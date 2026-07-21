// FAQ Learning + auto-merge engine — adds three things beyond what Phase 2
// (extraction) and Phase 3 (exact/near-duplicate flagging, already wired
// into knowledgeBuilder.service.ts via chunkDeduplicator.deduplicateFaqs)
// already do:
//
//   1. A per-FAQ confidence score (today confidence only exists downstream
//      on the derived KnowledgeChunk, never on the ExtractedFaq row itself).
//   2. similarQuestions/relatedQuestions — a DIFFERENT concept from
//      duplicate detection: paraphrases and topically-related-but-distinct
//      questions that should stay as separate FAQs, cross-linked, not
//      collapsed into one.
//   3. Real merge consolidation: Phase 3 only flags `isDuplicate` +
//      `duplicateOfFaqId` (a pointer, not a merge); this engine picks the
//      best canonical per duplicate cluster and records `mergedFaqIds` on
//      it, so the canonical is genuinely the most complete answer in its
//      cluster rather than an arbitrary array-order "first one".
//
// Deliberately does NOT recompute duplicate clustering — it consumes the
// isDuplicate/duplicateOfFaqId already set by Phase 3's pipeline, since
// re-deriving that clustering here would duplicate real, already-tested
// logic rather than build on it.

import { cosineSimilarity } from "../../knowledge/embed/embeddings";
import type { RelatedEntityRef } from "../types";

export interface FaqRecord {
  id: string;
  question: string;
  answer: string;
  source: string;
  isDuplicate: boolean;
  duplicateOfFaqId: string | null;
  embedding: number[];
}

const QUESTION_WORD_PATTERN = /^(what|how|why|when|where|who|which|can|does|do|is|are|will|should)\b/i;
const ANSWER_LENGTH_SATURATION = 200; // chars at which answerCompleteness reaches 1.0

function answerCompleteness(answer: string): number {
  return Math.min(1, answer.trim().length / ANSWER_LENGTH_SATURATION);
}

function questionClarity(question: string): number {
  let score = 0;
  if (question.trim().endsWith("?")) score += 0.6;
  if (QUESTION_WORD_PATTERN.test(question.trim())) score += 0.4;
  return Math.min(1, score);
}

function sourceQualityScore(source: string): number {
  return source === "structured_data" ? 1.0 : 0.7;
}

function corroborationScore(mergedCount: number): number {
  if (mergedCount >= 3) return 1.0;
  if (mergedCount === 2) return 0.85;
  if (mergedCount === 1) return 0.7;
  return 0.5; // a single, unmerged FAQ — not penalized to zero, just not corroborated
}

const CONFIDENCE_WEIGHTS = { sourceQuality: 0.3, answerCompleteness: 0.3, questionClarity: 0.15, corroboration: 0.25 };

/** `mergedCount` = number of duplicate FAQs consolidated into this one (0 if it's not a merge canonical). */
export function computeFaqConfidence(faq: Pick<FaqRecord, "question" | "answer" | "source">, mergedCount = 0): number {
  const weighted =
    CONFIDENCE_WEIGHTS.sourceQuality * sourceQualityScore(faq.source) +
    CONFIDENCE_WEIGHTS.answerCompleteness * answerCompleteness(faq.answer) +
    CONFIDENCE_WEIGHTS.questionClarity * questionClarity(faq.question) +
    CONFIDENCE_WEIGHTS.corroboration * corroborationScore(mergedCount);
  return Math.max(0, Math.min(1, weighted));
}

export interface FaqMergePlan {
  canonicalId: string;
  mergedFaqIds: string[];
}

/** Groups FAQs already flagged duplicate (by Phase 3) into merge plans, choosing the best canonical per cluster — not necessarily whichever one Phase 3's dedup pass happened to pick first, but the most complete (longest answer, then structured-data-sourced) member. */
export function planFaqMerges(faqs: FaqRecord[]): FaqMergePlan[] {
  const clusters = new Map<string, FaqRecord[]>(); // canonicalId (as originally pointed by Phase 3) -> all members incl. canonical

  for (const faq of faqs) {
    if (faq.isDuplicate && faq.duplicateOfFaqId) {
      const canonical = faqs.find((f) => f.id === faq.duplicateOfFaqId);
      const key = faq.duplicateOfFaqId;
      if (!clusters.has(key)) clusters.set(key, canonical ? [canonical] : []);
      clusters.get(key)!.push(faq);
    }
  }

  const plans: FaqMergePlan[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const best = [...members].sort((a, b) => {
      const sourceDiff = sourceQualityScore(b.source) - sourceQualityScore(a.source);
      if (sourceDiff !== 0) return sourceDiff;
      return b.answer.length - a.answer.length;
    })[0];
    plans.push({ canonicalId: best.id, mergedFaqIds: members.filter((m) => m.id !== best.id).map((m) => m.id) });
  }
  return plans;
}

export interface SimilarRelatedResult {
  similarQuestions: RelatedEntityRef[];
  relatedQuestions: RelatedEntityRef[];
}

export interface SimilarRelatedOptions {
  similarThreshold?: number;
  relatedThreshold?: number;
  k?: number;
}

/** Excludes candidates that are already part of the same merge cluster as `target` — those are consolidated, not "similar". */
export function computeSimilarAndRelatedQuestions(target: FaqRecord, candidates: FaqRecord[], options: SimilarRelatedOptions = {}): SimilarRelatedResult {
  const similarThreshold = options.similarThreshold ?? 0.8;
  const relatedThreshold = options.relatedThreshold ?? 0.55;
  const k = options.k ?? 5;

  const targetClusterId = target.duplicateOfFaqId ?? target.id;
  const scored = candidates
    .filter((c) => c.id !== target.id)
    .filter((c) => (c.duplicateOfFaqId ?? c.id) !== targetClusterId)
    .map((c) => ({ id: c.id, name: c.question, score: cosineSimilarity(target.embedding, c.embedding), reason: "" }))
    .sort((a, b) => b.score - a.score);

  const similarQuestions = scored
    .filter((r) => r.score >= similarThreshold)
    .slice(0, k)
    .map((r) => ({ ...r, reason: `Paraphrase of a similar question (${r.score.toFixed(2)})` }));

  const relatedQuestions = scored
    .filter((r) => r.score >= relatedThreshold && r.score < similarThreshold)
    .slice(0, k)
    .map((r) => ({ ...r, reason: `Topically related question (${r.score.toFixed(2)})` }));

  return { similarQuestions, relatedQuestions };
}
