import type { HTMLAttributes } from "react";

import { checkStatusTreatment, type CheckStatus } from "../../lib/status-treatment";
import { StatusBadge } from "../StatusBadge/StatusBadge";

export interface CheckResultProps extends HTMLAttributes<HTMLSpanElement> {
  /** One of the five frozen check outcomes from packages/shared's CheckResultSchema. */
  status: CheckStatus;
  /** Optional check key/label shown alongside the status, e.g. "lint", "unit-tests". */
  name?: string;
}

/**
 * Visual treatment for a single policy check result. Accepts exactly the
 * CheckStatus literal union frozen in packages/shared/src/domain.ts --
 * "passed" | "failed" | "timed_out" | "skipped" | "error".
 */
export function CheckResult({ status, name, className, ...rest }: CheckResultProps) {
  const { tone, icon, label } = checkStatusTreatment(status);
  const badgeLabel = name ? `${name}: ${label}` : label;
  return <StatusBadge tone={tone} icon={icon} label={badgeLabel} className={className} {...rest} />;
}
