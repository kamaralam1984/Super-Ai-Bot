import type { ReactNode } from "react";
import clsx from "clsx";

export function ConsolePanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("console-panel", className)}>{children}</div>;
}
