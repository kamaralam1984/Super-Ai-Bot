interface HostQueueState {
  chain: Promise<void>;
  lastRequestAt: number;
  minIntervalMs: number;
}

const DEFAULT_MIN_INTERVAL_MS = 500;

/**
 * Serializes requests per-hostname with a minimum spacing between them
 * (overridable per host from a robots.txt Crawl-delay directive), while
 * letting different hosts proceed fully concurrently. This is "politeness"
 * — a courtesy to the site being scanned — layered on top of safeFetch's
 * security guarantees, not a substitute for them.
 */
export class PerHostRateLimiter {
  private hosts = new Map<string, HostQueueState>();

  setMinInterval(hostname: string, ms: number): void {
    this.getState(hostname).minIntervalMs = Math.max(ms, 0);
  }

  private getState(hostname: string): HostQueueState {
    let state = this.hosts.get(hostname);
    if (!state) {
      state = { chain: Promise.resolve(), lastRequestAt: 0, minIntervalMs: DEFAULT_MIN_INTERVAL_MS };
      this.hosts.set(hostname, state);
    }
    return state;
  }

  async schedule<T>(hostname: string, task: () => Promise<T>): Promise<T> {
    const state = this.getState(hostname);
    const gate = state.chain.then(async () => {
      const wait = state.minIntervalMs - (Date.now() - state.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      state.lastRequestAt = Date.now();
    });
    state.chain = gate.catch(() => undefined);
    await gate;
    return task();
  }
}
