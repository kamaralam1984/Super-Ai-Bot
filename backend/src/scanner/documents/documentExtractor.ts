import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import * as cheerio from "cheerio";
import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import type { DiscoveredDocumentType } from "./documentDiscovery";
import { formatError } from "../../utils/formatError";

export interface DocumentHyperlink {
  text: string;
  url: string;
}

export interface DocumentExtractionResult {
  text: string;
  pageCount: number | null;
  error: string | null;
  metadata: Record<string, string>;
  headings: string[];
  hyperlinks: DocumentHyperlink[];
  tables: string[][][];
}

function emptyExtras(): Pick<DocumentExtractionResult, "metadata" | "headings" | "hyperlinks" | "tables"> {
  return { metadata: {}, headings: [], hyperlinks: [], tables: [] };
}

async function extractPdf(buffer: Buffer): Promise<DocumentExtractionResult> {
  const data = await pdfParse(buffer);
  // pdf-parse exposes the PDF's standard Info dictionary — real document
  // metadata, not something we're inferring. Structural headings/hyperlinks
  // require a much heavier PDF layout parser than this dependency provides
  // (PDF has no native heading semantics, only visual font-size cues) —
  // documented as a known limitation rather than faked.
  const info = (data.info ?? {}) as Record<string, unknown>;
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(info)) {
    if (typeof value === "string" && value.trim()) metadata[key] = value.trim();
  }
  return { text: data.text.trim(), pageCount: data.numpages, error: null, ...emptyExtras(), metadata };
}

/** Word's paragraph styles (Heading 1..6) survive mammoth's HTML conversion, unlike extractRawText — real headings/hyperlinks/tables, not inferred. */
async function extractDocx(buffer: Buffer): Promise<DocumentExtractionResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const $ = cheerio.load(html);

  const headings = $("h1, h2, h3, h4, h5, h6")
    .map((_i, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const hyperlinks: DocumentHyperlink[] = $("a[href]")
    .map((_i, el) => ({ text: $(el).text().trim(), url: $(el).attr("href") ?? "" }))
    .get()
    .filter((link) => link.url);

  const tables: string[][][] = $("table")
    .toArray()
    .map((table) =>
      $(table)
        .find("tr")
        .toArray()
        .map((row) =>
          $(row)
            .find("td, th")
            .map((_i, cell) => $(cell).text().trim())
            .get()
        )
    );

  const text = $.root().text().replace(/\s+/g, " ").trim();
  return { text, pageCount: null, error: null, metadata: {}, headings, hyperlinks, tables };
}

async function extractXlsx(buffer: Buffer): Promise<DocumentExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const lines: string[] = [];
  const hyperlinks: DocumentHyperlink[] = [];
  const tables: string[][][] = [];

  workbook.eachSheet((sheet) => {
    lines.push(`# Sheet: ${sheet.name}`);
    const sheetRows: string[][] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v)));
      if (cells.some((c) => c.trim())) {
        lines.push(cells.join(" | "));
        sheetRows.push(cells);
      }
      row.eachCell((cell) => {
        const hyperlink = (cell as unknown as { hyperlink?: string }).hyperlink;
        if (hyperlink) hyperlinks.push({ text: String(cell.text ?? cell.value ?? ""), url: hyperlink });
      });
    });
    if (sheetRows.length > 0) tables.push(sheetRows);
  });

  // Core OOXML document properties live directly on the Workbook instance
  // in exceljs (not under `.properties`, which is calc-settings only).
  const metadata: Record<string, string> = {};
  const metadataFields: [string, string | undefined][] = [
    ["title", workbook.title],
    ["subject", workbook.subject],
    ["creator", workbook.creator],
    ["company", workbook.company],
    ["category", workbook.category],
  ];
  for (const [key, value] of metadataFields) {
    if (typeof value === "string" && value.trim()) metadata[key] = value.trim();
  }

  return { text: lines.join("\n").trim(), pageCount: workbook.worksheets.length, error: null, metadata, headings: [], hyperlinks, tables };
}

function extractCsv(buffer: Buffer): DocumentExtractionResult {
  const rows = parseCsv(buffer, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  const text = rows.map((row) => row.join(" | ")).join("\n");
  return { text: text.trim(), pageCount: null, error: null, ...emptyExtras(), tables: rows.length > 0 ? [rows] : [] };
}

const MARKDOWN_HEADING_REGEX = /^#{1,6}\s+(.+)$/gm;
const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;

function extractMarkdown(buffer: Buffer): DocumentExtractionResult {
  const raw = buffer.toString("utf-8");
  const headings = [...raw.matchAll(MARKDOWN_HEADING_REGEX)].map((m) => m[1].trim());
  const hyperlinks = [...raw.matchAll(MARKDOWN_LINK_REGEX)].map((m) => ({ text: m[1], url: m[2] }));
  return { text: raw.trim(), pageCount: null, error: null, metadata: {}, headings, hyperlinks, tables: [] };
}

function extractPlainText(buffer: Buffer): DocumentExtractionResult {
  return { text: buffer.toString("utf-8").trim(), pageCount: null, error: null, ...emptyExtras() };
}

const xmlParser = new XMLParser({ ignoreAttributes: false, textNodeName: "#text" });

function flattenForText(value: unknown, depth = 0): string[] {
  if (depth > 20) return [];
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => flattenForText(v, depth + 1));
  if (typeof value === "object") return Object.values(value).flatMap((v) => flattenForText(v, depth + 1));
  return [];
}

function extractXml(buffer: Buffer): DocumentExtractionResult {
  const raw = buffer.toString("utf-8");
  try {
    const parsed = xmlParser.parse(raw);
    const text = flattenForText(parsed).filter((s) => s.trim().length > 0).join("\n");
    return { text: text.trim(), pageCount: null, error: null, ...emptyExtras() };
  } catch (err) {
    // Malformed XML — fall back to a raw tag strip rather than failing outright.
    const stripped = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { text: stripped, pageCount: null, error: `XML parse warning: ${formatError(err)}`, ...emptyExtras() };
  }
}

function extractJson(buffer: Buffer): DocumentExtractionResult {
  try {
    const parsed = JSON.parse(buffer.toString("utf-8"));
    const text = flattenForText(parsed).filter((s) => s.trim().length > 0).join("\n");
    return { text: text.trim(), pageCount: null, error: null, ...emptyExtras() };
  } catch (err) {
    return { text: "", pageCount: null, error: `JSON parse error: ${formatError(err)}`, ...emptyExtras() };
  }
}

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Extracts plain text — plus metadata/headings/hyperlinks/tables where the
 * format actually supports them — from a downloaded document buffer,
 * dispatched by type. Every branch is isolated by the caller's try/catch
 * (documentService below) so one corrupt file can't take down the rest of
 * the crawl — text extraction from documents fetched off the open internet
 * is exactly the kind of input that's often malformed.
 */
export async function extractDocumentText(buffer: Buffer, type: DiscoveredDocumentType): Promise<DocumentExtractionResult> {
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { text: "", pageCount: null, error: `Document exceeds ${MAX_DOCUMENT_BYTES} byte processing limit`, ...emptyExtras() };
  }

  switch (type) {
    case "PDF":
      return extractPdf(buffer);
    case "DOCX":
      return extractDocx(buffer);
    case "DOC":
      // Legacy binary .doc (pre-2007 Word) has no reliable pure-JS parser;
      // mammoth targets OOXML (.docx) only. Best-effort: try it anyway (it
      // occasionally succeeds on mislabeled files), report clearly if not.
      try {
        return await extractDocx(buffer);
      } catch {
        return { text: "", pageCount: null, error: "Legacy .doc binary format is not supported — convert to .docx or PDF", ...emptyExtras() };
      }
    case "XLSX":
      return extractXlsx(buffer);
    case "CSV":
      return extractCsv(buffer);
    case "TXT":
      return extractPlainText(buffer);
    case "MARKDOWN":
      return extractMarkdown(buffer);
    case "XML":
      return extractXml(buffer);
    case "JSON":
      return extractJson(buffer);
    default:
      return { text: "", pageCount: null, error: `Unsupported document type`, ...emptyExtras() };
  }
}
