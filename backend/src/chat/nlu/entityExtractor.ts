// Entity Recognition — regex/pattern extraction for the entity types worth
// acting on programmatically (an email to route an escalation to, an order
// number to look up, a date/money mention worth logging for analytics),
// plus optional substring matching against a caller-supplied list of known
// product/service names (from this installation's own knowledge base —
// this module does no DB I/O itself, a caller passes the names in).

export type EntityType = "email" | "phone" | "order_id" | "date" | "money" | "url" | "product_mention" | "service_mention";

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  raw: string;
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Deliberately requires 7+ digits (after stripping separators) — short
// numeric runs ("in stock: 3", "order #12") are common in chat and are not
// phone numbers; this trades a little recall for far fewer false positives.
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;

const ORDER_ID_PATTERN = /\b(?:order\s*#?|ord[-\s]?|#)\s*([a-z0-9]{4,15})\b/gi;

const MONEY_PATTERN = /(?:[$€£₹¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|eur|gbp|inr|rs\.?|rupees|dollars))/gi;

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

const DATE_PATTERN =
  /\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+\d{4})?|today|tomorrow|yesterday|next week|this week)\b/gi;

function extractAll(text: string, pattern: RegExp, type: EntityType, normalize: (raw: string) => string = (raw) => raw.trim()): ExtractedEntity[] {
  const matches = text.match(pattern) ?? [];
  return matches.map((raw) => ({ type, value: normalize(raw), raw }));
}

/** Order ids are alphanumeric (e.g. "A12345", "ORD-9F2E1") — a digits-only normalization would silently drop real, meaningful letters, so this extracts the regex's own capture group (the id itself, without the "order #"/"ord-" prefix) via `matchAll` rather than reusing `extractAll`'s whole-match + strip approach. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export interface EntityExtractionOptions {
  knownProductNames?: string[];
  knownServiceNames?: string[];
}

/** Extracts structured entities from one message. Pure — no I/O, no network. `knownProductNames`/`knownServiceNames` (if supplied) enable simple case-insensitive substring matching against catalog names already loaded by the caller; this module never queries anything itself. */
export function extractEntities(text: string, options: EntityExtractionOptions = {}): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  entities.push(...extractAll(text, EMAIL_PATTERN, "email", (raw) => raw.toLowerCase()));
  entities.push(...extractAll(text, URL_PATTERN, "url"));
  for (const match of text.matchAll(ORDER_ID_PATTERN)) {
    if (match[1]) entities.push({ type: "order_id", value: match[1].toUpperCase(), raw: match[0] });
  }
  entities.push(...extractAll(text, MONEY_PATTERN, "money"));
  entities.push(...extractAll(text, DATE_PATTERN, "date", (raw) => raw.toLowerCase()));

  // Phone numbers are matched last and filtered against already-claimed
  // spans (order ids, dates like "2024-01-01") so a 7+ digit order number
  // or an ISO date isn't double-counted as a phone number too.
  const claimedRaw = new Set(entities.map((e) => e.raw));
  for (const raw of text.match(PHONE_PATTERN) ?? []) {
    const digits = digitsOnly(raw);
    if (digits.length < 7 || claimedRaw.has(raw)) continue;
    entities.push({ type: "phone", value: digits, raw: raw.trim() });
  }

  const lowerText = text.toLowerCase();
  for (const name of options.knownProductNames ?? []) {
    if (name.trim().length > 0 && lowerText.includes(name.toLowerCase())) {
      entities.push({ type: "product_mention", value: name, raw: name });
    }
  }
  for (const name of options.knownServiceNames ?? []) {
    if (name.trim().length > 0 && lowerText.includes(name.toLowerCase())) {
      entities.push({ type: "service_mention", value: name, raw: name });
    }
  }

  return entities;
}
