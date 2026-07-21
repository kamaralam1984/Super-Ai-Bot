// Plugin Management — manifest validation (pure, no filesystem/Prisma).
// A plugin is a directory under `plugins/<name>/` containing a
// `plugin.json` matching this shape plus whatever code its own
// `entryPoint` references. See pluginService.ts for install/enable/
// disable orchestration, and this module's own bottom section for the
// documented scope boundary (registration/lifecycle only — no runtime
// code execution ships in this phase).

/** Read-only capabilities a plugin can declare — deliberately read-only and deliberately scoped to the same business-data categories Phase 7's Permission Engine already governs for AI/connector access, so a plugin never gets a *broader* grant than a connector already can. `webhook:outbound` is the one non-data capability, for a plugin that needs to call out to an external service (e.g. push a notification) rather than read internal data. */
export const KNOWN_PLUGIN_PERMISSIONS = [
  "read:products",
  "read:services",
  "read:faqs",
  "read:orders",
  "read:customers",
  "read:inventory",
  "read:appointments",
  "read:categories",
  "read:pricing",
  "read:shipping",
  "read:blogs",
  "read:support_articles",
  "read:conversations",
  "read:knowledge",
  "webhook:outbound",
] as const;

export type PluginPermission = (typeof KNOWN_PLUGIN_PERMISSIONS)[number];

export interface PluginManifest {
  name: string;
  version: string;
  entryPoint: string;
  permissions: PluginPermission[];
  description?: string;
  author?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  manifest?: PluginManifest;
  errors: string[];
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/; // lowercase, digits, hyphens — safe as both a directory name and a DB unique key
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Validates a plugin.json's raw parsed content. Rejects anything with an
 * unknown declared permission outright — a plugin asking for a
 * capability this host doesn't recognize is either malformed or asking
 * for something never intended to be grantable, and "silently ignore the
 * unknown permission" would be the wrong failure mode for a permissions
 * list (fail closed, not open).
 */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: ["plugin.json must be a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || !NAME_PATTERN.test(obj.name)) {
    errors.push("`name` must be a lowercase alphanumeric-and-hyphen string, 2-64 characters");
  }
  if (typeof obj.version !== "string" || !SEMVER_PATTERN.test(obj.version)) {
    errors.push("`version` must be a semver string (e.g. \"1.0.0\")");
  }
  if (typeof obj.entryPoint !== "string" || obj.entryPoint.trim() === "") {
    errors.push("`entryPoint` must be a non-empty string (relative path to the plugin's main file)");
  } else if (obj.entryPoint.includes("..") || path_isAbsolute(obj.entryPoint)) {
    errors.push("`entryPoint` must be a relative path inside the plugin's own directory (no \"..\" or absolute paths)");
  }

  let permissions: PluginPermission[] = [];
  if (obj.permissions !== undefined) {
    if (!Array.isArray(obj.permissions) || !obj.permissions.every((p) => typeof p === "string")) {
      errors.push("`permissions` must be an array of strings");
    } else {
      const unknown = obj.permissions.filter((p) => !(KNOWN_PLUGIN_PERMISSIONS as readonly string[]).includes(p));
      if (unknown.length > 0) {
        errors.push(`Unknown permission(s): ${unknown.join(", ")} — allowed: ${KNOWN_PLUGIN_PERMISSIONS.join(", ")}`);
      } else {
        permissions = obj.permissions as PluginPermission[];
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    manifest: {
      name: obj.name as string,
      version: obj.version as string,
      entryPoint: obj.entryPoint as string,
      permissions,
      description: typeof obj.description === "string" ? obj.description : undefined,
      author: typeof obj.author === "string" ? obj.author : undefined,
    },
  };
}

// A tiny local reimplementation of path.isAbsolute's POSIX check —
// avoids importing Node's `path` module into an otherwise dependency-free
// pure module just for one predicate, and this file only ever validates
// POSIX-style relative paths (plugin manifests are cross-platform JSON,
// not host paths).
function path_isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}
