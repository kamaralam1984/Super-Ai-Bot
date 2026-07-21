// Response Generator — the seam between "we decided what to say" and "an
// LLM actually writes it." The hallucination-prevention short-circuit
// lives here: when groundingGuard already decided the retrieval wasn't
// grounded, this module never calls the LLM at all — the refusal message
// is returned directly, which is both cheaper/faster and a *guarantee*
// (not a hope) that an ungrounded turn can't still hallucinate an answer
// past the refusal.

import { auditResponseGrounding, type GroundingAudit } from "../hallucination/groundingGuard";
import type { LlmMessage, LlmProvider, LlmStreamChunk } from "../llm/llmProvider.interface";

export interface GenerateResponseParams {
  provider: LlmProvider;
  promptMessages: LlmMessage[];
  grounded: boolean;
  refusalMessage: string;
  evidenceTexts: string[];
  maxTokens?: number;
  temperature?: number;
}

export interface GeneratedResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
  wasRefusal: boolean;
  groundingAudit: GroundingAudit;
}

const NO_AUDIT_FLAGS: GroundingAudit = { possiblyUngrounded: false, unmatchedFigures: [] };

/** Non-streaming generation — used by the REST fallback path and anywhere a caller wants the complete response in one round trip. */
export async function generateResponse(params: GenerateResponseParams): Promise<GeneratedResponse> {
  if (!params.grounded) {
    return { content: params.refusalMessage, tokensIn: 0, tokensOut: 0, wasRefusal: true, groundingAudit: NO_AUDIT_FLAGS };
  }

  const result = await params.provider.generate({ messages: params.promptMessages, maxTokens: params.maxTokens, temperature: params.temperature });
  return { content: result.content, tokensIn: result.tokensIn, tokensOut: result.tokensOut, wasRefusal: false, groundingAudit: auditResponseGrounding(result.content, params.evidenceTexts) };
}

/**
 * Streaming generation — used by the WebSocket path (chat/ws/chatSocket.ts)
 * for token-by-token rendering. On the ungrounded/refusal path, the
 * refusal message is emitted as a single `delta` immediately followed by
 * `done`, so the caller's streaming UI code doesn't need a separate
 * non-streaming branch to handle refusals.
 */
export async function* streamResponse(params: GenerateResponseParams): AsyncGenerator<LlmStreamChunk> {
  if (!params.grounded) {
    yield { type: "delta", delta: params.refusalMessage };
    yield { type: "done", result: { content: params.refusalMessage, tokensIn: 0, tokensOut: 0, stopReason: "grounding_refusal", model: "grounding-guard" } };
    return;
  }

  yield* params.provider.streamGenerate({ messages: params.promptMessages, maxTokens: params.maxTokens, temperature: params.temperature });
}
