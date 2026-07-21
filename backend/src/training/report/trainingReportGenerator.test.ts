import { describe, it, expect } from "vitest";
import { generateTrainingReport } from "./trainingReportGenerator";
import type { TrainingReportInputs } from "./trainingReportGenerator";

function baseInputs(overrides: Partial<TrainingReportInputs> = {}): TrainingReportInputs {
  return {
    crawlJobId: "job1",
    incremental: false,
    totalDocuments: 5,
    totalPages: 20,
    productsLearned: 10,
    servicesLearned: 3,
    faqsLearned: 8,
    policiesLearned: 2,
    contactsLearned: 1,
    embeddingsGenerated: 50,
    relationshipsCreated: 30,
    trainingTimeMs: 12345,
    chunkCategories: [],
    chunkConfidences: [],
    validationIssues: [],
    qualityIssues: [],
    ...overrides,
  };
}

describe("generateTrainingReport", () => {
  it("carries every counter through verbatim", () => {
    const report = generateTrainingReport(baseInputs());
    expect(report).toMatchObject({
      crawlJobId: "job1",
      incremental: false,
      totalDocuments: 5,
      totalPages: 20,
      productsLearned: 10,
      servicesLearned: 3,
      faqsLearned: 8,
      policiesLearned: 2,
      contactsLearned: 1,
      embeddingsGenerated: 50,
      relationshipsCreated: 30,
      trainingTimeMs: 12345,
    });
  });

  it("tallies category breakdown correctly", () => {
    const report = generateTrainingReport(baseInputs({ chunkCategories: ["Products", "Products", "FAQs", "Company"] }));
    expect(report.categoryBreakdown).toEqual({ Products: 2, FAQs: 1, Company: 1 });
  });

  it("computes overall confidence as the average of chunk confidences", () => {
    const report = generateTrainingReport(baseInputs({ chunkConfidences: [0.8, 0.6, 1.0] }));
    expect(report.overallConfidence).toBeCloseTo(0.8, 5);
  });

  it("returns 0 overall confidence when there are no chunks", () => {
    const report = generateTrainingReport(baseInputs({ chunkConfidences: [] }));
    expect(report.overallConfidence).toBe(0);
  });

  it("separates error-severity issues into errors and warning-severity into warnings, combining both validation and quality issues", () => {
    const report = generateTrainingReport(
      baseInputs({
        validationIssues: [{ severity: "error", code: "empty_content", message: "Empty content." }],
        qualityIssues: [{ severity: "warning", code: "low_confidence", message: "Low confidence.", entityType: "Chunk", entityId: "c1" }],
      })
    );
    expect(report.errors).toEqual(["Empty content."]);
    expect(report.warnings).toEqual(["Low confidence."]);
  });

  it("returns empty error/warning arrays when there are no issues", () => {
    const report = generateTrainingReport(baseInputs());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
