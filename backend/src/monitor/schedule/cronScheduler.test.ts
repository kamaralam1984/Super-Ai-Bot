import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeNextRun, CronRuntime, presetToCronExpression, validateCronExpression } from "./cronScheduler";

describe("presetToCronExpression", () => {
  it("maps every preset to a valid cron expression", () => {
    for (const preset of ["hourly", "daily", "weekly", "monthly"] as const) {
      expect(validateCronExpression(presetToCronExpression(preset)).valid).toBe(true);
    }
  });

  it("hourly fires every hour on the hour", () => {
    expect(presetToCronExpression("hourly")).toBe("0 * * * *");
  });
});

describe("validateCronExpression", () => {
  it("accepts a standard 5-field expression", () => {
    expect(validateCronExpression("0 3 * * *").valid).toBe(true);
  });

  it("rejects garbage input with an error message", () => {
    const result = validateCronExpression("not a cron expression");
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });
});

describe("computeNextRun", () => {
  it("computes the next hourly fire time after a given moment", () => {
    const from = new Date("2026-01-01T10:15:00.000Z");
    expect(computeNextRun("0 * * * *", from).toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });

  it("computes the next monthly fire time, correctly spanning a month with fewer days", () => {
    const from = new Date("2026-02-15T00:00:00.000Z");
    expect(computeNextRun("0 3 1 * *", from).toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("throws for an invalid expression", () => {
    expect(() => computeNextRun("garbage")).toThrow();
  });
});

describe("CronRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onFire at the computed next-run time, not before", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    runtime.register("s1", "0 * * * *"); // next fire: 01:00:00

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(onFire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith("s1");
  });

  it("re-arms automatically after firing (recurring behavior)", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    runtime.register("s1", "0 * * * *");

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // fires at 01:00
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // fires again at 02:00
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it("unregister prevents the next fire", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    runtime.register("s1", "0 * * * *");
    expect(runtime.unregister("s1")).toBe(true);
    expect(runtime.isRegistered("s1")).toBe(false);

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("unregister on an unknown id returns false", () => {
    const runtime = new CronRuntime(vi.fn());
    expect(runtime.unregister("nope")).toBe(false);
  });

  it("tracks multiple independent schedules", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    runtime.register("hourly-job", "0 * * * *");
    runtime.register("daily-job", "0 3 * * *");

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // 03:00 — hourly fires 3x, daily fires once
    expect(onFire.mock.calls.filter((c) => c[0] === "hourly-job")).toHaveLength(3);
    expect(onFire.mock.calls.filter((c) => c[0] === "daily-job")).toHaveLength(1);
  });

  it("unregisterAll stops every schedule", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    runtime.register("s1", "0 * * * *");
    runtime.register("s2", "0 3 * * *");
    runtime.unregisterAll();

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("re-registering with a new expression while the previous fire is still in flight does not resurrect the old expression (race condition fix)", async () => {
    let resolveFirstFire!: () => void;
    const firstFirePromise = new Promise<void>((resolve) => {
      resolveFirstFire = resolve;
    });

    let callCount = 0;
    const onFire = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        await firstFirePromise; // the first fire hangs until we let it resolve below
      }
    });

    const runtime = new CronRuntime(onFire);
    runtime.register("s1", "0 * * * *"); // next fire: 01:00

    // Advance exactly to the fire time — onFire is called and is now
    // awaiting firstFirePromise (still "in flight").
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(onFire).toHaveBeenCalledTimes(1);

    // While that first call is still in flight, re-register the SAME id
    // with a cron expression that fires ~14 days out (the 15th of the
    // month) — far enough that it won't fire during this test, but well
    // under the 32-bit setTimeout cap so this test stays focused on the
    // race condition alone (see the dedicated long-delay test below for
    // that separate concern).
    runtime.register("s1", "0 0 15 * *");

    // Now let the original in-flight call finish. Its stale `finally()`
    // must NOT re-arm using the old hourly expression.
    resolveFirstFire();
    await vi.advanceTimersByTimeAsync(0);

    // Advance another two hours — if the race condition existed, the
    // resurrected hourly schedule would have fired again by now.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(onFire).toHaveBeenCalledTimes(1); // still just the one call — the new (monthly) schedule hasn't fired yet, and the hourly one wasn't resurrected
  });

  it("correctly waits out a delay longer than Node's ~24.8-day 32-bit setTimeout limit by chaining timeouts, rather than firing early", async () => {
    const onFire = vi.fn();
    const runtime = new CronRuntime(onFire);
    // Next Jan 1st from Jan 1 2026 00:00:00 is a full year away — far
    // beyond the single-setTimeout cap, so this only passes if
    // armCountdown's chaining logic is correct.
    runtime.register("s1", "0 0 1 1 *");

    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(oneYearMs - 60_000);
    expect(onFire).not.toHaveBeenCalled(); // must not have fired early just because one leg of the countdown elapsed

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
