import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./circuitBreaker";

describe("CircuitBreaker", () => {
  it("starts CLOSED and allows attempts", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.getState("a")).toBe("CLOSED");
    expect(cb.canAttempt("a")).toBe(true);
  });

  it("opens after failureThreshold consecutive failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    cb.recordFailure("a", 0);
    cb.recordFailure("a", 0);
    expect(cb.getState("a")).toBe("CLOSED");
    cb.recordFailure("a", 0);
    expect(cb.getState("a")).toBe("OPEN");
    expect(cb.canAttempt("a", 0)).toBe(false);
  });

  it("moves to HALF_OPEN after resetTimeoutMs elapses, then CLOSED on success", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure("a", 0);
    expect(cb.getState("a")).toBe("OPEN");
    expect(cb.canAttempt("a", 500)).toBe(false);
    expect(cb.canAttempt("a", 1000)).toBe(true);
    expect(cb.getState("a")).toBe("HALF_OPEN");
    cb.recordSuccess("a");
    expect(cb.getState("a")).toBe("CLOSED");
  });

  it("re-opens immediately on a HALF_OPEN failure", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure("a", 0);
    cb.canAttempt("a", 1000); // transitions to HALF_OPEN
    cb.recordFailure("a", 1000);
    expect(cb.getState("a")).toBe("OPEN");
  });

  it("tracks independent state per key", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure("connector-a", 0);
    expect(cb.getState("connector-a")).toBe("OPEN");
    expect(cb.getState("connector-b")).toBe("CLOSED");
  });

  it("reset() clears state back to CLOSED", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure("a", 0);
    expect(cb.getState("a")).toBe("OPEN");
    cb.reset("a");
    expect(cb.getState("a")).toBe("CLOSED");
  });

  it("recordSuccess resets the consecutive failure count", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    cb.recordFailure("a", 0);
    cb.recordFailure("a", 0);
    cb.recordSuccess("a");
    cb.recordFailure("a", 0);
    cb.recordFailure("a", 0);
    expect(cb.getState("a")).toBe("CLOSED"); // would be OPEN if the earlier failures hadn't been reset
  });
});
