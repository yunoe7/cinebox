"use client";

import React, { useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import { AnimatePresence, motion, useReducedMotion, type MotionProps } from "framer-motion";

export function AnimatedListItem({ children, reducedMotion = false }: { children: React.ReactNode; reducedMotion?: boolean }) {
  const animations: MotionProps = reducedMotion
    ? {
        initial: false,
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 1, opacity: 1 },
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0.96, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.96, opacity: 0 },
        transition: { type: "spring", stiffness: 350, damping: 40 },
      };
  return <motion.div {...animations} layout={!reducedMotion} className="magic-animated-list-item">{children}</motion.div>;
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode;
  delay?: number;
  /** Magic UI reveals newest items on top by default. Set false to preserve source order. */
  reverse?: boolean;
}

export const AnimatedList = React.memo(({ children, className, delay = 600, reverse = true, ...props }: AnimatedListProps) => {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const childrenArray = useMemo(() => React.Children.toArray(children), [children]);

  useEffect(() => {
    if (reducedMotion) {
      setIndex(childrenArray.length > 0 ? childrenArray.length - 1 : 0);
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (index < childrenArray.length - 1) {
      timeout = setTimeout(() => setIndex((prev) => Math.min(prev + 1, childrenArray.length - 1)), delay);
    }
    return () => { if (timeout !== null) clearTimeout(timeout); };
  }, [index, delay, childrenArray.length, reducedMotion]);

  const visibleChildren = useMemo(
    () => childrenArray.slice(0, index + 1),
    [index, childrenArray]
  );
  const itemsToShow = useMemo(
    () => (reverse ? [...visibleChildren].reverse() : visibleChildren),
    [reverse, visibleChildren]
  );

  return (
    <div className={`magic-animated-list ${className ?? ""}`.trim()} {...props}>
      <AnimatePresence>
        {itemsToShow.map((item, itemIndex) => (
          <AnimatedListItem
            key={(item as React.ReactElement)?.key ?? itemIndex}
            reducedMotion={Boolean(reducedMotion)}
          >
            {item}
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
});

AnimatedList.displayName = "AnimatedList";
