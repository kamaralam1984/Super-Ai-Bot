// Static catalog of the 12 administrator-selectable data categories — the
// Permission Wizard's source of truth for labels/descriptions/sensitivity,
// and the place that maps a category to where it can apply (the
// installation's own crawled knowledge base, a Phase 5 connector, or
// both). Pure data, no I/O — same discipline as
// connector/registry/connectorRegistry.ts.

import type { DataScope, DataScopeDefinition } from "../types";

export const DATA_SCOPE_CATALOG: Record<DataScope, DataScopeDefinition> = {
  PRODUCTS: { scope: "PRODUCTS", label: "Products", description: "Product names, descriptions, specifications, and availability.", category: "commerce", sensitivity: "standard", appliesTo: ["site", "connector"] },
  SERVICES: { scope: "SERVICES", label: "Services", description: "Service offerings, workflows, and industries served.", category: "commerce", sensitivity: "standard", appliesTo: ["site", "connector"] },
  FAQS: { scope: "FAQS", label: "FAQs", description: "Frequently asked questions and their answers.", category: "content", sensitivity: "standard", appliesTo: ["site", "connector"] },
  ORDERS: { scope: "ORDERS", label: "Orders", description: "Order status, history, and fulfillment details from a connected system.", category: "commerce", sensitivity: "sensitive", appliesTo: ["connector"] },
  CUSTOMERS: { scope: "CUSTOMERS", label: "Customers", description: "Customer accounts and profile information from a connected system.", category: "customer", sensitivity: "sensitive", appliesTo: ["connector"] },
  INVENTORY: { scope: "INVENTORY", label: "Inventory", description: "Stock levels and warehouse/inventory data from a connected system.", category: "operations", sensitivity: "sensitive", appliesTo: ["connector"] },
  APPOINTMENTS: { scope: "APPOINTMENTS", label: "Appointments", description: "Bookings, appointment slots, and scheduling data.", category: "operations", sensitivity: "sensitive", appliesTo: ["connector"] },
  CATEGORIES: { scope: "CATEGORIES", label: "Categories", description: "Product/service category and taxonomy listings.", category: "content", sensitivity: "standard", appliesTo: ["connector"] },
  PRICING: { scope: "PRICING", label: "Pricing", description: "Price, discount, and currency fields attached to products/services.", category: "commerce", sensitivity: "sensitive", appliesTo: ["site", "connector"] },
  SHIPPING: { scope: "SHIPPING", label: "Shipping", description: "Shipping policies, rates, and delivery information.", category: "operations", sensitivity: "standard", appliesTo: ["site", "connector"] },
  BLOGS: { scope: "BLOGS", label: "Blogs", description: "Blog posts and editorial content.", category: "content", sensitivity: "standard", appliesTo: ["site", "connector"] },
  SUPPORT_ARTICLES: {
    scope: "SUPPORT_ARTICLES",
    label: "Support Articles",
    description: "Help-center articles, policies (refund/warranty/terms/cookies), and support contact channels.",
    category: "content",
    sensitivity: "standard",
    appliesTo: ["site", "connector"],
  },
};

export function getDataScopeDefinition(scope: DataScope): DataScopeDefinition {
  return DATA_SCOPE_CATALOG[scope];
}

export function listDataScopeDefinitions(): DataScopeDefinition[] {
  return Object.values(DATA_SCOPE_CATALOG);
}

/**
 * Maps Phase 6's PolicyType (extracted policy sub-type) to the wizard scope
 * that governs it — Shipping gets its own toggle per the spec; every other
 * policy sub-type (refund/warranty/terms/cookies/privacy/cancellation/
 * other) is grouped under Support Articles rather than getting a dedicated
 * (and unrequested) toggle of its own.
 */
const POLICY_TYPE_TO_SCOPE: Record<string, DataScope> = {
  SHIPPING: "SHIPPING",
  PRIVACY: "SUPPORT_ARTICLES",
  REFUND: "SUPPORT_ARTICLES",
  CANCELLATION: "SUPPORT_ARTICLES",
  WARRANTY: "SUPPORT_ARTICLES",
  TERMS: "SUPPORT_ARTICLES",
  COOKIES: "SUPPORT_ARTICLES",
  OTHER: "SUPPORT_ARTICLES",
};

export function scopeForPolicyType(policyType: string): DataScope {
  return POLICY_TYPE_TO_SCOPE[policyType] ?? "SUPPORT_ARTICLES";
}

/**
 * Maps a Phase 3 KnowledgeChunk category string to the wizard scope that
 * governs it, where one applies. Most of Phase 3's 17 categories (Company,
 * Team, Legal, About, ...) are general site content with no dedicated
 * wizard toggle (see docs/PERMISSION_ENGINE.md's scoping note) and
 * correctly map to `null`.
 */
const CHUNK_CATEGORY_TO_SCOPE: Record<string, DataScope> = {
  Products: "PRODUCTS",
  Services: "SERVICES",
  FAQs: "FAQS",
  Blogs: "BLOGS",
  Policies: "SUPPORT_ARTICLES",
  Pricing: "PRICING",
  Shipping: "SHIPPING",
};

export function scopeForChunkCategory(category: string | null): DataScope | null {
  if (!category) return null;
  return CHUNK_CATEGORY_TO_SCOPE[category] ?? null;
}

/**
 * Maps Phase 5's EndpointCategory (the AI tool layer's vocabulary) to the
 * wizard scope that governs it. `search` and `custom` intentionally have no
 * direct mapping — see docs/PERMISSION_ENGINE.md's "Known limitations".
 */
const ENDPOINT_CATEGORY_TO_SCOPE: Record<string, DataScope | undefined> = {
  products: "PRODUCTS",
  orders: "ORDERS",
  services: "SERVICES",
  users: "CUSTOMERS",
  appointments: "APPOINTMENTS",
  inventory: "INVENTORY",
  categories: "CATEGORIES",
  blogs: "BLOGS",
  faqs: "FAQS",
};

export function scopeForEndpointCategory(category: string): DataScope | null {
  return ENDPOINT_CATEGORY_TO_SCOPE[category] ?? null;
}
