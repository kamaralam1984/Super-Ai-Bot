import { motion } from "framer-motion";
import { AlertOctagon, RotateCcw } from "lucide-react";
import type { OnboardingErrorDetail } from "@kvl/shared";
import { PrimaryButton } from "../../components/PrimaryButton";

/**
 * Modeled on ErrorStep.tsx, minus its LogViewer — GET /api/logs is the
 * platform installer's own log stream (tied to the legacy
 * accountId:null installation), not tenant-scoped, so showing it here
 * would leak the wrong account's data rather than nothing at all.
 */
export function OnboardingErrorStep({ detail, onRetry }: { detail: OnboardingErrorDetail; onRetry: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} role="alert">
      <div className="flex flex-col items-center text-center gap-4 py-2">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 14 }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-critical/15 text-critical"
        >
          <AlertOctagon size={28} aria-hidden="true" />
        </motion.div>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{detail.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Failed at step: <span className="data-value text-ink">{detail.stepId.replace(/_/g, " ")}</span>
          </p>
        </div>

        <div className="w-full rounded-xl border border-critical/30 bg-critical/10 p-4 text-left">
          <p className="text-sm text-critical">{detail.message}</p>
          {detail.suggestedFix && (
            <p className="mt-2 text-xs text-critical/90">
              <span className="font-semibold">Suggested fix: </span>
              {detail.suggestedFix}
            </p>
          )}
        </div>

        {detail.retryable && (
          <PrimaryButton onClick={onRetry}>
            <RotateCcw size={15} aria-hidden="true" /> Retry Setup
          </PrimaryButton>
        )}
      </div>
    </motion.div>
  );
}
