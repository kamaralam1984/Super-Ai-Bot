import { describe, it, expect } from "vitest";
import { createLlmProviderFromEnv } from "./providerFactory";
import { AnthropicProvider } from "./anthropicProvider";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";

describe("createLlmProviderFromEnv", () => {
  it("defaults to anthropic and throws without ANTHROPIC_API_KEY", () => {
    expect(() => createLlmProviderFromEnv({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("builds an AnthropicProvider with the default model when ANTHROPIC_API_KEY is set", () => {
    const provider = createLlmProviderFromEnv({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe("anthropic");
    expect(provider.model).toBe("claude-sonnet-5");
  });

  it("honors LLM_MODEL for anthropic", () => {
    const provider = createLlmProviderFromEnv({ ANTHROPIC_API_KEY: "sk-ant-test", LLM_MODEL: "claude-opus-4-8" });
    expect(provider.model).toBe("claude-opus-4-8");
  });

  it("throws for openai_compatible without LLM_BASE_URL", () => {
    expect(() => createLlmProviderFromEnv({ LLM_PROVIDER: "openai_compatible" })).toThrow(/LLM_BASE_URL/);
  });

  it("builds an OpenAiCompatibleProvider when LLM_BASE_URL is set", () => {
    const provider = createLlmProviderFromEnv({ LLM_PROVIDER: "openai_compatible", LLM_BASE_URL: "http://localhost:11434/v1" });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.name).toBe("openai_compatible");
    expect(provider.model).toBe("llama3.1:8b-instruct");
  });

  it("throws for an unknown provider name", () => {
    expect(() => createLlmProviderFromEnv({ LLM_PROVIDER: "not_a_real_provider" })).toThrow(/Unknown LLM_PROVIDER/);
  });
});
