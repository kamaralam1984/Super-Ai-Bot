// Session Manager — pure decision logic for visitor identity and
// conversation recovery. The actual cookie read/write and Visitor/
// Conversation DB lookups happen at the route layer and
// chatRecord.service.ts respectively; this module only decides, given
// already-known facts, what should happen next (resume vs. start fresh,
// new visitor vs. returning).

import crypto from "node:crypto";

const FINGERPRINT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VisitorIdentity {
  fingerprint: string;
  isReturning: boolean;
}

export function generateVisitorFingerprint(): string {
  return crypto.randomUUID();
}

/** Resolves the visitor identity for an incoming connection: a well-formed cookie value is trusted and treated as a returning visitor; anything missing or malformed gets a freshly generated one. This is a public, non-secret identifier (see schema.prisma's `Visitor.fingerprint` doc comment) — its only job is recognizing the same browser across page loads, not authenticating anyone. */
export function resolveVisitorIdentity(cookieFingerprint: string | null | undefined): VisitorIdentity {
  if (cookieFingerprint && FINGERPRINT_PATTERN.test(cookieFingerprint)) {
    return { fingerprint: cookieFingerprint, isReturning: true };
  }
  return { fingerprint: generateVisitorFingerprint(), isReturning: false };
}

export type ConversationStatusLike = "ACTIVE" | "IDLE" | "ESCALATED" | "CLOSED";

export interface ExistingConversationSummary {
  status: ConversationStatusLike;
  lastMessageAt: Date;
}

export interface ConversationRecoveryDecision {
  action: "resume" | "start_new";
  reason: string;
}

/** A closed conversation never resumed just to make a slightly-idle one is worse than starting fresh, but a merely quiet one (visitor stepped away, came back) shouldn't lose context — this is the "Conversation Recovery" boundary. */
const RESUME_IDLE_WINDOW_MS = 30 * 60 * 1000;

export function decideConversationRecovery(existingConversation: ExistingConversationSummary | null, now: Date = new Date()): ConversationRecoveryDecision {
  if (!existingConversation) {
    return { action: "start_new", reason: "No prior conversation found for this visitor." };
  }
  if (existingConversation.status === "CLOSED") {
    return { action: "start_new", reason: "The visitor's most recent conversation was closed." };
  }

  const idleMinutes = Math.round((now.getTime() - existingConversation.lastMessageAt.getTime()) / 60000);
  if (idleMinutes * 60000 > RESUME_IDLE_WINDOW_MS) {
    return { action: "start_new", reason: `The visitor's most recent conversation has been idle for ${idleMinutes} minutes, past the ${RESUME_IDLE_WINDOW_MS / 60000}-minute resume window.` };
  }

  return { action: "resume", reason: "A recent, still-open conversation was found — resuming it." };
}

const SHARE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateShareToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function computeShareTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SHARE_TOKEN_TTL_MS);
}

export function isShareTokenValid(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}
