import { describe, it, expect } from "vitest";
import { attemptReconnection } from "./reconnectionEngine";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";

const NONE_CRED = { authMethod: "NONE" as const };

describe("attemptReconnection — real network", () => {
  it("recovers immediately (1 attempt) against a real, reachable site", async () => {
    const result = await attemptReconnection({
      connectorId: `test-reconnect-ok-${Date.now()}`,
      baseUrl: "https://wptavern.com",
      checkPath: "/",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
      maxAttempts: 3,
    });
    expect(result.recovered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.notifyAdministrator).toBe(false);
  }, 20_000);

  it("exhausts all attempts and requests admin notification for a genuinely dead host", async () => {
    const result = await attemptReconnection({
      connectorId: `test-reconnect-dead-${Date.now()}`,
      baseUrl: "https://this-domain-genuinely-does-not-exist-kvl-test.invalid",
      checkPath: "/",
      credential: NONE_CRED,
      config: { ...DEFAULT_CONNECTOR_CONFIG, timeoutMs: 3000, retryPolicy: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 } },
      maxAttempts: 2,
    });
    expect(result.recovered).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.notifyAdministrator).toBe(true);
    expect(result.finalStatus).not.toBe("CONNECTED");
    expect(result.history).toHaveLength(2);
  }, 30_000);

  it("does not attempt an OAuth2 token refresh when the credential has no expiresAt (nothing to refresh)", async () => {
    const result = await attemptReconnection({
      connectorId: `test-reconnect-oauth-noexpiry-${Date.now()}`,
      baseUrl: "https://wptavern.com",
      checkPath: "/",
      credential: { authMethod: "OAUTH2", oauth2: { accessToken: "some-token" } },
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.tokenRefreshed).toBe(false);
  }, 20_000);
});
