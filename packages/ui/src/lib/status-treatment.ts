import type { ChainTransaction, CheckResult } from "@donebond/shared";

/**
 * The frozen enums live in packages/shared/src/domain.ts as
 * `CheckStatusSchema` / `ChainTransactionStatusSchema`. We derive the
 * literal unions from the already-exported object types instead of
 * redefining a parallel string union here, so this file cannot drift from
 * the schema it visualizes.
 */
export type CheckStatus = CheckResult["status"];
export type ChainTransactionStatus = ChainTransaction["status"];

/**
 * A small, fixed set of visual tones. Distinct real-world states are allowed
 * to share a tone (e.g. two different "in flight" states) as long as their
 * icon and label still differ -- color is never the only signal.
 */
export type StatusTone = "success" | "pending" | "warning" | "error" | "critical" | "neutral";

export type StatusIcon =
  | "check"
  | "cross"
  | "clock"
  | "alert-triangle"
  | "minus"
  | "upload"
  | "refresh"
  | "question"
  | "document";

export interface StatusTreatment {
  tone: StatusTone;
  icon: StatusIcon;
  /** Always-visible text label -- never rely on color or icon alone. */
  label: string;
}

/**
 * Visual treatment for each of the five real check-result outcomes.
 * "failed" and "error" are deliberately not merged into one "error" bucket:
 * a failed check is an assertion outcome, an errored check is a runner/infra
 * problem, and they get distinct icons, labels, and tones.
 */
export function checkStatusTreatment(status: CheckStatus): StatusTreatment {
  switch (status) {
    case "passed":
      return { tone: "success", icon: "check", label: "Passed" };
    case "failed":
      return { tone: "error", icon: "cross", label: "Failed" };
    case "timed_out":
      return { tone: "warning", icon: "clock", label: "Timed out" };
    case "error":
      return { tone: "critical", icon: "alert-triangle", label: "Error" };
    case "skipped":
      return { tone: "neutral", icon: "minus", label: "Skipped" };
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled check status: ${String(exhaustive)}`);
    }
  }
}

/**
 * Visual treatment for each of the eight chain-transaction lifecycle states.
 * Several share a tone (e.g. wallet_requested/submitted are both "pending"),
 * but every state has a unique icon + label pair.
 */
export function chainTransactionStatusTreatment(status: ChainTransactionStatus): StatusTreatment {
  switch (status) {
    case "prepared":
      return { tone: "neutral", icon: "document", label: "Prepared" };
    case "wallet_requested":
      return { tone: "pending", icon: "clock", label: "Wallet requested" };
    case "submitted":
      return { tone: "pending", icon: "upload", label: "Submitted" };
    case "confirmed":
      return { tone: "success", icon: "check", label: "Confirmed" };
    case "rejected_by_user":
      return { tone: "error", icon: "cross", label: "Rejected" };
    case "replaced":
      return { tone: "warning", icon: "refresh", label: "Replaced" };
    case "reverted":
      return { tone: "critical", icon: "alert-triangle", label: "Reverted" };
    case "unknown_reconcile":
      return { tone: "neutral", icon: "question", label: "Unknown — reconciling" };
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled chain transaction status: ${String(exhaustive)}`);
    }
  }
}
