// LLM Provider Factory — the one place `LLM_PROVIDER`/`LLM_MODEL`/
// `ANTHROPIC_API_KEY`/`LLM_BASE_URL`/`LLM_API_KEY` are read from the
// environment and turned into a concrete provider. Every other chat/
// module receives an `LlmProvider` instance (typically via
// `getLlmProvider()`) rather than reading env vars itself.

import { AnthropicProvider } from "./anthropicProvider";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type { LlmProvider } from "./llmProvider.interface";

export type LlmProviderName = "anthropic" | "openai_compatible";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const DEFAULT_OPENAI_COMPATIBLE_MODEL = "llama3.1:8b-instruct";

export function createLlmProviderFromEnv(env: Record<string, string | undefined> = process.env): LlmProvider {
  const providerName = (env.LLM_PROVIDER ?? "anthropic").trim() as LlmProviderName;

  if (providerName === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set in .env. Set LLM_PROVIDER=openai_compatible instead to use a self-hosted model with no external API key.');
    }
    return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL });
  }

  if (providerName === "openai_compatible") {
    if (!env.LLM_BASE_URL) {
      throw new Error('LLM_PROVIDER=openai_compatible requires LLM_BASE_URL to be set in .env (e.g. "http://localhost:11434/v1" for a local Ollama server).');
    }
    return new OpenAiCompatibleProvider({ baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL || DEFAULT_OPENAI_COMPATIBLE_MODEL, apiKey: env.LLM_API_KEY });
  }

  throw new Error(`Unknown LLM_PROVIDER "${providerName}" — must be "anthropic" or "openai_compatible".`);
}

let cachedProvider: LlmProvider | null = null;

/** Process-wide singleton — an LlmProvider holds no per-request state (it's a thin HTTP client wrapper), so one instance per process is correct, matching the query cache / Socket.IO server's existing singleton pattern in this codebase. */
export function getLlmProvider(): LlmProvider {
  if (!cachedProvider) cachedProvider = createLlmProviderFromEnv();
  return cachedProvider;
}

/** Test/ops hook — resets the singleton so tests (or a future hot env-reload) don't observe a stale provider. */
export function resetLlmProviderCache(): void {
  cachedProvider = null;
}
