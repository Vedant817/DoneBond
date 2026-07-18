import type { HTMLAttributes } from "react";

import { StatusIcon, type StatusIconProps } from "../icons/StatusIcon";
import type { StatusTone } from "../../lib/status-treatment";
import styles from "./StatusBadge.module.css";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  icon: StatusIconProps["name"];
  label: string;
}

const TONE_CLASS: Record<StatusTone, string | undefined> = {
  success: styles.success,
  pending: styles.pending,
  warning: styles.warning,
  error: styles.error,
  critical: styles.critical,
  neutral: styles.neutral
};

/**
 * Generic status badge primitive: a tone-colored pill carrying both an icon
 * and a text label, so status is never conveyed by color alone. CheckResult
 * and TransactionState render themselves through this primitive.
 */
export function StatusBadge({ tone, icon, label, className, ...rest }: StatusBadgeProps) {
  const classes = [styles.badge, TONE_CLASS[tone], className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      <StatusIcon name={icon} className={styles.icon} />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
