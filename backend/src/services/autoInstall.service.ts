// Talks to kvl-installer-daemon.py (deploy/scripts/kvl-installer-daemon.py)
// over a Unix domain socket — a small privileged helper running directly
// on the VPS host (NOT a container) that this backend has no other way
// to reach, by design (Docker isolation keeps this API from ever having
// host-level command execution on its own). See that daemon's module
// docstring for the full threat model and the domain-allowlist gate.
//
// The socket is optional infrastructure: on any deployment where
// deploy/systemd/kvl-installer.service isn't installed (local dev, a
// fresh VPS before the admin sets this up, a non-Docker install), the
// connection simply fails and every function here resolves to "not
// eligible" / "failed" rather than throwing — the tenant dashboard falls
// back to the manual copy-paste instructions it already shows, so this
// feature is additive, never a hard dependency.

import net from "node:net";

const SOCKET_PATH = process.env.KVL_INSTALLER_SOCKET || "/run/kvl-installer/kvl-installer.sock";
const CHECK_TIMEOUT_MS = 3000;
const INSTALL_TIMEOUT_MS = 20000;

function sendCommand(line: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let response = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("kvl-installer-daemon timed out"));
    }, timeoutMs);

    socket.on("connect", () => socket.write(line + "\n"));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response.trim());
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether `websiteUrl`'s host is on the admin-maintained allowlist for one-click install — drives whether the dashboard offers the "Install Chatbot Automatically" button at all. */
export async function checkAutoInstallEligible(websiteUrl: string): Promise<boolean> {
  const domain = hostnameOf(websiteUrl);
  if (!domain) return false;
  try {
    const reply = await sendCommand(`CHECK ${domain}`, CHECK_TIMEOUT_MS);
    return reply === "OK";
  } catch {
    return false;
  }
}

export type AutoInstallResult = { ok: true } | { ok: false; message: string };

/** Actually performs the install for `websiteUrl` — only ever called after a tenant explicitly clicks the button; the daemon re-validates the allowlist independently regardless. */
export async function runAutoInstall(websiteUrl: string, installationId: string): Promise<AutoInstallResult> {
  const domain = hostnameOf(websiteUrl);
  if (!domain) return { ok: false, message: "This website's URL couldn't be parsed." };

  let reply: string;
  try {
    reply = await sendCommand(`INSTALL ${domain} ${installationId}`, INSTALL_TIMEOUT_MS);
  } catch {
    return { ok: false, message: "Automatic installation is unavailable right now. Use the manual steps below instead." };
  }

  if (reply === "OK") return { ok: true };
  if (reply === "NOT_ALLOWED") return { ok: false, message: "This website isn't registered for automatic installation yet." };
  if (reply === "INVALID_INSTALLATION_ID") return { ok: false, message: "Invalid installation id." };
  return { ok: false, message: reply.startsWith("ERROR ") ? reply.slice("ERROR ".length) : "Automatic installation failed." };
}
