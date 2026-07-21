import { describe, it, expect } from "vitest";
import { computeHealthScore, classifyStatus, performHealthCheck } from "./healthMonitor";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { HealthCheckResult } from "../types";

function check(status: HealthCheckResult["status"], latencyMs: number | null, availability: number): HealthCheckResult {
  return { status, latencyMs, availability, checkedAt: new Date().toISOString() };
}

describe("computeHealthScore", () => {
  it("returns 0 for empty history", () => {
    expect(computeHealthScore([])).toBe(0);
  });

  it("returns 100 for all-connected, zero-latency history", () => {
    expect(computeHealthScore([check("CONNECTED", 0, 1), check("CONNECTED", 0, 1)])).toBe(100);
  });

  it("returns 0 for all-disconnected history", () => {
    expect(computeHealthScore([check("DISCONNECTED", null, 0), check("DISCONNECTED", null, 0)])).toBe(0);
  });

  it("scores partial availability between 0 and 100", () => {
    const score = computeHealthScore([check("CONNECTED", 100, 1), check("DISCONNECTED", null, 0)]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("penalizes high latency even at full availability", () => {
    const fast = computeHealthScore([check("CONNECTED", 50, 1)]);
    const slow = computeHealthScore([check("CONNECTED", 4900, 1)]);
    expect(slow).toBeLessThan(fast);
  });
});

describe("classifyStatus", () => {
  it("returns PENDING for no history", () => {
    expect(classifyStatus([])).toBe("PENDING");
  });

  it("returns CONNECTED when the most recent check succeeded", () => {
    expect(classifyStatus([check("DISCONNECTED", null, 0), check("CONNECTED", 50, 1)])).toBe("CONNECTED");
  });

  it("returns DEGRADED for a single recent failure after a success", () => {
    expect(classifyStatus([check("CONNECTED", 50, 1), check("DEGRADED", 200, 0)])).toBe("DEGRADED");
  });

  it("returns DISCONNECTED after 3+ consecutive failures", () => {
    expect(classifyStatus([check("CONNECTED", 50, 1), check("DEGRADED", null, 0), check("DEGRADED", null, 0), check("DISCONNECTED", null, 0)])).toBe("DISCONNECTED");
  });
});

// Real-network: pings genuinely reachable and genuinely unreachable hosts.
describe("performHealthCheck — real network", () => {
  it("reports CONNECTED for a real, reachable HTTPS site", async () => {
    const result = await performHealthCheck({
      connectorId: "healthmonitor-test-live",
      baseUrl: "https://wptavern.com",
      checkPath: "/",
      credential: { authMethod: "NONE" },
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.status).toBe("CONNECTED");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it("reports DISCONNECTED for a domain that doesn't resolve", async () => {
    const result = await performHealthCheck({
      connectorId: "healthmonitor-test-dead",
      baseUrl: "https://this-domain-genuinely-does-not-exist-kvl-test.invalid",
      checkPath: "/",
      credential: { authMethod: "NONE" },
      config: { ...DEFAULT_CONNECTOR_CONFIG, timeoutMs: 5000 },
    });
    expect(result.status).toBe("DISCONNECTED");
    expect(result.availability).toBe(0);
    expect(result.errorMessage).toBeTruthy();
  }, 20_000);
});
