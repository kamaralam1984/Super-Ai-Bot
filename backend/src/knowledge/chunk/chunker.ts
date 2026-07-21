import { splitIntoSentences } from "./sentenceSplitter";
import { looksLikeCode } from "./codeBlockDetector";
import { serializeTableToMarkdown } from "./tableSerializer";
import { parseTextIntoBlocks, type SemanticBlock } from "./markdownStructureParser";

export type { SemanticBlock } from "./markdownStructureParser";

export type ChunkType = "PARAGRAPH" | "TABLE" | "CODE" | "HEADING_SECTION" | "LIST";

export interface KnowledgeChunkDraft {
  content: string;
  index: number;
  chunkType: ChunkType;
  /** nearest enclosing heading's own text, if any */
  title: string | null;
  /** full heading path, e.g. "Pricing > Enterprise Plan" */
  section: string | null;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 120;

/** Trailing sentences from the previous chunk, up to `overlap` chars, to seed the next chunk with continuity. */
function buildOverlapPrefix(previousChunk: string, overlap: number): string {
  if (overlap <= 0 || !previousChunk) return "";
  const sentences = splitIntoSentences(previousChunk);
  let prefix = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = prefix ? `${sentences[i]} ${prefix}` : sentences[i];
    if (candidate.length > overlap) break;
    prefix = candidate;
  }
  return prefix;
}

/** Packs sentences into chunks no larger than chunkSize, carrying a small sentence-level overlap between consecutive chunks. Hard-splits only the rare single sentence that alone exceeds chunkSize. */
function packSentences(sentences: string[], chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > chunkSize) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
        chunks.push(sentence.slice(i, i + chunkSize).trim());
        if (i + chunkSize >= sentence.length) break;
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      chunks.push(current.trim());
      const prefix = buildOverlapPrefix(current, overlap);
      current = prefix ? `${prefix} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * The core chunking engine: walks an ordered list of structured content
 * blocks and produces embedding-ready chunks that respect their source
 * structure — paragraphs under a heading are tagged HEADING_SECTION and
 * carry that heading's title/path; lists and tables are never merged into
 * surrounding prose; code (fenced or heuristically detected) and tables are
 * kept whole rather than sentence-split, since cutting either mid-block
 * destroys the thing that makes them useful. Oversized prose is packed on
 * sentence boundaries (see `packSentences`), falling back to a hard
 * character split only for a single sentence that alone exceeds chunkSize.
 */
export function chunkBlocks(blocks: SemanticBlock[], chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP): KnowledgeChunkDraft[] {
  const drafts: Omit<KnowledgeChunkDraft, "index">[] = [];

  const headingStack: { level: number; text: string }[] = [];
  const currentTitle = () => (headingStack.length > 0 ? headingStack[headingStack.length - 1].text : null);
  const currentSection = () => (headingStack.length > 0 ? headingStack.map((h) => h.text).join(" > ") : null);

  let paragraphBuffer: string[] = [];

  const flushParagraphBuffer = () => {
    if (paragraphBuffer.length === 0) return;
    const combined = paragraphBuffer.join("\n\n");
    const chunkType: ChunkType = headingStack.length > 0 ? "HEADING_SECTION" : "PARAGRAPH";
    const title = currentTitle();
    const section = currentSection();

    if (combined.length <= chunkSize) {
      drafts.push({ content: combined.replace(/\s+/g, " ").trim(), chunkType, title, section });
    } else {
      const pieces = packSentences(splitIntoSentences(combined), chunkSize, overlap);
      for (const piece of pieces) drafts.push({ content: piece, chunkType, title, section });
    }
    paragraphBuffer = [];
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        flushParagraphBuffer();
        const level = block.level ?? 1;
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const text = (block.text ?? "").trim();
        if (text) headingStack.push({ level, text });
        break;
      }

      case "paragraph": {
        const text = (block.text ?? "").trim();
        if (!text) break;
        if (looksLikeCode(text)) {
          flushParagraphBuffer();
          drafts.push({ content: text, chunkType: "CODE", title: currentTitle(), section: currentSection() });
        } else {
          paragraphBuffer.push(text);
          if (paragraphBuffer.join("\n\n").length > chunkSize) flushParagraphBuffer();
        }
        break;
      }

      case "code": {
        flushParagraphBuffer();
        const text = (block.text ?? "").trim();
        if (text) drafts.push({ content: text, chunkType: "CODE", title: currentTitle(), section: currentSection() });
        break;
      }

      case "list": {
        flushParagraphBuffer();
        const items = (block.items ?? []).filter(Boolean);
        if (items.length === 0) break;
        let current = "";
        for (const item of items) {
          const bullet = `- ${item}`;
          const candidate = current ? `${current}\n${bullet}` : bullet;
          if (candidate.length > chunkSize && current) {
            drafts.push({ content: current, chunkType: "LIST", title: currentTitle(), section: currentSection() });
            current = bullet;
          } else {
            current = candidate;
          }
        }
        if (current) drafts.push({ content: current, chunkType: "LIST", title: currentTitle(), section: currentSection() });
        break;
      }

      case "table": {
        flushParagraphBuffer();
        const rows = block.rows ?? [];
        if (rows.length === 0) break;
        const serialized = serializeTableToMarkdown(rows);
        if (serialized) drafts.push({ content: serialized, chunkType: "TABLE", title: currentTitle(), section: currentSection() });
        break;
      }
    }
  }
  flushParagraphBuffer();

  return drafts.filter((d) => d.content.trim().length > 0).map((d, index) => ({ ...d, index }));
}

/** Convenience wrapper for flat text input (documents without pre-structured fields) — recovers Markdown-style structure from the text itself, then runs it through `chunkBlocks`. */
export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP): KnowledgeChunkDraft[] {
  return chunkBlocks(parseTextIntoBlocks(text), chunkSize, overlap);
}
