const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// "January 5, 2024" / "Jan 5 2024"
const DATE_MONTH_FIRST = new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
// "5 January 2024" / "5 Jan, 2024"
const DATE_DAY_FIRST = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES}),?\\s+(\\d{4})\\b`, "gi");

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Normalizes unambiguous, month-name-bearing dates to ISO 8601. Purely numeric dates (1/2/2024) are left alone — DD/MM vs MM/DD is genuinely ambiguous without a known locale, and guessing wrong corrupts the knowledge base. */
export function normalizeDates(text: string): string {
  return text
    .replace(DATE_MONTH_FIRST, (match: string, month: string, day: string, year: string) => {
      const monthNum = MONTH_INDEX[month.toLowerCase()];
      return monthNum ? `${year}-${pad2(monthNum)}-${pad2(Number(day))}` : match;
    })
    .replace(DATE_DAY_FIRST, (match: string, day: string, month: string, year: string) => {
      const monthNum = MONTH_INDEX[month.toLowerCase()];
      return monthNum ? `${year}-${pad2(monthNum)}-${pad2(Number(day))}` : match;
    });
}

const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"];

/** Strips known tracking query parameters from URLs found in text, so the same page under different campaign links normalizes to one citation-worthy URL. */
export function normalizeUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s)"'<>]+/g, (match) => {
    try {
      const url = new URL(match);
      for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
      let result = url.toString();
      if (result.endsWith("?")) result = result.slice(0, -1);
      return result;
    } catch {
      return match;
    }
  });
}

const SMART_QUOTE_MAP: [string, string][] = [
  ["‘", "'"], ["’", "'"], ["‚", "'"], ["‛", "'"],
  ["“", '"'], ["”", '"'], ["„", '"'], ["‟", '"'],
  ["–", "-"], ["—", "-"], ["…", "..."],
];

/**
 * Curly quotes/dashes -> plain ASCII, ellipsis -> "...", and collapses
 * repeated punctuation ("!!!" -> "!"). Dots are handled separately from the
 * other collapse (4+ dots -> exactly "...") so a real ellipsis produced by
 * the "…" -> "..." mapping above doesn't itself get flattened to a single
 * "." by the same pass — meaning-bearing punctuation is otherwise untouched.
 */
export function normalizePunctuation(text: string): string {
  let result = text;
  for (const [from, to] of SMART_QUOTE_MAP) {
    result = result.split(from).join(to);
  }
  result = result.replace(/([!?,;:])\1{1,}/g, "$1");
  result = result.replace(/\.{4,}/g, "...");
  return result;
}

// Full-width digit block U+FF10.."９" -> ASCII "0".."9", plus the
// full-width period/comma that commonly appear alongside full-width digits
// in the same numeric literal. Written with explicit \u escapes, not
// literal full-width characters, so this range can't be silently mangled.
const FULLWIDTH_DIGIT_REGEX = /[０-９]/g;
const FULLWIDTH_DIGIT_OFFSET = 0xff10 - 0x30;
const FULLWIDTH_PUNCTUATION_MAP: [string, string][] = [
  ["．", "."], // fullwidth full stop
  ["，", ","], // fullwidth comma
];

/** Full-width digits/decimal-point/comma (common in CJK-adjacent content) -> standard ASCII. Thousand-separator conventions themselves are locale-dependent and deliberately left untouched. */
export function normalizeNumbers(text: string): string {
  let result = text.replace(FULLWIDTH_DIGIT_REGEX, (ch) => String.fromCodePoint(ch.codePointAt(0)! - FULLWIDTH_DIGIT_OFFSET));
  for (const [from, to] of FULLWIDTH_PUNCTUATION_MAP) {
    result = result.split(from).join(to);
  }
  return result;
}

/** Collapses whitespace and line breaks: CRLF/CR -> LF, 3+ blank lines -> 1, trailing spaces trimmed. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Removes: C0/C1 control chars (except \n \t\r, handled by whitespace
// normalization), lone (unpaired) surrogates, and the Unicode "specials"
// non-characters — all invalid/unsafe to persist as text and typically
// symptomatic of malformed source encodings or corrupted OCR output.
const CONTROL_CHARS = "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F";
const NONCHARACTERS = "\\uFDD0-\\uFDEF\\uFFFE\\uFFFF";
// eslint-disable-next-line no-control-regex
const INVALID_UNICODE_REGEX = new RegExp(
  `[${CONTROL_CHARS}${NONCHARACTERS}]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]`,
  "g"
);

export function stripInvalidUnicode(text: string): string {
  return text.replace(INVALID_UNICODE_REGEX, "");
}

/**
 * The full Phase 3 text-cleaning pass: applied on top of Phase 2's HTML/DOM
 * noise removal (contentCleaner.ts), operating on already-extracted plain
 * text. Order matters — invalid-unicode/whitespace cleanup happens first so
 * later regex-based passes (dates, URLs, punctuation) run against clean input.
 */
export function normalizeText(text: string): string {
  let result = stripInvalidUnicode(text).normalize("NFC");
  result = normalizeWhitespace(result);
  result = normalizeNumbers(result);
  result = normalizePunctuation(result);
  result = normalizeUrls(result);
  result = normalizeDates(result);
  return result;
}
