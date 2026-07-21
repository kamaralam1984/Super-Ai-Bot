// KVL Enterprise AI Training Engine (Phase 6) — shared types.
// Every module under backend/src/training/ except trainingRecord.service.ts
// is pure (no Prisma) — some (relationships/, incremental/) also make no
// network calls, matching Phase 3/4/5's established engine discipline.

export type ContactType = "GENERAL" | "SUPPORT" | "SALES";

export interface ExtractedContactDraft {
  contactType: ContactType;
  branch: string | null;
  department: string | null;
  phones: string[];
  emails: string[];
  addresses: string[];
  mapsLinks: string[];
  hours: string[];
  source: string;
}

export type PolicyType = "PRIVACY" | "REFUND" | "SHIPPING" | "CANCELLATION" | "WARRANTY" | "TERMS" | "COOKIES" | "OTHER";

export interface ExtractedPolicyDraft {
  policyType: PolicyType;
  title: string | null;
  content: string;
  confidenceScore: number;
  source: string;
}

export interface RelatedEntityRef {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export type RelationshipType =
  | "PRODUCT_CATEGORY"
  | "SERVICE_INDUSTRY"
  | "FAQ_PRODUCT"
  | "FAQ_SERVICE"
  | "POLICY_SERVICE"
  | "BLOG_PRODUCT"
  | "COMPANY_CONTACT"
  | "PRODUCT_PRODUCT"
  | "SERVICE_SERVICE";

export type RelationshipEntityType = "Product" | "Service" | "Faq" | "Policy" | "Contact" | "Chunk" | "Category";

export interface KnowledgeRelationshipDraft {
  sourceType: RelationshipEntityType;
  sourceId: string;
  targetType: RelationshipEntityType;
  targetId: string;
  relationshipType: RelationshipType;
  confidence: number;
  evidence: string[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface QualityIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityType: string;
  entityId: string;
}

export interface TrainingReportData {
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
  categoryBreakdown: Record<string, number>;
  overallConfidence: number;
  errors: string[];
  warnings: string[];
}
