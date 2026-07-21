import { franc } from "franc";

export interface LanguageDetection {
  code: string;
  name: string;
  confidence: "high" | "low";
}

// franc returns ISO 639-3 codes. Mapped to the spec's named languages;
// anything else still gets a real ISO-derived name rather than "unknown".
const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English",
  hin: "Hindi",
  urd: "Urdu",
  arb: "Arabic",
  fra: "French",
  deu: "German",
  spa: "Spanish",
  por: "Portuguese",
  rus: "Russian",
  cmn: "Chinese",
  jpn: "Japanese",
  ben: "Bengali",
  ita: "Italian",
  nld: "Dutch",
  tur: "Turkish",
};

const MIN_TEXT_LENGTH_FOR_HIGH_CONFIDENCE = 100;

export function detectLanguage(text: string): LanguageDetection {
  const code = franc(text, { minLength: 10 });
  if (code === "und") {
    return { code: "und", name: "Undetermined", confidence: "low" };
  }
  return {
    code,
    name: LANGUAGE_NAMES[code] ?? code,
    confidence: text.length >= MIN_TEXT_LENGTH_FOR_HIGH_CONFIDENCE ? "high" : "low",
  };
}

// Real-world pages are full of short fragments (category labels, button
// text, prices) that individually run only ~10-20 chars — well below what
// trigram-based detection needs for a trustworthy read, and prone to
// confidently-wrong single-word misfires ("Crime" reading as Scots, etc).
const MIN_BLOCK_LENGTH_FOR_DETECTION = 40;

/**
 * Detects language per content block (heading/paragraph/list item) and
 * reports whether the page mixes languages — relevant for multilingual
 * sites where a single page-level detection would hide, say, an English
 * nav bar over Hindi body content. Only high-confidence per-block reads
 * (both a length floor and franc's own "high confidence" length gate) count
 * toward "this page mixes languages" — a single short misfire shouldn't
 * flag an otherwise single-language page.
 */
export function detectPageLanguages(blocks: string[]): { primary: LanguageDetection; isMultilingual: boolean; detected: string[] } {
  const combined = blocks.join(" ");
  const primary = detectLanguage(combined);

  const trustedLanguages = [
    ...new Set(
      blocks
        .filter((b) => b.length >= MIN_BLOCK_LENGTH_FOR_DETECTION)
        .map((b) => franc(b, { minLength: MIN_BLOCK_LENGTH_FOR_DETECTION }))
        .filter((code) => code !== "und")
    ),
  ];

  return {
    primary,
    isMultilingual: trustedLanguages.length > 1,
    detected: trustedLanguages.map((c) => LANGUAGE_NAMES[c] ?? c),
  };
}
