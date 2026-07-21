// Service Learning Engine — enriches Phase 2's `ExtractedService` rows
// with `relatedServices` (embedding similarity + shared-industry boost,
// mirroring productLearning.ts) and `dependencies` (prerequisite services
// mentioned in the description/workflow text).

import { cosineSimilarity } from "../../knowledge/embed/embeddings";
import type { RelatedEntityRef } from "../types";

export interface ServiceForEnrichment {
  id: string;
  name: string;
  industries: string[];
  embedding: number[];
}

export interface RelatedServicesOptions {
  k?: number;
  minScore?: number;
  sharedIndustryBoost?: number;
}

export function computeRelatedServices(target: ServiceForEnrichment, candidates: ServiceForEnrichment[], options: RelatedServicesOptions = {}): RelatedEntityRef[] {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0.5;
  const boost = options.sharedIndustryBoost ?? 0.05;

  return candidates
    .filter((c) => c.id !== target.id)
    .map((c) => {
      const similarity = cosineSimilarity(target.embedding, c.embedding);
      const sharedIndustries = target.industries.filter((i) => c.industries.includes(i));
      const score = Math.min(1, similarity + (sharedIndustries.length > 0 ? boost : 0));
      const reason = sharedIndustries.length > 0 ? `Shared industries (${sharedIndustries.join(", ")}) and semantically similar (${similarity.toFixed(2)})` : `Semantically similar (${similarity.toFixed(2)})`;
      return { id: c.id, name: c.name, score, reason };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const DEPENDENCY_PHRASE_PATTERN = /\b(requires?|depends? on|needs?|must (?:already )?have|prerequisite|before you can|in conjunction with|only available (?:with|to)|first requires?)\b/i;
const MAX_DEPENDENCIES = 5;
const MIN_SENTENCE_LENGTH = 15;

/** Extracts sentences from the description/workflow text that name a real prerequisite — returns null (not []) rather than inventing a dependency that isn't stated. */
export function extractDependencies(description: string | null, workflow: string[] | null): string[] | null {
  const sources = [description, ...(workflow ?? [])].filter((s): s is string => Boolean(s));
  const sentences = sources.flatMap((text) =>
    text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_SENTENCE_LENGTH)
  );

  const dependencies = sentences.filter((s) => DEPENDENCY_PHRASE_PATTERN.test(s)).slice(0, MAX_DEPENDENCIES);
  return dependencies.length > 0 ? dependencies : null;
}
