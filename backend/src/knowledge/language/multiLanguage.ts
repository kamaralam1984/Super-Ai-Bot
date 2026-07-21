import { detectLanguage, type LanguageDetection } from "../../scanner/language/languageDetector";

/**
 * The spec's explicitly supported languages — see docs/KNOWLEDGE_BUILDER.md's
 * multi-language scope boundary (live translation is out of scope; every
 * chunk keeps its own detected language). Japanese and Chinese were added
 * in Phase 8 (see docs/CHAT_ENGINE.md) to reach the Live Chat Engine's
 * 10-language target — the underlying franc-based detector
 * (scanner/language/languageDetector.ts) already maps `cmn`→"Chinese" and
 * `jpn`→"Japanese", so this is a whitelist widening, not new detection
 * logic.
 */
export const SUPPORTED_LANGUAGES = ["English", "Hindi", "Hinglish", "Urdu", "Arabic", "French", "German", "Spanish", "Japanese", "Chinese"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Extremely common romanized-Hindi function words, verbs, and
// colloquialisms that essentially never appear in genuine English prose —
// curated for precision (few false positives on real English text) over
// exhaustive recall. franc (Phase 2's underlying detector) has no native
// Hinglish model since it isn't a real ISO 639-3 language — it's Hindi
// grammar/vocabulary written in Latin script, which franc reads as English
// (or fails to place at all on short/mixed text) since it only looks at
// character trigrams, not actual word meaning.
// Deliberately excludes anything that collides with a real, common English
// word ("me", "hi", "so") even where that costs some recall — a marker set
// with false positives on plain English would be worse than an incomplete
// one, given the dual count+ratio gate below is the main defense and can't
// catch every case on its own.
const HINGLISH_MARKERS = new Set([
  "hai", "hain", "hoon", "hun", "tha", "thi", "thay",
  "nahi", "nahin", "haan", "han",
  "kya", "kyun", "kyu", "kaise", "kahan", "kab", "kaun", "kitna", "kitne",
  "hum", "humein", "humko", "mujhe", "mujhko", "tumhe", "tumko", "aap", "aapka", "aapko",
  "mera", "meri", "mere", "tera", "teri", "tere", "uska", "uski", "unka", "iska", "iski", "unko", "isko", "usko",
  "karo", "kro", "karna", "krna", "kiya", "kijiye", "krke",
  "raha", "rha", "rahi", "rhi", "rahe", "rhe",
  "bhai", "yaar", "acha", "accha", "theek", "thik", "sahi",
  "bahut", "bohot", "matlab", "chahiye",
  "wala", "wale", "wali", "jaisa", "jaise", "waisa", "waise", "isliye", "lekin", "magar",
  "paisa", "paise", "paisay", "abhi", "phir", "fir",
  "samajh", "samjho", "dekho", "suno", "bolo", "jaana", "jana",
  "ka", "ki", "ke", "ko", "se", "mein", "par", "aur", "poora", "pura",
  "din", "kaam", "jaldi", "pahle", "jo", "ek", "jayega", "jaye", "hisab", "bnate", "banate", "usme", "isme",
]);

const HINGLISH_MIN_MARKER_COUNT = 2; // avoid a single stray word false-positiving on short English text
const HINGLISH_MIN_MARKER_RATIO = 0.08; // 8%+ of words being Hinglish markers is a strong signal, not noise

function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

/** Heuristic check for romanized Hindi (Hinglish) content, meant to be applied to text franc has already read as English or undetermined — see module docstring above for why franc can't tell the difference on its own. */
export function looksLikeHinglish(text: string): boolean {
  const words = tokenizeWords(text);
  if (words.length === 0) return false;
  const markerCount = words.filter((w) => HINGLISH_MARKERS.has(w)).length;
  return markerCount >= HINGLISH_MIN_MARKER_COUNT && markerCount / words.length >= HINGLISH_MIN_MARKER_RATIO;
}

export interface ChunkLanguageDetection extends LanguageDetection {
  isHinglish: boolean;
}

const MIN_TEXT_LENGTH_FOR_HIGH_CONFIDENCE = 100;

/**
 * Chunk-level language detection: checks for Hinglish (romanized Hindi)
 * first via `looksLikeHinglish`, falling back to Phase 2's franc-based
 * detector (scanner/language/languageDetector.ts) otherwise.
 *
 * Hinglish is checked *unconditionally*, not only when franc's own read is
 * English or undetermined — franc works on character trigrams with no
 * concept of word meaning, and empirically it doesn't reliably fall back
 * to "eng"/"und" on Hinglish text; it can confidently misclassify it as an
 * unrelated language entirely (verified: "isko 100% kro prompt ke hisab
 * se" reads as Pular ("fuf") to franc). The curated marker-word check is
 * precise enough to run first and override whatever franc would have said.
 */
export function detectChunkLanguage(text: string): ChunkLanguageDetection {
  if (looksLikeHinglish(text)) {
    return { code: "hin-Latn", name: "Hinglish", confidence: text.length >= MIN_TEXT_LENGTH_FOR_HIGH_CONFIDENCE ? "high" : "low", isHinglish: true };
  }

  const base = detectLanguage(text);

  // Content dominated by digits/currency/punctuation (a run of prices like
  // "£37.97 In stock £21.87 In stock ...") isn't really "written in a
  // language" at all — franc still returns *something*, often confidently
  // wrong, because there's too little alphabetic signal for its trigram
  // model to work with. English is the honest default rather than
  // propagating a near-arbitrary guess.
  const letterCount = (text.match(/\p{L}/gu) ?? []).length;
  const nonSpaceLength = text.replace(/\s/g, "").length || 1;
  if (letterCount / nonSpaceLength < 0.7 && !isSupportedLanguage(base.name)) {
    return { code: "eng", name: "English", confidence: "low", isHinglish: false };
  }

  // Real-world chunks are frequently short, structurally unusual fragments
  // (nav menus, bulleted category lists, "- Home / - Books / - Romance")
  // that carry almost no genuine linguistic signal for a trigram-based
  // detector — franc will confidently return a totally unrelated language
  // (Scots, Sotho, Balkan Romani, ...) that isn't even one of this
  // product's supported languages. When franc's own confidence is already
  // "low" *and* the result isn't one of the languages this product
  // actually supports, that combination is far more likely to be noise
  // than a real detection of some other, unsupported language — English
  // is the more useful and honest default than propagating a
  // near-meaningless ISO code. A *high*-confidence unsupported-language
  // read (100+ characters of real, coherent text) is left as-is: that's
  // more likely a genuine detection of real content in a language this
  // product doesn't yet explicitly support, not noise to paper over.
  if (base.confidence === "low" && !isSupportedLanguage(base.name)) {
    return { code: "eng", name: "English", confidence: "low", isHinglish: false };
  }

  return { ...base, isHinglish: false };
}

export function isSupportedLanguage(name: string): name is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(name);
}
