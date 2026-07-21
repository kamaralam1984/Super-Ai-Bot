// Conversation Analytics — pure aggregation over already-fetched rows.
// chatRecord.service.ts owns every Prisma query that produces this
// module's input (matching the "engine modules are pure, only the record
// service touches the database" discipline every prior phase follows);
// this module only computes metrics from what it's handed.

export interface ConversationSummaryInput {
  id: string;
  status: "ACTIVE" | "IDLE" | "ESCALATED" | "CLOSED";
  startedAt: Date;
  lastMessageAt: Date;
  closedAt: Date | null;
}

export interface MessageSummaryInput {
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  tookMs: number | null;
  confidence: number | null;
  feedback: "NONE" | "LIKE" | "DISLIKE";
  createdAt: Date;
}

export interface EscalationSummaryInput {
  conversationId: string;
  reason: string;
}

export interface ConversationAnalyticsInput {
  conversations: ConversationSummaryInput[];
  messages: MessageSummaryInput[];
  escalations: EscalationSummaryInput[];
}

export interface FrequencyEntry {
  question: string;
  count: number;
}

export interface ConversationAnalyticsReport {
  totalConversations: number;
  averageResponseTimeMs: number | null;
  averageConversationLengthMessages: number;
  resolvedConversations: number;
  escalatedConversations: number;
  userSatisfaction: { likes: number; dislikes: number; ratio: number | null };
  topQuestions: FrequencyEntry[];
  failedQuestions: FrequencyEntry[];
  /** Fraction (0-1) of user questions that received a grounded (non-refusal) answer — the spec's "Knowledge Coverage" and "AI Accuracy" are the same underlying signal here (there's no ground-truth label to measure true accuracy against; a low/null confidence answer is the only available honest proxy for "the AI couldn't confidently answer this"), reported once under both names rather than presenting a second, differently-labeled metric as something more than it is. */
  knowledgeCoverage: number | null;
}

const LOW_CONFIDENCE_THRESHOLD = 0.35; // matches knowledge/citation/citationFormatter.ts's own answer-confidence floor
const TOP_N = 10;

interface QuestionAnswerPair {
  question: string;
  answerConfidence: number | null;
  answerTookMs: number | null;
}

function pairQuestionsWithAnswers(messages: MessageSummaryInput[]): QuestionAnswerPair[] {
  const byConversation = new Map<string, MessageSummaryInput[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  const pairs: QuestionAnswerPair[] = [];
  for (const conversationMessages of byConversation.values()) {
    const sorted = [...conversationMessages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].role === "USER" && sorted[i + 1].role === "ASSISTANT") {
        pairs.push({ question: sorted[i].content.trim(), answerConfidence: sorted[i + 1].confidence, answerTookMs: sorted[i + 1].tookMs });
      }
    }
  }
  return pairs;
}

function topFrequencies(questions: string[], limit: number): FrequencyEntry[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const question of questions) {
    if (!question) continue;
    const key = question.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { display: question, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({ question: entry.display, count: entry.count }));
}

export function computeConversationAnalytics(input: ConversationAnalyticsInput): ConversationAnalyticsReport {
  const totalConversations = input.conversations.length;
  const resolvedConversations = input.conversations.filter((c) => c.status === "CLOSED" && c.closedAt !== null).length;
  const escalatedConversationIds = new Set(input.escalations.map((e) => e.conversationId));
  const escalatedConversations = escalatedConversationIds.size;

  const assistantMessages = input.messages.filter((m) => m.role === "ASSISTANT");
  const responseTimes = assistantMessages.map((m) => m.tookMs).filter((t): t is number => t !== null);
  const averageResponseTimeMs = responseTimes.length > 0 ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length : null;

  const messagesByConversation = new Map<string, number>();
  for (const message of input.messages) {
    messagesByConversation.set(message.conversationId, (messagesByConversation.get(message.conversationId) ?? 0) + 1);
  }
  const conversationLengths = [...messagesByConversation.values()];
  const averageConversationLengthMessages = conversationLengths.length > 0 ? conversationLengths.reduce((sum, n) => sum + n, 0) / conversationLengths.length : 0;

  const likes = input.messages.filter((m) => m.feedback === "LIKE").length;
  const dislikes = input.messages.filter((m) => m.feedback === "DISLIKE").length;
  const totalFeedback = likes + dislikes;

  const pairs = pairQuestionsWithAnswers(input.messages);
  const failedPairs = pairs.filter((p) => p.answerConfidence === null || p.answerConfidence < LOW_CONFIDENCE_THRESHOLD);

  const knowledgeCoverage = pairs.length > 0 ? (pairs.length - failedPairs.length) / pairs.length : null;

  return {
    totalConversations,
    averageResponseTimeMs,
    averageConversationLengthMessages,
    resolvedConversations,
    escalatedConversations,
    userSatisfaction: { likes, dislikes, ratio: totalFeedback > 0 ? likes / totalFeedback : null },
    topQuestions: topFrequencies(pairs.map((p) => p.question), TOP_N),
    failedQuestions: topFrequencies(failedPairs.map((p) => p.question), TOP_N),
    knowledgeCoverage,
  };
}
