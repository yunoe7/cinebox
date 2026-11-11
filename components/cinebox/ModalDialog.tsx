"use client";

import type { ReactNode, RefObject } from "react";
import { useModalDialog, type ModalDialogOptions } from "./useModalDialog";

type DialogProps = { role: "dialog" | "alertdialog"; "aria-modal": true };

/**
 * Render-prop wrapper for dialogs that live inline in a larger component.
 * Mounting this component mounts the dialog, which is what activates the
 * shared focus/scroll behaviour.
 */
export function ModalDialog<T extends HTMLElement = HTMLElement>({ children, ...options }: ModalDialogOptions & {
  children: (props: { ref: RefObject<T | null>; dialogProps: DialogProps }) => ReactNode;
}) {
  const { ref, dialogProps } = useModalDialog<T>(options);
  return <>{children({ ref, dialogProps })}</>;
}
