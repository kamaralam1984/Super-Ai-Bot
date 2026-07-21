import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RetrainScheduler, shouldAutoRetrain } from "./retrainScheduler";

describe("RetrainScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers a manual retrain immediately with reason 'manual'", async () => {
    const onTrigger = vi.fn();
    const scheduler = new RetrainScheduler(onTrigger);
    await scheduler.triggerManual("inst1", "job1");
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ installationId: "inst1", crawlJobId: "job1", reason: "manual" }));
  });

  it("fires a scheduled retrain on the configured interval with reason 'scheduled'", () => {
    const onTrigger = vi.fn();
    const scheduler = new RetrainScheduler(onTrigger);
    scheduler.scheduleRecurring({ installationId: "inst1", crawlJobId: "job1", intervalMs: 60_000 });

    expect(onTrigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ reason: "scheduled" }));
    vi.advanceTimersByTime(60_000);
    expect(onTrigger).toHaveBeenCalledTimes(2);

    scheduler.cancelAll();
  });

  it("rejects an interval below the 60s floor", () => {
    const scheduler = new RetrainScheduler(vi.fn());
    expect(() => scheduler.scheduleRecurring({ installationId: "inst1", crawlJobId: "job1", intervalMs: 5000 })).toThrow(/at least/);
  });

  it("cancelRecurring stops future triggers and returns true when it existed", () => {
    const onTrigger = vi.fn();
    const scheduler = new RetrainScheduler(onTrigger);
    const handleId = scheduler.scheduleRecurring({ installationId: "inst1", crawlJobId: "job1", intervalMs: 60_000 });

    expect(scheduler.cancelRecurring(handleId)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("cancelRecurring returns false for an unknown handle", () => {
    const scheduler = new RetrainScheduler(vi.fn());
    expect(scheduler.cancelRecurring("nonexistent")).toBe(false);
  });

  it("listScheduled reports every active recurring schedule", () => {
    const scheduler = new RetrainScheduler(vi.fn());
    scheduler.scheduleRecurring({ installationId: "inst1", crawlJobId: "job1", intervalMs: 60_000 });
    scheduler.scheduleRecurring({ installationId: "inst2", crawlJobId: "job2", intervalMs: 120_000 });
    expect(scheduler.listScheduled()).toHaveLength(2);
    scheduler.cancelAll();
  });

  it("cancelAll stops every scheduled retrain", () => {
    const onTrigger = vi.fn();
    const scheduler = new RetrainScheduler(onTrigger);
    scheduler.scheduleRecurring({ installationId: "inst1", crawlJobId: "job1", intervalMs: 60_000 });
    scheduler.scheduleRecurring({ installationId: "inst2", crawlJobId: "job2", intervalMs: 60_000 });
    scheduler.cancelAll();
    vi.advanceTimersByTime(120_000);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(scheduler.listScheduled()).toHaveLength(0);
  });
});

describe("shouldAutoRetrain", () => {
  it("retrains when there is no prior training run, regardless of other thresholds", () => {
    const decision = shouldAutoRetrain({ changeRatio: 0, hoursSinceLastTraining: null });
    expect(decision.shouldRetrain).toBe(true);
  });

  it("does not retrain when too little time has passed since the last run", () => {
    const decision = shouldAutoRetrain({ changeRatio: 0.5, hoursSinceLastTraining: 0.1 });
    expect(decision.shouldRetrain).toBe(false);
    expect(decision.reason).toContain("Only");
  });

  it("does not retrain when change ratio is below the threshold, even with plenty of time elapsed", () => {
    const decision = shouldAutoRetrain({ changeRatio: 0.01, hoursSinceLastTraining: 24 });
    expect(decision.shouldRetrain).toBe(false);
  });

  it("retrains when both thresholds are met", () => {
    const decision = shouldAutoRetrain({ changeRatio: 0.2, hoursSinceLastTraining: 24 });
    expect(decision.shouldRetrain).toBe(true);
  });

  it("respects custom thresholds", () => {
    const decision = shouldAutoRetrain({ changeRatio: 0.5, hoursSinceLastTraining: 2, minChangeRatio: 0.6, minHoursBetweenRuns: 1 });
    expect(decision.shouldRetrain).toBe(false); // 0.5 < custom 0.6 floor
  });
});
