export interface CodeSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

const FENCED_CODE_REGEX = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;

/**
 * Splits Markdown-fenced ("```") code blocks out of a text blob, in order,
 * so the surrounding prose and the code can be chunked with different
 * rules (code stays intact; prose is sentence/paragraph packed).
 */
export function splitCodeFences(text: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let lastIndex = 0;

  FENCED_CODE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCED_CODE_REGEX.exec(text))) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[2].replace(/\n$/, ""), language: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments.filter((s) => s.type === "code" || s.content.trim().length > 0);
}

// Signals common to most mainstream languages — used only as a fallback for
// code that made it into a plain paragraph without Markdown fences (e.g. a
// <pre>/<code> block whose formatting didn't survive text extraction).
const CODE_SIGNAL_REGEX = /[{};]|=>|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\breturn\b|\bclass\b|\bdef\b|\bpublic\b|\bprivate\b|^(if|for|while|switch)\s*\(/;

/** Heuristic: does this multi-line block of text look like source code rather than prose? */
export function looksLikeCode(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const codeLines = lines.filter((l) => CODE_SIGNAL_REGEX.test(l));
  return codeLines.length / lines.length >= 0.5;
}
