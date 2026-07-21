// Entity-Level Change Detection Engine — the genuinely new layer this
// phase adds on top of Phase 2's already-built page-level change
// detection (scanner/recrawl/changeDetector.ts, which only knows "page
// X's content hash changed", not *what* changed on it). Every recrawl
// creates entirely fresh ExtractedProduct/Service/Faq/Policy/Contact rows
// (they belong to a fresh CrawledPage row for the new CrawlJob, not an
// update to the previous crawl's rows — see schema.prisma), so there is
// no database-level "this row was updated" to observe directly. This
// module reconstructs that by matching entities across two crawls by a
// stable business key (SKU/name/question/policy type) and diffing the
// fields the spec explicitly calls out: price, stock, description,
// pricing, answers, policy content, contact details.

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  /** Price/stock fields are ranked above plain description/copy edits — the spec calls out "Price Changes" and "Inventory Changes" as their own category, not just "something changed." */
  significant: boolean;
}

export type EntityChangeType = "added" | "removed" | "updated";

export interface EntityChange {
  identity: string;
  changeType: EntityChangeType;
  fieldChanges: FieldChange[];
}

export type EntityCategory = "products" | "services" | "faqs" | "policies" | "contacts";

export interface EntityChangeSummary {
  category: EntityCategory;
  added: number;
  removed: number;
  updated: number;
  /** Capped, most-significant-first — see MAX_CHANGES_PER_CATEGORY. A count above the cap is never silently implied as "everything shown"; callers needing the full list should query the underlying tables directly. */
  changes: EntityChange[];
  truncated: boolean;
}

const MAX_CHANGES_PER_CATEGORY = 50;

function matchByKey<T>(oldItems: T[], newItems: T[], keyFn: (item: T) => string): { added: T[]; removed: T[]; matched: Array<{ old: T; incoming: T; key: string }> } {
  const oldByKey = new Map(oldItems.map((item) => [keyFn(item), item]));
  const newByKey = new Map(newItems.map((item) => [keyFn(item), item]));

  const added: T[] = [];
  const matched: Array<{ old: T; incoming: T; key: string }> = [];
  for (const [key, incoming] of newByKey) {
    const old = oldByKey.get(key);
    if (old) matched.push({ old, incoming, key });
    else added.push(incoming);
  }

  const removed = [...oldByKey.entries()].filter(([key]) => !newByKey.has(key)).map(([, item]) => item);
  return { added, removed, matched };
}

/** `T` deliberately has no `Record<string, unknown>` constraint — TS requires an explicit index signature to satisfy that constraint even though every one of this module's snapshot interfaces is structurally compatible with it; the cast below is the same runtime-safe field lookup either way, just without fighting that strictness quirk at every call site. */
function diffFields<T extends object>(old: T, incoming: T, fields: string[], significantFields: Set<string>): FieldChange[] {
  const oldRecord = old as Record<string, unknown>;
  const incomingRecord = incoming as Record<string, unknown>;
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const oldValue = oldRecord[field];
    const newValue = incomingRecord[field];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field, oldValue: oldValue ?? null, newValue: newValue ?? null, significant: significantFields.has(field) });
    }
  }
  return changes;
}

/** Significant changes first, then by how many fields changed (more = more likely to matter), most-changed first. Deterministic — no random tie-breaking. */
function rankChanges(changes: EntityChange[]): EntityChange[] {
  return [...changes].sort((a, b) => {
    const aSig = a.fieldChanges.some((f) => f.significant) ? 1 : 0;
    const bSig = b.fieldChanges.some((f) => f.significant) ? 1 : 0;
    if (aSig !== bSig) return bSig - aSig;
    return b.fieldChanges.length - a.fieldChanges.length;
  });
}

function buildSummary(category: EntityCategory, added: EntityChange[], removed: EntityChange[], updated: EntityChange[]): EntityChangeSummary {
  const all = rankChanges([...updated, ...added, ...removed]);
  const truncated = all.length > MAX_CHANGES_PER_CATEGORY;
  return { category, added: added.length, removed: removed.length, updated: updated.length, changes: all.slice(0, MAX_CHANGES_PER_CATEGORY), truncated };
}

export interface ProductSnapshot {
  name: string;
  sku: string | null;
  price: string | null;
  currency: string | null;
  discount: string | null;
  stockStatus: string | null;
  description: string | null;
}

const PRODUCT_FIELDS = ["price", "currency", "discount", "stockStatus", "description"];
const PRODUCT_SIGNIFICANT_FIELDS = new Set(["price", "currency", "discount", "stockStatus"]);

function productKey(p: ProductSnapshot): string {
  return p.sku ? `sku:${p.sku.toLowerCase()}` : `name:${p.name.trim().toLowerCase()}`;
}

export function detectProductChanges(oldProducts: ProductSnapshot[], newProducts: ProductSnapshot[]): EntityChangeSummary {
  const { added, removed, matched } = matchByKey(oldProducts, newProducts, productKey);
  const addedChanges: EntityChange[] = added.map((p) => ({ identity: p.name, changeType: "added", fieldChanges: [] }));
  const removedChanges: EntityChange[] = removed.map((p) => ({ identity: p.name, changeType: "removed", fieldChanges: [] }));
  const updatedChanges: EntityChange[] = matched
    .map(({ old, incoming }) => ({ identity: incoming.name, changeType: "updated" as const, fieldChanges: diffFields(old, incoming, PRODUCT_FIELDS, PRODUCT_SIGNIFICANT_FIELDS) }))
    .filter((c) => c.fieldChanges.length > 0);
  return buildSummary("products", addedChanges, removedChanges, updatedChanges);
}

export interface ServiceSnapshot {
  name: string;
  pricing: string | null;
  description: string | null;
}

const SERVICE_FIELDS = ["pricing", "description"];
const SERVICE_SIGNIFICANT_FIELDS = new Set(["pricing"]);

function serviceKey(s: ServiceSnapshot): string {
  return `name:${s.name.trim().toLowerCase()}`;
}

export function detectServiceChanges(oldServices: ServiceSnapshot[], newServices: ServiceSnapshot[]): EntityChangeSummary {
  const { added, removed, matched } = matchByKey(oldServices, newServices, serviceKey);
  const addedChanges: EntityChange[] = added.map((s) => ({ identity: s.name, changeType: "added", fieldChanges: [] }));
  const removedChanges: EntityChange[] = removed.map((s) => ({ identity: s.name, changeType: "removed", fieldChanges: [] }));
  const updatedChanges: EntityChange[] = matched
    .map(({ old, incoming }) => ({ identity: incoming.name, changeType: "updated" as const, fieldChanges: diffFields(old, incoming, SERVICE_FIELDS, SERVICE_SIGNIFICANT_FIELDS) }))
    .filter((c) => c.fieldChanges.length > 0);
  return buildSummary("services", addedChanges, removedChanges, updatedChanges);
}

export interface FaqSnapshot {
  question: string;
  answer: string;
}

const FAQ_FIELDS = ["answer"];
const FAQ_SIGNIFICANT_FIELDS = new Set<string>();

function faqKey(f: FaqSnapshot): string {
  return `q:${f.question.trim().toLowerCase()}`;
}

export function detectFaqChanges(oldFaqs: FaqSnapshot[], newFaqs: FaqSnapshot[]): EntityChangeSummary {
  const { added, removed, matched } = matchByKey(oldFaqs, newFaqs, faqKey);
  const addedChanges: EntityChange[] = added.map((f) => ({ identity: f.question, changeType: "added", fieldChanges: [] }));
  const removedChanges: EntityChange[] = removed.map((f) => ({ identity: f.question, changeType: "removed", fieldChanges: [] }));
  const updatedChanges: EntityChange[] = matched
    .map(({ old, incoming }) => ({ identity: incoming.question, changeType: "updated" as const, fieldChanges: diffFields(old, incoming, FAQ_FIELDS, FAQ_SIGNIFICANT_FIELDS) }))
    .filter((c) => c.fieldChanges.length > 0);
  return buildSummary("faqs", addedChanges, removedChanges, updatedChanges);
}

export interface PolicySnapshot {
  policyType: string;
  title: string | null;
  content: string;
}

const POLICY_FIELDS = ["title", "content"];
const POLICY_SIGNIFICANT_FIELDS = new Set<string>();

function policyKey(p: PolicySnapshot): string {
  return `type:${p.policyType}`;
}

export function detectPolicyChanges(oldPolicies: PolicySnapshot[], newPolicies: PolicySnapshot[]): EntityChangeSummary {
  const { added, removed, matched } = matchByKey(oldPolicies, newPolicies, policyKey);
  const addedChanges: EntityChange[] = added.map((p) => ({ identity: p.policyType, changeType: "added", fieldChanges: [] }));
  const removedChanges: EntityChange[] = removed.map((p) => ({ identity: p.policyType, changeType: "removed", fieldChanges: [] }));
  const updatedChanges: EntityChange[] = matched
    .map(({ old, incoming }) => ({ identity: incoming.policyType, changeType: "updated" as const, fieldChanges: diffFields(old, incoming, POLICY_FIELDS, POLICY_SIGNIFICANT_FIELDS) }))
    .filter((c) => c.fieldChanges.length > 0);
  return buildSummary("policies", addedChanges, removedChanges, updatedChanges);
}

export interface ContactSnapshot {
  contactType: string;
  branch: string | null;
  phones: string[];
  emails: string[];
  addresses: string[];
}

const CONTACT_FIELDS = ["phones", "emails", "addresses"];
const CONTACT_SIGNIFICANT_FIELDS = new Set(["phones", "emails", "addresses"]); // any contact-detail change is worth flagging prominently — there's no "minor" version of a wrong phone number

function contactKey(c: ContactSnapshot): string {
  return `${c.contactType}:${(c.branch ?? "default").trim().toLowerCase()}`;
}

export function detectContactChanges(oldContacts: ContactSnapshot[], newContacts: ContactSnapshot[]): EntityChangeSummary {
  const { added, removed, matched } = matchByKey(oldContacts, newContacts, contactKey);
  const identityOf = (c: ContactSnapshot) => (c.branch ? `${c.contactType} (${c.branch})` : c.contactType);
  const addedChanges: EntityChange[] = added.map((c) => ({ identity: identityOf(c), changeType: "added", fieldChanges: [] }));
  const removedChanges: EntityChange[] = removed.map((c) => ({ identity: identityOf(c), changeType: "removed", fieldChanges: [] }));
  const updatedChanges: EntityChange[] = matched
    .map(({ old, incoming }) => ({ identity: identityOf(incoming), changeType: "updated" as const, fieldChanges: diffFields(old, incoming, CONTACT_FIELDS, CONTACT_SIGNIFICANT_FIELDS) }))
    .filter((c) => c.fieldChanges.length > 0);
  return buildSummary("contacts", addedChanges, removedChanges, updatedChanges);
}
