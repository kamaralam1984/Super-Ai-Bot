import fs from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { MODELS_DIR } from "../../config/paths";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

// Same reasoning as embed/embeddings.ts's TRANSFORMERS_CACHE_DIR — left at
// tesseract.js's default (cwd), downloaded trained-data packs would be
// lost on every container recreate. Redirected into the same persistent
// `models/` runtime directory Docker mounts as a volume.
const TESSERACT_CACHE_DIR = path.join(MODELS_DIR, "tesseract");

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
}

/** Our internal language names (from languageDetector.ts) -> Tesseract.js trained-data codes. */
const LANGUAGE_TO_TESSERACT_CODE: Record<string, string> = {
  English: "eng",
  Hindi: "hin",
  Urdu: "urd",
  Arabic: "ara",
  French: "fra",
  German: "deu",
  Spanish: "spa",
};

const DEFAULT_TESSERACT_LANG = "eng";

/**
 * One lazily-created, cached Tesseract worker per language pack — workers
 * are expensive to spin up (each downloads and loads its language's
 * trained data on first use), so every language seen more than once
 * reuses its worker rather than re-initializing.
 */
const workerPromises = new Map<string, Promise<Worker>>();

async function getWorker(tesseractLang: string): Promise<Worker> {
  let promise = workerPromises.get(tesseractLang);
  if (!promise) {
    fs.mkdirSync(TESSERACT_CACHE_DIR, { recursive: true, mode: 0o750 });
    promise = createWorker(tesseractLang, undefined, { cachePath: TESSERACT_CACHE_DIR }).catch((err) => {
      workerPromises.delete(tesseractLang);
      throw err;
    });
    workerPromises.set(tesseractLang, promise);
  }
  return promise;
}

export async function closeOcrEngine(): Promise<void> {
  const promises = [...workerPromises.values()];
  workerPromises.clear();
  for (const promise of promises) {
    const worker = await promise.catch(() => null);
    await worker?.terminate().catch(() => undefined);
  }
}

/** Resolves a page's detected language (from languageDetector.ts, e.g. "Hindi") to a Tesseract code, combined with English (logos/brand names are routinely Latin-script even on non-English sites). Falls back to English-only when the language is unrecognized or undetermined. */
export function resolveOcrLanguage(detectedLanguageName: string | null | undefined): string {
  const code = detectedLanguageName ? LANGUAGE_TO_TESSERACT_CODE[detectedLanguageName] : undefined;
  if (!code || code === DEFAULT_TESSERACT_LANG) return DEFAULT_TESSERACT_LANG;
  return `${code}+${DEFAULT_TESSERACT_LANG}`;
}

const MIN_CONFIDENCE_TO_KEEP = 40; // Tesseract's 0-100 mean confidence — below this, treat as noise, not text

/**
 * Runs local OCR (no external API — self-hosted, matches the product's
 * positioning) on an image buffer, using the trained-data pack for
 * `languageHint` (typically the hosting page's detected language) combined
 * with English. Returns empty text rather than throwing when the image has
 * no recognizable text or OCR fails, since this is called opportunistically
 * across many crawled images and one failure shouldn't interrupt the pipeline.
 */
export async function runOcr(imageBuffer: Buffer, languageHint?: string | null): Promise<OcrResult> {
  const tesseractLang = resolveOcrLanguage(languageHint);
  try {
    const worker = await getWorker(tesseractLang);
    const { data } = await worker.recognize(imageBuffer);
    const text = data.text.trim();
    if (data.confidence < MIN_CONFIDENCE_TO_KEEP || !text) {
      return { text: "", confidence: data.confidence, language: tesseractLang };
    }
    return { text, confidence: data.confidence, language: tesseractLang };
  } catch (err) {
    logEvent({ component: "scanner-ocr", message: `OCR failed for an image (lang=${tesseractLang})`, status: "warn", error: formatError(err) });
    return { text: "", confidence: 0, language: tesseractLang };
  }
}
