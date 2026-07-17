import {
  createDatabase,
  DatabaseServiceError,
  DrizzleTaskRepository,
  type TaskChainReconciliationContext
} from "@donebond/db";
import { ERROR_CODES, loadChainConfiguration } from "@donebond/shared";

import { getProjectPolicyServices } from "./auth-runtime.ts";
import { correlationId, errorResponse, HttpError } from "./http.ts";
import { MonadTaskReceiptProvider } from "./task-receipt-provider.ts";
import {
  createTaskHandlers,
  type ChainTransactionRecord,
  type TaskRecord,
  type TaskStore
} from "./task-handlers.ts";
import type { ReconciliationContext } from "./task-reconciliation.ts";

let handlers: ReturnType<typeof createTaskHandlers> | undefined;
let taskRepository: DrizzleTaskRepository | undefined;
let receiptProvider: MonadTaskReceiptProvider | undefined;

function translateTaskDatabaseError(error: unknown, missing: "task" | "transaction"): never {
  if (!(error instanceof DatabaseServiceError)) throw error;
  switch (error.code) {
    case "DB_IDEMPOTENCY_CONFLICT":
      throw new HttpError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        "The idempotency key was already used for a different request",
        409,
        { cause: error }
      );
    case "DB_TASK_HASH_CONFLICT":
      throw new HttpError(
        ERROR_CODES.VALIDATION_INVALID_INPUT,
        "A task hash already identifies a project task",
        409,
        { cause: error }
      );
    case "DB_PROJECT_ARCHIVED":
      throw new HttpError(
        ERROR_CODES.INVALID_STATE,
        "Archived projects cannot accept tasks or chain transactions",
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
      translateTaskDatabaseError(error, missing);
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

function reconciliationContext(view: TaskChainReconciliationContext): ReconciliationContext {
  return {
    transactionPublicId: view.transactionPublicId,
    transactionHash: view.transactionHash,
    status: view.status,
    chainId: view.chainId,
    contractAddress: view.contractAddress,
    taskPublicId: view.taskPublicId,
    taskHash: view.taskHash,
    policyHash: view.policyHash,
    creatorWallet: view.creatorWallet,
    assigneeWallet: view.assigneeWallet,
    rewardWei: view.rewardWei,
    deadlineUnixSeconds: view.deadlineUnixSeconds
  };
}

function initialize(): ReturnType<typeof createTaskHandlers> {
  if (handlers !== undefined) return handlers;
  const baseServices = getProjectPolicyServices();
  const chainConfig = loadChainConfiguration(process.env);
  const chainId = chainConfig.chainId;
  const contractAddress = chainConfig.contractAddress;
  if (contractAddress === undefined) {
    throw new TypeError(
      "NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS is required for task creation and chain reconciliation"
    );
  }
  if (chainConfig.rpcUrl === undefined) {
    throw new TypeError("MONAD_RPC_URL is required for on-chain task reconciliation");
  }

  const database = createDatabase();
  taskRepository = new DrizzleTaskRepository(database.db);
  receiptProvider = new MonadTaskReceiptProvider(chainId, chainConfig.rpcUrl);

  const store: TaskStore = {
    async getCreationContext(projectPublicId, actorUserId) {
      return databaseCall("task", () =>
        taskRepository!.getCreationContext(projectPublicId, actorUserId)
      );
    },
    async createTask(input) {
      return taskRecord(
        await databaseCall("task", () =>
          taskRepository!.createTask({
            actorUserId: input.actorUserId,
            publicId: input.publicId,
            projectPublicId: input.projectPublicId,
            policyPublicId: input.policyPublicId,
            canonicalTask: input.canonicalTask,
            taskHash: input.taskHash,
            repositoryUrl: input.repositoryUrl,
            creatorWallet: input.creatorWallet,
            contractAddress: input.contractAddress,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            requestedAt: input.requestedAt
          })
        )
      );
    },
    async listTasks(projectPublicId, actorUserId, page) {
      const result = await databaseCall("task", () =>
        taskRepository!.listTasks(projectPublicId, actorUserId, {
          limit: page.limit,
          ...(page.cursor === null ? {} : { cursor: page.cursor })
        })
      );
      return {
        items: result.items.map(taskRecord),
        nextCursor: result.nextCursor
      };
    },
    async getTask(taskPublicId, actorUserId) {
      const view = await databaseCall("task", () =>
        taskRepository!.getTask(taskPublicId, actorUserId)
      );
      return view === null ? null : taskRecord(view);
    },
    async createChainIntent(input) {
      const result = await databaseCall("task", () =>
        taskRepository!.createChainIntent({
          actorUserId: input.actorUserId,
          taskPublicId: input.taskPublicId,
          publicId: input.publicId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          requestedAt: input.requestedAt
        })
      );
      return {
        task: taskRecord(result.task),
        transaction: transactionView(result.transaction),
        replayed: result.replayed
      };
    },
    async recordWalletOutcome(input) {
      return transactionView(
        await databaseCall("transaction", () =>
          taskRepository!.recordWalletOutcome({
            taskPublicId: input.taskPublicId,
            transactionPublicId: input.transactionPublicId,
            actorUserId: input.actorUserId,
            status: input.status,
            transactionHash: input.transactionHash,
            nonce: input.nonce,
            failureCode: input.failureCode,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            requestedAt: input.requestedAt
          })
        )
      );
    },
    async recordReplacement(input) {
      const result = await databaseCall("transaction", () =>
        taskRepository!.recordReplacement({
          actorUserId: input.actorUserId,
          priorTransactionPublicId: input.replacedTransactionPublicId,
          publicId: input.publicId,
          transactionHash: input.transactionHash,
          nonce: input.nonce,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          requestedAt: input.requestedAt
        })
      );
      return transactionView(result.replacement);
    },
    async getReconciliationContext(transactionPublicId, actorUserId) {
      const context = await databaseCall("transaction", () =>
        taskRepository!.getTaskChainReconciliationContext(transactionPublicId, actorUserId)
      );
      return context === null ? null : reconciliationContext(context);
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
    async confirmTaskCreated(input) {
      await databaseCall("transaction", () =>
        taskRepository!.confirmTaskCreatedFromReconciliation({
          transactionPublicId: input.context.transactionPublicId,
          expectedStatus: input.context.status,
          chainTaskId: input.chainTaskId,
          blockHash: input.blockHash,
          blockNumber: input.blockNumber,
          logIndex: input.logIndex,
          reconciledAt: input.reconciledAt
        })
      );
    }
  };

  handlers = createTaskHandlers({
    applicationOrigin: baseServices.applicationOrigin,
    resourceSecret: baseServices.resourceSecret,
    chain: { chainId, contractAddress },
    auth: baseServices.auth,
    accessStore: baseServices.accessStore,
    store,
    receiptProvider,
    rateLimiter: baseServices.rateLimiter
  });
  return handlers;
}

export type TaskAction = keyof ReturnType<typeof createTaskHandlers>;

export async function dispatchTask(
  action: TaskAction,
  request: Request,
  resourcePublicId?: string
): Promise<Response> {
  try {
    const selected = initialize();
    switch (action) {
      case "createTask":
      case "listTasks":
        if (resourcePublicId === undefined) throw new TypeError("Project ID is required");
        return selected[action](request, resourcePublicId);
      case "getTask":
        if (resourcePublicId === undefined) throw new TypeError("Task ID is required");
        return selected[action](request, resourcePublicId);
      case "createChainIntent":
      case "recordChainTransaction":
        if (resourcePublicId === undefined) throw new TypeError("Task ID is required");
        return selected[action](request, resourcePublicId);
      case "reconcileTransaction":
        if (resourcePublicId === undefined) throw new TypeError("Transaction ID is required");
        return selected[action](request, resourcePublicId);
    }
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}
