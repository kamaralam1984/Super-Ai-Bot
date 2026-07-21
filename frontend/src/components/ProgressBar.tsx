import { motion } from "framer-motion";

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      {label && (
        <div className="flex justify-between mb-1.5">
          <span className="data-label">{label}</span>
          <span className="data-value text-xs font-medium text-ink">{Math.round(clamped)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1.5 w-full rounded-full bg-border overflow-hidden"
      >
        <motion.div
          className="relative h-full rounded-full bg-gradient-to-r from-accent-strong to-accent overflow-hidden"
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 22 }}
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
        </motion.div>
      </div>
    </div>
  );
}
