import type { HTMLAttributes } from "react";

/** Small CSS adaptation of Magic UI Progressive Blur for the lower edge of the hero. */
export function ProgressiveBlur({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`magic-progressive-blur ${className}`.trim()} {...props}><span/><span/><span/><span/></div>;
}
