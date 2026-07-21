// OpenAI-compatible provider — talks to any server exposing the
// `/v1/chat/completions` shape: Ollama, vLLM, LM Studio, text-generation-
// webui, or a real OpenAI-compatible cloud endpoint. This is the fully
// self-hosted path — point LLM_BASE_URL at a local server and no
// conversation content ever leaves the machine.

import { request as undiciRequest } from "undici";
import type { LlmGenerateOptions, LlmGenerateResult, LlmProvider, LlmStreamChunk } from "./llmProvider.interface";

export interface OpenAiCompatibleProviderConfig {
  /** e.g. "http://localhost:11434/v1" (Ollama) or "http://localhost:8000/v1" (vLLM). No trailing slash required. */
  baseUrl: string;
  model: string;
  /** Most local servers (Ollama) ignore this; some (vLLM with --api-key, or a real OpenAI-compatible cloud host) require it. */
  apiKey?: string;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai_compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: OpenAiCompatibleProviderConfig) {
    if (!config.baseUrl) throw new Error("OpenAiCompatibleProvider requires a baseUrl (set LLM_BASE_URL).");
    if (!config.model) throw new Error("OpenAiCompatibleProvider requires a model (set LLM_MODEL).");
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private requestBody(options: LlmGenerateOptions, stream: boolean): string {
    return JSON.stringify({
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
      stop: options.stopSequences,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    });
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const response = await undiciRequest(`${this.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: this.requestBody(options, false) });
    const body = (await response.body.json()) as OpenAiResponseBody;

    if (response.statusCode >= 400) {
      throw new Error(`LLM endpoint error (${response.statusCode}): ${body.error?.message ?? JSON.stringify(body)}`);
    }

    const choice = body.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
      stopReason: choice?.finish_reason ?? null,
      model: body.model ?? this.model,
    };
  }

  async *streamGenerate(options: LlmGenerateOptions): AsyncGenerator<LlmStreamChunk> {
    const response = await undiciRequest(`${this.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: this.requestBody(options, true) });

    if (response.statusCode >= 400) {
      const errBody = (await response.body.json().catch(() => null)) as OpenAiResponseBody | null;
      yield { type: "error", error: `LLM endpoint error (${response.statusCode}): ${errBody?.error?.message ?? "unknown error"}` };
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
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          if (jsonStr === "[DONE]") {
            yield { type: "done", result: { content: fullContent, tokensIn, tokensOut, stopReason, model } };
            return;
          }

          let event: OpenAiStreamEvent;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullContent += delta;
            yield { type: "delta", delta };
          }
          const finishReason = event.choices?.[0]?.finish_reason;
          if (finishReason) stopReason = finishReason;
          if (event.usage) {
            tokensIn = event.usage.prompt_tokens ?? tokensIn;
            tokensOut = event.usage.completion_tokens ?? tokensOut;
          }
          model = event.model ?? model;
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    // Some OpenAI-compatible servers close the stream without a final
    // "[DONE]" sentinel (observed on a few Ollama versions) — the loop
    // ending is itself a valid completion signal, not an error.
    yield { type: "done", result: { content: fullContent, tokensIn, tokensOut, stopReason, model } };
  }
}

interface OpenAiResponseBody {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string };
}

interface OpenAiStreamEvent {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}
