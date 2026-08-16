import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, Globe, Loader2, Tag, Code2, Copy, Check } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { api, type AdminInstallation } from "../../lib/api";
import type { HealthReport, VersionInfo } from "../../lib/dashboardTypes";

/**
 * The embed snippet is otherwise only ever shown once, on
 * OnboardingCompleteStep.tsx right after signup — anyone who navigates
 * away without copying it (or logs in fresh on a later day) had no way
 * to get it again. Shown here for whoever owns `installation` — the
 * platform super-admin (/dashboard) and every SaaS tenant (/app) alike,
 * since both have a real embeddable widget for their own installation.
 */
function WidgetEmbedCard({ installation }: { installation: AdminInstallation }) {
  const [copied, setCopied] = useState(false);
  const embedSnippet = `<script src="${window.location.origin}/widget.js" data-installation-id="${installation.installationId}"></script>`;

  function copySnippet() {
    navigator.clipboard.writeText(embedSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-accent/25 bg-accent/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <Code2 size={15} className="text-accent" aria-hidden="true" />
        Your chat widget
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        Paste this one line anywhere in your site's HTML (before <code className="data-value">&lt;/body&gt;</code>) to embed the chat widget.
      </p>
      <div className="flex items-center gap-2">
        <code className="data-value flex-1 truncate rounded-lg border border-border bg-surface-raised/80 px-3 py-2 text-xs text-ink">{embedSnippet}</code>
        <button
          type="button"
          onClick={copySnippet}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50"
        >
          {copied ? <Check size={13} className="text-success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.deployment.health().catch(() => null), api.deployment.version().catch(() => null)])
      .then(([h, v]) => {
        if (cancelled) return;
        setHealth(h);
        setVersion(v);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-4xl">
      <StepHeader icon={Activity} title="Overview" subtitle="Live status of every layer this installation depends on." />

      {installation && (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
          <Globe size={16} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">{installation.websiteName} — {installation.websiteUrl}</span>
        </div>
      )}

      {installation && <WidgetEmbedCard installation={installation} />}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking system health…
        </div>
      )}

      {!loading && health && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {health.items.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <StatusIcon status={item.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{item.label}</p>
                <p className="truncate text-xs text-ink-muted" title={item.detail}>{item.detail}</p>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {!loading && !health && <p className="text-sm text-ink-muted">Could not load health status.</p>}

      {version && (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-faint">
          <Tag size={12} aria-hidden="true" /> v{version.version} · Node {version.nodeVersion} · {version.nodeEnv}
        </p>
      )}
    </div>
  );
}
