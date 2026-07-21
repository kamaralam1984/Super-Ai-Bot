export type SemanticBlockKind = "heading" | "paragraph" | "list" | "table" | "code";

export interface SemanticBlock {
  kind: SemanticBlockKind;
  /** heading/paragraph text, or the raw code body */
  text?: string;
  /** heading level 1-6 */
  level?: number;
  /** list item texts, in order */
  items?: string[];
  /** table rows (first row is the header) */
  rows?: string[][];
  /** fenced code block's declared language, if any */
  language?: string;
}

const HEADING_LINE = /^(#{1,6})\s+(.+)$/;
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;
const TABLE_ROW_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FENCE_LINE = /^```(\w*)\s*$/;

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Recovers document structure (headings, lists, Markdown pipe tables, fenced
 * code blocks, and paragraphs) directly from a flat text blob. This is what
 * lets Markdown-sourced documents get real section/table/code-aware
 * chunking even though the extractor only handed back one string — for
 * sources whose extractor already returns separate structured fields (HTML
 * pages, DOCX), callers should build `SemanticBlock[]` directly from that
 * structured data instead of round-tripping through this text parser.
 */
export function parseTextIntoBlocks(text: string): SemanticBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: SemanticBlock[] = [];

  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    // Joined with newlines (not spaces) so line structure survives into
    // `looksLikeCode`'s per-line heuristic — chunker.ts normalizes
    // whitespace once it has decided a block is prose, not code.
    const joined = paragraphBuffer.join("\n").trim();
    if (joined) blocks.push({ kind: "paragraph", text: joined });
    paragraphBuffer = [];
  };
  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push({ kind: "list", items: [...listBuffer] });
    listBuffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    const fenceMatch = trimmed.match(FENCE_LINE);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const language = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_LINE.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence line
      blocks.push({ kind: "code", text: codeLines.join("\n"), language });
      continue;
    }

    const headingMatch = trimmed.match(HEADING_LINE);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    if (TABLE_ROW_LINE.test(trimmed) && i + 1 < lines.length && TABLE_SEPARATOR_LINE.test(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const rows: string[][] = [parseMarkdownTableRow(trimmed)];
      i += 2; // header row + separator row
      while (i < lines.length && TABLE_ROW_LINE.test(lines[i].trim())) {
        rows.push(parseMarkdownTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const listMatch = trimmed.match(LIST_ITEM_LINE);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1].trim());
      i++;
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
    i++;
  }

  flushParagraph();
  flushList();

  return blocks;
}
