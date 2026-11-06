"use client";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
type Props = { children: ReactNode; className?: string; color?: string };
export function SpotlightSurface({ children, className = "", color = "rgba(203,177,132,.13)" }: Props) {
  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  };
  return <div className={`spotlight-surface ${className}`} style={{ "--spotlight-color": color } as CSSProperties} onPointerMove={track}>{children}</div>;
}