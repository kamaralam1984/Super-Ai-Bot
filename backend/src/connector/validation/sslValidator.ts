// SSL Certificate Validation — a real TLS handshake against a connector's
// baseUrl, inspecting the peer certificate's trust status, issuer/subject,
// and expiry. Independent of Phase 4's tech-detection TLS signal collector
// (`techdetect/signals/signalCollector.ts`) by design — that module
// exists to *describe* a site's technology stack for a report; this one
// exists to decide whether *this specific connector* can be trusted to
// keep working, a distinct module boundary even though the underlying
// mechanism (a TLS handshake) is similar.

import tls from "node:tls";
import type { SslCertificateInfo } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatCertName(name: Record<string, string> | undefined): string | null {
  if (!name) return null;
  return name.CN ?? name.O ?? (Object.keys(name).length > 0 ? JSON.stringify(name) : null);
}

function errorResult(errorMessage: string): SslCertificateInfo {
  return { valid: false, issuer: null, subject: null, validFrom: null, validTo: null, daysUntilExpiry: null, selfSigned: false, errorMessage };
}

/**
 * Returns `null` — not a failure — for a plain-HTTP `baseUrl`: there is no
 * certificate to validate, and reporting "invalid" would be misleading
 * (the connector may be intentionally, legitimately HTTP-only, e.g. a
 * purely local/internal system — a separate recommendation already flags
 * "no HTTPS" as a security concern; this function's job is narrower).
 *
 * Connects with `rejectUnauthorized: false` so the handshake still
 * completes for an untrusted/expired/self-signed certificate — the whole
 * point is to *inspect and report* on exactly that case, not just fail
 * fast the way a normal HTTPS request correctly would.
 */
export function validateSslCertificate(baseUrl: string, timeoutMs = 10_000): Promise<SslCertificateInfo | null> {
  let hostname: string;
  let port: number;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") return Promise.resolve(null);
    hostname = parsed.hostname;
    port = parsed.port ? Number(parsed.port) : 443;
  } catch {
    return Promise.resolve(errorResult(`"${baseUrl}" is not a valid URL.`));
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: SslCertificateInfo) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: timeoutMs, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError;
      socket.end();

      if (!cert || Object.keys(cert).length === 0) {
        settle(errorResult("The server completed a TLS handshake but presented no certificate."));
        return;
      }

      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const daysUntilExpiry = validTo && !Number.isNaN(validTo.getTime()) ? Math.floor((validTo.getTime() - Date.now()) / MS_PER_DAY) : null;
      const issuer = formatCertName(cert.issuer as Record<string, string> | undefined);
      const subject = formatCertName(cert.subject as Record<string, string> | undefined);

      settle({
        valid: authorized === true,
        issuer,
        subject,
        validFrom: cert.valid_from ?? null,
        validTo: cert.valid_to ?? null,
        daysUntilExpiry,
        selfSigned: issuer !== null && issuer === subject,
        errorMessage: authorized ? undefined : (authorizationError?.message ?? "Certificate is not trusted by this system's CA store."),
      });
    });

    socket.on("error", (err) => settle(errorResult(err.message)));
    socket.on("timeout", () => {
      socket.destroy();
      settle(errorResult(`TLS handshake to ${hostname}:${port} timed out after ${timeoutMs}ms.`));
    });
  });
}

const CERT_EXPIRY_WARNING_DAYS = 30;

/** True when a certificate is either already expired or will be within the warning window — the signal apiValidationEngine.ts/connectorReportGenerator.ts use to raise a recommendation before an outage actually happens. */
export function isCertificateExpiringSoon(info: SslCertificateInfo, warningDays: number = CERT_EXPIRY_WARNING_DAYS): boolean {
  return info.daysUntilExpiry !== null && info.daysUntilExpiry <= warningDays;
}
