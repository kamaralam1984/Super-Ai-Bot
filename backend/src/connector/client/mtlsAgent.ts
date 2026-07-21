// Mutual TLS — builds a per-connector `undici.Agent` carrying the client
// certificate/key (and optional CA) MTLS auth requires, reusing
// `safeFetch`'s exact SSRF-guarded DNS resolution (`safeLookup`) so an
// mTLS connector gets the same anti-SSRF guarantee every other connector
// call does — the only thing that changes is the TLS handshake, not the
// destination-safety check.

import { Agent } from "undici";
import { safeFetch, safeLookup } from "../../scanner/http/safeFetch";
import type { RawCredentialInput } from "../types";

export type MtlsCredential = NonNullable<RawCredentialInput["mtls"]>;

const agents = new Map<string, Agent>(); // one per connectorId — each connector's certificate is distinct

function agentFor(connectorId: string, mtls: MtlsCredential, timeoutMs: number): Agent {
  let agent = agents.get(connectorId);
  if (!agent) {
    agent = new Agent({
      connect: {
        lookup: safeLookup as never,
        timeout: timeoutMs,
        cert: mtls.clientCertPem,
        key: mtls.clientKeyPem,
        ca: mtls.caCertPem,
        // The client certificate authenticates us to the *target*; it says
        // nothing about whether the target's own server certificate is
        // trustworthy. That's still verified normally (Node's default
        // `rejectUnauthorized: true`) — mTLS adds a second, independent
        // check, it never weakens the first one.
        rejectUnauthorized: true,
      },
    });
    agents.set(connectorId, agent);
  }
  return agent;
}

/** Releases a connector's cached Agent (its open sockets/TLS session state) — call when a connector's certificate is rotated or the connector is deleted, so a stale certificate can never be reused for a new one. */
export async function resetMtlsAgent(connectorId: string): Promise<void> {
  const agent = agents.get(connectorId);
  agents.delete(connectorId);
  if (agent) await agent.close().catch(() => undefined);
}

export interface MtlsFetchOptions {
  connectorId: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** GET/HEAD only, same restriction as every other read-only connector call — enforced here too, not just trusted to the caller, since this is a genuine network entry point. */
export async function mtlsFetch(url: string, mtls: MtlsCredential, options: MtlsFetchOptions) {
  const method = options.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    throw new Error(`mtlsFetch only permits GET/HEAD, got "${method}"`);
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Mutual TLS requires https — got "${parsed.protocol}" for ${url}`);
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const agent = agentFor(options.connectorId, mtls, timeoutMs);

  return safeFetch(url, {
    method,
    headers: options.headers,
    timeoutMs,
    maxRedirects: options.maxRedirects,
    dispatcher: agent,
  });
}
