// Plugin Management — the impure orchestration edge. A plugin is a
// directory under `plugins/<name>/plugin.json` (+ whatever code its
// entryPoint references); this module discovers/validates/registers
// them and tracks enabled/disabled/error state.
//
// SCOPE BOUNDARY, stated honestly: this covers the full plugin
// *lifecycle* — install, enable, disable, remove, health, permission
// declaration/tracking — and is genuinely marketplace-ready (a future
// marketplace only needs to drop a validated directory into `plugins/`
// and call installPlugin). It does NOT execute plugin code — no
// `require()`/`import()` of a plugin's entryPoint happens anywhere in
// this codebase. Actually loading and running third-party code inside
// this process safely needs a real isolation strategy (a worker thread
// or separate process with a capability-scoped API surface enforcing the
// declared `permissions`), which is a substantial, security-critical
// undertaking on its own — building an unsandboxed `require(entryPoint)`
// here would be actively dangerous to ship as "production-ready," not a
// shortcut worth taking. See docs/DEPLOYMENT.md's Plugin Management
// section.

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { PLUGINS_DIR } from "../../config/paths";
import { validatePluginManifest, type PluginManifest } from "./pluginManifest";
import { PluginRecordService, type PluginRow } from "./pluginRecord.service";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";
import { recordAuditEvent } from "../../knowledge/security/auditLog";

async function readManifest(pluginDirName: string): Promise<PluginManifest> {
  const manifestPath = path.join(PLUGINS_DIR, pluginDirName, "plugin.json");
  const raw = await fs.readFile(manifestPath, "utf-8").catch((err) => {
    throw new Error(`Cannot read ${manifestPath}: ${formatError(err)}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${manifestPath} is not valid JSON: ${formatError(err)}`);
  }
  const result = validatePluginManifest(parsed);
  if (!result.valid || !result.manifest) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${result.errors.join("; ")}`);
  }
  if (result.manifest.name !== pluginDirName) {
    throw new Error(`plugin.json's "name" (${result.manifest.name}) must match its directory name (${pluginDirName})`);
  }
  const entryPointPath = path.join(PLUGINS_DIR, pluginDirName, result.manifest.entryPoint);
  if (!fsSync.existsSync(entryPointPath)) {
    throw new Error(`entryPoint "${result.manifest.entryPoint}" not found at ${entryPointPath}`);
  }
  return result.manifest;
}

/** Every subdirectory of `plugins/` that has a plugin.json — candidates for installPlugin, regardless of whether they're already registered. */
export async function discoverPluginDirectories(): Promise<string[]> {
  await fs.mkdir(PLUGINS_DIR, { recursive: true, mode: 0o750 });
  const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (fsSync.existsSync(path.join(PLUGINS_DIR, entry.name, "plugin.json"))) {
      candidates.push(entry.name);
    }
  }
  return candidates;
}

/** Validates and registers (or re-registers, on upgrade) one plugin directory. Always leaves the plugin DISABLED — matches this product's "read-only/least-privilege by default, opt in explicitly" posture used everywhere else (Permission Engine grants, notification channels, ...). */
export async function installPlugin(databaseUrl: string, installationId: string, pluginDirName: string): Promise<PluginRow> {
  const manifest = await readManifest(pluginDirName);
  const records = new PluginRecordService(databaseUrl);
  try {
    const id = await records.upsert(installationId, manifest);
    logEvent({ component: "deployment-plugins", message: `Installed plugin "${manifest.name}"@${manifest.version} (disabled by default)`, status: "success" });
    recordAuditEvent({ type: "deployment_plugin_installed", detail: `${manifest.name}@${manifest.version}`, component: "deployment-plugins" });
    const row = await records.get(id);
    if (!row) throw new Error("Plugin row disappeared immediately after upsert — this should be unreachable");
    return row;
  } finally {
    await records.close();
  }
}

export async function enablePlugin(databaseUrl: string, id: string): Promise<void> {
  const records = new PluginRecordService(databaseUrl);
  try {
    const plugin = await records.get(id);
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    // Re-validate before enabling — the on-disk manifest/entry point may
    // have been removed/corrupted since install without going through
    // this module (a manual `rm`, a failed upgrade half-applied on disk).
    await readManifest(plugin.name);
    await records.setStatus(id, "ENABLED");
    logEvent({ component: "deployment-plugins", message: `Enabled plugin "${plugin.name}"`, status: "info" });
    recordAuditEvent({ type: "deployment_plugin_enabled", detail: plugin.name, component: "deployment-plugins" });
  } catch (err) {
    await records.setStatus(id, "ERROR", formatError(err));
    throw err;
  } finally {
    await records.close();
  }
}

export async function disablePlugin(databaseUrl: string, id: string): Promise<void> {
  const records = new PluginRecordService(databaseUrl);
  try {
    const plugin = await records.get(id);
    await records.setStatus(id, "DISABLED");
    if (plugin) recordAuditEvent({ type: "deployment_plugin_disabled", detail: plugin.name, component: "deployment-plugins" });
  } finally {
    await records.close();
  }
}

/** Removes the plugin's *registration* only — deliberately does not delete its on-disk directory. Blindly `rm -rf`-ing a path assembled from a database-stored plugin name is a real risk this module isn't willing to take automatically; removing the actual files is a manual (or install.sh-adjacent) operator action. */
export async function removePlugin(databaseUrl: string, id: string): Promise<void> {
  const records = new PluginRecordService(databaseUrl);
  try {
    const plugin = await records.get(id);
    await records.remove(id);
    if (plugin) recordAuditEvent({ type: "deployment_plugin_removed", detail: plugin.name, component: "deployment-plugins" });
  } finally {
    await records.close();
  }
}

/** Re-validates a plugin's manifest/entry point without changing its enabled/disabled state — surfaces drift (a plugin that was fine at install time but is now broken on disk) as an ERROR status rather than silently leaving a stale "ENABLED" that would fail if actually loaded. */
export async function checkPluginHealth(databaseUrl: string, id: string): Promise<PluginRow> {
  const records = new PluginRecordService(databaseUrl);
  try {
    const plugin = await records.get(id);
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    try {
      await readManifest(plugin.name);
      if (plugin.status === "ERROR") await records.setStatus(id, "DISABLED"); // recovered — but still requires an explicit re-enable, not auto-reactivated
    } catch (err) {
      await records.setStatus(id, "ERROR", formatError(err));
    }
    const refreshed = await records.get(id);
    if (!refreshed) throw new Error("Plugin disappeared during health check");
    return refreshed;
  } finally {
    await records.close();
  }
}

export async function listPlugins(databaseUrl: string, installationId: string): Promise<PluginRow[]> {
  const records = new PluginRecordService(databaseUrl);
  try {
    return await records.list(installationId);
  } finally {
    await records.close();
  }
}
