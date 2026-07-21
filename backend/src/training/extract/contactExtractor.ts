// Contact Learning Engine — normalizes Phase 2's flat, untyped
// `CrawledPage.contactInfo` blob into a structured `ExtractedContact` draft,
// plus a best-effort (and honestly limited — see docs/AI_TRAINING_ENGINE.md)
// classification of which contact type/branch/department the page
// represents. Does not re-scrape HTML: works only from what Phase 2 already
// extracted, since re-parsing pages is Phase 2's job, not Phase 6's.

import type { ContactInfo } from "../../scanner/parse/contactExtractor";
import type { ContactType, ExtractedContactDraft } from "../types";

const SUPPORT_KEYWORDS = /\b(support|help\s*desk|customer\s*service|technical\s*support|helpline)\b/i;
const SALES_KEYWORDS = /\b(sales|buy\s*now|purchase\s*inquiry|get\s*a\s*quote|request\s*a\s*quote)\b/i;

const DEPARTMENT_KEYWORDS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Sales", pattern: /\bsales\b/i },
  { name: "Support", pattern: /\b(support|help\s*desk)\b/i },
  { name: "Human Resources", pattern: /\b(hr|human\s*resources)\b/i },
  { name: "Careers", pattern: /\bcareers?\b/i },
  { name: "Billing", pattern: /\bbilling\b/i },
  { name: "Customer Service", pattern: /\bcustomer\s*service\b/i },
];

// Catches conventional branch-naming patterns ("Mumbai Office", "Delhi
// Branch", "Contact Us - Bangalore") — known limitation: pages that name a
// location without one of these exact words (e.g. just "Mumbai") won't be
// recognized, since there's no reliable way to distinguish a place name
// from any other capitalized word without a gazetteer this engine doesn't
// have. Left null rather than guessed in that case.
const BRANCH_PATTERNS = [/\b([A-Z][a-zA-Z]+)\s+(?:Office|Branch|Location)\b/, /Contact(?:\s*Us)?\s*[-–:]\s*([A-Z][a-zA-Z]+)\b/];

function inferContactType(title: string | null): ContactType {
  const haystack = title ?? "";
  if (SUPPORT_KEYWORDS.test(haystack)) return "SUPPORT";
  if (SALES_KEYWORDS.test(haystack)) return "SALES";
  return "GENERAL";
}

function inferDepartment(title: string | null): string | null {
  if (!title) return null;
  for (const { name, pattern } of DEPARTMENT_KEYWORDS) {
    if (pattern.test(title)) return name;
  }
  return null;
}

function inferBranch(title: string | null): string | null {
  if (!title) return null;
  for (const pattern of BRANCH_PATTERNS) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export interface ContactExtractionInput {
  title: string | null;
  contactInfo: ContactInfo | null;
}

/** Returns null (rather than an empty-but-present row) when the page's contactInfo has nothing usable — no fabricated rows. */
export function extractContact(input: ContactExtractionInput): ExtractedContactDraft | null {
  const info = input.contactInfo;
  if (!info) return null;

  const hasAnything = info.phones.length > 0 || info.emails.length > 0 || info.addresses.length > 0 || info.mapsLinks.length > 0 || info.businessHours.length > 0;
  if (!hasAnything) return null;

  return {
    contactType: inferContactType(input.title),
    branch: inferBranch(input.title),
    department: inferDepartment(input.title),
    phones: info.phones,
    emails: info.emails,
    addresses: info.addresses,
    mapsLinks: info.mapsLinks,
    hours: info.businessHours,
    source: "heuristic",
  };
}
