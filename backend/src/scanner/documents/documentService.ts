import crypto from "node:crypto";
import { safeFetch } from "../http/safeFetch";
import { extractDocumentText, type DocumentHyperlink } from "./documentExtractor";
import type { DiscoveredDocumentType } from "./documentDiscovery";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

export interface ProcessedDocumentResult {
  sourceUrl: string;
  documentType: DiscoveredDocumentType;
  extractedText: string;
  contentHash: string | null;
  pageCount: number | null;
  errorMessage: string | null;
  docMetadata: Record<string, string>;
  headings: string[];
  hyperlinks: DocumentHyperlink[];
  tables: string[][][];
}

function empty(sourceUrl: string, type: DiscoveredDocumentType, errorMessage: string): ProcessedDocumentResult {
  return { sourceUrl, documentType: type, extractedText: "", contentHash: null, pageCount: null, errorMessage, docMetadata: {}, headings: [], hyperlinks: [], tables: [] };
}

/** Fetches (SSRF-guarded, size-capped) and extracts text from one linked document. Never throws — errors are reported in the result. */
export async function processDocument(url: string, type: DiscoveredDocumentType): Promise<ProcessedDocumentResult> {
  try {
    const response = await safeFetch(url, { timeoutMs: 20000, maxBytes: 25 * 1024 * 1024 });
    if (!response.ok) {
      return empty(url, type, `HTTP ${response.statusCode}`);
    }

    const extraction = await extractDocumentText(response.body, type);
    const contentHash = extraction.text ? crypto.createHash("sha256").update(extraction.text).digest("hex") : null;

    logEvent({
      component: "scanner-documents",
      message: `Processed ${type} document: ${url} (${extraction.text.length} chars extracted)`,
      status: extraction.error ? "warn" : "success",
      error: extraction.error ?? undefined,
    });

    return {
      sourceUrl: url,
      documentType: type,
      extractedText: extraction.text,
      contentHash,
      pageCount: extraction.pageCount,
      errorMessage: extraction.error,
      docMetadata: extraction.metadata,
      headings: extraction.headings,
      hyperlinks: extraction.hyperlinks,
      tables: extraction.tables,
    };
  } catch (err) {
    const message = formatError(err);
    logEvent({ component: "scanner-documents", message: `Failed to process document: ${url}`, status: "error", error: message });
    return empty(url, type, message);
  }
}
