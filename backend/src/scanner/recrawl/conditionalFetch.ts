import { safeFetch } from "../http/safeFetch";

export interface CachedPageMeta {
  etag: string | null;
  lastModified: string | null;
}

export type ConditionalFetchResult = { notModified: true } | { notModified: false; body: Buffer; meta: CachedPageMeta; statusCode: number };

function headerString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * A cheaper first check for incremental recrawls: if the site honors
 * conditional requests, a page that hasn't changed comes back as a 304
 * with an empty body — no re-download, no re-parse, no re-embedding
 * needed. Falls through to a normal fetch (and reports the fresh
 * ETag/Last-Modified for next time) when the server doesn't support it or
 * the content has changed.
 */
export async function conditionalFetch(url: string, previous: CachedPageMeta): Promise<ConditionalFetchResult> {
  const headers: Record<string, string> = {};
  if (previous.etag) headers["If-None-Match"] = previous.etag;
  if (previous.lastModified) headers["If-Modified-Since"] = previous.lastModified;

  const response = await safeFetch(url, { headers, timeoutMs: 15000 });

  if (response.statusCode === 304) {
    return { notModified: true };
  }

  return {
    notModified: false,
    body: response.body,
    statusCode: response.statusCode,
    meta: {
      etag: headerString(response.headers.etag),
      lastModified: headerString(response.headers["last-modified"]),
    },
  };
}
