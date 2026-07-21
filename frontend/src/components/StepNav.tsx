import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import clsx from "clsx";

export interface WizardStepDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function StepNav({ steps, currentIndex }: { steps: WizardStepDef[]; currentIndex: number }) {
  return (
    <ol className="flex items-center w-full" aria-label="Installation progress">
      {steps.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        const Icon = step.icon;
        return (
          <li key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300",
                  state === "done" && "bg-accent border-accent text-accent-ink",
                  state === "current" && "border-accent text-accent bg-accent/10 animate-glow-pulse",
                  state === "upcoming" && "border-border text-ink-faint"
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {state === "done" ? <Check size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
              </div>
              <span
                className={clsx(
                  "data-label hidden sm:block",
                  state === "current" ? "text-ink" : "text-ink-faint"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px mx-2 bg-border overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: state === "done" ? "100%" : "0%" }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
