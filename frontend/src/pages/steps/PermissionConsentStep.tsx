import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import type { DataScope, DataScopeDefinition, WizardScopeOption } from "@kvl/shared";
import { api, ApiError } from "../../lib/api";
import { StepHeader } from "../../components/StepHeader";
import { PermissionScopeToggle } from "../../components/PermissionScopeToggle";
import { PrimaryButton } from "../../components/PrimaryButton";

const CATEGORY_LABELS: Record<DataScopeDefinition["category"], string> = {
  commerce: "Commerce",
  content: "Content",
  customer: "Customer",
  operations: "Operations",
};

interface PermissionConsentStepProps {
  grantedScopes: DataScope[];
  onChange: (scopes: DataScope[]) => void;
  onNext: () => void;
}

/**
 * The self-serve onboarding flow's consent screen — sits between entering
 * a website URL and the fully-automatic Installing step. Unlike
 * PermissionWizard.tsx (the admin dashboard's version of this same
 * checklist), there is no installation yet at this point, so there is no
 * `installationId` to load current state from — every scope simply starts
 * pre-checked (an installer whose default answer is "grant nothing" would
 * leave the AI unable to answer anything on first run) and the selection
 * is carried in InstallWizard's own state, then sent once as
 * `grantedScopes` on POST /api/install/start, where the orchestrator
 * applies it server-side alongside the automatic scan + training run.
 */
export function PermissionConsentStep({ grantedScopes, onChange, onNext }: PermissionConsentStepProps) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<DataScopeDefinition[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.permission
      .getScopes()
      .then((defs) => {
        if (cancelled) return;
        setDefinitions(defs);
        onChange(defs.map((d) => d.scope));
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "Could not load the permission checklist.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
    // Intentionally runs once — the catalog is static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => new Set(grantedScopes), [grantedScopes]);

  const grouped = useMemo(() => {
    const byCategory = new Map<DataScopeDefinition["category"], DataScopeDefinition[]>();
    for (const def of definitions) {
      const list = byCategory.get(def.category) ?? [];
      list.push(def);
      byCategory.set(def.category, list);
    }
    return Array.from(byCategory.entries());
  }, [definitions]);

  function toggle(scope: DataScope) {
    const next = new Set(selected);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    onChange(Array.from(next));
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader
        icon={ShieldCheck}
        title="AI Data Permissions"
        subtitle="Choose what the AI may learn from your website — always read-only. Everything is checked by default; uncheck anything you'd rather keep off-limits."
      />

      {loadState === "loading" && (
        <div className="flex items-center gap-2.5 py-6 text-sm text-ink-muted">
          <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
          Loading permission checklist…
        </div>
      )}

      {loadState === "error" && (
        <div className="flex items-start gap-2.5 rounded-lg border border-critical/30 bg-critical/10 px-3.5 py-3 text-sm text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" />
          {loadError}
        </div>
      )}

      {loadState === "ready" && (
        <div className="space-y-5">
          {grouped.map(([category, categoryDefs]) => (
            <div key={category}>
              <h3 className="data-label mb-1.5 text-ink-faint">{CATEGORY_LABELS[category]}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-surface/50">
                {categoryDefs.map((def, i) => (
                  <PermissionScopeToggle
                    key={def.scope}
                    option={{ ...def, granted: selected.has(def.scope) }}
                    checked={selected.has(def.scope)}
                    onToggle={() => toggle(def.scope)}
                    index={i}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="data-label mt-4 text-ink-faint">Access is always read-only — the AI can never modify, delete, or create data through a granted permission. You can change this anytime from the admin dashboard.</p>

      <div className="mt-6 flex justify-end">
        <PrimaryButton onClick={onNext} disabled={loadState !== "ready"}>
          Continue
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
