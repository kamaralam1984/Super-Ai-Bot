import { describe, it, expect, vi } from "vitest";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("undici", () => ({ request: requestMock }));

function sseBody(events: string[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield Buffer.from(event);
    },
  };
}

describe("OpenAiCompatibleProvider", () => {
  it("throws without a baseUrl or model", () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: "", model: "llama3.1" })).toThrow(/baseUrl/);
    expect(() => new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "" })).toThrow(/model/);
  });

  it("strips a trailing slash from baseUrl before building the request URL", async () => {
    let capturedUrl: string | undefined;
    requestMock.mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { statusCode: 200, body: { json: async () => ({ choices: [{ message: { content: "ok" } }] }) } };
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1/", model: "llama3.1" });
    await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
    expect(capturedUrl).toBe("http://localhost:11434/v1/chat/completions");
  });

  describe("generate", () => {
    it("parses a successful response", async () => {
      requestMock.mockResolvedValue({
        statusCode: 200,
        body: { json: async () => ({ choices: [{ message: { content: "Hello there" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 6 }, model: "llama3.1:8b" }) },
      });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" });
      const result = await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect(result).toEqual({ content: "Hello there", tokensIn: 12, tokensOut: 6, stopReason: "stop", model: "llama3.1:8b" });
    });

    it("attaches a bearer token when an apiKey is configured", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      requestMock.mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => {
        capturedHeaders = init.headers;
        return { statusCode: 200, body: { json: async () => ({ choices: [{ message: { content: "ok" } }] }) } };
      });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:8000/v1", model: "llama3.1", apiKey: "secret-token" });
      await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect(capturedHeaders?.authorization).toBe("Bearer secret-token");
    });

    it("omits the authorization header when no apiKey is configured", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      requestMock.mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => {
        capturedHeaders = init.headers;
        return { statusCode: 200, body: { json: async () => ({ choices: [{ message: { content: "ok" } }] }) } };
      });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" });
      await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect(capturedHeaders?.authorization).toBeUndefined();
    });

    it("throws a clear error on a non-2xx response", async () => {
      requestMock.mockResolvedValue({ statusCode: 500, body: { json: async () => ({ error: { message: "model not found" } }) } });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "missing-model" });
      await expect(provider.generate({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(/model not found/);
    });
  });

  describe("streamGenerate", () => {
    it("yields delta chunks then done, respecting a [DONE] sentinel", async () => {
      const events = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}],"model":"llama3.1:8b"}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ];
      requestMock.mockResolvedValue({ statusCode: 200, body: sseBody(events) });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" });

      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);

      expect(chunks).toEqual([
        { type: "delta", delta: "Hello" },
        { type: "delta", delta: " world" },
        { type: "done", result: { content: "Hello world", tokensIn: 8, tokensOut: 2, stopReason: "stop", model: "llama3.1:8b" } },
      ]);
    });

    it("still yields a done chunk if the stream ends without a [DONE] sentinel", async () => {
      requestMock.mockResolvedValue({ statusCode: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n']) });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" });
      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);
      expect(chunks).toEqual([{ type: "delta", delta: "Hi" }, { type: "done", result: { content: "Hi", tokensIn: 0, tokensOut: 0, stopReason: null, model: "llama3.1" } }]);
    });

    it("yields an error chunk and stops on a non-2xx response", async () => {
      requestMock.mockResolvedValue({ statusCode: 503, body: { json: async () => ({ error: { message: "server overloaded" } }) } });
      const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" });
      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);
      expect(chunks).toEqual([{ type: "error", error: expect.stringContaining("server overloaded") }]);
    });
  });
});
