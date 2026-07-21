// LLM Provider abstraction — the one seam between the Chat Engine and
// whatever actually generates text. Two real implementations exist
// (anthropicProvider.ts, openAiCompatibleProvider.ts) so the administrator
// can choose a cloud API or a fully self-hosted local model (Ollama/vLLM/
// LM Studio) via LLM_PROVIDER, matching this product's self-hosted,
// client-controlled positioning. Every other chat/ module talks to this
// interface, never to a specific provider's SDK/HTTP shape directly.

export type LlmMessageRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmGenerateOptions {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LlmGenerateResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  stopReason: string | null;
  model: string;
}

export type LlmStreamChunk = { type: "delta"; delta: string } | { type: "done"; result: LlmGenerateResult } | { type: "error"; error: string };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(options: LlmGenerateOptions): Promise<LlmGenerateResult>;
  /** Yields `delta` chunks as text arrives, then exactly one terminal chunk — either `done` (with the accumulated result) or `error`. Never throws; a mid-stream failure is reported as an `error` chunk so a caller mid-way through emitting partial tokens to a client can react cleanly instead of an unhandled rejection. */
  streamGenerate(options: LlmGenerateOptions): AsyncGenerator<LlmStreamChunk>;
}
