"use client";

import { type ComponentPropsWithoutRef, type CSSProperties } from "react";

interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<"span"> {
  shimmerWidth?: number;
}

export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 120,
  style,
  ...props
}: AnimatedShinyTextProps) {
  return (
    <span
      style={{ "--magic-shine-width": `${shimmerWidth}px`, ...style } as CSSProperties}
      className={`magic-animated-shiny-text ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </span>
  );
}