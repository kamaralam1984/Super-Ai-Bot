// Background Job System — a generic, in-process priority job queue.
// "In-process" is the same documented architectural choice
// training/retrain/retrainScheduler.ts already made for retraining
// specifically ("no job-queue library exists anywhere in this
// codebase... this product's self-hosted deployment model is one
// long-running Node process per installation, not a distributed system
// with a durable job store") — this module generalizes that same choice
// into a reusable primitive for scan/training/notification/rollback
// jobs, not a reversal of it. "Distributed Workers" (the spec's own
// term) is therefore an honest non-goal: there is one process, and this
// queue runs multiple *concurrent* workers within it (real parallel
// processing, via `concurrency`), not workers distributed across
// machines — see docs/AUTO_UPDATE_ENGINE.md's Known Limitations.
//
// Job *state* (BackgroundJob rows) is persisted via
// monitorRecord.service.ts so "Failed Jobs" and job history survive a
// restart and are queryable; the live *execution order* — this class —
// does not, matching every other in-process scheduler in this codebase.

export type JobPriority = number; // lower = higher priority, matching Connector.priority's own convention

export interface JobDefinition<TPayload = unknown> {
  id: string;
  type: string;
  priority: JobPriority;
  payload: TPayload;
  attempts: number;
  maxAttempts: number;
  /** epoch ms — a job is not eligible to run before this (used both for a genuinely delayed job and for a backoff-retry's wait). */
  scheduledFor: number;
}

export type JobHandler<TPayload = unknown> = (payload: TPayload, job: JobDefinition<TPayload>) => Promise<void>;

export interface JobRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface JobQueueOptions {
  concurrency: number;
  retryPolicy: JobRetryPolicy;
}

export interface JobLifecycleHooks {
  onStarted?: (job: JobDefinition) => void;
  onCompleted?: (job: JobDefinition) => void;
  /** `willRetry: false` means this attempt exhausted `maxAttempts` — the job is now terminally failed and will not be re-enqueued; the caller's hook is where that becomes a persisted `BackgroundJob.status = FAILED` row. */
  onFailed?: (job: JobDefinition, error: Error, willRetry: boolean) => void;
}

/**
 * A priority-ordered, concurrency-bounded, in-process job runner. Jobs
 * are pulled lowest-priority-number-first, then earliest-`scheduledFor`
 * first among those actually eligible right now — a stable, deterministic
 * tie-break, never a random pick between equally-ranked jobs.
 */
export class JobQueue {
  private pending: JobDefinition[] = [];
  private running = new Set<string>();
  private handlers = new Map<string, JobHandler>();
  private draining = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private options: JobQueueOptions,
    private hooks: JobLifecycleHooks = {}
  ) {}

  registerHandler<TPayload>(type: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  enqueue(job: JobDefinition): void {
    this.pending.push(job);
    this.pump();
  }

  /** Removes a not-yet-started job. Returns false if it's already running (or unknown) — an in-flight job must be allowed to finish, not yanked mid-execution. */
  cancel(jobId: string): boolean {
    const index = this.pending.findIndex((j) => j.id === jobId);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    return true;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get runningCount(): number {
    return this.running.size;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  private sortPending(): void {
    this.pending.sort((a, b) => a.priority - b.priority || a.scheduledFor - b.scheduledFor);
  }

  private pump(): void {
    if (this.draining) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }

    this.sortPending();
    while (this.running.size < this.options.concurrency) {
      const now = Date.now();
      const index = this.pending.findIndex((j) => j.scheduledFor <= now);
      if (index === -1) break;
      const [job] = this.pending.splice(index, 1);
      void this.runJob(job);
    }

    // Nothing eligible right now, but something IS pending (waiting out a
    // delay or a backoff retry) — without this, a queue with no other
    // activity would never wake up to run it; only enqueue()/pump() calls
    // trigger a pull, and neither happens on its own while idle.
    if (this.pending.length > 0 && this.running.size < this.options.concurrency) {
      const earliestScheduledFor = Math.min(...this.pending.map((j) => j.scheduledFor));
      const delay = Math.max(0, earliestScheduledFor - Date.now());
      this.wakeTimer = setTimeout(() => this.pump(), delay);
    }
  }

  private async runJob(job: JobDefinition): Promise<void> {
    this.running.add(job.id);
    this.hooks.onStarted?.(job);

    const handler = this.handlers.get(job.type);
    try {
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.type}"`);
      }
      await handler(job.payload, job);
      this.hooks.onCompleted?.(job);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const nextAttempts = job.attempts + 1;
      const willRetry = nextAttempts < job.maxAttempts;
      this.hooks.onFailed?.(job, error, willRetry);
      if (willRetry) {
        const delay = Math.min(this.options.retryPolicy.baseDelayMs * 2 ** job.attempts, this.options.retryPolicy.maxDelayMs);
        this.pending.push({ ...job, attempts: nextAttempts, scheduledFor: Date.now() + delay });
      }
    } finally {
      this.running.delete(job.id);
      this.pump();
    }
  }

  /** Stops pulling new jobs (in-flight jobs still finish) and cancels the idle wake timer — for graceful shutdown/test teardown. */
  drain(): void {
    this.draining = true;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }
}
