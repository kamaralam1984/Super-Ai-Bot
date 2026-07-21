import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import clsx from "clsx";
import type { WizardScopeOption } from "@kvl/shared";

export function PermissionScopeToggle({ option, checked, onToggle, index }: { option: WizardScopeOption; checked: boolean; onToggle: () => void; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.035, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-start gap-3 px-4 py-3"
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle ${option.label} access`}
        onClick={onToggle}
        className={clsx(
          "mt-0.5 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          checked ? "bg-accent" : "bg-surface-raised border border-border"
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={clsx("inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow", checked ? "translate-x-[19px]" : "translate-x-1")}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{option.label}</span>
          {option.sensitivity === "sensitive" && (
            <span className="data-label inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-warning">
              <ShieldAlert size={11} aria-hidden="true" />
              sensitive
            </span>
          )}
        </div>
        <p className="data-value text-xs text-ink-muted mt-0.5">{option.description}</p>
      </div>
    </motion.li>
  );
}
