import type { HTMLAttributes } from "react";

import {
  chainTransactionStatusTreatment,
  type ChainTransactionStatus
} from "../../lib/status-treatment";
import { StatusBadge } from "../StatusBadge/StatusBadge";

export interface TransactionStateProps extends HTMLAttributes<HTMLSpanElement> {
  /** One of the eight frozen states from packages/shared's ChainTransactionStatusSchema. */
  status: ChainTransactionStatus;
}

/**
 * Visual treatment for a wallet/chain transaction's lifecycle state. Accepts
 * exactly the ChainTransactionStatus literal union frozen in
 * packages/shared/src/domain.ts (prepared, wallet_requested, submitted,
 * confirmed, rejected_by_user, replaced, reverted, unknown_reconcile).
 */
export function TransactionState({ status, className, ...rest }: TransactionStateProps) {
  const { tone, icon, label } = chainTransactionStatusTreatment(status);
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} {...rest} />;
}
