"use client";

import React from "react";

interface ProgressiveBlurProps {
  className?: string;
  height?: string;
  position?: "top" | "bottom" | "both";
  blurLevels?: number[];
}

export function ProgressiveBlur({
  className,
  height = "30%",
  position = "bottom",
  blurLevels = [0.5, 1, 2, 4, 8, 16, 32, 64],
}: ProgressiveBlurProps) {
  const divElements = Array(Math.max(0, blurLevels.length - 2)).fill(null);

  const maskFor = (kind: "first" | "middle" | "last", index?: number) => {
    if (position === "bottom") {
      if (kind === "first") return "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)";
      if (kind === "last") return "linear-gradient(to bottom, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)";
      const s = (index! + 1) * 12.5;
      const m = (index! + 2) * 12.5;
      const e = (index! + 3) * 12.5;
      return `linear-gradient(to bottom, rgba(0,0,0,0) ${s}%, rgba(0,0,0,1) ${m}%, rgba(0,0,0,1) ${e}%, rgba(0,0,0,0) ${e + 12.5}%)`;
    }
    if (position === "top") {
      if (kind === "first") return "linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)";
      if (kind === "last") return "linear-gradient(to top, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)";
      const s = (index! + 1) * 12.5;
      const m = (index! + 2) * 12.5;
      const e = (index! + 3) * 12.5;
      return `linear-gradient(to top, rgba(0,0,0,0) ${s}%, rgba(0,0,0,1) ${m}%, rgba(0,0,0,1) ${e}%, rgba(0,0,0,0) ${e + 12.5}%)`;
    }
    // both
    if (kind === "first") return "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)";
    if (kind === "last") return "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)";
    return "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)";
  };

  const posStyle: React.CSSProperties =
    position === "top" ? { top: 0 } : position === "bottom" ? { bottom: 0 } : { top: 0, bottom: 0 };

  return (
    <div
      className={`magic-progressive-blur ${className ?? ""}`.trim()}
      style={{ position: "absolute", left: 0, right: 0, height: position === "both" ? "100%" : height, pointerEvents: "none", zIndex: 10, ...posStyle }}
    >
      <div className="magic-progressive-blur-layer" style={{ position: "absolute", inset: 0, zIndex: 1, backdropFilter: `blur(${blurLevels[0]}px)`, WebkitBackdropFilter: `blur(${blurLevels[0]}px)`, maskImage: maskFor("first"), WebkitMaskImage: maskFor("first") }} />
      {divElements.map((_, index) => {
        const blurIndex = index + 1;
        const startPercent = blurIndex * 12.5;
        const midPercent = (blurIndex + 1) * 12.5;
        const endPercent = (blurIndex + 2) * 12.5;
        const maskGradient =
          position === "bottom"
            ? `linear-gradient(to bottom, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
            : position === "top"
              ? `linear-gradient(to top, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
              : `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`;
        return (
          <div
            key={`blur-${index}`}
            className="magic-progressive-blur-layer"
            style={{ position: "absolute", inset: 0, zIndex: index + 2, backdropFilter: `blur(${blurLevels[blurIndex]}px)`, WebkitBackdropFilter: `blur(${blurLevels[blurIndex]}px)`, maskImage: maskGradient, WebkitMaskImage: maskGradient }}
          />
        );
      })}
      <div className="magic-progressive-blur-layer" style={{ position: "absolute", inset: 0, zIndex: blurLevels.length, backdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`, WebkitBackdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`, maskImage: maskFor("last"), WebkitMaskImage: maskFor("last") }} />
    </div>
  );
}