// Permission Wizard — lets an administrator individually authorize which
// of the 12 data categories the chatbot may read (Products, Services,
// FAQs, Orders, Customers, Inventory, Appointments, Categories, Pricing,
// Shipping, Blogs, Support Articles), always READ_ONLY. Talks to
// GET/POST /api/permission/wizard (backend/src/routes/permission.routes.ts).
//
// Not mounted into the live installer flow: every Phase 2-7 API requires
// an `x-api-key: <API_SECRET>` header, a server-side secret this public
// installer SPA never has and must never embed in browser JS. This
// component is fully functional and ready to be dropped into a future
// authenticated admin dashboard (one with its own session/login, calling
// through a backend-for-frontend that injects the key server-side) — see
// docs/PERMISSION_ENGINE.md's "Known limitations" for why that dashboard
// doesn't exist yet, matching CompletionStep's own "the application
// dashboard becomes available once the product's application layer is
// deployed" disclaimer.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WizardScopeOption } from "@kvl/shared";
import { api, ApiError } from "../lib/api";
import { StepHeader } from "../components/StepHeader";
import { PermissionScopeToggle } from "../components/PermissionScopeToggle";
import { PrimaryButton } from "../components/PrimaryButton";

const CATEGORY_LABELS: Record<WizardScopeOption["category"], string> = {
  commerce: "Commerce",
  content: "Content",
  customer: "Customer",
  operations: "Operations",
};

interface PermissionWizardProps {
  installationId: string;
  connectorId?: string | null;
  /** Free-text audit label for who made this change — an admin username/email, not an authentication mechanism (the caller's session/API key already establishes that). */
  actor: string;
  onSaved?: (result: { granted: string[]; revoked: string[] }) => void;
}

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

export function PermissionWizard({ installationId, connectorId = null, actor, onSaved }: PermissionWizardProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<WizardScopeOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    api.permission
      .getWizardState(installationId, connectorId)
      .then((state) => {
        if (cancelled) return;
        setOptions(state.options);
        setSelected(new Set(state.options.filter((o) => o.granted).map((o) => o.scope)));
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "Could not load the permission wizard.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [installationId, connectorId]);

  const grouped = useMemo(() => {
    const byCategory = new Map<WizardScopeOption["category"], WizardScopeOption[]>();
    for (const option of options) {
      const list = byCategory.get(option.category) ?? [];
      list.push(option);
      byCategory.set(option.category, list);
    }
    return Array.from(byCategory.entries());
  }, [options]);

  function toggle(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      const result = await api.permission.submitWizard({
        installationId,
        connectorId,
        grantedScopes: Array.from(selected) as never,
        actor,
      });
      setSaveState("saved");
      onSaved?.({ granted: result.granted, revoked: result.revoked });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save permission changes.");
      setSaveState("error");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2.5 py-6 text-sm text-ink-muted">
        <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
        Loading current permissions…
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-critical/30 bg-critical/10 px-3.5 py-3 text-sm text-ink">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" />
        {loadError}
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <StepHeader
        icon={ShieldCheck}
        title="AI Data Permissions"
        subtitle={connectorId ? `Authorize what this connector's data the AI may use — always read-only.` : "Authorize what the AI may learn from your website — always read-only."}
      />

      <div className="space-y-5">
        {grouped.map(([category, categoryOptions]) => (
          <div key={category}>
            <h3 className="data-label mb-1.5 text-ink-faint">{CATEGORY_LABELS[category]}</h3>
            <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-surface/50">
              {categoryOptions.map((option, i) => (
                <PermissionScopeToggle key={option.scope} option={option} checked={selected.has(option.scope)} onToggle={() => toggle(option.scope)} index={i} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <PrimaryButton onClick={handleSave} loading={saveState === "saving"}>
          Save Permissions
        </PrimaryButton>
        {saveState === "saved" && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 size={14} aria-hidden="true" /> Saved
          </motion.span>
        )}
        {saveState === "error" && (
          <span className="flex items-center gap-1.5 text-xs text-critical">
            <AlertTriangle size={14} aria-hidden="true" /> {saveError}
          </span>
        )}
      </div>

      <p className="data-label mt-4 text-ink-faint">Access is always read-only — the AI can never modify, delete, or create data through a granted permission.</p>
    </motion.div>
  );
}
