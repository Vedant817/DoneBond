import { decodeEventLog, getAddress } from "viem";

import type { ChainReceipt, TaskReceiptProvider } from "./task-reconciliation.ts";

const RECEIPT_SUBMITTED_EVENT = {
  type: "event",
  name: "ReceiptSubmitted",
  anonymous: false,
  inputs: [
    { name: "taskId", type: "uint256", indexed: true },
    { name: "assignee", type: "address", indexed: true },
    { name: "evidenceHash", type: "bytes32", indexed: false },
    { name: "commitHash", type: "bytes32", indexed: false }
  ]
} as const;

const VERIFIER_ATTESTATION_CONSUMED_EVENT = {
  type: "event",
  name: "VerifierAttestationConsumed",
  anonymous: false,
  inputs: [
    { name: "taskId", type: "uint256", indexed: true },
    { name: "attestationDigest", type: "bytes32", indexed: true },
    { name: "verifier", type: "address", indexed: true },
    { name: "attestationExpiry", type: "uint64", indexed: false }
  ]
} as const;

export interface ReceiptReconciliationContext {
  readonly transactionPublicId: string;
  readonly transactionHash: `0x${string}`;
  readonly status: "submitted" | "unknown_reconcile";
  readonly chainId: number;
  readonly contractAddress: string;
  readonly taskPublicId: string;
  readonly chainTaskId: string;
  readonly assigneeWallet: string;
  readonly evidenceHash: string;
  readonly commitHash: string;
  readonly attestationExpiryUnixSeconds: string;
  readonly verifierAddress: string;
  readonly typedDataDigest: string;
}

export interface ReceiptReconciliationStore {
  getReceiptReconciliationContext(
    transactionPublicId: string,
    actorUserId: string
  ): Promise<ReceiptReconciliationContext | null>;
  markTransactionUnknown(input: {
    readonly context: ReceiptReconciliationContext;
    readonly failureCode: string;
    readonly reconciledAt: Date;
  }): Promise<void>;
  markTransactionReverted(input: {
    readonly context: ReceiptReconciliationContext;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly reconciledAt: Date;
  }): Promise<void>;
  confirmReceiptSubmitted(input: {
    readonly context: ReceiptReconciliationContext;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly logIndex: number;
    readonly reconciledAt: Date;
  }): Promise<void>;
}

export type ReceiptReconciliationResult =
  | { readonly status: "unknown_reconcile"; readonly failureCode: string }
  | { readonly status: "reverted"; readonly blockNumber: string }
  | { readonly status: "confirmed"; readonly blockNumber: string };

function sameAddress(left: string, right: string): boolean {
  return getAddress(left).toLowerCase() === getAddress(right).toLowerCase();
}

/**
 * Reconciles a `submit_receipt` chain transaction, mirroring
 * `reconcileTaskCreation` in `task-reconciliation.ts` for the `ReceiptSubmitted`
 * lifecycle instead of `TaskCreated`.
 *
 * Both `ReceiptSubmitted` and `VerifierAttestationConsumed` are decoded and
 * checked against the persisted attestation context (task ID, assignee,
 * evidence/commit hashes, and the exact typed-data digest) before the
 * transaction is confirmed — this is the defense-in-depth analog of
 * `reconcileTaskCreation`'s exact `TaskCreated` argument matching. Only the
 * `ReceiptSubmitted` event is persisted as an indexed `contract_events` row
 * (mirroring `TaskCreated`'s single-event persistence for `create_task`);
 * `VerifierAttestationConsumed` is verified here but not separately indexed,
 * a deliberately scoped simplification left for milestone 4.8's general event
 * indexer.
 */
export async function reconcileReceiptSubmission(
  store: ReceiptReconciliationStore,
  provider: TaskReceiptProvider,
  transactionPublicId: string,
  actorUserId: string,
  reconciledAt: Date
): Promise<ReceiptReconciliationResult | null> {
  const context = await store.getReceiptReconciliationContext(transactionPublicId, actorUserId);
  if (context === null) return null;
  let receipt: ChainReceipt | null;
  try {
    receipt = await provider.getReceipt(context.chainId, context.transactionHash);
  } catch {
    await store.markTransactionUnknown({ context, failureCode: "RPC_UNAVAILABLE", reconciledAt });
    return { status: "unknown_reconcile", failureCode: "RPC_UNAVAILABLE" };
  }
  if (receipt === null) {
    await store.markTransactionUnknown({ context, failureCode: "RECEIPT_PENDING", reconciledAt });
    return { status: "unknown_reconcile", failureCode: "RECEIPT_PENDING" };
  }
  if (receipt.transactionHash.toLowerCase() !== context.transactionHash.toLowerCase()) {
    await store.markTransactionUnknown({
      context,
      failureCode: "RECEIPT_HASH_MISMATCH",
      reconciledAt
    });
    return { status: "unknown_reconcile", failureCode: "RECEIPT_HASH_MISMATCH" };
  }
  if (receipt.status === "reverted") {
    await store.markTransactionReverted({
      context,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      reconciledAt
    });
    return { status: "reverted", blockNumber: receipt.blockNumber.toString() };
  }
  const matchingReceiptSubmitted: { logIndex: number }[] = [];
  let attestationConsumedMatched = false;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, context.contractAddress)) continue;
    try {
      const event = decodeEventLog({
        abi: [RECEIPT_SUBMITTED_EVENT],
        eventName: "ReceiptSubmitted",
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
        strict: true
      });
      if (
        event.args.taskId === BigInt(context.chainTaskId) &&
        sameAddress(event.args.assignee, context.assigneeWallet) &&
        event.args.evidenceHash.toLowerCase() === context.evidenceHash.toLowerCase() &&
        event.args.commitHash.toLowerCase() === context.commitHash.toLowerCase()
      ) {
        matchingReceiptSubmitted.push({ logIndex: log.logIndex });
      }
      continue;
    } catch {
      // Fall through to try the other known event shape below.
    }
    try {
      const event = decodeEventLog({
        abi: [VERIFIER_ATTESTATION_CONSUMED_EVENT],
        eventName: "VerifierAttestationConsumed",
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
        strict: true
      });
      if (
        event.args.taskId === BigInt(context.chainTaskId) &&
        sameAddress(event.args.verifier, context.verifierAddress) &&
        event.args.attestationDigest.toLowerCase() === context.typedDataDigest.toLowerCase() &&
        event.args.attestationExpiry === BigInt(context.attestationExpiryUnixSeconds)
      ) {
        attestationConsumedMatched = true;
      }
    } catch {
      // Non-registry or unrelated logs are irrelevant to this intent.
    }
  }
  if (matchingReceiptSubmitted.length !== 1 || !attestationConsumedMatched) {
    const failureCode =
      matchingReceiptSubmitted.length === 0 || !attestationConsumedMatched
        ? "RECEIPT_SUBMITTED_EVENT_MISSING"
        : "RECEIPT_SUBMITTED_EVENT_AMBIGUOUS";
    await store.markTransactionUnknown({ context, failureCode, reconciledAt });
    return { status: "unknown_reconcile", failureCode };
  }
  const match = matchingReceiptSubmitted[0];
  if (match === undefined) throw new TypeError("Expected one ReceiptSubmitted event");
  await store.confirmReceiptSubmitted({
    context,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    logIndex: match.logIndex,
    reconciledAt
  });
  return { status: "confirmed", blockNumber: receipt.blockNumber.toString() };
}
