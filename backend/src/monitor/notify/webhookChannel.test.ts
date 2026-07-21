import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const safeFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../scanner/http/safeFetch", () => ({ safeFetch: safeFetchMock }));

import { deliverWebhookNotification, verifyWebhookSignature } from "./webhookChannel";

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("deliverWebhookNotification", () => {
  it("POSTs the JSON payload with a valid HMAC signature header", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, statusCode: 200, body: Buffer.from(""), headers: {}, finalUrl: "https://example.com/hook" });

    const result = await deliverWebhookNotification({ url: "https://example.com/hook", secret: "s3cr3t", payload: { type: "TRAINING_COMPLETED", message: "done" } });

    expect(result).toEqual({ ok: true, statusCode: 200 });
    const call = safeFetchMock.mock.calls[0];
    expect(call[0]).toBe("https://example.com/hook");
    expect(call[1].method).toBe("POST");
    const expectedSignature = crypto.createHmac("sha256", "s3cr3t").update(call[1].body).digest("hex");
    expect(call[1].headers["X-KVL-Signature"]).toBe(expectedSignature);
  });

  it("returns ok:false with the status code when the endpoint responds with an error status", async () => {
    safeFetchMock.mockResolvedValue({ ok: false, statusCode: 500, body: Buffer.from(""), headers: {}, finalUrl: "https://example.com/hook" });
    const result = await deliverWebhookNotification({ url: "https://example.com/hook", secret: "s", payload: {} });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it("returns ok:false with the error message when the request throws (e.g. SSRF-blocked or unreachable)", async () => {
    safeFetchMock.mockRejectedValue(new Error("Blocked as an unsafe destination"));
    const result = await deliverWebhookNotification({ url: "http://169.254.169.254/hook", secret: "s", payload: {} });
    expect(result).toEqual({ ok: false, errorMessage: "Blocked as an unsafe destination" });
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = crypto.createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(false);
  });

  it("rejects a tampered body", () => {
    const originalBody = JSON.stringify({ a: 1 });
    const signature = crypto.createHmac("sha256", "secret").update(originalBody).digest("hex");
    expect(verifyWebhookSignature(JSON.stringify({ a: 2 }), signature, "secret")).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature("{}", undefined, "secret")).toBe(false);
    expect(verifyWebhookSignature("{}", null, "secret")).toBe(false);
  });

  it("rejects a signature of a different length without throwing", () => {
    expect(verifyWebhookSignature("{}", "short", "secret")).toBe(false);
  });
});
