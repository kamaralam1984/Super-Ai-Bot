import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Server, Globe2, Link2, Settings2, ShieldCheck, Database, FolderTree, Radar, GraduationCap, PartyPopper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DataScope, InstallErrorDetail, InstallProgressEvent, InstallStepId } from "@kvl/shared";
import { getSocket, subscribeProgressRoom } from "../../lib/socket";
import { api } from "../../lib/api";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusIcon } from "../../components/StatusIcon";
import { StepHeader } from "../../components/StepHeader";
import clsx from "clsx";

const STEP_ICONS: Record<InstallStepId, LucideIcon> = {
  system_check: Server,
  environment_validation: Globe2,
  website_validation: Link2,
  configuration: Settings2,
  security: ShieldCheck,
  database: Database,
  directories: FolderTree,
  permissions: ShieldCheck,
  scanning: Radar,
  training: GraduationCap,
  finalizing: PartyPopper,
};

const STEP_ORDER: InstallStepId[] = [
  "system_check",
  "environment_validation",
  "website_validation",
  "configuration",
  "security",
  "database",
  "directories",
  "permissions",
  "scanning",
  "training",
  "finalizing",
];

interface InstallingStepProps {
  websiteName: string;
  websiteUrl: string;
  grantedScopes: DataScope[];
  onComplete: () => void;
  onError: (detail: InstallErrorDetail) => void;
}

export function InstallingStep({ websiteName, websiteUrl, grantedScopes, onComplete, onError }: InstallingStepProps) {
  const [events, setEvents] = useState<Record<InstallStepId, InstallProgressEvent>>({} as Record<InstallStepId, InstallProgressEvent>);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    // A ref-based "already started" guard would survive React StrictMode's
    // dev-only mount→cleanup→mount cycle and end up suppressing the *surviving*
    // mount's listeners too. A per-run `cancelled` flag closed over by this
    // effect instance is the correct pattern: the discarded first pass cleans
    // itself up completely, and the second (real) pass starts fresh.
    let cancelled = false;
    const socket = getSocket();
    // A room this browser tab generates and keeps re-subscribing to on
    // every connect (including reconnects) — not `socket.id`, which
    // changes on every reconnect and would silently strand this screen on
    // stale progress the moment a real, multi-minute scan+train run
    // outlives one WebSocket connection. See lib/socket.ts's
    // subscribeProgressRoom doc comment.
    const room = crypto.randomUUID();
    const unsubscribeRoom = subscribeProgressRoom(room);

    const handleProgress = (event: InstallProgressEvent) => {
      if (cancelled) return;
      setEvents((prev) => ({ ...prev, [event.stepId]: event }));
      setPercent(event.progressPercent);
      if (event.stepId === "finalizing" && event.status === "success") {
        setTimeout(onComplete, 600);
      }
    };
    const handleError = (detail: InstallErrorDetail) => {
      if (!cancelled) onError(detail);
    };

    socket.on("install:progress", handleProgress);
    socket.on("install:error", handleError);

    const start = () => {
      if (cancelled) return;
      api.startInstall({ websiteName, websiteUrl, socketId: room, grantedScopes }).catch((err) => {
        if (cancelled) return;
        onError({ stepId: "finalizing", title: "Could not start installation", message: err instanceof Error ? err.message : "Unknown error", suggestedFix: "Check that the installer backend is running and retry.", retryable: true });
      });
    };
    if (socket.connected) start();
    else socket.once("connect", start);

    return () => {
      cancelled = true;
      unsubscribeRoom();
      socket.off("install:progress", handleProgress);
      socket.off("install:error", handleError);
      socket.off("connect", start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={Loader2} title="Installing" subtitle="Please don't close this window." />

      <ProgressBar percent={percent} label="Overall progress" />

      <ul className="mt-6 space-y-1" aria-live="polite" aria-atomic="false">
        {STEP_ORDER.map((stepId) => {
          const event = events[stepId];
          const Icon = STEP_ICONS[stepId];
          const isRunning = event?.status === "running";
          const status = !event ? "pending" : isRunning ? "pending" : event.status === "success" ? "pass" : "fail";
          return (
            <motion.li
              key={stepId}
              animate={{ opacity: event ? 1 : 0.4, x: 0 }}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent transition-colors",
                isRunning && "border-accent/25 bg-accent/5"
              )}
            >
              <div
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isRunning ? "bg-accent/15 text-accent" : "bg-surface-raised text-ink-faint"
                )}
              >
                <Icon size={14} aria-hidden="true" className={isRunning ? "animate-pulse" : undefined} />
              </div>
              <span className={clsx("text-sm flex-1", isRunning ? "text-ink" : "text-ink-muted")}>
                {event?.message ?? STEP_ORDER_LABELS[stepId]}
              </span>
              {event && <StatusIcon status={status} size={16} />}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}

const STEP_ORDER_LABELS: Record<InstallStepId, string> = {
  system_check: "Checking Server",
  environment_validation: "Checking Environment",
  website_validation: "Verifying Website",
  configuration: "Creating Configuration",
  security: "Generating Security Keys",
  database: "Creating Database",
  directories: "Creating Directory Structure",
  permissions: "Applying AI Data Permissions",
  scanning: "Scanning Your Website",
  training: "Training the AI",
  finalizing: "Finalizing Installation",
};
