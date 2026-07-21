import type { DetectionCandidate, ScoredCandidate } from "../types";

/**
 * Turns raw detector output (`DetectionCandidate[]` — a technology name
 * plus every independent `SignalMatch` that fired for it, each with its
 * own standalone weight in [0,1]) into calibrated `ScoredCandidate[]`
 * (name + one combined confidence + human-readable evidence), sorted
 * best-first. Every one of the 16 detection categories in `detect/`
 * funnels through this same function — no detector computes its own
 * confidence, which is what keeps the scoring consistent across CMS,
 * frontend framework, hosting, payment gateway, and everything else.
 *
 * Combines signals via **noisy-OR**: `confidence = 1 - ∏(1 - weight_i)`.
 * Chosen over naive summing (`weight_1 + weight_2 + ...`, which can
 * exceed 1 and has no probabilistic meaning) or max-only (which discards
 * the fact that multiple independent signals agreeing is stronger
 * evidence than any one of them alone). A single strong signal (weight
 * 0.9) alone yields confidence 0.9; two weak signals (0.3 each) compound
 * to 0.51, not 0.3 or 0.6; more agreeing signals asymptotically approach
 * but never reach 1.0. See docs/TECH_DETECTION.md's "Confidence scoring
 * design" section for the full rationale.
 */
export function scoreConfidence(candidates: DetectionCandidate[]): ScoredCandidate[] {
  return candidates
    .map((candidate): ScoredCandidate => {
      const confidence = 1 - candidate.matches.reduce((product, match) => product * (1 - clamp01(match.weight)), 1);
      return {
        name: candidate.name,
        confidence: roundTo(confidence, 4),
        evidence: candidate.matches.map((m) => m.signal),
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/** Convenience: scores and keeps only candidates whose combined confidence clears `minConfidence` (default 0) — useful for a report that should omit noise-level single-weak-signal candidates rather than listing every technology that got even one point of evidence. */
export function scoreAndFilter(candidates: DetectionCandidate[], minConfidence = 0): ScoredCandidate[] {
  return scoreConfidence(candidates).filter((c) => c.confidence >= minConfidence);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
