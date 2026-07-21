import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: "primary" | "ghost";
}

export function PrimaryButton({ loading, variant = "primary", className, children, disabled, ...rest }: PrimaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "relative inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium tracking-wide transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "primary" &&
          "bg-accent text-accent-ink shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_8px_20px_-6px_rgb(var(--accent)/0.55)] hover:bg-accent-strong active:scale-[0.97] active:shadow-none",
        variant === "ghost" &&
          "bg-surface-raised/70 border border-border text-ink hover:border-accent/50 hover:text-accent active:scale-[0.97]",
        className
      )}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
