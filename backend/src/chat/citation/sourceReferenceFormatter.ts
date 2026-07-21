// Source Citation Engine — turns Phase 3's `CitationSource[]` (already
// ranked and confidence-scored by knowledge/citation/citationFormatter.ts)
// into the exact fields the spec's "Source Citation" section asks every
// answer to carry: Knowledge Source, Document Name, Page URL, Section
// Name, Retrieved Timestamp, Confidence Score. Named differently from
// Phase 3's `citationFormatter.ts` (which decides *whether* an answer is
// grounded) — this module only *formats* already-decided sources for
// display, a distinct responsibility.

import type { CitationSource } from "../../knowledge/citation/citationFormatter";

export interface SourceReference {
  chunkId: string;
  documentName: string;
  pageUrl: string;
  sectionName: string | null;
  retrievedAt: string; // ISO timestamp
  confidenceScore: number;
  relevanceScore: number;
}

/** Falls back to a human-readable name derived from the URL's last path segment when a chunk has no title (e.g. a raw document with no `<title>`) — better than leaving "Document Name" blank. */
function deriveDocumentName(sourceUrl: string, title: string | null): string {
  if (title && title.trim().length > 0) return title;
  try {
    const { pathname } = new URL(sourceUrl);
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    if (lastSegment) return decodeURIComponent(lastSegment).replace(/[-_]+/g, " ").replace(/\.\w+$/, "");
  } catch {
    // sourceUrl wasn't a parseable absolute URL — fall through to the raw URL below.
  }
  return sourceUrl;
}

export function formatSourceReferences(sources: CitationSource[], retrievedAt: Date = new Date()): SourceReference[] {
  const isoTimestamp = retrievedAt.toISOString();
  return sources.map((source) => ({
    chunkId: source.chunkId,
    documentName: deriveDocumentName(source.sourceUrl, source.title),
    pageUrl: source.sourceUrl,
    sectionName: source.category,
    retrievedAt: isoTimestamp,
    confidenceScore: source.confidenceScore,
    relevanceScore: source.relevanceScore,
  }));
}
