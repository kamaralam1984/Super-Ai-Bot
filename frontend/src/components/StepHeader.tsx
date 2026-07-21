import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

export function StepHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-3 mb-5">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 14 }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent"
      >
        <Icon size={19} aria-hidden="true" />
      </motion.div>
      <div>
        <h2 className="font-display text-[17px] font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-muted">{subtitle}</p>
      </div>
    </header>
  );
}
