import {
  createDatabase,
  DrizzleTaskRepository,
  type PendingReconciliationTransaction
} from "@donebond/db";
import { loadChainConfiguration } from "@donebond/shared";

import { reconcileReceiptSubmission } from "./receipt-reconciliation.ts";
import { MonadTaskReceiptProvider } from "./task-receipt-provider.ts";
import { reconcileTaskCreation } from "./task-reconciliation.ts";

export interface ReconciliationJobResult {
  readonly scanned: number;
  readonly confirmed: number;
  readonly reverted: number;
  readonly pending: number;
  readonly failed: number;
}

interface ReconciliationJobDependencies {
  listPending(limit: number): Promise<readonly PendingReconciliationTransaction[]>;
  reconcileTask(item: PendingReconciliationTransaction, at: Date): Promise<string | null>;
  reconcileReceipt(item: PendingReconciliationTransaction, at: Date): Promise<string | null>;
  now(): Date;
}

/**
 * Processes a bounded snapshot. Each transaction is isolated so one malformed
 * or concurrently-updated row cannot prevent later recoverable work from being
 * retried on this invocation.
 */
export async function runPendingReconciliation(
  dependencies: ReconciliationJobDependencies,
  limit = 50
): Promise<ReconciliationJobResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Reconciliation limit must be an integer between 1 and 100");
  }
  const items = await dependencies.listPending(limit);
  const counts = { scanned: items.length, confirmed: 0, reverted: 0, pending: 0, failed: 0 };
  for (const item of items) {
    try {
      const status =
        item.intentType === "create_task"
          ? await dependencies.reconcileTask(item, dependencies.now())
          : await dependencies.reconcileReceipt(item, dependencies.now());
      if (status === "confirmed") counts.confirmed += 1;
      else if (status === "reverted") counts.reverted += 1;
      else counts.pending += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}

export async function runConfiguredReconciliationJob(): Promise<ReconciliationJobResult> {
  const chain = loadChainConfiguration(process.env);
  if (!chain.rpcUrl) throw new TypeError("MONAD_RPC_URL is required for reconciliation");
  if (!chain.contractAddress) {
    throw new TypeError("NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS is required for reconciliation");
  }
  const database = createDatabase();
  const repository = new DrizzleTaskRepository(database.db);
  const provider = new MonadTaskReceiptProvider(chain.chainId, chain.rpcUrl);

  const commonStore = {
    async markTransactionUnknown(input: {
      readonly context: {
        readonly transactionPublicId: string;
        readonly status: "submitted" | "unknown_reconcile";
      };
      readonly failureCode: string;
      readonly reconciledAt: Date;
    }) {
      await repository.markTransactionUnknown({
        transactionPublicId: input.context.transactionPublicId,
        expectedStatus: input.context.status,
        failureCode: input.failureCode,
        reconciledAt: input.reconciledAt
      });
    },
    async markTransactionReverted(input: {
      readonly context: {
        readonly transactionPublicId: string;
        readonly status: "submitted" | "unknown_reconcile";
      };
      readonly blockHash: string;
      readonly blockNumber: bigint;
      readonly reconciledAt: Date;
    }) {
      await repository.markTransactionReverted({
        transactionPublicId: input.context.transactionPublicId,
        expectedStatus: input.context.status,
        blockHash: input.blockHash,
        blockNumber: input.blockNumber,
        reconciledAt: input.reconciledAt
      });
    }
  };

  try {
    return await runPendingReconciliation({
      now: () => new Date(),
      listPending: (limit) => repository.listPendingReconciliationTransactions(limit),
      async reconcileTask(item, at) {
        const result = await reconcileTaskCreation(
          {
            getReconciliationContext: (transactionPublicId, actorUserId) =>
              repository.getTaskChainReconciliationContext(transactionPublicId, actorUserId),
            ...commonStore,
            async confirmTaskCreated(input) {
              await repository.confirmTaskCreatedFromReconciliation({
                transactionPublicId: input.context.transactionPublicId,
                expectedStatus: input.context.status,
                chainTaskId: input.chainTaskId,
                blockHash: input.blockHash,
                blockNumber: input.blockNumber,
                logIndex: input.logIndex,
                reconciledAt: input.reconciledAt
              });
            }
          },
          provider,
          item.transactionPublicId,
          item.actorUserId,
          at
        );
        return result?.status ?? null;
      },
      async reconcileReceipt(item, at) {
        const result = await reconcileReceiptSubmission(
          {
            getReceiptReconciliationContext: (transactionPublicId, actorUserId) =>
              repository.getReceiptChainReconciliationContext(transactionPublicId, actorUserId),
            ...commonStore,
            async confirmReceiptSubmitted(input) {
              await repository.confirmReceiptSubmittedFromReconciliation({
                transactionPublicId: input.context.transactionPublicId,
                expectedStatus: input.context.status,
                blockHash: input.blockHash,
                blockNumber: input.blockNumber,
                logIndex: input.logIndex,
                reconciledAt: input.reconciledAt
              });
            }
          },
          provider,
          item.transactionPublicId,
          item.actorUserId,
          at
        );
        return result?.status ?? null;
      }
    });
  } finally {
    await database.close();
  }
}
