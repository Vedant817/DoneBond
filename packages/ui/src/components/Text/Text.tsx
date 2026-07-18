import type { ElementType, HTMLAttributes } from "react";

import styles from "./Text.module.css";

export type TextSize = "xs" | "sm" | "base" | "md";
export type TextTone = "muted" | "subtle" | "strong" | "accent";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  size?: TextSize;
  tone?: TextTone;
  /** Renders the mono, wide-tracked "eyebrow" treatment used for section labels. */
  eyebrow?: boolean;
  as?: ElementType;
}

const SIZE_CLASS: Record<TextSize, string | undefined> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  base: styles.sizeBase,
  md: styles.sizeMd
};

const TONE_CLASS: Record<TextTone, string | undefined> = {
  muted: styles.toneMuted,
  subtle: styles.toneSubtle,
  strong: styles.toneStrong,
  accent: styles.toneAccent
};

/** Body-copy primitive. Covers paragraph text, muted/subtle secondary text, and eyebrow labels. */
export function Text({
  size = "base",
  tone = "muted",
  eyebrow = false,
  as,
  className,
  children,
  ...rest
}: TextProps) {
  const Tag = as ?? "p";
  const classes = [
    styles.text,
    SIZE_CLASS[size],
    eyebrow ? styles.eyebrow : TONE_CLASS[tone],
    className
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
