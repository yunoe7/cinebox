import type { ButtonHTMLAttributes } from "react";
export function ShimmerButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`magic-shimmer-button ${className}`.trim()} {...props}>{children}</button>;
}