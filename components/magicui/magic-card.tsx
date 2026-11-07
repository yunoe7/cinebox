"use client";

import { useState, type HTMLAttributes, type PointerEvent } from "react";

/** Magic UI MagicCard pointer-follow spotlight, using CinéBox's own CSS tokens. */
export function MagicCard({ className = "", onPointerMove, onPointerLeave, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [active, setActive] = useState(false);
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--magic-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--magic-y", `${event.clientY - bounds.top}px`);
    if (!active) setActive(true);
    onPointerMove?.(event);
  };

  return <div className={`magic-card ${active ? "magic-card-active" : ""} ${className}`.trim()} onPointerMove={handlePointerMove} onPointerLeave={(event) => { setActive(false); onPointerLeave?.(event); }} {...props} />;
}
