export type PageType =
  | "home" | "about" | "product" | "service" | "pricing" | "blog" | "faq" | "contact"
  | "policy" | "gallery" | "testimonials" | "documentation" | "career" | "other";

// Word-boundary patterns (no leading "/") so the same list works against
// both URL path segments ("/faq" — "/" is a non-word char, so \b still
// matches right before "faq") and plain title text ("Frequently Asked
// Questions" has no slashes at all).
const CONTENT_PATTERNS: [RegExp, PageType][] = [
  [/\b(about([-\s]us)?|who[-\s]we[-\s]are)\b/i, "about"],
  [/\b(product|shop|store)s?\b/i, "product"],
  [/\b(service|solutions?)\b/i, "service"],
  [/\b(pricing|plans)\b/i, "pricing"],
  [/\b(blog|news|articles?|posts?)\b/i, "blog"],
  [/\b(faq|frequently[-\s]asked)\b/i, "faq"],
  [/\b(contact([-\s]us)?|get[-\s]in[-\s]touch)\b/i, "contact"],
  [/\b(privacy|terms|refund|shipping|polic(y|ies)|legal)\b/i, "policy"],
  [/\b(gallery|portfolio|showcase)\b/i, "gallery"],
  [/\b(testimonials?|reviews?|case[-\s]stud(y|ies))\b/i, "testimonials"],
  [/\b(docs?|documentation|knowledge[-\s]base|kb|support|help)\b/i, "documentation"],
  [/\b(career|careers|jobs)\b/i, "career"],
];

export function classifyPageType(url: string, title: string | null): PageType {
  try {
    const path = new URL(url).pathname;
    if (/^\/?$/.test(path)) return "home";
    for (const [pattern, type] of CONTENT_PATTERNS) {
      if (pattern.test(path)) return type;
    }
  } catch {
    // fall through to title-based heuristic
  }

  if (title) {
    for (const [pattern, type] of CONTENT_PATTERNS) {
      if (pattern.test(title)) return type;
    }
  }

  return "other";
}
