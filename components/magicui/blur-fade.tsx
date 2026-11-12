"use client";

import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, type MotionProps, type Variants } from "framer-motion";

type MarginType = string | number;

interface BlurFadeProps extends MotionProps {
  children: ReactNode;
  className?: string;
  variant?: { hidden: { y: number }; visible: { y: number } };
  duration?: number;
  delay?: number;
  offset?: number;
  direction?: "up" | "down" | "left" | "right";
  inView?: boolean;
  inViewMargin?: MarginType;
  blur?: string;
}

const getFilter = (v: Variants[string]) => (typeof v === "function" ? undefined : v?.filter);

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.45,
  delay = 0,
  offset = 8,
  direction = "down",
  inView = false,
  inViewMargin = "-60px",
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin as never });
  const isInView = !inView || inViewResult;

  const defaultVariants: Variants = {
    hidden: {
      [direction === "left" || direction === "right" ? "x" : "y"]:
        direction === "right" || direction === "down" ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      [direction === "left" || direction === "right" ? "x" : "y"]: 0,
      opacity: 1,
      filter: "blur(0px)",
    },
  };
  const combinedVariants = variant ?? defaultVariants;

  const hiddenFilter = getFilter(combinedVariants.hidden);
  const visibleFilter = getFilter(combinedVariants.visible);
  const shouldTransitionFilter = hiddenFilter != null && visibleFilter != null && hiddenFilter !== visibleFilter;

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={reducedMotion || isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={combinedVariants}
        transition={reducedMotion ? { duration: 0 } : {
          delay: 0.04 + delay,
          duration,
          ease: "easeOut",
          ...(shouldTransitionFilter ? { filter: { duration } } : {}),
        }}
        className={`magic-blur-fade${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}