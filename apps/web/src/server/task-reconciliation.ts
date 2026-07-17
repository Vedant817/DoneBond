import { getAddress, decodeEventLog } from "viem";

const TASK_CREATED_EVENT = {
  type: "event",
  name: "TaskCreated",
  anonymous: false,
  inputs: [
    { name: "taskId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "assignee", type: "address", indexed: true },
    { name: "taskHash", type: "bytes32", indexed: false },
    { name: "policyHash", type: "bytes32", indexed: false },
    { name: "reward", type: "uint256", indexed: false },
    { name: "deadline", type: "uint64", indexed: false }
  ]
} as const;

export interface ReconciliationContext {
  readonly transactionPublicId: string;
  readonly transactionHash: `0x${string}`;
  readonly status: "submitted" | "unknown_reconcile";
  readonly chainId: number;
  readonly contractAddress: string;
  readonly taskPublicId: string;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly creatorWallet: string;
  readonly assigneeWallet: string;
  readonly rewardWei: string;
  readonly deadlineUnixSeconds: string;
}

export interface ChainReceipt {
  readonly status: "success" | "reverted";
  readonly transactionHash: `0x${string}`;
  readonly blockHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly logs: readonly {
    readonly address: string;
    readonly logIndex: number;
    readonly data: `0x${string}`;
    readonly topics: readonly `0x${string}`[];
  }[];
}

export interface TaskReconciliationStore {
  getReconciliationContext(
    transactionPublicId: string,
    actorUserId: string
  ): Promise<ReconciliationContext | null>;
  markTransactionUnknown(input: {
    readonly context: ReconciliationContext;
    readonly failureCode: string;
    readonly reconciledAt: Date;
  }): Promise<void>;
  markTransactionReverted(input: {
    readonly context: ReconciliationContext;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly reconciledAt: Date;
  }): Promise<void>;
  confirmTaskCreated(input: {
    readonly context: ReconciliationContext;
    readonly chainTaskId: bigint;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly logIndex: number;
    readonly decodedEvent: Readonly<Record<string, string>>;
    readonly reconciledAt: Date;
  }): Promise<void>;
}

export interface TaskReceiptProvider {
  getReceipt(chainId: number, transactionHash: `0x${string}`): Promise<ChainReceipt | null>;
}

export type ReconciliationResult =
  | { readonly status: "unknown_reconcile"; readonly failureCode: string }
  | { readonly status: "reverted"; readonly blockNumber: string }
  | { readonly status: "confirmed"; readonly chainTaskId: string; readonly blockNumber: string };

function sameAddress(left: string, right: string): boolean {
  return getAddress(left).toLowerCase() === getAddress(right).toLowerCase();
}

function deadline(context: ReconciliationContext): bigint {
  return BigInt(context.deadlineUnixSeconds);
}

export async function reconcileTaskCreation(
  store: TaskReconciliationStore,
  provider: TaskReceiptProvider,
  transactionPublicId: string,
  actorUserId: string,
  reconciledAt: Date
): Promise<ReconciliationResult | null> {
  const context = await store.getReconciliationContext(transactionPublicId, actorUserId);
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
  const matching = [] as {
    chainTaskId: bigint;
    logIndex: number;
    decoded: Readonly<Record<string, string>>;
  }[];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, context.contractAddress)) continue;
    try {
      const event = decodeEventLog({
        abi: [TASK_CREATED_EVENT],
        eventName: "TaskCreated",
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
        strict: true
      });
      const args = event.args;
      if (
        !sameAddress(args.creator, context.creatorWallet) ||
        !sameAddress(args.assignee, context.assigneeWallet) ||
        args.taskHash.toLowerCase() !== context.taskHash.toLowerCase() ||
        args.policyHash.toLowerCase() !== context.policyHash.toLowerCase() ||
        args.reward !== BigInt(context.rewardWei) ||
        args.deadline !== deadline(context)
      )
        continue;
      matching.push({
        chainTaskId: args.taskId,
        logIndex: log.logIndex,
        decoded: {
          taskId: args.taskId.toString(),
          creator: args.creator.toLowerCase(),
          assignee: args.assignee.toLowerCase(),
          taskHash: args.taskHash.toLowerCase(),
          policyHash: args.policyHash.toLowerCase(),
          reward: args.reward.toString(),
          deadline: args.deadline.toString()
        }
      });
    } catch {
      // Non-TaskCreated logs from the registry are irrelevant to this intent.
    }
  }
  if (matching.length !== 1) {
    await store.markTransactionUnknown({
      context,
      failureCode:
        matching.length === 0 ? "TASK_CREATED_EVENT_MISSING" : "TASK_CREATED_EVENT_AMBIGUOUS",
      reconciledAt
    });
    return {
      status: "unknown_reconcile",
      failureCode:
        matching.length === 0 ? "TASK_CREATED_EVENT_MISSING" : "TASK_CREATED_EVENT_AMBIGUOUS"
    };
  }
  const event = matching[0];
  if (event === undefined) throw new TypeError("Expected one TaskCreated event");
  await store.confirmTaskCreated({
    context,
    chainTaskId: event.chainTaskId,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    logIndex: event.logIndex,
    decodedEvent: event.decoded,
    reconciledAt
  });
  return {
    status: "confirmed",
    chainTaskId: event.chainTaskId.toString(),
    blockNumber: receipt.blockNumber.toString()
  };
}
