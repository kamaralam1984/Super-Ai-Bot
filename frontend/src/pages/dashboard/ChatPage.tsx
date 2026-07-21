import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MessageSquare, Loader2, TriangleAlert, ThumbsUp, ThumbsDown } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api, type AdminInstallation } from "../../lib/api";
import type { ConversationRecord, EscalationTicketRecord, EscalationStatus, ConversationAnalyticsReport } from "../../lib/dashboardTypes";

export function ChatPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();
  const [conversations, setConversations] = useState<ConversationRecord[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationTicketRecord[] | null>(null);
  const [analytics, setAnalytics] = useState<ConversationAnalyticsReport | null>(null);

  useEffect(() => {
    if (!installation) return;
    api.chatAdmin.listConversations(installation.id).then(setConversations).catch(() => setConversations([]));
    api.chatAdmin.listEscalations(installation.id).then(setEscalations).catch(() => setEscalations([]));
    api.chatAdmin.analytics(installation.id, 30).then(setAnalytics).catch(() => setAnalytics(null));
  }, [installation]);

  async function resolveEscalation(ticketId: string, status: EscalationStatus) {
    await api.chatAdmin.updateEscalation(ticketId, status);
    if (installation) api.chatAdmin.listEscalations(installation.id).then(setEscalations).catch(() => undefined);
  }

  return (
    <div className="max-w-3xl">
      <StepHeader icon={MessageSquare} title="Chat" subtitle="Conversations, escalations, and analytics from the live AI chat engine." />

      {analytics && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Conversations", analytics.totalConversations],
            ["Escalated", analytics.escalatedConversations],
            ["Resolved", analytics.resolvedConversations],
            ["Avg. length", `${analytics.averageConversationLengthMessages.toFixed(1)} msgs`],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <p className="data-value text-lg font-semibold text-ink">{value}</p>
              <p className="text-xs text-ink-muted">{label}</p>
            </div>
          ))}
          <div className="col-span-2 flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 sm:col-span-4">
            <ThumbsUp size={14} className="text-success" aria-hidden="true" /> {analytics.userSatisfaction.likes}
            <ThumbsDown size={14} className="ml-3 text-critical" aria-hidden="true" /> {analytics.userSatisfaction.dislikes}
            {analytics.userSatisfaction.ratio !== null && <span className="ml-auto text-xs text-ink-muted">{(analytics.userSatisfaction.ratio * 100).toFixed(0)}% positive</span>}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <TriangleAlert size={15} aria-hidden="true" /> Open escalations
      </div>
      {!escalations && (
        <div className="mb-6 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}
      {escalations && escalations.filter((e) => e.status === "OPEN" || e.status === "ACKNOWLEDGED").length === 0 && (
        <p className="mb-6 text-sm text-ink-muted">No open escalations.</p>
      )}
      {escalations && escalations.length > 0 && (
        <ul className="mb-6 space-y-2">
          {escalations
            .filter((e) => e.status === "OPEN" || e.status === "ACKNOWLEDGED")
            .map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-ink">
                <span className="flex-1 truncate">{e.reason} — via {e.channel}</span>
                <PrimaryButton variant="ghost" onClick={() => resolveEscalation(e.id, "RESOLVED")}>Resolve</PrimaryButton>
              </li>
            ))}
        </ul>
      )}

      <div className="mb-3 text-sm font-medium text-ink">Recent conversations</div>
      {!conversations && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}
      {conversations && conversations.length === 0 && <p className="text-sm text-ink-muted">No conversations yet.</p>}
      {conversations && conversations.length > 0 && (
        <ul className="space-y-2">
          {conversations.slice(0, 20).map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
              <span className="truncate">{c.topicSummary ?? "(no summary yet)"}</span>
              <span className="ml-3 shrink-0 text-xs text-ink-faint">{c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
