import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertOctagon, RotateCcw, ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import type { InstallErrorDetail, InstallLogEntry } from "@kvl/shared";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api } from "../../lib/api";

const STATUS_COLOR: Record<InstallLogEntry["status"], string> = {
  info: "text-ink-faint",
  success: "text-success",
  warn: "text-warning",
  error: "text-critical",
};

function LogViewer() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<InstallLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !logs) {
      setLoading(true);
      api
        .getLogs(80)
        .then((res) => setLogs(res.entries))
        .catch(() => setLogs([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="w-full mt-2">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-accent transition-colors"
        aria-expanded={open}
      >
        <ScrollText size={13} aria-hidden="true" />
        View Installation Logs
        {open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border-strong bg-ground/80 p-3 font-mono text-[11px] leading-relaxed">
              {loading && <p className="text-ink-faint">Loading logs...</p>}
              {!loading && logs?.length === 0 && <p className="text-ink-faint">No log entries found.</p>}
              {!loading &&
                logs?.map((entry, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    <span className="text-ink-faint">{entry.time.slice(11, 19)}</span>{" "}
                    <span className={STATUS_COLOR[entry.status]}>[{entry.component}]</span>{" "}
                    <span className="text-ink-muted">{entry.message}</span>
                    {entry.error && <span className="text-critical"> — {entry.error}</span>}
                  </div>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ErrorStep({ detail, onRetry }: { detail: InstallErrorDetail; onRetry: () => void }) {
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
            <RotateCcw size={15} aria-hidden="true" /> Retry Installation
          </PrimaryButton>
        )}

        <LogViewer />
      </div>
    </motion.div>
  );
}
