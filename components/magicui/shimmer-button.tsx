import type { ButtonHTMLAttributes } from "react";
export function ShimmerButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`magic-shimmer-button ${className}`.trim()} {...props}><span className="magic-shimmer-sheen" aria-hidden="true"/><span className="magic-shimmer-content">{children}</span></button>;
}