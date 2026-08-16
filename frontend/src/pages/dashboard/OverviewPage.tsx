import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Globe, Loader2, Tag, Code2, Copy, Check, ExternalLink, Plus, Power, AlertTriangle, ChevronDown, Download, Zap } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api, ApiError, type AdminInstallation } from "../../lib/api";
import type { HealthReport, VersionInfo, TechStackSignals } from "../../lib/dashboardTypes";

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

/** Picks the one most relevant install method for whatever CrawlJob.techStack detected during onboarding — a tenant on WordPress sees WordPress steps, not a generic wall of every possible platform. */
function pickInstallMethod(techStack: TechStackSignals | null): { label: string; steps: string[]; code: string | null; downloadUrl?: string } {
  const cms = techStack?.cms?.toLowerCase() ?? "";
  const frameworks = (techStack?.frameworks ?? []).map((f) => f.toLowerCase());

  if (cms.includes("wordpress")) {
    return {
      label: "WordPress",
      steps: [
        "Download the KVL Chatbot plugin below.",
        "In your WP Admin sidebar, go to Plugins → Add New → Upload Plugin, choose the downloaded .zip, then click Install Now → Activate.",
        "Go to Settings → KVL Chatbot, paste your Installation ID (shown below), and save. No code editing, no theme changes.",
      ],
      code: null,
      downloadUrl: "ORIGIN/integrations/wordpress-plugin.zip",
    };
  }
  if (cms.includes("shopify")) {
    return {
      label: "Shopify",
      steps: [
        "In your Shopify admin, go to Online Store → Themes → Edit code (on your live theme).",
        "Open layout/theme.liquid and paste the snippet right before </body>.",
        "Save. Shopify publishes the change immediately.",
      ],
      code: `{{ '' }}\n<!-- layout/theme.liquid, right before </body> -->\n<script src="ORIGIN/widget.js" data-installation-id="INSTALLATION_ID"></script>`,
    };
  }
  if (frameworks.some((f) => f.includes("next"))) {
    return {
      label: "Next.js",
      steps: [
        "Open your app's root layout file (app/layout.tsx for the App Router, or pages/_app.tsx for the Pages Router).",
        "Import next/script and render it once inside <body>.",
        "Rebuild and restart the app for the change to take effect.",
      ],
      code: `import Script from "next/script";\n\n<Script\n  src="ORIGIN/widget.js"\n  data-installation-id="INSTALLATION_ID"\n  strategy="lazyOnload"\n/>`,
    };
  }
  return {
    label: "Plain HTML",
    steps: [
      "Open the HTML file (or shared layout/template) for your site.",
      "Paste the snippet right before the closing </body> tag.",
      "Save and redeploy — no other configuration needed.",
    ],
    code: `<!-- right before </body> -->\n<script src="ORIGIN/widget.js" data-installation-id="INSTALLATION_ID"></script>`,
  };
}

function AddChatbotPanel({ installation }: { installation: AdminInstallation }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [techStack, setTechStack] = useState<TechStackSignals | null | undefined>(undefined);
  const [autoInstallEligible, setAutoInstallEligible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installState, setInstallState] = useState<"idle" | "success" | "error">("idle");
  const [installError, setInstallError] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && techStack === undefined) {
      setLoading(true);
      api.tenant
        .techStack()
        .then((res) => {
          setTechStack(res.techStack);
          setAutoInstallEligible(res.autoInstallEligible);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Could not detect your site's platform."))
        .finally(() => setLoading(false));
    }
  }

  function handleAutoInstall() {
    setInstalling(true);
    setInstallError(null);
    api.tenant
      .autoInstall()
      .then(() => setInstallState("success"))
      .catch((err) => {
        setInstallState("error");
        setInstallError(err instanceof ApiError ? err.message : "Automatic installation failed.");
      })
      .finally(() => setInstalling(false));
  }

  const origin = window.location.origin;
  const method = pickInstallMethod(techStack ?? null);
  const fill = (s: string) => s.replace(/ORIGIN/g, origin).replace(/INSTALLATION_ID/g, installation.installationId);
  const code = method.code ? fill(method.code) : null;
  const downloadUrl = method.downloadUrl ? fill(method.downloadUrl) : null;

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface/60 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink"
      >
        <span className="flex items-center gap-2">
          <Plus size={15} className="text-accent" aria-hidden="true" />
          Add Chatbot — how to install it on {installation.websiteName}
        </span>
        <ChevronDown size={15} className={`text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border px-4 py-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Detecting your website's platform…
                </div>
              )}
              {!loading && error && <p className="text-sm text-critical">{error}</p>}
              {!loading && !error && (
                <>
                  {autoInstallEligible && installState !== "success" && (
                    <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 p-3">
                      <p className="mb-2 text-sm text-ink">
                        <strong className="font-semibold">This site is hosted on our own server</strong> — install the chatbot automatically with one click, no code needed.
                      </p>
                      {installState === "error" && installError && <p className="mb-2 text-xs text-critical">{installError}</p>}
                      <PrimaryButton loading={installing} onClick={handleAutoInstall} className="text-sm">
                        <Zap size={14} aria-hidden="true" /> Install Chatbot Automatically
                      </PrimaryButton>
                    </div>
                  )}
                  {autoInstallEligible && installState === "success" && (
                    <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-ink">
                      <Check size={14} className="text-success" aria-hidden="true" /> Installed automatically — click Run Chatbot to see it live.
                    </div>
                  )}
                  <p className="mb-3 text-xs text-ink-muted">
                    Detected platform: <span className="font-medium text-ink">{method.label}</span>
                    {techStack?.confidence && <span className="text-ink-faint"> ({techStack.confidence} confidence)</span>}
                    {autoInstallEligible && <span className="text-ink-faint"> — or use the manual method below:</span>}
                  </p>
                  <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-ink">
                    {method.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-strong"
                    >
                      <Download size={13} aria-hidden="true" /> Download KVL Chatbot plugin (.zip)
                    </a>
                  )}
                  {downloadUrl && (
                    <p className="mb-3 text-xs text-ink-muted">
                      Your Installation ID to paste into the plugin's settings: <code className="data-value rounded bg-surface-raised/80 px-1.5 py-0.5 text-ink">{installation.installationId}</code>
                    </p>
                  )}
                  {code && <pre className="overflow-x-auto rounded-lg border border-border bg-surface-raised/80 p-3 text-xs text-ink">{code}</pre>}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatbotControls({ installation, onStatusChange }: { installation: AdminInstallation; onStatusChange: (status: AdminInstallation["status"]) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const disabled = installation.status === "DISABLED";

  function runChatbot() {
    const separator = installation.websiteUrl.includes("?") ? "&" : "?";
    window.open(`${installation.websiteUrl}${separator}kvl_preview=1`, "_blank", "noopener,noreferrer");
  }

  function toggleActive() {
    if (disabled) {
      setBusy(true);
      api.tenant
        .enableInstallation()
        .then((res) => onStatusChange(res.status as AdminInstallation["status"]))
        .finally(() => setBusy(false));
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    api.tenant
      .disableInstallation()
      .then((res) => onStatusChange(res.status as AdminInstallation["status"]))
      .finally(() => {
        setBusy(false);
        setConfirmingDelete(false);
      });
  }

  return (
    <div className="mb-5">
      <AddChatbotPanel installation={installation} />

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton variant="ghost" onClick={runChatbot} className="text-sm">
          <ExternalLink size={14} aria-hidden="true" /> Run Chatbot
        </PrimaryButton>

        {disabled && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised/60 px-2.5 py-1.5 text-xs text-ink-muted">
            <Power size={12} aria-hidden="true" /> Disabled — visitors currently see "chat unavailable"
          </div>
        )}

        <PrimaryButton
          variant="ghost"
          loading={busy}
          onClick={toggleActive}
          className={`text-sm ${!disabled ? "hover:border-critical/50 hover:text-critical" : ""}`}
        >
          <Power size={14} aria-hidden="true" />
          {disabled ? "Enable Chatbot" : confirmingDelete ? "Click again to confirm" : "Delete Chatbot"}
        </PrimaryButton>

        {confirmingDelete && (
          <span className="flex items-center gap-1 text-xs text-ink-faint">
            <AlertTriangle size={12} aria-hidden="true" /> Your widget stays on your site but stops responding
          </span>
        )}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { installation: initialInstallation, isTenant } = useOutletContext<{ installation: AdminInstallation | null; isTenant?: boolean }>();
  const [installation, setInstallation] = useState(initialInstallation);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setInstallation(initialInstallation);
  }, [initialInstallation]);

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

      {installation && isTenant && (
        <ChatbotControls installation={installation} onStatusChange={(status) => setInstallation((prev) => (prev ? { ...prev, status } : prev))} />
      )}

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
