import { describe, it, expect } from "vitest";
import { scoreConfidence } from "./confidenceScorer";

const NOW = new Date("2026-07-20T00:00:00Z");
const GOOD_CONTENT = "Our refund policy allows returns of any item within 30 days of purchase for a full refund.";

describe("scoreConfidence", () => {
  it("scores clean, structured-data, recent, corroborated content near the top", () => {
    const result = scoreConfidence(
      {
        content: GOOD_CONTENT,
        extractionSource: "structured_data",
        fetchedAt: NOW,
        duplicateClusterSize: 3,
      },
      NOW
    );
    expect(result.overallScore).toBeGreaterThan(0.85);
  });

  it("scores empty content at zero", () => {
    const result = scoreConfidence({ content: "   " }, NOW);
    expect(result.overallScore).toBe(0);
    expect(result.factors.contentQuality).toBe(0);
  });

  it("penalizes very short content", () => {
    const short = scoreConfidence({ content: "Hi." }, NOW);
    const long = scoreConfidence({ content: GOOD_CONTENT }, NOW);
    expect(short.factors.contentQuality).toBeLessThan(long.factors.contentQuality);
  });

  it("penalizes content with a Unicode replacement character (encoding corruption)", () => {
    const corrupted = scoreConfidence({ content: "This text has a corrupt byte � right here in the middle of it." }, NOW);
    const clean = scoreConfidence({ content: GOOD_CONTENT }, NOW);
    expect(corrupted.factors.contentQuality).toBeLessThan(clean.factors.contentQuality);
  });

  it("gives structured_data higher source authority than heuristic", () => {
    const structured = scoreConfidence({ content: GOOD_CONTENT, extractionSource: "structured_data" }, NOW);
    const heuristic = scoreConfidence({ content: GOOD_CONTENT, extractionSource: "heuristic" }, NOW);
    expect(structured.factors.sourceAuthority).toBeGreaterThan(heuristic.factors.sourceAuthority);
  });

  it("decays recency for old content but never below the floor", () => {
    const fresh = scoreConfidence({ content: GOOD_CONTENT, fetchedAt: NOW }, NOW);
    const threeMonthsOld = scoreConfidence({ content: GOOD_CONTENT, fetchedAt: new Date("2026-04-21T00:00:00Z") }, NOW);
    const fiveYearsOld = scoreConfidence({ content: GOOD_CONTENT, fetchedAt: new Date("2021-07-20T00:00:00Z") }, NOW);
    expect(fresh.factors.recency).toBeGreaterThan(threeMonthsOld.factors.recency);
    expect(threeMonthsOld.factors.recency).toBeGreaterThan(fiveYearsOld.factors.recency);
    expect(threeMonthsOld.factors.recency).toBeGreaterThan(0.3); // not yet at the floor
    expect(fiveYearsOld.factors.recency).toBe(0.3); // long past saturation, sitting at the floor
  });

  it("decays evergreen categories slower than time-sensitive ones for the same age", () => {
    const oldDate = new Date("2025-01-20T00:00:00Z"); // 6 months before NOW
    const evergreen = scoreConfidence({ content: GOOD_CONTENT, fetchedAt: oldDate, category: "Company" }, NOW);
    const timeSensitive = scoreConfidence({ content: GOOD_CONTENT, fetchedAt: oldDate, category: "Pricing" }, NOW);
    expect(evergreen.factors.recency).toBeGreaterThan(timeSensitive.factors.recency);
  });

  it("treats missing fetchedAt as neutral, not zero", () => {
    const result = scoreConfidence({ content: GOOD_CONTENT }, NOW);
    expect(result.factors.recency).toBe(0.75);
  });

  it("penalizes an extraction error via the completeness factor", () => {
    const withError = scoreConfidence({ content: GOOD_CONTENT, extractionErrorMessage: "Document exceeds size limit" }, NOW);
    const withoutError = scoreConfidence({ content: GOOD_CONTENT }, NOW);
    expect(withError.factors.completeness).toBeLessThan(withoutError.factors.completeness);
  });

  it("rewards duplicate corroboration from multiple independent sources", () => {
    const single = scoreConfidence({ content: GOOD_CONTENT, duplicateClusterSize: 1 }, NOW);
    const corroborated = scoreConfidence({ content: GOOD_CONTENT, duplicateClusterSize: 4 }, NOW);
    expect(corroborated.factors.duplicateCorroboration).toBeGreaterThan(single.factors.duplicateCorroboration);
  });

  it("treats content with no OCR involvement as full marks on the OCR factor", () => {
    const result = scoreConfidence({ content: GOOD_CONTENT }, NOW);
    expect(result.factors.ocrAccuracy).toBe(1.0);
  });

  it("scales the OCR factor with the reported OCR confidence", () => {
    const lowOcr = scoreConfidence({ content: GOOD_CONTENT, ocrConfidence: 45 }, NOW);
    const highOcr = scoreConfidence({ content: GOOD_CONTENT, ocrConfidence: 95 }, NOW);
    expect(lowOcr.factors.ocrAccuracy).toBeLessThan(highOcr.factors.ocrAccuracy);
    expect(highOcr.factors.ocrAccuracy).toBeCloseTo(0.95, 5);
  });

  it("penalizes a stale embedding", () => {
    const stale = scoreConfidence({ content: GOOD_CONTENT, embeddingIsStale: true }, NOW);
    const fresh = scoreConfidence({ content: GOOD_CONTENT, embeddingIsStale: false }, NOW);
    expect(stale.factors.embeddingQuality).toBeLessThan(fresh.factors.embeddingQuality);
  });

  it("always returns an overall score clamped to [0, 1]", () => {
    const best = scoreConfidence(
      { content: GOOD_CONTENT, extractionSource: "structured_data", fetchedAt: NOW, duplicateClusterSize: 10, ocrConfidence: 100 },
      NOW
    );
    const worst = scoreConfidence({ content: "" }, NOW);
    expect(best.overallScore).toBeLessThanOrEqual(1);
    expect(worst.overallScore).toBeGreaterThanOrEqual(0);
  });
});
