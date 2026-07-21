// Anthropic Claude provider — talks to the Messages API directly over
// `undici` (already this codebase's HTTP client of choice throughout
// scanner/connector code) rather than adding the `@anthropic-ai/sdk`
// dependency for what is, at bottom, one JSON POST and one SSE parser.

import { request as undiciRequest } from "undici";
import type { LlmGenerateOptions, LlmGenerateResult, LlmMessage, LlmProvider, LlmStreamChunk } from "./llmProvider.interface";

const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  /** Override for tests / a corporate proxy — defaults to the real Anthropic API. */
  apiUrl?: string;
}

interface AnthropicChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Anthropic's Messages API takes `system` as a top-level field, not a message with role "system" — every other provider in this codebase's abstraction uses the OpenAI-style inline system message, so this is the one place that difference is bridged. */
function splitSystemMessage(messages: LlmMessage[]): { system: string | undefined; rest: AnthropicChatMessage[] } {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system") as AnthropicChatMessage[];
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest };
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) throw new Error("AnthropicProvider requires an apiKey (set ANTHROPIC_API_KEY).");
    if (!config.model) throw new Error("AnthropicProvider requires a model (set LLM_MODEL).");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiUrl = config.apiUrl ?? DEFAULT_API_URL;
  }

  private headers(streaming: boolean): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      ...(streaming ? { accept: "text/event-stream" } : {}),
    };
  }

  private requestBody(options: LlmGenerateOptions, stream: boolean): string {
    const { system, rest } = splitSystemMessage(options.messages);
    return JSON.stringify({
      model: this.model,
      system,
      messages: rest,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
      stop_sequences: options.stopSequences,
      stream,
    });
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const response = await undiciRequest(this.apiUrl, { method: "POST", headers: this.headers(false), body: this.requestBody(options, false) });
    const body = (await response.body.json()) as AnthropicResponseBody;

    if (response.statusCode >= 400) {
      throw new Error(`Anthropic API error (${response.statusCode}): ${body.error?.message ?? JSON.stringify(body)}`);
    }

    const content = Array.isArray(body.content)
      ? body.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("")
      : "";

    return {
      content,
      tokensIn: body.usage?.input_tokens ?? 0,
      tokensOut: body.usage?.output_tokens ?? 0,
      stopReason: body.stop_reason ?? null,
      model: body.model ?? this.model,
    };
  }

  async *streamGenerate(options: LlmGenerateOptions): AsyncGenerator<LlmStreamChunk> {
    const response = await undiciRequest(this.apiUrl, { method: "POST", headers: this.headers(true), body: this.requestBody(options, true) });

    if (response.statusCode >= 400) {
      const errBody = (await response.body.json().catch(() => null)) as AnthropicResponseBody | null;
      yield { type: "error", error: `Anthropic API error (${response.statusCode}): ${errBody?.error?.message ?? "unknown error"}` };
      return;
    }

    let buffer = "";
    let fullContent = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let stopReason: string | null = null;
    let model = this.model;

    try {
      for await (const rawChunk of response.body) {
        buffer += Buffer.isBuffer(rawChunk) ? rawChunk.toString("utf-8") : String(rawChunk);
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;

          let event: AnthropicStreamEvent;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            fullContent += event.delta.text;
            yield { type: "delta", delta: event.delta.text };
          } else if (event.type === "message_start") {
            model = event.message?.model ?? model;
            tokensIn = event.message?.usage?.input_tokens ?? tokensIn;
          } else if (event.type === "message_delta") {
            stopReason = event.delta?.stop_reason ?? stopReason;
            tokensOut = event.usage?.output_tokens ?? tokensOut;
          } else if (event.type === "error") {
            yield { type: "error", error: event.error?.message ?? "Unknown streaming error" };
            return;
          }
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    yield { type: "done", result: { content: fullContent, tokensIn, tokensOut, stopReason, model } };
  }
}

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
  model?: string;
  error?: { message?: string };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  message?: { model?: string; usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}
