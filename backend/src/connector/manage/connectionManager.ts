// Connection Manager — Priority Rules + Failover across multiple
// connectors that can serve the same EndpointCategory for one
// installation, plus a bounded in-process Retry Queue for transient
// failures. "In-process" is a real, stated scope boundary — this product
// runs one long-lived Node process per self-hosted installation (the same
// precedent every other in-process mechanism in this codebase follows,
// e.g. Phase 6's retrain/retrainScheduler.ts) — not a distributed job
// queue this product's deployment model doesn't call for.

import type { ConnectorRecord } from "../connectorRecord.service";
import type { EndpointCategory } from "../types";

const CALLABLE_STATUSES = new Set<ConnectorRecord["status"]>(["CONNECTED", "DEGRADED"]);

export interface ConnectorCandidate {
  connector: ConnectorRecord;
  hasCategoryEndpoint: boolean;
}

/**
 * Orders connectors by priority (lower number first — matches
 * schema.prisma's `Connector.priority` doc comment), then by `createdAt`
 * (older first) as a deterministic tie-break — never a random pick
 * between equally-configured connectors. Only connectors that are
 * currently callable (CONNECTED/DEGRADED) and have at least one validated
 * endpoint for the requested category are candidates at all; `category`
 * itself isn't used for filtering here (the caller already determined
 * `hasCategoryEndpoint` per candidate) — it's accepted for a clearer call
 * site and future category-specific tie-break rules.
 */
export function selectConnectorForCategory(candidates: ConnectorCandidate[], _category: EndpointCategory): ConnectorRecord[] {
  return candidates
    .filter((c) => c.hasCategoryEndpoint && CALLABLE_STATUSES.has(c.connector.status))
    .sort((a, b) => a.connector.priority - b.connector.priority || a.connector.createdAt.getTime() - b.connector.createdAt.getTime())
    .map((c) => c.connector);
}

export interface FailoverResult<T> {
  succeeded: boolean;
  result?: T;
  attemptedConnectorIds: string[];
  lastError?: string;
}

/**
 * Tries each ordered connector in turn, stopping at the first one whose
 * `attempt` both resolves without throwing *and* satisfies `isSuccess` —
 * a connector-level failure (thrown error, e.g. CircuitOpenError, or a
 * result `isSuccess` rejects, e.g. a `ToolResult` with `ok: false`) moves
 * to the next candidate rather than failing the whole call. Every
 * candidate failing is reported as `succeeded: false`, never thrown, so a
 * caller (the AI tool layer, the chat engine) can degrade gracefully
 * instead of needing a try/catch around every call site.
 */
export async function withFailover<T>(orderedConnectors: ConnectorRecord[], attempt: (connector: ConnectorRecord) => Promise<T>, isSuccess: (result: T) => boolean): Promise<FailoverResult<T>> {
  const attemptedConnectorIds: string[] = [];
  let lastError: string | undefined;

  for (const connector of orderedConnectors) {
    attemptedConnectorIds.push(connector.id);
    try {
      const result = await attempt(connector);
      if (isSuccess(result)) {
        return { succeeded: true, result, attemptedConnectorIds };
      }
      lastError = `Connector "${connector.name}" returned an unsuccessful result.`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { succeeded: false, attemptedConnectorIds, lastError };
}

export interface RetryQueueOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Caps how many retry timers can be pending at once — a bound against unbounded queue growth if a caller schedules retries faster than they resolve. */
  maxPending: number;
}

/** A bounded, in-process retry queue: schedules a delayed re-attempt of a transiently-failed operation (exponential backoff, per-id attempt tracking) without blocking the caller that triggered it. */
export class RetryQueue {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private attempts = new Map<string, number>();

  constructor(private options: RetryQueueOptions) {}

  get size(): number {
    return this.pending.size;
  }

  private backoffDelay(attempt: number): number {
    return Math.min(this.options.baseDelayMs * 2 ** (attempt - 1), this.options.maxDelayMs);
  }

  /** Schedules `task` after an exponential-backoff delay based on how many times this `id` has already been retried. Returns `false` (without scheduling) once `id` has exhausted `maxAttempts`, or the queue is at `maxPending` capacity for a genuinely new id — either case means "give up, don't retry again," which the caller should treat as final. */
  schedule(id: string, task: () => void): boolean {
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    if (attempt > this.options.maxAttempts) return false;
    if (this.pending.size >= this.options.maxPending && !this.pending.has(id)) return false;

    this.cancel(id);
    this.attempts.set(id, attempt);
    const timer = setTimeout(() => {
      this.pending.delete(id);
      task();
    }, this.backoffDelay(attempt));
    this.pending.set(id, timer);
    return true;
  }

  /** Clears retry state for `id` — call once an attempt actually succeeds, so a later transient failure starts its backoff fresh rather than continuing an old attempt count. */
  reset(id: string): void {
    this.cancel(id);
    this.attempts.delete(id);
  }

  private cancel(id: string): void {
    const timer = this.pending.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  /** Cancels every pending retry and forgets all attempt counts — for tests and graceful process shutdown. */
  clear(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.attempts.clear();
  }
}
