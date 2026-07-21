import { describe, it, expect } from "vitest";
import { computeConversationAnalytics, type ConversationAnalyticsInput } from "./conversationAnalytics";

function iso(offsetSeconds: number): Date {
  return new Date(new Date("2026-01-01T00:00:00Z").getTime() + offsetSeconds * 1000);
}

describe("computeConversationAnalytics", () => {
  it("returns zeroed/null metrics for no data", () => {
    const report = computeConversationAnalytics({ conversations: [], messages: [], escalations: [] });
    expect(report.totalConversations).toBe(0);
    expect(report.averageResponseTimeMs).toBeNull();
    expect(report.knowledgeCoverage).toBeNull();
    expect(report.userSatisfaction).toEqual({ likes: 0, dislikes: 0, ratio: null });
  });

  it("counts total, resolved, and escalated conversations", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [
        { id: "c1", status: "CLOSED", startedAt: iso(0), lastMessageAt: iso(10), closedAt: iso(10) },
        { id: "c2", status: "ACTIVE", startedAt: iso(0), lastMessageAt: iso(10), closedAt: null },
        { id: "c3", status: "ESCALATED", startedAt: iso(0), lastMessageAt: iso(10), closedAt: null },
      ],
      messages: [],
      escalations: [{ conversationId: "c3", reason: "COMPLAINT" }],
    };
    const report = computeConversationAnalytics(input);
    expect(report.totalConversations).toBe(3);
    expect(report.resolvedConversations).toBe(1);
    expect(report.escalatedConversations).toBe(1);
  });

  it("computes average response time from assistant messages' tookMs", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [],
      messages: [
        { conversationId: "c1", role: "USER", content: "hi", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c1", role: "ASSISTANT", content: "hello", tookMs: 200, confidence: 0.9, feedback: "NONE", createdAt: iso(1) },
        { conversationId: "c1", role: "USER", content: "price?", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(2) },
        { conversationId: "c1", role: "ASSISTANT", content: "$49", tookMs: 400, confidence: 0.8, feedback: "NONE", createdAt: iso(3) },
      ],
      escalations: [],
    };
    expect(computeConversationAnalytics(input).averageResponseTimeMs).toBe(300);
  });

  it("computes user satisfaction from feedback", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [],
      messages: [
        { conversationId: "c1", role: "ASSISTANT", content: "a", tookMs: null, confidence: 0.9, feedback: "LIKE", createdAt: iso(0) },
        { conversationId: "c1", role: "ASSISTANT", content: "b", tookMs: null, confidence: 0.9, feedback: "LIKE", createdAt: iso(1) },
        { conversationId: "c1", role: "ASSISTANT", content: "c", tookMs: null, confidence: 0.9, feedback: "DISLIKE", createdAt: iso(2) },
      ],
      escalations: [],
    };
    const report = computeConversationAnalytics(input);
    expect(report.userSatisfaction).toEqual({ likes: 2, dislikes: 1, ratio: 2 / 3 });
  });

  it("identifies top and failed questions from user/assistant pairs", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [],
      messages: [
        { conversationId: "c1", role: "USER", content: "What are your hours?", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c1", role: "ASSISTANT", content: "9-5", tookMs: 100, confidence: 0.9, feedback: "NONE", createdAt: iso(1) },
        { conversationId: "c2", role: "USER", content: "What are your hours?", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c2", role: "ASSISTANT", content: "9-5", tookMs: 100, confidence: 0.9, feedback: "NONE", createdAt: iso(1) },
        { conversationId: "c3", role: "USER", content: "Do you sell rocket fuel?", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c3", role: "ASSISTANT", content: "I don't have verified information about that.", tookMs: 50, confidence: null, feedback: "NONE", createdAt: iso(1) },
      ],
      escalations: [],
    };
    const report = computeConversationAnalytics(input);
    expect(report.topQuestions[0]).toEqual({ question: "What are your hours?", count: 2 });
    expect(report.failedQuestions).toEqual([{ question: "Do you sell rocket fuel?", count: 1 }]);
  });

  it("computes knowledge coverage as the fraction of confidently-answered questions", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [],
      messages: [
        { conversationId: "c1", role: "USER", content: "q1", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c1", role: "ASSISTANT", content: "a1", tookMs: null, confidence: 0.9, feedback: "NONE", createdAt: iso(1) },
        { conversationId: "c1", role: "USER", content: "q2", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(2) },
        { conversationId: "c1", role: "ASSISTANT", content: "a2", tookMs: null, confidence: 0.1, feedback: "NONE", createdAt: iso(3) },
      ],
      escalations: [],
    };
    expect(computeConversationAnalytics(input).knowledgeCoverage).toBe(0.5);
  });

  it("computes average conversation length across all conversations that have messages", () => {
    const input: ConversationAnalyticsInput = {
      conversations: [],
      messages: [
        { conversationId: "c1", role: "USER", content: "a", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
        { conversationId: "c1", role: "ASSISTANT", content: "b", tookMs: null, confidence: 0.9, feedback: "NONE", createdAt: iso(1) },
        { conversationId: "c2", role: "USER", content: "a", tookMs: null, confidence: null, feedback: "NONE", createdAt: iso(0) },
      ],
      escalations: [],
    };
    expect(computeConversationAnalytics(input).averageConversationLengthMessages).toBe(1.5);
  });
});
