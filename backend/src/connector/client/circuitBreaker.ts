// A minimal, dependency-free circuit breaker (CLOSED → OPEN → HALF_OPEN).
// One instance per connector, keyed by the caller. Consistent with this
// codebase's established preference for small hand-rolled utilities over
// pulling in a library (e.g. TokenBucketRateLimiter) — there's no existing
// circuit-breaker dependency and the state machine is small enough that a
// dependency would add more surface than it saves.

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private circuits = new Map<string, CircuitRecord>();

  constructor(private options: CircuitBreakerOptions) {}

  private get(key: string): CircuitRecord {
    let record = this.circuits.get(key);
    if (!record) {
      record = { state: "CLOSED", consecutiveFailures: 0, openedAt: null };
      this.circuits.set(key, record);
    }
    return record;
  }

  /** True if a request is currently allowed through (CLOSED, or OPEN but the reset timeout has elapsed — moves it to HALF_OPEN). */
  canAttempt(key: string, now: number = Date.now()): boolean {
    const record = this.get(key);
    if (record.state === "CLOSED") return true;
    if (record.state === "OPEN") {
      if (record.openedAt !== null && now - record.openedAt >= this.options.resetTimeoutMs) {
        record.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN — allow exactly one probe through; recordSuccess/recordFailure decide the outcome
  }

  recordSuccess(key: string): void {
    const record = this.get(key);
    record.state = "CLOSED";
    record.consecutiveFailures = 0;
    record.openedAt = null;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const record = this.get(key);
    record.consecutiveFailures += 1;
    if (record.state === "HALF_OPEN" || record.consecutiveFailures >= this.options.failureThreshold) {
      record.state = "OPEN";
      record.openedAt = now;
    }
  }

  getState(key: string): CircuitState {
    return this.get(key).state;
  }

  reset(key: string): void {
    this.circuits.delete(key);
  }
}
