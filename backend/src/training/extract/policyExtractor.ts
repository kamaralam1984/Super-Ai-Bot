// Policy Learning Engine — classifies a page/chunk that Phase 3's
// `categoryClassifier.ts` already tagged "Policies" into its specific
// sub-type. This is a genuinely new capability: Phase 3 only knows a page
// is *some* kind of policy, not which one — needed so the AI can answer
// "what's your refund policy?" from the refund policy specifically, not an
// arbitrary policy chunk that happens to rank highest.

import type { ExtractedPolicyDraft, PolicyType } from "../types";

interface PolicyPattern {
  policyType: PolicyType;
  title: RegExp;
  content: RegExp;
}

const POLICY_PATTERNS: PolicyPattern[] = [
  { policyType: "PRIVACY", title: /\bprivacy\b/i, content: /\b(privacy|personal\s*data|gdpr|data\s*protection)\b/i },
  { policyType: "REFUND", title: /\brefund\b/i, content: /\b(refund|money[-\s]back|reimburs)/i },
  { policyType: "SHIPPING", title: /\b(shipping|delivery)\b/i, content: /\b(shipping|delivery\s*(time|policy|charge))\b/i },
  { policyType: "CANCELLATION", title: /\bcancel(l)?ation\b/i, content: /\bcancel(l)?ation\b|\bcancel\s*(an?\s*)?order\b/i },
  { policyType: "WARRANTY", title: /\b(warranty|guarantee)\b/i, content: /\b(warranty|guarantee)\b/i },
  { policyType: "COOKIES", title: /\bcookie/i, content: /\bcookie(s)?\b/i },
  { policyType: "TERMS", title: /\bterms\b/i, content: /\bterms\s*(and|&)?\s*conditions\b|\bterms\s*of\s*(service|use)\b/i },
];

const TITLE_WEIGHT = 4;
const URL_WEIGHT = 2;
const CONTENT_WEIGHT = 1;
const MAX_CONTENT_MATCHES = 5;
const MIN_CONTENT_LENGTH = 20;

function scorePattern(pattern: PolicyPattern, title: string, url: string, content: string): number {
  let score = 0;
  if (pattern.title.test(title)) score += TITLE_WEIGHT;
  if (pattern.title.test(url)) score += URL_WEIGHT;
  const contentMatches = content.match(new RegExp(pattern.content, "gi"));
  if (contentMatches) score += Math.min(contentMatches.length, MAX_CONTENT_MATCHES) * CONTENT_WEIGHT;
  return score;
}

export interface PolicyExtractionInput {
  content: string;
  title: string | null;
  sourceUrl: string;
}

/** Returns null for near-empty content — nothing worth learning as a distinct policy sub-type. */
export function extractPolicy(input: PolicyExtractionInput): ExtractedPolicyDraft | null {
  const content = input.content.trim();
  if (content.length < MIN_CONTENT_LENGTH) return null;

  const title = input.title ?? "";
  let best: { policyType: PolicyType; score: number } = { policyType: "OTHER", score: 0 };

  for (const pattern of POLICY_PATTERNS) {
    const score = scorePattern(pattern, title, input.sourceUrl, content);
    if (score > best.score) best = { policyType: pattern.policyType, score };
  }

  // Saturating normalization: a title hit alone (4) plus a couple of
  // content mentions already reads as confident; the ceiling (10) allows a
  // strong multi-signal match to approach but not need to hit every
  // possible point to reach 1.0.
  const confidenceScore = Math.min(1, best.score / 10);

  return {
    policyType: best.policyType,
    title: input.title,
    content,
    confidenceScore,
    source: "heuristic",
  };
}
