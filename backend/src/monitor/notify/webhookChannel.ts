// Outbound webhook notification delivery — an HMAC-SHA256-signed POST to
// an administrator-configured URL, going through `safeFetch` (the same
// SSRF-guarded entry point every other outbound call in this product
// uses; a webhook URL is admin-configured but still an arbitrary outbound
// destination). Signing follows the exact same scheme
// connector/auth/authManager.ts's `signRequest` already established for
// outbound connector calls — one HMAC convention for the whole product,
// not a second one invented here. `verifyWebhookSignature` is reused for
// *inbound* webhook verification too (see routes for the on-demand-scan
// webhook trigger).

import crypto from "node:crypto";
import { safeFetch } from "../../scanner/http/safeFetch";

function signPayload(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export interface WebhookDeliveryParams {
  url: string;
  secret: string;
  payload: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  ok: boolean;
  statusCode?: number;
  errorMessage?: string;
}

export async function deliverWebhookNotification(params: WebhookDeliveryParams): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(params.payload);
  const signature = signPayload(body, params.secret);

  try {
    const response = await safeFetch(params.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KVL-Signature": signature },
      body,
      timeoutMs: 10_000,
    });
    if (!response.ok) {
      return { ok: false, statusCode: response.statusCode, errorMessage: `Webhook endpoint responded with HTTP ${response.statusCode}` };
    }
    return { ok: true, statusCode: response.statusCode };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

/** Constant-time comparison, same reasoning as knowledge/security/accessControl.ts's `verifyApiKey` — a naive `===` on a signature leaks timing information proportional to how many leading bytes match. */
export function verifyWebhookSignature(body: string, providedSignature: string | undefined | null, secret: string): boolean {
  if (!providedSignature) return false;
  const expected = signPayload(body, secret);
  const provided = Buffer.from(providedSignature, "utf-8");
  const expectedBuf = Buffer.from(expected, "utf-8");
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}
