import type { HTMLAttributes } from "react";

import styles from "./Heading.module.css";

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
}

const TAGS = ["h1", "h2", "h3", "h4"] as const;
const LEVEL_CLASS = {
  1: styles.level1,
  2: styles.level2,
  3: styles.level3,
  4: styles.level4
} as const;

/** Heading primitive covering the four heading levels the product needs. */
export function Heading({ level = 2, className, children, ...rest }: HeadingProps) {
  const Tag = TAGS[level - 1] ?? "h2";
  const classes = [styles.heading, LEVEL_CLASS[level], className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
