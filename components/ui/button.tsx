import type { ButtonHTMLAttributes } from "react";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost"; size?: "default" | "sm" | "icon" };
export function Button({ className = "", variant = "default", size = "default", ...props }: Props) {
  return <button className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()} {...props} />;
}