import Image from "next/image";
import type { CSSProperties } from "react";
import spiderMark from "./spider-mark.png";
import { BlurFade } from "../magicui/blur-fade";

type CineboxLogoProps = {
  variant?: "sidebar" | "mobile" | "loading" | "profile-gate";
};

/** Shared spider symbol for the loading state and responsive navigation. */
export function CineboxLogo({ variant = "sidebar" }: CineboxLogoProps) {
  const maskStyle = { "--cinebox-spider-mask": `url("${spiderMark.src}")` } as CSSProperties;
  const duration = variant === "profile-gate" ? 0 : .72;
  const delay = variant === "profile-gate" ? 0 : .04;

  return <BlurFade className={`cinebox-logo-motion cinebox-logo-motion--${variant}`} duration={duration} delay={delay}>
    <span className={`cinebox-logo-stage cinebox-logo-stage--${variant}`} aria-hidden="true">
      <Image
        src={spiderMark}
        alt=""
        draggable={false}
        className="cinebox-logo"
      />
      <span className="cinebox-logo-finish" style={maskStyle} />
    </span>
  </BlurFade>;
}
