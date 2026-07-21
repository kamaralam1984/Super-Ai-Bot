import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { CheckStatus } from "@kvl/shared";

const STYLES: Record<CheckStatus, { icon: typeof CheckCircle2; className: string; srLabel: string }> = {
  pass: { icon: CheckCircle2, className: "text-success", srLabel: "Passed" },
  warn: { icon: AlertTriangle, className: "text-warning", srLabel: "Warning" },
  fail: { icon: XCircle, className: "text-critical", srLabel: "Failed" },
  pending: { icon: Loader2, className: "text-ink-faint animate-spin", srLabel: "Checking" },
};

export function StatusIcon({ status, size = 18 }: { status: CheckStatus; size?: number }) {
  const { icon: Icon, className, srLabel } = STYLES[status];
  return (
    <span className="inline-flex shrink-0">
      <Icon size={size} className={className} aria-hidden="true" />
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
