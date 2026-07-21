// Training Report Generator — assembles the final TrainingReportData from
// raw pipeline counters, the persisted analogue of Phase 2's CrawlReport
// and Phase 4's TechDetectionReport. Pure function: every input is
// already-computed data from earlier pipeline stages.

import type { QualityIssue, TrainingReportData, ValidationIssue } from "../types";

export interface TrainingReportInputs {
  crawlJobId: string;
  incremental: boolean;
  totalDocuments: number;
  totalPages: number;
  productsLearned: number;
  servicesLearned: number;
  faqsLearned: number;
  policiesLearned: number;
  contactsLearned: number;
  embeddingsGenerated: number;
  relationshipsCreated: number;
  trainingTimeMs: number;
  chunkCategories: string[];
  chunkConfidences: number[];
  validationIssues: ValidationIssue[];
  qualityIssues: QualityIssue[];
}

function tallyCategories(categories: string[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const category of categories) {
    breakdown[category] = (breakdown[category] ?? 0) + 1;
  }
  return breakdown;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function generateTrainingReport(inputs: TrainingReportInputs): TrainingReportData {
  const errors = [...inputs.validationIssues, ...inputs.qualityIssues].filter((i) => i.severity === "error").map((i) => i.message);
  const warnings = [...inputs.validationIssues, ...inputs.qualityIssues].filter((i) => i.severity === "warning").map((i) => i.message);

  return {
    crawlJobId: inputs.crawlJobId,
    incremental: inputs.incremental,
    totalDocuments: inputs.totalDocuments,
    totalPages: inputs.totalPages,
    productsLearned: inputs.productsLearned,
    servicesLearned: inputs.servicesLearned,
    faqsLearned: inputs.faqsLearned,
    policiesLearned: inputs.policiesLearned,
    contactsLearned: inputs.contactsLearned,
    embeddingsGenerated: inputs.embeddingsGenerated,
    relationshipsCreated: inputs.relationshipsCreated,
    trainingTimeMs: inputs.trainingTimeMs,
    categoryBreakdown: tallyCategories(inputs.chunkCategories),
    overallConfidence: average(inputs.chunkConfidences),
    errors,
    warnings,
  };
}
