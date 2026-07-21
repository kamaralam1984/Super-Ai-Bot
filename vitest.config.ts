import { defineConfig } from "vitest/config";

// Many test files across this project make real network calls (real
// websites, real DNS/TLS probes) rather than mocking — deliberate, see
// docs/SCANNER.md and docs/TECH_DETECTION.md. Vitest's default file
// concurrency (up to one worker per CPU core) opens enough simultaneous
// outbound connections in this sandboxed environment to occasionally
// exhaust connection capacity and produce spurious ConnectTimeoutErrors —
// verified: the exact same tests pass reliably in isolation and fail only
// when several real-network test files run in parallel. Capping worker
// concurrency trades some wall-clock time for reliability without mocking
// anything.
export default defineConfig({
  test: {
    poolOptions: {
      threads: { maxThreads: 2, minThreads: 1 },
      forks: { maxForks: 2, minForks: 1 },
    },
  },
});
