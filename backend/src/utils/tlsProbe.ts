import tls from "node:tls";

export interface TlsProbeResult {
  reachable: boolean;
  authorized: boolean;
  issuer: string | null;
  expiresAt: string | null;
  error: string | null;
  /** negotiated protocol version, e.g. "TLSv1.3" — null when the handshake never completed */
  protocol: string | null;
}

/**
 * Probes a remote host's TLS endpoint directly (not via fetch) so we can
 * distinguish "TLS port doesn't answer at all" from "TLS answers but the
 * certificate isn't trusted/expired" — fetch alone collapses both into one
 * generic network error, which isn't precise enough for Step 3's separate
 * SSL vs HTTPS checks.
 */
export function probeTls(hostname: string, port = 443, timeoutMs = 6000): Promise<TlsProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      if (settled) return;
      settled = true;
      const cert = socket.getPeerCertificate();
      const issuerField = cert?.issuer?.O ?? cert?.issuer?.CN ?? null;
      resolve({
        reachable: true,
        authorized: socket.authorized,
        issuer: Array.isArray(issuerField) ? issuerField[0] ?? null : issuerField ?? null,
        expiresAt: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null,
        error: socket.authorized ? null : String(socket.authorizationError ?? "Certificate not trusted"),
        protocol: socket.getProtocol(),
      });
      socket.end();
    });
    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable: false, authorized: false, issuer: null, expiresAt: null, error: "TLS handshake timed out", protocol: null });
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({ reachable: false, authorized: false, issuer: null, expiresAt: null, error: err.message, protocol: null });
    });
  });
}
