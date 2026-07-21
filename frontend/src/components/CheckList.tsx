import { motion } from "framer-motion";
import { StatusIcon } from "./StatusIcon";
import type { CheckStatus } from "@kvl/shared";

export interface CheckListItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  required?: boolean;
}

export function CheckList({ items }: { items: CheckListItem[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-surface/50">
      {items.map((item, i) => (
        <motion.li
          key={item.id}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.045, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-start gap-3 px-4 py-3"
        >
          <div className="mt-0.5">
            <StatusIcon status={item.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{item.label}</span>
              {item.required === false && (
                <span className="data-label border border-border rounded px-1.5 py-0.5">optional</span>
              )}
            </div>
            <p className="data-value text-xs text-ink-muted mt-0.5 break-words">{item.detail}</p>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}
