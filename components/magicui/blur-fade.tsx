"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type BlurFadeProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition"> & { duration?: number; delay?: number };

/** Magic UI Blur Fade adapted to the existing Framer Motion and CSS setup. */
export function BlurFade({ children, className = "", duration = 0.55, delay = 0, ...props }: BlurFadeProps) {
  const reducedMotion = useReducedMotion();
  return <motion.div className={`magic-blur-fade ${className}`.trim()} initial={reducedMotion ? false : { opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: reducedMotion ? 0 : duration, delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }} {...props}>{children}</motion.div>;
}
