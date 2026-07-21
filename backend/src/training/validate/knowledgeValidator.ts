// Knowledge Validation stage — an explicit, distinct "Validate Knowledge"
// pipeline step that runs BEFORE chunking/embedding, on raw content units
// (pages/documents). This is genuinely new: Phase 3's confidence scorer
// has an implicit contentQuality gate that *discounts* a bad chunk's
// score after the fact, but nothing today rejects unusable content before
// it's chunked and embedded at all — wasted work on content that was
// never going to be useful. Distinct from qualityValidator.ts (task 101),
// which checks the *persisted, already-trained* knowledge base's
// integrity (broken relationships, dangling references) — this module
// only ever sees raw input.

import type { ValidationIssue } from "../types";

const MIN_CONTENT_LENGTH = 10;
const REPLACEMENT_CHAR = "�";
const MAX_REPLACEMENT_RATIO = 0.05;
const MIN_WORDS_FOR_REPETITION_CHECK = 20;
const MAX_REPETITION_UNIQUE_RATIO = 0.15;

export interface ValidationInput {
  sourceUrl: string;
  content: string;
}

/** Flags a short phrase repeated many times — a common scraping artifact (e.g. a nav-menu label captured as "page content" over and over) rather than real prose. */
function isExcessivelyRepetitive(content: string): boolean {
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS_FOR_REPETITION_CHECK) return false;
  const uniqueRatio = new Set(words.map((w) => w.toLowerCase())).size / words.length;
  return uniqueRatio < MAX_REPETITION_UNIQUE_RATIO;
}

export function validateKnowledgeUnit(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const context = { sourceUrl: input.sourceUrl };

  if (!input.sourceUrl || input.sourceUrl.trim().length === 0) {
    issues.push({ severity: "error", code: "missing_source", message: "Knowledge unit has no source URL.", context });
  }

  const content = input.content.trim();
  if (content.length === 0) {
    issues.push({ severity: "error", code: "empty_content", message: "Content is empty after trimming whitespace.", context });
    return issues; // nothing further to meaningfully check
  }

  if (content.length < MIN_CONTENT_LENGTH) {
    issues.push({ severity: "warning", code: "content_too_short", message: `Content is only ${content.length} characters — likely too little to be useful.`, context: { ...context, length: content.length } });
  }

  const replacementCount = (content.match(new RegExp(REPLACEMENT_CHAR, "g")) ?? []).length;
  if (replacementCount / content.length > MAX_REPLACEMENT_RATIO) {
    issues.push({
      severity: "error",
      code: "encoding_broken",
      message: `Content contains ${replacementCount} replacement characters (${((replacementCount / content.length) * 100).toFixed(1)}% of content) — likely a character-encoding failure upstream.`,
      context,
    });
  }

  if (isExcessivelyRepetitive(content)) {
    issues.push({ severity: "warning", code: "repetitive_content", message: "Content appears to be a short phrase repeated many times — likely a scraping artifact, not real prose.", context });
  }

  return issues;
}

export interface BatchValidationResult<T extends ValidationInput> {
  validUnits: T[];
  issues: ValidationIssue[];
}

/** Filters out any unit with an error-severity issue (empty content, missing source, broken encoding); units with only warnings are kept but still surfaced in `issues` for the training report. */
export function validateBatch<T extends ValidationInput>(units: T[]): BatchValidationResult<T> {
  const validUnits: T[] = [];
  const issues: ValidationIssue[] = [];

  for (const unit of units) {
    const unitIssues = validateKnowledgeUnit(unit);
    issues.push(...unitIssues);
    if (!unitIssues.some((i) => i.severity === "error")) {
      validUnits.push(unit);
    }
  }

  return { validUnits, issues };
}
