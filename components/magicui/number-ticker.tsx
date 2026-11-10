"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const motionValue = useMotionValue(direction === "down" ? value : startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const formatValue = (latest: number) => Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(latest.toFixed(decimalPlaces)));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isInView && !reducedMotion) {
      timer = setTimeout(() => {
        motionValue.set(direction === "down" ? startValue : value);
      }, delay * 1000);
    }
    return () => { if (timer !== null) clearTimeout(timer); };
  }, [motionValue, isInView, delay, value, direction, startValue, reducedMotion]);

  useEffect(() => {
    if (!reducedMotion || !ref.current) return;
    ref.current.textContent = formatValue(direction === "down" ? startValue : value);
  }, [reducedMotion, direction, startValue, value, decimalPlaces]);

  useEffect(
    () => springValue.on("change", (latest) => {
      if (ref.current && !reducedMotion) {
        ref.current.textContent = formatValue(Number(latest));
      }
    }),
    [springValue, decimalPlaces, reducedMotion]
  );

  return (
    <span ref={ref} className={`magic-number-ticker ${className ?? ""}`.trim()} {...props}>
      {startValue}
    </span>
  );
}