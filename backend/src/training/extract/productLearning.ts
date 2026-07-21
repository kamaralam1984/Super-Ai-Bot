// Product Learning Engine — enriches Phase 2's `ExtractedProduct` rows with
// three things Phase 2 never computed: a normalized `availability` value,
// distinctly-extracted `benefits` (outcomes, not specs), and a
// `relatedProducts` list. Takes pre-computed embeddings rather than calling
// the embedding model itself — embedding generation stays centralized in
// Phase 3's `embed/embeddings.ts`, called once by the training orchestrator
// for every product's name+description text.

import { cosineSimilarity } from "../../knowledge/embed/embeddings";
import type { RelatedEntityRef } from "../types";

const IN_STOCK_PATTERN = /\b(in\s*stock|available)\b/i;
const OUT_OF_STOCK_PATTERN = /\b(out\s*of\s*stock|sold\s*out|unavailable|discontinued)\b/i;
const PREORDER_PATTERN = /\b(pre[-\s]?order|coming\s*soon|launching\s*soon)\b/i;

export type NormalizedAvailability = "in_stock" | "out_of_stock" | "preorder" | "unknown";

export function normalizeAvailability(stockStatus: string | null, description: string | null): NormalizedAvailability {
  for (const source of [stockStatus, description]) {
    if (!source) continue;
    if (OUT_OF_STOCK_PATTERN.test(source)) return "out_of_stock";
    if (PREORDER_PATTERN.test(source)) return "preorder";
    if (IN_STOCK_PATTERN.test(source)) return "in_stock";
  }
  return "unknown";
}

const BENEFIT_PHRASE_PATTERN = /\b(helps? you|so (?:that )?you can|which means|allow(?:s|ing) you to|enjoy|experience|save (?:time|money)|no more|without the hassle|designed to make)\b/i;
const MAX_BENEFITS = 5;
const MIN_SENTENCE_LENGTH = 15;

/** Extracts sentences from the description that read as a benefit/outcome claim rather than a spec — real text pulled from real content, never invented. Returns null (not []) when nothing qualifies. */
export function extractBenefits(description: string | null): string[] | null {
  if (!description) return null;
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH);

  const benefits = sentences.filter((s) => BENEFIT_PHRASE_PATTERN.test(s)).slice(0, MAX_BENEFITS);
  return benefits.length > 0 ? benefits : null;
}

export interface ProductForEnrichment {
  id: string;
  name: string;
  category: string | null;
  embedding: number[];
}

export interface RelatedProductsOptions {
  k?: number;
  minScore?: number;
  sameCategoryBoost?: number;
}

/** Ranks candidate products by embedding similarity to `target`, with a small same-category boost — a product in the same category that's also semantically similar is a stronger "related" signal than similarity alone. */
export function computeRelatedProducts(target: ProductForEnrichment, candidates: ProductForEnrichment[], options: RelatedProductsOptions = {}): RelatedEntityRef[] {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0.5;
  const boost = options.sameCategoryBoost ?? 0.05;

  const scored = candidates
    .filter((c) => c.id !== target.id)
    .map((c) => {
      const similarity = cosineSimilarity(target.embedding, c.embedding);
      const sameCategory = target.category !== null && target.category === c.category;
      const score = Math.min(1, similarity + (sameCategory ? boost : 0));
      const reason = sameCategory ? `Same category ("${c.category}") and semantically similar (${similarity.toFixed(2)})` : `Semantically similar (${similarity.toFixed(2)})`;
      return { id: c.id, name: c.name, score, reason };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}
