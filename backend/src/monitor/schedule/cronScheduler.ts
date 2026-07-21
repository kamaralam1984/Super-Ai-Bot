// Cron Scheduling — real cron-expression-based scheduling via
// `cron-parser`, a small, focused, well-maintained library for computing
// "when does this expression next fire." Hand-rolling that calculation
// (month lengths, leap years, day-of-week arithmetic) is a genuinely
// error-prone undertaking; this is a different, narrower kind of
// dependency than the "no job-queue library" decision
// retrain/retrainScheduler.ts documents for itself — that comment is
// about queueing/distributed execution, not expression parsing.
//
// Execution is still in-process — this product's documented
// single-long-running-process-per-installation model (the same
// precedent RetrainScheduler already established) — but the schedule
// *definition* (see schema.prisma's `ScanSchedule`) is now persisted, so
// a restart no longer silently forgets every scheduled scan the way the
// interval-based scheduler's in-memory-only config did. The server
// re-registers every enabled `ScanSchedule` from the database at
// startup; this module has no persistence of its own.

import { CronExpressionParser } from "cron-parser";

export type SchedulePreset = "hourly" | "daily" | "weekly" | "monthly";

// Daily/weekly/monthly default to 03:00 — a low-traffic hour, not
// literally midnight (a common cron-guessing anti-pattern that collides
// with every other job that also picked "00:00").
const PRESET_EXPRESSIONS: Record<SchedulePreset, string> = {
  hourly: "0 * * * *",
  daily: "0 3 * * *",
  weekly: "0 3 * * 0",
  monthly: "0 3 1 * *",
};

export function presetToCronExpression(preset: SchedulePreset): string {
  return PRESET_EXPRESSIONS[preset];
}

export interface CronValidationResult {
  valid: boolean;
  errorMessage?: string;
}

/** Soft-failure validation for an admin-supplied cron expression (or a preset's own expression, defensively) — use before `computeNextRun`, which throws on an invalid expression. */
export function validateCronExpression(expression: string): CronValidationResult {
  try {
    CronExpressionParser.parse(expression);
    return { valid: true };
  } catch (err) {
    return { valid: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Computes the next run time strictly after `from` (defaults to now).
 * Throws for an invalid expression — validate first via
 * `validateCronExpression` for a soft-failure path.
 *
 * `tz` defaults to `"UTC"`, not the host machine's local timezone —
 * `cron-parser` evaluates cron fields in whatever timezone it's given
 * (matching real crontab semantics), and this product runs on an
 * arbitrary client server whose local timezone this codebase has no
 * other reason to depend on implicitly. An administrator who wants "3am
 * *my* time" can pass their own IANA timezone name explicitly (stored on
 * `ScanSchedule` if this product exposes that setting) — the default
 * stays deterministic and portable either way.
 */
export function computeNextRun(expression: string, from: Date = new Date(), tz = "UTC"): Date {
  const interval = CronExpressionParser.parse(expression, { currentDate: from, tz });
  return interval.next().toDate();
}

export type CronCallback = (scheduleId: string) => void | Promise<void>;

interface RegisteredSchedule {
  cronExpression: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * In-process cron runtime: for each registered schedule, arms a single
 * `setTimeout` for its next fire time and re-arms after each fire —
 * correct for cron expressions where the gap between fires isn't
 * constant (e.g. "1st of the month" spans 28-31 days), unlike a
 * `setInterval`.
 *
 * Each registration carries a generation number specifically to close a
 * real race: if `register()` is called again for the same `scheduleId`
 * (a new cron expression) while the *previous* fire's async `onFire` is
 * still in flight, the in-flight call's `finally()` must not resurrect
 * the old expression by re-arming with it — it checks its captured
 * generation against the current one and only re-arms if it's still the
 * active registration.
 */
// Node's setTimeout silently clamps any delay that doesn't fit in a
// 32-bit signed integer (~24.8 days) down to ~1ms instead of throwing or
// waiting the intended time — an undocumented quirk that would otherwise
// make a "monthly" (let alone less frequent) schedule fire almost
// immediately instead of waiting for its real target date. Caught by
// this module's own test suite simulating a long-delay schedule, not
// assumed. `armCountdown` below chains multiple capped-length timeouts
// until the real target time is reached, checking the generation at each
// leg (not just after the eventual `onFire`) so a long countdown can
// still be safely unregistered/replaced partway through.
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

export class CronRuntime {
  private schedules = new Map<string, RegisteredSchedule>();
  private generations = new Map<string, number>();

  constructor(private onFire: CronCallback) {}

  register(scheduleId: string, cronExpression: string, tz = "UTC"): void {
    this.unregister(scheduleId);
    const generation = (this.generations.get(scheduleId) ?? 0) + 1;
    this.generations.set(scheduleId, generation);
    this.armNext(scheduleId, cronExpression, tz, generation);
  }

  private armNext(scheduleId: string, cronExpression: string, tz: string, generation: number): void {
    const targetTime = computeNextRun(cronExpression, new Date(), tz).getTime();
    this.armCountdown(scheduleId, cronExpression, tz, generation, targetTime);
  }

  private armCountdown(scheduleId: string, cronExpression: string, tz: string, generation: number, targetTime: number): void {
    const remaining = Math.max(0, targetTime - Date.now());
    const delay = Math.min(remaining, MAX_SAFE_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (this.generations.get(scheduleId) !== generation) return; // unregistered or replaced mid-countdown

      if (Date.now() < targetTime) {
        this.armCountdown(scheduleId, cronExpression, tz, generation, targetTime); // hit the 32-bit cap — chain another leg
        return;
      }

      void Promise.resolve(this.onFire(scheduleId)).finally(() => {
        if (this.generations.get(scheduleId) === generation) {
          this.armNext(scheduleId, cronExpression, tz, generation);
        }
      });
    }, delay);
    this.schedules.set(scheduleId, { cronExpression, timer });
  }

  unregister(scheduleId: string): boolean {
    // Deliberately does NOT delete the generation counter — only bump it
    // via the next register() call. If it were deleted here, a
    // subsequent register() would restart numbering from 1, which could
    // collide with a still-in-flight stale closure's captured generation
    // (exactly the race this counter exists to prevent) and let it
    // resurrect anyway. Caught by this module's own test suite
    // simulating a re-register during an in-flight fire, not assumed.
    const entry = this.schedules.get(scheduleId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.schedules.delete(scheduleId);
    return true;
  }

  isRegistered(scheduleId: string): boolean {
    return this.schedules.has(scheduleId);
  }

  /** Stops every registered schedule — for clean process shutdown/test teardown. */
  unregisterAll(): void {
    for (const entry of this.schedules.values()) clearTimeout(entry.timer);
    this.schedules.clear();
    this.generations.clear();
  }
}
