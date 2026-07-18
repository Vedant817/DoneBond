import {
  createDatabase,
  DatabaseServiceError,
  DoneBondRepository,
  DrizzleTaskRepository
} from "@donebond/db";
import { ERROR_CODES, loadChainConfiguration } from "@donebond/shared";
import { privateKeyToAccount } from "viem/accounts";

import { getProjectPolicyServices } from "./auth-runtime.ts";
import { correlationId, errorResponse, HttpError } from "./http.ts";
import { isWellFormedPrivateKey, signReceiptAttestation } from "./receipt-attestation.ts";
import {
  createReceiptHandlers,
  type PassingEvidenceRecord,
  type ReceiptRecord
} from "./receipt-handlers.ts";
import { MonadTaskReceiptProvider } from "./task-receipt-provider.ts";
import type { ChainTransactionRecord, TaskRecord } from "./task-handlers.ts";

let handlers: ReturnType<typeof createReceiptHandlers> | undefined;
let taskRepository: DrizzleTaskRepository | undefined;
let publicRepository: DoneBondRepository | undefined;
let receiptProvider: MonadTaskReceiptProvider | undefined;

export function translateReceiptDatabaseError(
  error: unknown,
  missing: "task" | "transaction"
): never {
  if (!(error instanceof DatabaseServiceError)) throw error;
  switch (error.code) {
    case "DB_IDEMPOTENCY_CONFLICT":
      throw new HttpError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        "The idempotency key was already used for a different request",
        409,
        { cause: error }
      );
    case "DB_PROJECT_ARCHIVED":
      throw new HttpError(
        ERROR_CODES.INVALID_STATE,
        "Archived projects cannot accept receipt transactions",
        409,
        { cause: error }
      );
    case "DB_NOT_FOUND":
      throw new HttpError(
        missing === "task" ? ERROR_CODES.TASK_NOT_FOUND : ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND,
        missing === "task" ? "Task was not found" : "Chain transaction was not found",
        404,
        { cause: error }
      );
    case "DB_CONFLICT":
      throw new HttpError(ERROR_CODES.INVALID_STATE, "The resource state changed", 409, {
        cause: error,
        retryable: true
      });
    case "DB_INVALID_INPUT":
      throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, error.message, 400, {
        cause: error
      });
  }
  throw error;
}

async function databaseCall<T>(
  missing: "task" | "transaction",
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DatabaseServiceError) {
      translateReceiptDatabaseError(error, missing);
    }
    throw error;
  }
}

type TaskView = Awaited<ReturnType<DrizzleTaskRepository["getTask"]>>;
type ChainView = Awaited<ReturnType<DrizzleTaskRepository["recordWalletOutcome"]>>;

function taskRecord(view: TaskView): TaskRecord {
  if (view === null) throw new TypeError("Task view was null");
  return {
    publicId: view.publicId,
    projectPublicId: view.projectPublicId,
    chainId: view.chainId,
    contractAddress: view.contractAddress,
    chainTaskId: view.chainTaskId === null ? null : BigInt(view.chainTaskId),
    title: view.title,
    description: view.description,
    repositoryUrl: view.repositoryUrl,
    targetBranch: view.targetBranch,
    baseCommit: view.baseCommit,
    acceptanceCriteria: view.acceptanceCriteria,
    taskHash: view.taskHash,
    policyHash: view.policyHash,
    creatorWallet: view.creatorWallet,
    assigneeWallet: view.assigneeWallet,
    rewardWei: view.rewardWei,
    deadline: view.deadline,
    offchainStatus: view.offchainStatus,
    chainStatus: view.chainStatus,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    canonicalTask: view.canonicalTask
  };
}

function transactionView(view: ChainView): ChainTransactionRecord {
  return {
    publicId: view.publicId,
    taskPublicId: view.taskPublicId,
    intentType: view.intentType,
    idempotencyKey: view.idempotencyKey,
    chainId: view.chainId,
    fromAddress: view.fromAddress,
    toAddress: view.toAddress,
    transactionHash: view.transactionHash,
    nonce: view.nonce === null ? null : BigInt(view.nonce),
    status: view.status,
    blockNumber: view.blockNumber === null ? null : BigInt(view.blockNumber),
    failureCode: view.failureCode,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  };
}

function passingEvidence(
  view: Awaited<ReturnType<DrizzleTaskRepository["getLatestPassingEvidence"]>>
): PassingEvidenceRecord | null {
  return view;
}

function receiptRecord(
  view: Awaited<ReturnType<DoneBondRepository["getPublicReceipt"]>>
): ReceiptRecord | null {
  return view;
}

function initialize(): ReturnType<typeof createReceiptHandlers> {
  if (handlers !== undefined) return handlers;
  const baseServices = getProjectPolicyServices();
  const chainConfig = loadChainConfiguration(process.env);
  const chainId = chainConfig.chainId;
  const contractAddress = chainConfig.contractAddress;
  if (contractAddress === undefined) {
    throw new TypeError(
      "NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS is required for receipt submission and reconciliation"
    );
  }
  if (chainConfig.rpcUrl === undefined) {
    throw new TypeError("MONAD_RPC_URL is required for on-chain receipt reconciliation");
  }
  const verifierPrivateKey = process.env.VERIFIER_PRIVATE_KEY;
  if (verifierPrivateKey === undefined || verifierPrivateKey === "") {
    throw new TypeError("VERIFIER_PRIVATE_KEY is required to attest passing evidence receipts");
  }
  if (!isWellFormedPrivateKey(verifierPrivateKey)) {
    throw new TypeError(
      "VERIFIER_PRIVATE_KEY must be a 0x-prefixed 32-byte hexadecimal value, never logged"
    );
  }
  // Deriving the address only reads the key locally; it is never logged, returned in a
  // response, or persisted anywhere beyond this in-memory closure over the raw value.
  const verifierAddress = privateKeyToAccount(verifierPrivateKey).address.toLowerCase();

  const database = createDatabase();
  taskRepository = new DrizzleTaskRepository(database.db);
  publicRepository = new DoneBondRepository(database.db);
  receiptProvider = new MonadTaskReceiptProvider(chainId, chainConfig.rpcUrl);

  handlers = createReceiptHandlers({
    applicationOrigin: baseServices.applicationOrigin,
    resourceSecret: baseServices.resourceSecret,
    chain: { chainId, contractAddress, explorerUrl: chainConfig.explorerUrl },
    auth: baseServices.auth,
    receiptProvider,
    verifierAddress,
    attestationTtlSeconds: 60 * 60,
    signAttestation: (input) => signReceiptAttestation(verifierPrivateKey, input),
    rateLimiter: baseServices.rateLimiter,
    store: {
      async getTask(taskPublicId, actorUserId) {
        const view = await databaseCall("task", () =>
          taskRepository!.getTask(taskPublicId, actorUserId)
        );
        return view === null ? null : taskRecord(view);
      },
      async getLatestPassingEvidence(taskPublicId) {
        return passingEvidence(
          await databaseCall("task", () => taskRepository!.getLatestPassingEvidence(taskPublicId))
        );
      },
      async createReceiptChainIntent(input) {
        const result = await databaseCall("task", () =>
          taskRepository!.createReceiptChainIntent(input)
        );
        return {
          task: taskRecord(result.task),
          transaction: transactionView(result.transaction),
          replayed: result.replayed
        };
      },
      async recordWalletOutcome(input) {
        return transactionView(
          await databaseCall("transaction", () => taskRepository!.recordWalletOutcome(input))
        );
      },
      async getReceiptReconciliationContext(transactionPublicId, actorUserId) {
        return databaseCall("transaction", () =>
          taskRepository!.getReceiptChainReconciliationContext(transactionPublicId, actorUserId)
        );
      },
      async markTransactionUnknown(input) {
        await databaseCall("transaction", () =>
          taskRepository!.markTransactionUnknown({
            transactionPublicId: input.context.transactionPublicId,
            expectedStatus: input.context.status,
            failureCode: input.failureCode,
            reconciledAt: input.reconciledAt
          })
        );
      },
      async markTransactionReverted(input) {
        await databaseCall("transaction", () =>
          taskRepository!.markTransactionReverted({
            transactionPublicId: input.context.transactionPublicId,
            expectedStatus: input.context.status,
            blockHash: input.blockHash,
            blockNumber: input.blockNumber,
            reconciledAt: input.reconciledAt
          })
        );
      },
      async confirmReceiptSubmitted(input) {
        await databaseCall("transaction", () =>
          taskRepository!.confirmReceiptSubmittedFromReconciliation({
            transactionPublicId: input.context.transactionPublicId,
            expectedStatus: input.context.status,
            blockHash: input.blockHash,
            blockNumber: input.blockNumber,
            logIndex: input.logIndex,
            reconciledAt: input.reconciledAt
          })
        );
      },
      async getPublicReceipt(taskPublicId) {
        return receiptRecord(
          await databaseCall("task", () => publicRepository!.getPublicReceipt(taskPublicId))
        );
      },
      async getReceiptForMember(taskPublicId, actorUserId) {
        return receiptRecord(
          await databaseCall("task", () =>
            publicRepository!.getReceiptForMember(taskPublicId, actorUserId)
          )
        );
      }
    }
  });
  return handlers;
}

export type ReceiptAction = keyof ReturnType<typeof createReceiptHandlers>;

export async function dispatchReceipt(
  action: ReceiptAction,
  request: Request,
  resourcePublicId?: string
): Promise<Response> {
  try {
    const selected = initialize();
    if (resourcePublicId === undefined) throw new TypeError("Resource ID is required");
    return selected[action](request, resourcePublicId);
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}

/** Validates the verifier configuration at startup without serving a request. */
export function validateReceiptRuntimeAtStartup(): void {
  initialize();
}
