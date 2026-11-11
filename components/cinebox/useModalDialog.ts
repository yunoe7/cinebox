"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared modal-dialog behaviour: initial focus, focus trap, Escape handling,
 * focus return and background scroll lock.
 *
 * Dialogs are conditionally mounted, so the effect runs once for the lifetime
 * of the dialog. A module-level stack keeps nested dialogs working: only the
 * topmost dialog traps Tab and handles Escape, and the page stays locked until
 * the last dialog closes.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type DialogEntry = { id: symbol; container: HTMLElement };

const dialogStack: DialogEntry[] = [];
let scrollLockCount = 0;
let previousBodyOverflow = "";

function lockScroll() {
  if (typeof document === "undefined") return;
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}

function unlockScroll() {
  if (typeof document === "undefined") return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

function isTopmost(id: symbol) {
  return dialogStack[dialogStack.length - 1]?.id === id;
}

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0);
}

export type ModalDialogRole = "dialog" | "alertdialog";

export type ModalDialogOptions = {
  active?: boolean;
  onClose?: () => void;
  closeOnEscape?: boolean;
  role?: ModalDialogRole;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
};

export function useModalDialog<T extends HTMLElement = HTMLElement>(options: ModalDialogOptions = {}) {
  const ref = useRef<T>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const active = options.active !== false;

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const current = optionsRef.current;
    const entry: DialogEntry = { id: Symbol("modal-dialog"), container };
    const previouslyFocused = current.returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const shouldLock = current.lockScroll !== false;

    dialogStack.push(entry);
    if (shouldLock) lockScroll();

    const focusInitial = () => {
      const target = optionsRef.current.initialFocusRef?.current
        ?? container.querySelector<HTMLElement>("[data-autofocus]")
        ?? focusableElements(container)[0]
        ?? container;
      if (target === container && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost(entry.id)) return;
      if (event.key === "Escape") {
        if (optionsRef.current.closeOnEscape === false) return;
        event.preventDefault();
        event.stopPropagation();
        optionsRef.current.onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableElements(container);
      if (!items.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const index = dialogStack.indexOf(entry);
      if (index >= 0) dialogStack.splice(index, 1);
      if (shouldLock) unlockScroll();
      const returnTarget = optionsRef.current.returnFocusRef?.current ?? previouslyFocused;
      if (returnTarget && returnTarget.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [active]);

  const role = options.role ?? "dialog";
  return {
    ref,
    dialogProps: {
      role,
      "aria-modal": true as const,
    },
  };
}
