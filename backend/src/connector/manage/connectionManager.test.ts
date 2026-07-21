import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RetryQueue, selectConnectorForCategory, withFailover } from "./connectionManager";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { ConnectorRecord } from "../connectorRecord.service";

function connector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: "conn-1",
    installationId: "install-1",
    crawlJobId: null,
    name: "Connector",
    connectorType: "GENERIC_REST",
    authMethod: "NONE",
    baseUrl: "https://example.com",
    status: "CONNECTED",
    config: DEFAULT_CONNECTOR_CONFIG,
    priority: 0,
    healthScore: null,
    securityScore: null,
    lastHealthCheckAt: null,
    lastErrorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("selectConnectorForCategory", () => {
  it("orders candidates by priority, lower first", () => {
    const low = connector({ id: "low", priority: 5 });
    const high = connector({ id: "high", priority: 1 });
    const result = selectConnectorForCategory(
      [
        { connector: low, hasCategoryEndpoint: true },
        { connector: high, hasCategoryEndpoint: true },
      ],
      "products"
    );
    expect(result.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("breaks a priority tie by createdAt, older first", () => {
    const newer = connector({ id: "newer", priority: 1, createdAt: new Date("2026-02-01T00:00:00Z") });
    const older = connector({ id: "older", priority: 1, createdAt: new Date("2026-01-01T00:00:00Z") });
    const result = selectConnectorForCategory(
      [
        { connector: newer, hasCategoryEndpoint: true },
        { connector: older, hasCategoryEndpoint: true },
      ],
      "products"
    );
    expect(result.map((c) => c.id)).toEqual(["older", "newer"]);
  });

  it("excludes a connector with no endpoint for the category", () => {
    const result = selectConnectorForCategory([{ connector: connector(), hasCategoryEndpoint: false }], "products");
    expect(result).toEqual([]);
  });

  it("excludes a DISCONNECTED or ERROR connector even if it has the endpoint", () => {
    const result = selectConnectorForCategory(
      [
        { connector: connector({ id: "down", status: "DISCONNECTED" }), hasCategoryEndpoint: true },
        { connector: connector({ id: "errored", status: "ERROR" }), hasCategoryEndpoint: true },
      ],
      "products"
    );
    expect(result).toEqual([]);
  });

  it("includes a DEGRADED connector, not just CONNECTED", () => {
    const result = selectConnectorForCategory([{ connector: connector({ status: "DEGRADED" }), hasCategoryEndpoint: true }], "products");
    expect(result).toHaveLength(1);
  });
});

describe("withFailover", () => {
  it("returns the first connector's successful result without trying the rest", async () => {
    const c1 = connector({ id: "c1" });
    const c2 = connector({ id: "c2" });
    const attempt = vi.fn(async (c: ConnectorRecord) => ({ ok: c.id === "c1" }));
    const result = await withFailover([c1, c2], attempt, (r) => r.ok);
    expect(result).toEqual({ succeeded: true, result: { ok: true }, attemptedConnectorIds: ["c1"] });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("falls through to the next connector when the first attempt throws", async () => {
    const c1 = connector({ id: "c1" });
    const c2 = connector({ id: "c2" });
    const attempt = vi.fn(async (c: ConnectorRecord) => {
      if (c.id === "c1") throw new Error("circuit open");
      return { ok: true };
    });
    const result = await withFailover([c1, c2], attempt, (r) => r.ok);
    expect(result.succeeded).toBe(true);
    expect(result.attemptedConnectorIds).toEqual(["c1", "c2"]);
  });

  it("falls through to the next connector when isSuccess rejects the result", async () => {
    const c1 = connector({ id: "c1" });
    const c2 = connector({ id: "c2" });
    const attempt = vi.fn(async (c: ConnectorRecord) => ({ ok: c.id === "c2" }));
    const result = await withFailover([c1, c2], attempt, (r) => r.ok);
    expect(result.succeeded).toBe(true);
    expect(result.result).toEqual({ ok: true });
    expect(result.attemptedConnectorIds).toEqual(["c1", "c2"]);
  });

  it("reports failure (not a throw) when every connector fails", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("unreachable");
    });
    const result = await withFailover([connector({ id: "c1" }), connector({ id: "c2" })], attempt, () => true);
    expect(result.succeeded).toBe(false);
    expect(result.attemptedConnectorIds).toEqual(["c1", "c2"]);
    expect(result.lastError).toMatch(/unreachable/);
  });

  it("returns failure immediately for an empty candidate list", async () => {
    const attempt = vi.fn();
    const result = await withFailover([], attempt, () => true);
    expect(result.succeeded).toBe(false);
    expect(attempt).not.toHaveBeenCalled();
  });
});

describe("RetryQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a task and runs it after the base delay on the first attempt", () => {
    const queue = new RetryQueue({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000, maxPending: 10 });
    const task = vi.fn();
    expect(queue.schedule("job-1", task)).toBe(true);
    expect(queue.size).toBe(1);

    vi.advanceTimersByTime(999);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
    expect(queue.size).toBe(0);
  });

  it("doubles the delay on each successive scheduled attempt for the same id (exponential backoff)", () => {
    const queue = new RetryQueue({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000, maxPending: 10 });
    queue.schedule("job-1", () => undefined);
    queue.schedule("job-1", () => undefined); // re-scheduling before the first fires cancels+replaces it, now at attempt 2
    vi.advanceTimersByTime(199);
    const task = vi.fn();
    queue.schedule("job-1", task); // attempt 3 -> 400ms
    vi.advanceTimersByTime(399);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it("caps the delay at maxDelayMs", () => {
    const queue = new RetryQueue({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 3000, maxPending: 10 });
    for (let i = 0; i < 4; i++) queue.schedule("job-1", () => undefined); // attempts 1-4 would be 1000/2000/4000/8000 uncapped
    const task = vi.fn();
    queue.schedule("job-1", task); // attempt 5, capped at 3000ms
    vi.advanceTimersByTime(2999);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it("refuses to schedule beyond maxAttempts", () => {
    const queue = new RetryQueue({ maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 100, maxPending: 10 });
    expect(queue.schedule("job-1", () => undefined)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(queue.schedule("job-1", () => undefined)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(queue.schedule("job-1", () => undefined)).toBe(false);
  });

  it("refuses to schedule a new id once maxPending is reached", () => {
    const queue = new RetryQueue({ maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 5000, maxPending: 2 });
    expect(queue.schedule("job-1", () => undefined)).toBe(true);
    expect(queue.schedule("job-2", () => undefined)).toBe(true);
    expect(queue.schedule("job-3", () => undefined)).toBe(false);
  });

  it("reset() clears attempt history so a later schedule starts fresh at the base delay", () => {
    const queue = new RetryQueue({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000, maxPending: 10 });
    queue.schedule("job-1", () => undefined);
    vi.advanceTimersByTime(200);
    queue.reset("job-1");

    const task = vi.fn();
    queue.schedule("job-1", task);
    vi.advanceTimersByTime(99);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it("clear() cancels every pending timer", () => {
    const queue = new RetryQueue({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000, maxPending: 10 });
    const task = vi.fn();
    queue.schedule("job-1", task);
    queue.clear();
    vi.advanceTimersByTime(10_000);
    expect(task).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });
});
