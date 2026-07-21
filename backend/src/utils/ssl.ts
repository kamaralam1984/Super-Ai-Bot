import fs from "node:fs/promises";
import tls from "node:tls";

export interface LocalSslInfo {
  found: boolean;
  source: string | null;
  issuer: string | null;
  expiresAt: string | null;
}

const LETSENCRYPT_DIR = "/etc/letsencrypt/live";

/**
 * Detects whether this environment already has a working SSL setup: first via
 * a live TLS handshake against localhost:443 (authoritative — proves a server
 * is actually terminating TLS), falling back to checking for Let's Encrypt
 * certificate directories (present but perhaps not yet wired into a vhost).
 */
export async function detectLocalSsl(port443Listening: boolean): Promise<LocalSslInfo> {
  if (port443Listening) {
    const handshakeResult = await inspectTlsCertificate("localhost", 443).catch(() => null);
    if (handshakeResult) return handshakeResult;
  }

  try {
    const entries = await fs.readdir(LETSENCRYPT_DIR);
    if (entries.length > 0) {
      return { found: true, source: `${LETSENCRYPT_DIR}/${entries[0]}`, issuer: "Let's Encrypt (on disk, not yet verified live)", expiresAt: null };
    }
  } catch {
    // directory doesn't exist — no certbot certs present
  }

  return { found: false, source: null, issuer: null, expiresAt: null };
}

/** Exported for deployment/health/healthCheckEngine.ts's post-deployment SSL check, which inspects the PUBLIC domain's live certificate (not localhost — the backend container has no TLS listener of its own; nginx terminates TLS) via the same real-handshake technique this module already uses for its own local-detection purpose. */
export function inspectTlsCertificate(host: string, port: number): Promise<LocalSslInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: 3000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || Object.keys(cert).length === 0) {
        reject(new Error("No certificate presented"));
        return;
      }
      const issuerField = cert.issuer?.O ?? cert.issuer?.CN ?? null;
      resolve({
        found: true,
        source: `TLS handshake (${host}:${port})`,
        issuer: Array.isArray(issuerField) ? issuerField[0] ?? null : issuerField,
        expiresAt: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS handshake timed out"));
    });
    socket.on("error", reject);
  });
}
