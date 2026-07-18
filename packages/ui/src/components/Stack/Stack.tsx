import type { HTMLAttributes } from "react";

import styles from "./Stack.module.css";

export type StackDirection = "row" | "column";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackGap = 1 | 2 | 3 | 4 | 5 | 6;

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  align?: StackAlign;
  gap?: StackGap;
}

const DIRECTION_CLASS: Record<StackDirection, string | undefined> = {
  row: styles.directionRow,
  column: styles.directionColumn
};

const ALIGN_CLASS: Record<StackAlign, string | undefined> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch
};

const GAP_CLASS: Record<StackGap, string | undefined> = {
  1: styles.gap1,
  2: styles.gap2,
  3: styles.gap3,
  4: styles.gap4,
  5: styles.gap5,
  6: styles.gap6
};

/**
 * Spacing primitive: a flex box with a token-based gap. Used instead of
 * ad-hoc margins so vertical rhythm stays systematic across the app.
 */
export function Stack({
  direction = "column",
  align = "stretch",
  gap = 4,
  className,
  ...rest
}: StackProps) {
  const classes = [
    styles.stack,
    DIRECTION_CLASS[direction],
    ALIGN_CLASS[align],
    GAP_CLASS[gap],
    className
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...rest} />;
}
