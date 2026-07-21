// Input Validation / XSS Protection - normalizes and bounds raw visitor
// input before it's used anywhere else in the pipeline (NLU, prompt
// construction, persistence), and provides an HTML-escaping helper for any
// path that ever renders message content inside real HTML (an email
// escalation notification, an exported-conversation HTML view) rather than
// relying solely on a frontend framework's own auto-escaping.

const MAX_MESSAGE_LENGTH = 4000;

// Strips C0 control characters (code points 0-31) and DEL (127), except
// horizontal tab (9) and line feed (10), which are legitimate in a chat
// message. Carriage return (13) is deliberately stripped too - this
// product never needs it and it's a common log/terminal-injection vector.
// Built from character codes at module load (not a regex escape-range
// literal in source text) to avoid any ambiguity between "the four
// characters backslash, u, 0, 0, 0, 0" and an actual embedded control
// byte in this file.
const KEEP_CODES = new Set([9, 10]);
const STRIPPED_CONTROL_CHARS = Array.from({ length: 32 }, (_unused, code) => code)
  .concat([127])
  .filter((code) => !KEEP_CODES.has(code))
  .map((code) => String.fromCharCode(code));
const CONTROL_CHAR_PATTERN = new RegExp(`[${STRIPPED_CONTROL_CHARS.join("")}]`, "g");

/** Normalizes raw visitor input before it enters NLU/retrieval/prompt construction: strips control characters, trims, and caps length. Does NOT HTML-escape - the content stays plain text through the pipeline; `escapeHtml` is applied only at the specific point of rendering into real HTML, not here, so it isn't double-escaped by every downstream consumer. */
export function sanitizeUserInput(raw: string): string {
  return raw.replace(CONTROL_CHAR_PATTERN, "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

/** Escapes the five HTML-significant characters - for the one or two paths that embed message content inside real HTML (e.g. an escalation email). Chat UIs built on a framework that auto-escapes text content (React, etc.) don't need this on the render path; it exists for paths outside that framework's protection. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export { MAX_MESSAGE_LENGTH };
