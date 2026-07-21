import dns from "node:dns";
import net from "node:net";
import { Agent, request as undiciRequest } from "undici";
import { isUnsafeAddress } from "./ipSafety";

export class SsrfBlockedError extends Error {
  constructor(hostname: string, address: string) {
    super(`Blocked request to "${hostname}" — resolved to ${address}, a private/reserved address`);
    this.name = "SsrfBlockedError";
  }
}

interface LookupAddress {
  address: string;
  family: number;
}

/**
 * A dns.lookup-compatible resolver that rejects any hostname resolving to a
 * private/loopback/link-local/reserved address. Passed as `connect.lookup`
 * to the undici Agent below, so the address it returns is the one the
 * socket actually connects to — closing the DNS-rebinding gap where a
 * separate "check" lookup and "connect" lookup could resolve differently.
 *
 * Node's net.js calls this with `options.all` set depending on whether
 * Happy-Eyeballs/autoSelectFamily multi-address resolution is in play, and
 * expects the callback shape to match: `(err, address, family)` for a
 * single result or `(err, addresses[])` for `all: true`. Returning the
 * wrong shape doesn't error loudly — it corrupts the caller's internal
 * state (this was caught by testing against a real host, not assumed).
 */
/** Exported so other modules that need their own `undici.Agent` (e.g. connector/client/mtlsAgent.ts, which needs per-connector client-certificate options a shared Agent can't carry) can reuse the exact same SSRF-safe resolution logic rather than re-implementing it. */
export function safeLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void
): void {
  const wantsAll = (options as dns.LookupAllOptions)?.all === true;

  dns.lookup(hostname, options as dns.LookupAllOptions, (err: NodeJS.ErrnoException | null, addressOrAddresses: string | LookupAddress[], family?: number) => {
    if (err) {
      callback(err);
      return;
    }

    if (wantsAll) {
      const addresses = addressOrAddresses as unknown as LookupAddress[];
      const safeAddresses = addresses.filter((a) => !isUnsafeAddress(a.address, a.family));
      if (safeAddresses.length === 0) {
        callback(new SsrfBlockedError(hostname, addresses[0]?.address ?? "unknown"));
        return;
      }
      callback(null, safeAddresses);
      return;
    }

    const address = addressOrAddresses as string;
    if (isUnsafeAddress(address, family as number)) {
      callback(new SsrfBlockedError(hostname, address));
      return;
    }
    callback(null, address, family);
  });
}

const safeAgent = new Agent({
  connect: { lookup: safeLookup as never, timeout: 10_000 },
});

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const USER_AGENT = "KVL-Super-AI-Chatbot-Scanner/1.0 (+read-only website scan; respects robots.txt)";

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** Overrides the shared SSRF-guarded agent — for a caller that needs its own connection options (e.g. connector/client/mtlsAgent.ts's per-connector client certificate) while still going through this function's SSRF/redirect/timeout/size-cap handling. Must still use `safeLookup` internally, or the SSRF guard this function exists to provide is lost; every current caller of this option does. */
  dispatcher?: Agent;
}

export interface SafeFetchResult {
  ok: boolean;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  finalUrl: string;
  truncated: boolean;
}

/**
 * The scanner's only HTTP entry point. Every fetch — page, sitemap, robots.txt,
 * document, image — goes through this: SSRF-guarded DNS resolution, a
 * response size cap, a timeout, and *manual* redirect following so every
 * hop is re-validated (auto-follow would let an attacker-controlled
 * redirect bypass the SSRF check entirely).
 */
export async function safeFetch(inputUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  let currentUrl = inputUrl;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Blocked unsafe protocol "${parsed.protocol}" for ${currentUrl}`);
    }

    // Node's net.connect skips the custom `lookup` hook entirely when the
    // host is already a literal IP address (no DNS resolution needed) — so
    // `http://127.0.0.1/` or `http://169.254.169.254/` would otherwise sail
    // straight past safeLookup. Caught by testing, not assumed: validate
    // literal-IP hosts explicitly, on every redirect hop. WHATWG URL keeps
    // brackets in `.hostname` for IPv6 literals (e.g. "[::1]") — net.isIP
    // needs them stripped.
    const bareHost = parsed.hostname.replace(/^\[|\]$/g, "");
    const ipFamily = net.isIP(bareHost);
    if (ipFamily && isUnsafeAddress(bareHost, ipFamily)) {
      throw new SsrfBlockedError(bareHost, bareHost);
    }

    const response = await undiciRequest(currentUrl, {
      method: (opts.method ?? "GET") as never,
      dispatcher: opts.dispatcher ?? safeAgent,
      headersTimeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      bodyTimeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRedirections: 0,
      headers: { "User-Agent": USER_AGENT, ...opts.headers },
      body: opts.body,
    });

    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      await response.body.dump().catch(() => undefined);
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of response.body) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) {
        truncated = true;
        break;
      }
      chunks.push(chunk as Buffer);
    }
    if (truncated) await response.body.dump().catch(() => undefined);

    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      statusCode: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks),
      finalUrl: currentUrl,
      truncated,
    };
  }

  throw new Error(`Too many redirects (> ${maxRedirects}) for ${inputUrl}`);
}

export async function safeFetchText(url: string, opts: SafeFetchOptions = {}): Promise<{ text: string; result: SafeFetchResult }> {
  const result = await safeFetch(url, opts);
  return { text: result.body.toString("utf-8"), result };
}
