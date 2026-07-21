import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "./anthropicProvider";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("undici", () => ({ request: requestMock }));

function sseBody(events: string[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield Buffer.from(event);
      }
    },
  };
}

describe("AnthropicProvider", () => {
  it("throws without an apiKey or model", () => {
    expect(() => new AnthropicProvider({ apiKey: "", model: "claude-sonnet-5" })).toThrow(/apiKey/);
    expect(() => new AnthropicProvider({ apiKey: "sk-ant-test", model: "" })).toThrow(/model/);
  });

  describe("generate", () => {
    it("parses a successful response into an LlmGenerateResult", async () => {
      requestMock.mockResolvedValue({
        statusCode: 200,
        body: { json: async () => ({ content: [{ type: "text", text: "Hello there" }], usage: { input_tokens: 10, output_tokens: 4 }, stop_reason: "end_turn", model: "claude-sonnet-5" }) },
      });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });
      const result = await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect(result).toEqual({ content: "Hello there", tokensIn: 10, tokensOut: 4, stopReason: "end_turn", model: "claude-sonnet-5" });
    });

    it("joins multiple text content blocks", async () => {
      requestMock.mockResolvedValue({ statusCode: 200, body: { json: async () => ({ content: [{ type: "text", text: "Part 1. " }, { type: "text", text: "Part 2." }] }) } });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });
      const result = await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect(result.content).toBe("Part 1. Part 2.");
    });

    it("throws a clear error on a non-2xx response", async () => {
      requestMock.mockResolvedValue({ statusCode: 401, body: { json: async () => ({ error: { message: "invalid x-api-key" } }) } });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-bad", model: "claude-sonnet-5" });
      await expect(provider.generate({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(/invalid x-api-key/);
    });

    it("moves system-role messages into the top-level system field, not the messages array", async () => {
      let capturedBody: string | undefined;
      requestMock.mockImplementation(async (_url: string, init: { body: string }) => {
        capturedBody = init.body;
        return { statusCode: 200, body: { json: async () => ({ content: [{ type: "text", text: "ok" }] }) } };
      });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });
      await provider.generate({ messages: [{ role: "system", content: "Be concise." }, { role: "user", content: "Hi" }] });
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.system).toBe("Be concise.");
      expect(parsed.messages).toEqual([{ role: "user", content: "Hi" }]);
    });
  });

  describe("streamGenerate", () => {
    it("yields delta chunks then a done chunk with the accumulated result", async () => {
      const events = [
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      ];
      requestMock.mockResolvedValue({ statusCode: 200, body: sseBody(events) });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });

      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);

      expect(chunks).toEqual([
        { type: "delta", delta: "Hello" },
        { type: "delta", delta: " world" },
        { type: "done", result: { content: "Hello world", tokensIn: 10, tokensOut: 5, stopReason: "end_turn", model: "claude-sonnet-5" } },
      ]);
    });

    it("handles an SSE event split across multiple network chunks", async () => {
      const fullEvent = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n';
      const half = Math.floor(fullEvent.length / 2);
      requestMock.mockResolvedValue({ statusCode: 200, body: sseBody([fullEvent.slice(0, half), fullEvent.slice(half)]) });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });

      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);
      expect(chunks[0]).toEqual({ type: "delta", delta: "Hi" });
    });

    it("yields an error chunk and stops on a non-2xx response", async () => {
      requestMock.mockResolvedValue({ statusCode: 500, body: { json: async () => ({ error: { message: "overloaded" } }) } });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });
      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);
      expect(chunks).toEqual([{ type: "error", error: expect.stringContaining("overloaded") }]);
    });

    it("yields an error chunk on an in-stream error event", async () => {
      requestMock.mockResolvedValue({ statusCode: 200, body: sseBody(['data: {"type":"error","error":{"message":"rate limited"}}\n\n']) });
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });
      const chunks = [];
      for await (const chunk of provider.streamGenerate({ messages: [{ role: "user", content: "Hi" }] })) chunks.push(chunk);
      expect(chunks).toEqual([{ type: "error", error: "rate limited" }]);
    });
  });
});
