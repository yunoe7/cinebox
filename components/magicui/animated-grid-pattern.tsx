"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface AnimatedGridPatternProps extends ComponentPropsWithoutRef<"svg"> {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  strokeDasharray?: number;
  numSquares?: number;
  maxOpacity?: number;
  duration?: number;
  repeatDelay?: number;
}

type Square = { id: number; pos: [number, number]; iteration: number };

export function AnimatedGridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  numSquares = 16,
  className,
  maxOpacity = 0.18,
  duration = 4,
  repeatDelay = 1,
  ...props
}: AnimatedGridPatternProps) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<SVGSVGElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [squares, setSquares] = useState<Array<Square>>([]);

  const getPos = useCallback((): [number, number] => {
    return [
      Math.floor((Math.random() * dimensions.width) / width),
      Math.floor((Math.random() * dimensions.height) / height),
    ];
  }, [dimensions.height, dimensions.width, height, width]);

  const generateSquares = useCallback(
    (count: number) => Array.from({ length: count }, (_, i) => ({ id: i, pos: getPos(), iteration: 0 })),
    [getPos]
  );

  const updateSquarePosition = useCallback((squareId: number) => {
    setSquares((current) => {
      const cur = current[squareId];
      if (!cur || cur.id !== squareId) return current;
      const next = current.slice();
      next[squareId] = { ...cur, pos: getPos(), iteration: cur.iteration + 1 };
      return next;
    });
  }, [getPos]);

  useEffect(() => {
    if (dimensions.width && dimensions.height) setSquares(generateSquares(numSquares));
  }, [dimensions.width, dimensions.height, generateSquares, numSquares]);

  useEffect(() => {
    const element = containerRef.current;
    let ro: ResizeObserver | null = null;
    if (element) {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setDimensions((cur) => {
            const nw = entry.contentRect.width;
            const nh = entry.contentRect.height;
            if (cur.width === nw && cur.height === nh) return cur;
            return { width: nw, height: nh };
          });
        }
      });
      ro.observe(element);
    }
    return () => { if (ro) ro.disconnect(); };
  }, []);

  return (
    <svg
      ref={containerRef}
      aria-hidden="true"
      className={`magic-animated-grid ${className ?? ""}`.trim()}
      {...props}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg x={x} y={y} className="magic-animated-grid-squares">
        {squares.map(({ pos: [sx, sy], id: sid, iteration }, index) => (
          <motion.rect
            initial={{ opacity: 0 }}
            animate={{ opacity: maxOpacity }}
            transition={reducedMotion ? { duration: 0 } : { duration, repeat: 1, delay: index * 0.12, repeatType: "reverse", repeatDelay }}
            onAnimationComplete={reducedMotion ? undefined : () => updateSquarePosition(sid)}
            key={`${sid}-${iteration}`}
            width={width - 1}
            height={height - 1}
            x={sx * width + 1}
            y={sy * height + 1}
            fill="currentColor"
            strokeWidth="0"
          />
        ))}
      </svg>
    </svg>
  );
}