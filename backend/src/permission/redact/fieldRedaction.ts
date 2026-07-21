// Field Redaction — best-effort key-based redaction for connector API
// responses whose shape isn't controlled by this product (every customer's
// WordPress/Shopify/Magento/enterprise system returns a different JSON
// shape). This is the concrete mechanism behind the Pricing permission: an
// administrator can grant "Products"/"Services" without granting "Pricing"
// and the AI still gets names, descriptions, and availability — just not
// price fields. This is a pragmatic, documented best effort (matching
// common key names), not a cryptographic guarantee that no price value can
// ever leak through a field name this product doesn't recognize — see
// docs/PERMISSION_ENGINE.md's "Known limitations".

const PRICE_KEY_PATTERN = /^(price|prices|pricing|cost|costs|discount|discounts|currency|msrp|sale_?price|regular_?price|unit_?price|list_?price|amount)$/i;

const MAX_REDACTION_DEPTH = 8;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (PRICE_KEY_PATTERN.test(key)) continue;
    result[key] = redactValue(val, depth + 1);
  }
  return result;
}

/** Recursively strips keys that look like price/pricing fields from a JSON-shaped value. Applied to tool results when a caller is authorized for PRODUCTS/SERVICES but not PRICING. */
export function redactPricingFields<T>(data: T): T {
  return redactValue(data, 0) as T;
}
