import { describe, it, expect } from "vitest";
import { scoreConfidence, scoreAndFilter } from "./confidenceEngine";
import { detectCms } from "../detect/cmsDetector";
import { collectSignals } from "../signals/signalCollector";

describe("scoreConfidence", () => {
  it("gives a single signal its own weight as the confidence", () => {
    const [result] = scoreConfidence([{ name: "WordPress", matches: [{ signal: "a", weight: 0.9 }] }]);
    expect(result.confidence).toBeCloseTo(0.9, 5);
  });

  it("combines two weak signals to more than either alone but less than their sum", () => {
    const [result] = scoreConfidence([
      { name: "WordPress", matches: [{ signal: "a", weight: 0.3 }, { signal: "b", weight: 0.3 }] },
    ]);
    // 1 - (1-0.3)*(1-0.3) = 1 - 0.49 = 0.51
    expect(result.confidence).toBeCloseTo(0.51, 5);
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("asymptotically approaches but never reaches 1.0 with more agreeing signals", () => {
    const [result] = scoreConfidence([
      { name: "WordPress", matches: [{ signal: "a", weight: 0.9 }, { signal: "b", weight: 0.9 }, { signal: "c", weight: 0.9 }] },
    ]);
    expect(result.confidence).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0.99);
  });

  it("preserves every signal's description as evidence, in order", () => {
    const [result] = scoreConfidence([{ name: "WordPress", matches: [{ signal: "first", weight: 0.5 }, { signal: "second", weight: 0.5 }] }]);
    expect(result.evidence).toEqual(["first", "second"]);
  });

  it("sorts results by confidence, highest first", () => {
    const results = scoreConfidence([
      { name: "Weak", matches: [{ signal: "a", weight: 0.2 }] },
      { name: "Strong", matches: [{ signal: "a", weight: 0.9 }] },
      { name: "Medium", matches: [{ signal: "a", weight: 0.5 }] },
    ]);
    expect(results.map((r) => r.name)).toEqual(["Strong", "Medium", "Weak"]);
  });

  it("clamps out-of-range weights defensively", () => {
    const [result] = scoreConfidence([{ name: "X", matches: [{ signal: "a", weight: 1.5 }] }]);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("returns an empty array for empty input", () => {
    expect(scoreConfidence([])).toEqual([]);
  });

  it("handles a candidate with zero matches as zero confidence", () => {
    const [result] = scoreConfidence([{ name: "X", matches: [] }]);
    expect(result.confidence).toBe(0);
  });
});

describe("scoreAndFilter", () => {
  it("excludes candidates below the confidence floor", () => {
    const results = scoreAndFilter(
      [
        { name: "Strong", matches: [{ signal: "a", weight: 0.9 }] },
        { name: "Weak", matches: [{ signal: "a", weight: 0.1 }] },
      ],
      0.5
    );
    expect(results.map((r) => r.name)).toEqual(["Strong"]);
  });

  it("includes everything when minConfidence is 0 (the default)", () => {
    const results = scoreAndFilter([{ name: "Weak", matches: [{ signal: "a", weight: 0.05 }] }]);
    expect(results).toHaveLength(1);
  });
});

describe("confidenceEngine — real end-to-end with a real detector and a real site", () => {
  it("produces a high-confidence WordPress score from real multi-signal evidence", async () => {
    const signals = await collectSignals("https://wptavern.com");
    const raw = detectCms(signals);
    const scored = scoreConfidence(raw);
    const wordpress = scored.find((c) => c.name === "WordPress");
    expect(wordpress).toBeDefined();
    expect(wordpress!.confidence).toBeGreaterThan(0.9);
    expect(wordpress!.evidence.length).toBeGreaterThanOrEqual(3);
  }, 30000);
});
