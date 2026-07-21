// KVL Enterprise Permission & Connector Access Engine (Phase 7) — shared
// types. Every module under backend/src/permission/ except
// permissionRecord.service.ts is pure (no Prisma, no network calls),
// matching Phase 3/4/5/6's established engine discipline.

/**
 * The 12 administrator-selectable data categories from the product spec.
 * Deliberately does not include general crawled website content (pages,
 * company info, generic knowledge chunks) — see docs/PERMISSION_ENGINE.md
 * for why that's a Phase 1/2 authorization boundary the customer already
 * crossed by installing the product, not something this engine re-gates.
 */
export type DataScope = "PRODUCTS" | "SERVICES" | "FAQS" | "ORDERS" | "CUSTOMERS" | "INVENTORY" | "APPOINTMENTS" | "CATEGORIES" | "PRICING" | "SHIPPING" | "BLOGS" | "SUPPORT_ARTICLES";

export const ALL_DATA_SCOPES: DataScope[] = ["PRODUCTS", "SERVICES", "FAQS", "ORDERS", "CUSTOMERS", "INVENTORY", "APPOINTMENTS", "CATEGORIES", "PRICING", "SHIPPING", "BLOGS", "SUPPORT_ARTICLES"];

/** A single-value union, not a boolean — see policy/leastPrivilegePolicy.ts for why. */
export type PermissionAccessLevel = "READ_ONLY";

export type PermissionGrantStatus = "ACTIVE" | "REVOKED";

export type PermissionEventType = "WIZARD_COMPLETED" | "GRANTED" | "REVOKED" | "ACCESS_CHECKED" | "ACCESS_DENIED";

export interface PermissionGrantRecord {
  id: string;
  installationId: string;
  connectorId: string | null;
  dataScope: DataScope;
  accessLevel: PermissionAccessLevel;
  status: PermissionGrantStatus;
  grantedAt: Date;
  grantedBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
  notes: string | null;
}

export interface DataScopeDefinition {
  scope: DataScope;
  label: string;
  description: string;
  category: "commerce" | "content" | "customer" | "operations";
  sensitivity: "standard" | "sensitive";
  /** Where this scope can be granted: against the installation's own crawled knowledge base ("site"), a Phase 5 connector ("connector"), or both. */
  appliesTo: Array<"site" | "connector">;
}

export interface AccessRequest {
  installationId: string;
  dataScope: DataScope;
  /** null/undefined = the installation's own crawled knowledge base; set = a specific Phase 5 connector. */
  connectorId?: string | null;
  /** Free-text, audit-only — e.g. "ai_training", "ai_tool_call", "search". */
  purpose: string;
}

export interface AccessDecision {
  allowed: boolean;
  dataScope: DataScope;
  connectorId: string | null;
  reason: string;
  matchedGrantId?: string;
}

export interface WizardScopeOption extends DataScopeDefinition {
  granted: boolean;
  grantId?: string;
}

export interface WizardState {
  installationId: string;
  connectorId: string | null;
  options: WizardScopeOption[];
}

export interface WizardSubmission {
  installationId: string;
  connectorId?: string | null;
  grantedScopes: DataScope[];
  /** Identifies who completed the wizard, for audit — e.g. an admin username/email. Not an authentication mechanism itself; the route layer's API-key gate already establishes the caller is the installation's administrator. */
  actor: string;
  notes?: string;
}

export interface WizardDiff {
  toGrant: DataScope[];
  toRevoke: DataScope[];
  unchanged: DataScope[];
}
