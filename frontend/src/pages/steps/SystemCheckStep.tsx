import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ServerCog, RefreshCw, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { CheckList } from "../../components/CheckList";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StepHeader } from "../../components/StepHeader";
import type { RequirementCheckResult } from "@kvl/shared";

export function SystemCheckStep({ onNext }: { onNext: () => void }) {
  const [result, setResult] = useState<RequirementCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .systemCheck()
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "System check failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={ServerCog} title="System Requirements" subtitle="Checking your server against installation requirements." />

      <div aria-live="polite">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
            <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" />
            Running system checks...
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-critical/30 bg-critical/10 p-4 text-sm text-critical">{error}</div>
        )}
        {result && !loading && <CheckList items={result.items} />}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={runCheck}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-accent transition-colors"
        >
          <RefreshCw size={13} aria-hidden="true" /> Re-run checks
        </button>
        <PrimaryButton onClick={onNext} disabled={!result?.allRequiredPassed || loading}>
          Continue
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
