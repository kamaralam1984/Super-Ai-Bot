export type DiscoveredDocumentType = "PDF" | "DOCX" | "DOC" | "XLSX" | "CSV" | "TXT" | "MARKDOWN" | "XML" | "JSON";

const EXTENSION_MAP: Record<string, DiscoveredDocumentType> = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".doc": "DOC",
  ".xlsx": "XLSX",
  ".xls": "XLSX",
  ".csv": "CSV",
  ".txt": "TXT",
  ".md": "MARKDOWN",
  ".markdown": "MARKDOWN",
  ".xml": "XML",
  ".json": "JSON",
};

export function classifyDocumentUrl(url: string): DiscoveredDocumentType | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const dot = pathname.lastIndexOf(".");
    if (dot === -1) return null;
    return EXTENSION_MAP[pathname.slice(dot)] ?? null;
  } catch {
    return null;
  }
}

/** Filters a set of discovered links down to ones that look like processable documents. */
export function findDocumentLinks(links: string[]): { url: string; type: DiscoveredDocumentType }[] {
  const seen = new Set<string>();
  const documents: { url: string; type: DiscoveredDocumentType }[] = [];
  for (const url of links) {
    const type = classifyDocumentUrl(url);
    if (type && !seen.has(url)) {
      seen.add(url);
      documents.push({ url, type });
    }
  }
  return documents;
}
