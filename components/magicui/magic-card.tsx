import type { HTMLAttributes } from "react";
export function MagicCard({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`magic-card ${className}`.trim()} {...props} />;
}