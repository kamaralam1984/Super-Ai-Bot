import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobQueue } from "./jobQueue";
import type { JobDefinition } from "./jobQueue";

function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return { id: "job-1", type: "test", priority: 0, payload: {}, attempts: 0, maxAttempts: 3, scheduledFor: Date.now(), ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("JobQueue — basic execution", () => {
  it("runs a registered handler for an enqueued job", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    const handler = vi.fn(async () => undefined);
    queue.registerHandler("test", handler);
    queue.enqueue(job());

    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("calls onStarted and onCompleted for a successful job", async () => {
    const onStarted = vi.fn();
    const onCompleted = vi.fn();
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } }, { onStarted, onCompleted });
    queue.registerHandler("test", async () => undefined);
    queue.enqueue(job({ id: "j1" }));

    await vi.advanceTimersByTimeAsync(0);
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
  });

  it("fails a job with no registered handler and reports onFailed", async () => {
    const onFailed = vi.fn();
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } }, { onFailed });
    queue.enqueue(job({ maxAttempts: 1 }));

    await vi.advanceTimersByTimeAsync(0);
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }), expect.any(Error), false);
  });

  it("does not exceed the configured concurrency, across the full backlog until drained", async () => {
    const queue = new JobQueue({ concurrency: 2, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    let concurrentCount = 0;
    let maxConcurrent = 0;
    let resolvers: Array<() => void> = [];
    queue.registerHandler("test", () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          concurrentCount--;
          resolve();
        });
      });
    });

    for (let i = 0; i < 5; i++) queue.enqueue(job({ id: `j${i}` }));
    await vi.advanceTimersByTimeAsync(0);

    expect(maxConcurrent).toBe(2);
    expect(queue.runningCount).toBe(2);
    expect(queue.pendingCount).toBe(3);

    // Drain in waves: resolving the currently-running jobs immediately
    // pulls more from the backlog (3 still pending), so full drainage
    // takes multiple rounds, not one.
    while (queue.runningCount > 0 || queue.pendingCount > 0) {
      const toResolve = resolvers;
      resolvers = [];
      toResolve.forEach((r) => r());
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(maxConcurrent).toBe(2); // never exceeded, across every wave
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });
});

describe("JobQueue — priority ordering", () => {
  it("runs lower priority-number jobs first", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    const order: string[] = [];

    // Saturate the single concurrency slot with a "blocker" job first —
    // with concurrency:1, whichever job is enqueued first claims the only
    // free slot immediately, before the others even exist to be sorted
    // against. To actually observe priority ordering, capacity must
    // already be full when the real jobs are enqueued, so they queue up
    // as a real backlog the queue then sorts.
    let releaseBlocker!: () => void;
    queue.registerHandler("blocker", () => new Promise<void>((resolve) => (releaseBlocker = resolve)));
    queue.registerHandler("test", async (_payload, j) => {
      order.push(j.id);
    });
    queue.enqueue(job({ id: "blocker", type: "blocker" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.runningCount).toBe(1);

    queue.enqueue(job({ id: "low-priority", priority: 10 }));
    queue.enqueue(job({ id: "high-priority", priority: 0 }));
    queue.enqueue(job({ id: "mid-priority", priority: 5 }));
    expect(queue.pendingCount).toBe(3);

    releaseBlocker();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["high-priority", "mid-priority", "low-priority"]);
  });

  it("breaks a priority tie by scheduledFor, earliest first", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    const order: string[] = [];
    queue.registerHandler("test", async (_payload, j) => {
      order.push(j.id);
    });

    const now = Date.now();
    queue.enqueue(job({ id: "later", priority: 0, scheduledFor: now + 100 }));
    queue.enqueue(job({ id: "earlier", priority: 0, scheduledFor: now }));

    await vi.advanceTimersByTimeAsync(200);
    expect(order).toEqual(["earlier", "later"]);
  });
});

describe("JobQueue — scheduling and retry", () => {
  it("does not run a job before its scheduledFor time", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    const handler = vi.fn(async () => undefined);
    queue.registerHandler("test", handler);
    queue.enqueue(job({ scheduledFor: Date.now() + 5000 }));

    await vi.advanceTimersByTimeAsync(4999);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("retries a failing job with exponential backoff, then succeeds", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000 } });
    let callCount = 0;
    queue.registerHandler("test", async () => {
      callCount++;
      if (callCount < 3) throw new Error("transient failure");
    });
    queue.enqueue(job({ maxAttempts: 5 }));

    await vi.advanceTimersByTimeAsync(0); // attempt 1 fails, schedules retry at +100ms
    expect(callCount).toBe(1);
    await vi.advanceTimersByTimeAsync(100); // attempt 2 fails, schedules retry at +200ms
    expect(callCount).toBe(2);
    await vi.advanceTimersByTimeAsync(200); // attempt 3 succeeds
    expect(callCount).toBe(3);
  });

  it("stops retrying and reports a terminal failure once maxAttempts is exhausted", async () => {
    const onFailed = vi.fn();
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 10, maxDelayMs: 1000 } }, { onFailed });
    queue.registerHandler("test", async () => {
      throw new Error("always fails");
    });
    queue.enqueue(job({ maxAttempts: 2 }));

    await vi.advanceTimersByTimeAsync(0); // attempt 1 fails, retries
    await vi.advanceTimersByTimeAsync(1000); // attempt 2 fails, exhausted

    const finalCall = onFailed.mock.calls.at(-1)!;
    expect(finalCall[2]).toBe(false); // willRetry: false
    expect(queue.pendingCount).toBe(0); // not re-enqueued
  });

  it("caps retry backoff at maxDelayMs", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 1000, maxDelayMs: 1500 } });
    let callCount = 0;
    queue.registerHandler("test", async () => {
      callCount++;
      if (callCount < 3) throw new Error("fail");
    });
    queue.enqueue(job({ maxAttempts: 5 }));

    await vi.advanceTimersByTimeAsync(0); // attempt 1 fails -> retry at +1000ms (base * 2^0)
    await vi.advanceTimersByTimeAsync(1000); // attempt 2 fails -> retry at +1500ms (capped, base*2^1=2000 > max)
    expect(callCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(callCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(callCount).toBe(3);
  });

  it("wakes up on its own to run a delayed retry even with no other queue activity", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 5000, maxDelayMs: 5000 } });
    let callCount = 0;
    queue.registerHandler("test", async () => {
      callCount++;
      if (callCount === 1) throw new Error("fail once");
    });
    queue.enqueue(job());
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // Nothing else touches the queue — no enqueue(), no external pump().
    // The queue must wake itself up when the backoff delay elapses.
    await vi.advanceTimersByTimeAsync(5000);
    expect(callCount).toBe(2);
  });
});

describe("JobQueue — cancel", () => {
  it("removes a pending job before it runs", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    const handler = vi.fn(async () => undefined);
    queue.registerHandler("test", handler);
    queue.enqueue(job({ id: "j1", scheduledFor: Date.now() + 5000 }));

    expect(queue.cancel("j1")).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns false for a job that is already running", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    queue.registerHandler("test", () => new Promise<void>(() => undefined)); // never resolves
    queue.enqueue(job({ id: "j1" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.isRunning("j1")).toBe(true);
    expect(queue.cancel("j1")).toBe(false);
  });

  it("returns false for an unknown job id", () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    expect(queue.cancel("does-not-exist")).toBe(false);
  });
});

describe("JobQueue — drain", () => {
  it("stops pulling new jobs but lets in-flight ones finish", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { baseDelayMs: 100, maxDelayMs: 1000 } });
    let resolveFirst!: () => void;
    const handler = vi.fn(async () => new Promise<void>((resolve) => (resolveFirst = resolve)));
    queue.registerHandler("test", handler);

    queue.enqueue(job({ id: "j1" }));
    await vi.advanceTimersByTimeAsync(0);
    queue.drain();
    queue.enqueue(job({ id: "j2" }));

    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1); // j2 was never pulled
  });
});
