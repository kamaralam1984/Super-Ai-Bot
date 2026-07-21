/**
 * Renders extracted table rows (from HTML `<table>`, DOCX, XLSX, CSV, or
 * Markdown pipe tables) as a Markdown table string — a compact,
 * embedding-friendly form that keeps row/column relationships legible in
 * both raw text and when quoted back as a search-result citation.
 */
export function serializeTableToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";

  const clean = rows.map((row) => row.map((cell) => (cell ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()));
  const colCount = Math.max(...clean.map((r) => r.length));
  const pad = (row: string[]) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push("");
    return padded;
  };

  const header = pad(clean[0]);
  const separator = header.map(() => "---");
  const lines = [`| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`, ...clean.slice(1).map((row) => `| ${pad(row).join(" | ")} |`)];
  return lines.join("\n");
}
