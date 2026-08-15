import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck, Radar, GraduationCap, PartyPopper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DataScope, OnboardingErrorDetail, OnboardingProgressEvent, OnboardingStepId } from "@kvl/shared";
import { getSocket, subscribeProgressRoom } from "../../lib/socket";
import { api } from "../../lib/api";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusIcon } from "../../components/StatusIcon";
import { StepHeader } from "../../components/StepHeader";
import clsx from "clsx";

const STEP_ICONS: Record<OnboardingStepId, LucideIcon> = {
  permissions: ShieldCheck,
  scanning: Radar,
  training: GraduationCap,
  finalizing: PartyPopper,
};

const STEP_ORDER: OnboardingStepId[] = ["permissions", "scanning", "training", "finalizing"];

const STEP_ORDER_LABELS: Record<OnboardingStepId, string> = {
  permissions: "Applying AI Data Permissions",
  scanning: "Scanning Your Website",
  training: "Training the AI",
  finalizing: "Finalizing Setup",
};

interface OnboardingStepProps {
  grantedScopes: DataScope[];
  onComplete: () => void;
  onError: (detail: OnboardingErrorDetail) => void;
}

/**
 * A shorter sibling of InstallingStep.tsx — same live-progress pattern
 * (a caller-generated room joined/rejoined across reconnects, see
 * lib/socket.ts's subscribeProgressRoom), but listens for
 * "onboarding:progress"/"onboarding:error" (tenantOnboarding.service.ts)
 * instead of "install:progress"/"install:error", over a shorter 4-step
 * vocabulary — the tenant's Account + Installation rows already exist
 * (created by the signup step just before this one), so there's no
 * system-check/config/database step to show.
 */
export function OnboardingStep({ grantedScopes, onComplete, onError }: OnboardingStepProps) {
  const [events, setEvents] = useState<Record<OnboardingStepId, OnboardingProgressEvent>>({} as Record<OnboardingStepId, OnboardingProgressEvent>);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    const room = crypto.randomUUID();
    const unsubscribeRoom = subscribeProgressRoom(room);

    const handleProgress = (event: OnboardingProgressEvent) => {
      if (cancelled) return;
      setEvents((prev) => ({ ...prev, [event.stepId]: event }));
      setPercent(event.progressPercent);
      if (event.stepId === "finalizing" && event.status === "success") {
        setTimeout(onComplete, 600);
      }
    };
    const handleError = (detail: OnboardingErrorDetail) => {
      if (!cancelled) onError(detail);
    };

    socket.on("onboarding:progress", handleProgress);
    socket.on("onboarding:error", handleError);

    const start = () => {
      if (cancelled) return;
      api.tenant.startOnboarding({ socketId: room, grantedScopes }).catch((err) => {
        if (cancelled) return;
        onError({
          stepId: "finalizing",
          title: "Could not start setup",
          message: err instanceof Error ? err.message : "Unknown error",
          suggestedFix: "Check that the server is running and retry.",
          retryable: true,
        });
      });
    };
    if (socket.connected) start();
    else socket.once("connect", start);

    return () => {
      cancelled = true;
      unsubscribeRoom();
      socket.off("onboarding:progress", handleProgress);
      socket.off("onboarding:error", handleError);
      socket.off("connect", start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={Loader2} title="Setting things up" subtitle="Please don't close this window." />

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
              <span className={clsx("text-sm flex-1", isRunning ? "text-ink" : "text-ink-muted")}>{event?.message ?? STEP_ORDER_LABELS[stepId]}</span>
              {event && <StatusIcon status={status} size={16} />}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}
