// Retraining Engine — manual, scheduled, and automatic retraining
// triggers. No job-queue library exists anywhere in this codebase
// (confirmed before writing this — every long-running pipeline in Phases
// 2-5 is a single async function plus a progress callback over the
// caller's own request/socket); this follows the same established
// pattern rather than introducing the first queue dependency. Scheduling
// is in-process (setInterval-based) — a known limitation is that a
// scheduled retrain doesn't survive a server restart, which is an honest
// scope boundary documented in docs/AI_TRAINING_ENGINE.md, not a bug: the
// self-hosted deployment model here is one long-running Node process per
// installation, not a distributed system with a durable job store.

export interface RetrainTrigger {
  installationId: string;
  crawlJobId: string;
  reason: "manual" | "scheduled" | "automatic";
  triggeredAt: string;
}

export type RetrainCallback = (trigger: RetrainTrigger) => void | Promise<void>;

export interface ScheduledRetrainConfig {
  installationId: string;
  crawlJobId: string;
  intervalMs: number;
}

const MIN_INTERVAL_MS = 60_000; // a floor against accidental sub-minute scheduling that would hammer the pipeline

interface ScheduledEntry extends ScheduledRetrainConfig {
  handleId: string;
  timer: ReturnType<typeof setInterval>;
}

/** In-process recurring + manual retrain trigger dispatcher — one instance per running server process. */
export class RetrainScheduler {
  private entries = new Map<string, ScheduledEntry>();
  private nextHandleId = 1;

  constructor(private onTrigger: RetrainCallback) {}

  scheduleRecurring(config: ScheduledRetrainConfig): string {
    if (config.intervalMs < MIN_INTERVAL_MS) {
      throw new Error(`intervalMs must be at least ${MIN_INTERVAL_MS}ms (got ${config.intervalMs}) — sub-minute scheduled retraining is not supported.`);
    }
    const handleId = `retrain-${this.nextHandleId++}`;
    const timer = setInterval(() => {
      void this.onTrigger({ installationId: config.installationId, crawlJobId: config.crawlJobId, reason: "scheduled", triggeredAt: new Date().toISOString() });
    }, config.intervalMs);
    this.entries.set(handleId, { ...config, handleId, timer });
    return handleId;
  }

  cancelRecurring(handleId: string): boolean {
    const entry = this.entries.get(handleId);
    if (!entry) return false;
    clearInterval(entry.timer);
    this.entries.delete(handleId);
    return true;
  }

  listScheduled(): ScheduledRetrainConfig[] {
    return [...this.entries.values()].map(({ installationId, crawlJobId, intervalMs }) => ({ installationId, crawlJobId, intervalMs }));
  }

  async triggerManual(installationId: string, crawlJobId: string): Promise<void> {
    await this.onTrigger({ installationId, crawlJobId, reason: "manual", triggeredAt: new Date().toISOString() });
  }

  /** Stops every scheduled retrain — for clean process shutdown/test teardown. */
  cancelAll(): void {
    for (const entry of this.entries.values()) clearInterval(entry.timer);
    this.entries.clear();
  }
}

export interface AutoRetrainDecisionInput {
  changeRatio: number; // from RecrawlSummary — fraction of pages that are new/modified/deleted
  hoursSinceLastTraining: number | null; // null = never trained before
  minChangeRatio?: number;
  minHoursBetweenRuns?: number;
}

export interface AutoRetrainDecision {
  shouldRetrain: boolean;
  reason: string;
}

const DEFAULT_MIN_CHANGE_RATIO = 0.05; // 5% of pages changed
const DEFAULT_MIN_HOURS_BETWEEN_RUNS = 1;

/** Pure decision function for "automatic" retraining — should this recrawl's worth of change actually trigger a retrain, or is it too small/too soon to be worth the cost? */
export function shouldAutoRetrain(input: AutoRetrainDecisionInput): AutoRetrainDecision {
  if (input.hoursSinceLastTraining === null) {
    return { shouldRetrain: true, reason: "No prior training run exists for this installation." };
  }

  const minHours = input.minHoursBetweenRuns ?? DEFAULT_MIN_HOURS_BETWEEN_RUNS;
  if (input.hoursSinceLastTraining < minHours) {
    return { shouldRetrain: false, reason: `Only ${input.hoursSinceLastTraining.toFixed(2)}h since the last training run — minimum interval is ${minHours}h.` };
  }

  const minChangeRatio = input.minChangeRatio ?? DEFAULT_MIN_CHANGE_RATIO;
  if (input.changeRatio < minChangeRatio) {
    return { shouldRetrain: false, reason: `Only ${(input.changeRatio * 100).toFixed(1)}% of content changed — below the ${(minChangeRatio * 100).toFixed(0)}% threshold to justify an automatic retrain.` };
  }

  return { shouldRetrain: true, reason: `${(input.changeRatio * 100).toFixed(1)}% of content changed, ${input.hoursSinceLastTraining.toFixed(2)}h since the last run — both thresholds met.` };
}
