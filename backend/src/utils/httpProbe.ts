type FetchRedirectMode = "follow" | "manual" | "error";

export interface FetchProbeResult {
  ok: boolean;
  statusCode: number | null;
  finalUrl: string | null;
  locationHeader: string | null;
  latencyMs: number;
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = "KVL-Super-AI-Chatbot-Installer/1.0 (+website-validation)";

/** Thin wrapper around Node's native fetch (Node 18+) with timing, timeout, and error normalization. */
export async function fetchProbe(
  url: string,
  opts: { method?: string; redirect?: FetchRedirectMode; timeoutMs?: number } = {}
): Promise<FetchProbeResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      redirect: opts.redirect ?? "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT },
    });
    // Drain the body so keep-alive sockets are released promptly.
    await res.arrayBuffer().catch(() => undefined);
    return {
      ok: res.ok,
      statusCode: res.status,
      finalUrl: res.url || null,
      locationHeader: res.headers.get("location"),
      latencyMs: Math.round(performance.now() - start),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: null,
      locationHeader: null,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
