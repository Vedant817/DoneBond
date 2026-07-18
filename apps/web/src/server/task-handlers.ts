import { canonicalKeccak256 } from "@donebond/evidence";
import {
  CanonicalTaskV1Schema,
  ChainTransactionSchema,
  ERROR_CODES,
  PublicIdentifierSchema,
  RepositoryIdentitySchema,
  TaskSchema,
  type CanonicalTaskV1
} from "@donebond/shared";
import { encodeFunctionData } from "viem";

import { deriveOpaquePublicId } from "./cli-token.ts";
import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import type { ProjectWriteRateLimiter } from "./project-policy-handlers.ts";
import {
  authorizeProjectSession,
  requireProjectAccess,
  type ProjectAccessStore
} from "./project-authorization.ts";
import { parseCreateTaskInput } from "./task-input.ts";
import type { ProjectMutationAuth } from "./project-policy-handlers.ts";
import {
  reconcileTaskCreation,
  type ReconciliationContext,
  type TaskReceiptProvider
} from "./task-reconciliation.ts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const OPAQUE_PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;
const CREATE_TASK_ABI = [
  {
    type: "function",
    name: "createTask",
    stateMutability: "payable",
    inputs: [
      { name: "taskHash", type: "bytes32" },
      { name: "policyHash", type: "bytes32" },
      { name: "assignee", type: "address" },
      { name: "deadline", type: "uint64" }
    ],
    outputs: [{ name: "taskId", type: "uint256" }]
  }
] as const;

export interface TaskCreationContext {
  readonly projectPublicId: string;
  readonly repositoryUrl: string;
  readonly status: "active" | "archived";
  readonly activePolicyPublicId: string;
  readonly activePolicyHash: string;
}

export interface TaskRecord {
  readonly publicId: string;
  readonly projectPublicId: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly chainTaskId: bigint | string | null;
  readonly title: string;
  readonly description: string;
  readonly repositoryUrl: string;
  readonly targetBranch: string;
  readonly baseCommit: string | null;
  readonly acceptanceCriteria: unknown;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly creatorWallet: string;
  readonly assigneeWallet: string;
  readonly rewardWei: bigint | string;
  readonly deadline: Date | string | null;
  readonly offchainStatus: string;
  readonly chainStatus: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
  readonly canonicalTask: CanonicalTaskV1;
}

export interface TaskListCursor {
  readonly createdAt: Date;
  readonly publicId: string;
}

export interface ChainTransactionRecord {
  readonly publicId: string;
  readonly taskPublicId: string;
  readonly intentType:
    "create_task" | "submit_receipt" | "approve" | "reject" | "cancel" | "withdraw";
  readonly idempotencyKey: string;
  readonly chainId: number;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly transactionHash: string | null;
  readonly nonce: bigint | number | null;
  readonly status:
    | "prepared"
    | "wallet_requested"
    | "submitted"
    | "confirmed"
    | "rejected_by_user"
    | "replaced"
    | "reverted"
    | "unknown_reconcile";
  readonly blockNumber: bigint | string | null;
  readonly failureCode: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface TaskStore {
  getCreationContext(
    projectPublicId: string,
    actorUserId: string
  ): Promise<TaskCreationContext | null>;
  createTask(input: {
    readonly publicId: string;
    readonly projectPublicId: string;
    readonly policyPublicId: string;
    readonly actorUserId: string;
    readonly canonicalTask: CanonicalTaskV1;
    readonly taskHash: string;
    readonly repositoryUrl: string;
    readonly creatorWallet: string;
    readonly contractAddress: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<TaskRecord>;
  listTasks(
    projectPublicId: string,
    actorUserId: string,
    page: { readonly cursor: TaskListCursor | null; readonly limit: number }
  ): Promise<{ readonly items: readonly TaskRecord[]; readonly nextCursor: TaskListCursor | null }>;
  getTask(taskPublicId: string, actorUserId: string): Promise<TaskRecord | null>;
  createChainIntent(input: {
    readonly publicId: string;
    readonly taskPublicId: string;
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<{
    readonly task: TaskRecord;
    readonly transaction: ChainTransactionRecord;
    readonly replayed: boolean;
  }>;
  recordWalletOutcome(input: {
    readonly taskPublicId: string;
    readonly transactionPublicId: string;
    readonly actorUserId: string;
    readonly status: "wallet_requested" | "submitted" | "rejected_by_user";
    readonly transactionHash: string | null;
    readonly nonce: bigint | null;
    readonly failureCode: string | null;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<ChainTransactionRecord>;
  recordReplacement(input: {
    readonly publicId: string;
    readonly taskPublicId: string;
    readonly replacedTransactionPublicId: string;
    readonly actorUserId: string;
    readonly transactionHash: string;
    readonly nonce: bigint;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<ChainTransactionRecord>;
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

export interface TaskHandlerDependencies {
  readonly applicationOrigin: string;
  readonly resourceSecret: string;
  readonly chain: { readonly chainId: 143 | 10_143; readonly contractAddress: string };
  readonly auth: ProjectMutationAuth;
  readonly accessStore: ProjectAccessStore;
  readonly store: TaskStore;
  readonly receiptProvider: TaskReceiptProvider;
  readonly rateLimiter: ProjectWriteRateLimiter;
  readonly now?: () => Date;
}

function cookie(request: Request): string | null {
  return request.headers.get("cookie");
}

function requireNoQuery(request: Request): void {
  if (new URL(request.url).search !== "") {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "This endpoint does not accept query parameters",
      400
    );
  }
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (value === null || !IDEMPOTENCY_KEY.test(value)) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "A valid Idempotency-Key header is required",
      400
    );
  }
  return value;
}

function publicId(value: string, kind: "project" | "task" | "transaction"): string {
  try {
    const parsed = PublicIdentifierSchema.parse(value);
    if (!OPAQUE_PUBLIC_ID.test(parsed)) throw new TypeError("Expected an opaque public ID");
    return parsed;
  } catch (cause) {
    throw new HttpError(
      kind === "project"
        ? ERROR_CODES.PROJECT_NOT_FOUND
        : kind === "task"
          ? ERROR_CODES.TASK_NOT_FOUND
          : ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND,
      kind === "project"
        ? "Project was not found"
        : kind === "task"
          ? "Task was not found"
          : "Transaction was not found",
      404,
      { cause }
    );
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function taskDto(task: TaskRecord) {
  return TaskSchema.parse({
    schemaVersion: 1,
    publicId: task.publicId,
    projectPublicId: task.projectPublicId,
    chainId: task.chainId,
    chainTaskId: task.chainTaskId === null ? null : task.chainTaskId.toString(),
    title: task.title,
    description: task.description,
    repositoryUrl: task.repositoryUrl,
    targetBranch: task.targetBranch,
    baseCommit: task.baseCommit,
    acceptanceCriteria: task.acceptanceCriteria,
    taskHash: task.taskHash,
    policyHash: task.policyHash,
    creatorWallet: task.creatorWallet,
    assigneeWallet: task.assigneeWallet,
    rewardWei: task.rewardWei.toString(),
    deadline: task.deadline === null ? null : iso(task.deadline),
    offchainStatus: task.offchainStatus,
    chainStatus: task.chainStatus,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt)
  });
}

function transactionDto(transaction: ChainTransactionRecord) {
  const parsed = ChainTransactionSchema.parse({
    schemaVersion: 1,
    ...transaction,
    nonce: transaction.nonce === null ? null : transaction.nonce.toString(),
    blockNumber: transaction.blockNumber === null ? null : transaction.blockNumber.toString(),
    createdAt: iso(transaction.createdAt),
    updatedAt: iso(transaction.updatedAt)
  });
  const { idempotencyKey: _idempotencyKey, ...safe } = parsed;
  return safe;
}

function repositoryIdentity(repositoryUrl: string): string {
  const url = new URL(repositoryUrl);
  return RepositoryIdentitySchema.parse(`${url.hostname}${url.pathname}`);
}

function parsePage(request: Request): { cursor: TaskListCursor | null; limit: number } {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== "cursor" && key !== "limit")
      throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Unknown pagination field", 400);
  }
  if (url.searchParams.getAll("cursor").length > 1 || url.searchParams.getAll("limit").length > 1) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Pagination fields may appear only once",
      400
    );
  }
  const limitText = url.searchParams.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitText))
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "limit must be from 1 to 100", 400);
  const supplied = url.searchParams.get("cursor");
  if (supplied === null) return { cursor: null, limit: Number(limitText) };
  try {
    const decoded = JSON.parse(Buffer.from(supplied, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(decoded).length !== 2 ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.publicId !== "string"
    )
      throw new TypeError("Malformed cursor");
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new TypeError("Malformed cursor date");
    return {
      cursor: { createdAt, publicId: publicId(decoded.publicId, "task") },
      limit: Number(limitText)
    };
  } catch (cause) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "cursor is invalid", 400, { cause });
  }
}

function encodeCursor(cursor: TaskListCursor | null): string | null {
  return cursor === null
    ? null
    : Buffer.from(
        JSON.stringify({ createdAt: cursor.createdAt.toISOString(), publicId: cursor.publicId }),
        "utf8"
      ).toString("base64url");
}

function parseOutcome(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Expected a JSON object", 400);
  const input = value as Record<string, unknown>;
  const allowed = new Set(["transactionId", "status", "transactionHash", "nonce"]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Request contains an unknown field",
      400
    );
  const status = input.status;
  if (
    status !== "wallet_requested" &&
    status !== "submitted" &&
    status !== "rejected_by_user" &&
    status !== "replacement_submitted"
  )
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Wallet outcome status is invalid",
      400
    );
  const transactionId = publicId(String(input.transactionId ?? ""), "transaction");
  const hash = input.transactionHash;
  const nonce = input.nonce;
  if (status === "submitted" || status === "replacement_submitted") {
    if (
      typeof hash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/u.test(hash) ||
      typeof nonce !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(nonce)
    )
      throw new HttpError(
        ERROR_CODES.VALIDATION_INVALID_INPUT,
        "Submitted transactions require a hash and safe nonce",
        400
      );
  } else if ((hash !== null && hash !== undefined) || (nonce !== null && nonce !== undefined)) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "Only submitted outcomes may include transaction fields",
      400
    );
  }
  if (status === "replacement_submitted") {
    if (typeof hash !== "string" || typeof nonce !== "string") {
      throw new TypeError("Validated replacement fields are missing");
    }
    return {
      transactionPublicId: transactionId,
      status,
      transactionHash: hash.toLowerCase(),
      nonce: BigInt(nonce),
      failureCode: null
    } as const;
  }
  return {
    transactionPublicId: transactionId,
    status,
    transactionHash: status === "submitted" ? (hash as string).toLowerCase() : null,
    nonce: status === "submitted" ? BigInt(nonce as string) : null,
    failureCode: status === "rejected_by_user" ? "WALLET_REJECTED" : null
  } as const;
}

export function createTaskHandlers(dependencies: TaskHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());
  async function mutation(
    request: Request,
    operation: "task_create" | "task_chain_intent" | "task_chain_register",
    at: Date
  ) {
    requireTrustedOrigin(request, dependencies.applicationOrigin);
    if (!(await dependencies.rateLimiter.consume(operation, null, at)))
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many task requests", 429, {
        retryable: true
      });
    return dependencies.auth.requireCsrf(cookie(request), request.headers.get("x-csrf-token"));
  }
  async function subjectLimit(
    operation: "task_create" | "task_chain_intent" | "task_chain_register",
    subject: string,
    at: Date
  ) {
    if (!(await dependencies.rateLimiter.consume(operation, subject, at)))
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many task requests", 429, {
        retryable: true
      });
  }
  return {
    createTask: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "task_create", at);
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await subjectLimit("task_create", `${session.userId}:${access.projectPublicId}`, at);
        const parsed = parseCreateTaskInput(await readBoundedJson(request, 32_768), at);
        if (parsed.chainId !== dependencies.chain.chainId || session.chainId !== parsed.chainId)
          throw new HttpError(
            ERROR_CODES.CHAIN_UNSUPPORTED,
            "Connect the creator wallet on the configured Monad network",
            400
          );
        const context = await dependencies.store.getCreationContext(
          access.projectPublicId,
          session.userId
        );
        if (context === null)
          throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
        if (context.projectPublicId !== access.projectPublicId) {
          throw new TypeError("Task creation context crossed the authorized project boundary");
        }
        const canonicalTask = CanonicalTaskV1Schema.parse({
          kind: "donebond.task",
          schemaVersion: 1,
          projectPublicId: context.projectPublicId,
          repositoryIdentity: repositoryIdentity(context.repositoryUrl),
          targetBranch: parsed.targetBranch,
          baseCommit: parsed.baseCommit,
          title: parsed.title,
          description: parsed.description,
          acceptanceCriteria: parsed.acceptanceCriteria,
          assigneeWallet: parsed.assigneeWallet,
          deadlineUnixSeconds: parsed.deadlineUnixSeconds,
          rewardWei: parsed.rewardWei,
          policyHash: context.activePolicyHash
        });
        const taskHash = canonicalKeccak256(canonicalTask);
        const key = idempotencyKey(request);
        const task = await dependencies.store.createTask({
          publicId: deriveOpaquePublicId(dependencies.resourceSecret, "task", [
            session.userId,
            access.projectPublicId,
            key
          ]),
          projectPublicId: access.projectPublicId,
          policyPublicId: context.activePolicyPublicId,
          actorUserId: session.userId,
          canonicalTask,
          taskHash,
          repositoryUrl: context.repositoryUrl,
          creatorWallet: session.address,
          contractAddress: dependencies.chain.contractAddress,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.task-create-request",
            projectPublicId: access.projectPublicId,
            chainId: parsed.chainId,
            contractAddress: dependencies.chain.contractAddress,
            input: {
              title: parsed.title,
              description: parsed.description,
              targetBranch: parsed.targetBranch,
              baseCommit: parsed.baseCommit,
              acceptanceCriteria: parsed.acceptanceCriteria,
              assigneeWallet: parsed.assigneeWallet,
              deadlineUnixSeconds: parsed.deadlineUnixSeconds,
              rewardWei: parsed.rewardWei
            }
          }),
          requestedAt: at
        });
        return jsonResponse(
          {
            task: taskDto(task),
            canonicalTask: CanonicalTaskV1Schema.parse(task.canonicalTask)
          },
          201,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },
    listTasks: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        const { session, access } = await requireProjectAccess(
          dependencies.auth,
          dependencies.accessStore,
          cookie(request),
          publicId(projectPublicId, "project")
        );
        const page = await dependencies.store.listTasks(
          access.projectPublicId,
          session.userId,
          parsePage(request)
        );
        return jsonResponse(
          { items: page.items.map(taskDto), nextCursor: encodeCursor(page.nextCursor) },
          200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },
    getTask: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const session = await dependencies.auth.authenticate(cookie(request));
        const task = await dependencies.store.getTask(
          publicId(taskPublicId, "task"),
          session.userId
        );
        if (task === null)
          throw new HttpError(ERROR_CODES.TASK_NOT_FOUND, "Task was not found", 404);
        return jsonResponse({ task: taskDto(task) }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },
    createChainIntent: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "task_chain_intent", at);
        const taskId = publicId(taskPublicId, "task");
        const empty = await readBoundedJson(request, 1024);
        if (
          typeof empty !== "object" ||
          empty === null ||
          Array.isArray(empty) ||
          Object.keys(empty).length !== 0
        )
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Expected an empty JSON object",
            400
          );
        const existingTask = await dependencies.store.getTask(taskId, session.userId);
        if (existingTask === null) {
          throw new HttpError(ERROR_CODES.TASK_NOT_FOUND, "Task was not found", 404);
        }
        const eligibleTask = taskDto(existingTask);
        const expired =
          eligibleTask.deadline !== null &&
          new Date(eligibleTask.deadline).getTime() <= at.getTime();
        if (
          eligibleTask.creatorWallet !== session.address ||
          session.chainId !== dependencies.chain.chainId ||
          eligibleTask.chainId !== dependencies.chain.chainId ||
          existingTask.contractAddress !== dependencies.chain.contractAddress ||
          eligibleTask.chainStatus !== "none" ||
          eligibleTask.offchainStatus !== "draft" ||
          expired
        ) {
          throw new HttpError(
            ERROR_CODES.INVALID_STATE,
            "Task is not eligible for chain creation",
            409
          );
        }
        await subjectLimit("task_chain_intent", `${session.userId}:${taskId}`, at);
        const key = idempotencyKey(request);
        const result = await dependencies.store.createChainIntent({
          publicId: deriveOpaquePublicId(dependencies.resourceSecret, "chain-transaction", [
            session.userId,
            taskId,
            key
          ]),
          taskPublicId: taskId,
          actorUserId: session.userId,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.create-task-intent",
            taskPublicId: taskId
          }),
          requestedAt: at
        });
        const task = taskDto(result.task);
        if (
          result.task.publicId !== taskId ||
          task.creatorWallet !== session.address ||
          session.chainId !== dependencies.chain.chainId ||
          task.chainId !== dependencies.chain.chainId ||
          result.task.contractAddress !== dependencies.chain.contractAddress ||
          task.chainStatus !== "none" ||
          task.offchainStatus !== "draft" ||
          result.transaction.taskPublicId !== taskId ||
          result.transaction.chainId !== dependencies.chain.chainId ||
          result.transaction.fromAddress !== session.address ||
          result.transaction.toAddress !== dependencies.chain.contractAddress ||
          result.transaction.intentType !== "create_task" ||
          result.transaction.idempotencyKey !== key ||
          result.transaction.status !== "wallet_requested"
        )
          throw new HttpError(
            ERROR_CODES.INVALID_STATE,
            "Task is not eligible for chain creation",
            409
          );
        const data = encodeFunctionData({
          abi: CREATE_TASK_ABI,
          functionName: "createTask",
          args: [
            task.taskHash as `0x${string}`,
            task.policyHash as `0x${string}`,
            task.assigneeWallet as `0x${string}`,
            BigInt(
              task.deadline === null ? 0 : Math.floor(new Date(task.deadline).getTime() / 1000)
            )
          ]
        });
        return jsonResponse(
          {
            transaction: transactionDto(result.transaction),
            walletRequest: result.replayed
              ? null
              : {
                  chainId: dependencies.chain.chainId,
                  from: task.creatorWallet,
                  to: dependencies.chain.contractAddress,
                  value: task.rewardWei,
                  data,
                  method: "createTask"
                }
          },
          result.replayed ? 200 : 201,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },
    recordChainTransaction: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "task_chain_register", at);
        const taskId = publicId(taskPublicId, "task");
        const outcome = parseOutcome(await readBoundedJson(request, 4096));
        const task = await dependencies.store.getTask(taskId, session.userId);
        if (task === null) {
          throw new HttpError(ERROR_CODES.TASK_NOT_FOUND, "Task was not found", 404);
        }
        if (
          task.creatorWallet !== session.address ||
          task.chainId !== dependencies.chain.chainId ||
          session.chainId !== dependencies.chain.chainId ||
          task.contractAddress !== dependencies.chain.contractAddress
        ) {
          throw new HttpError(
            ERROR_CODES.AUTH_FORBIDDEN,
            "Only the task creator may register its chain transaction",
            403
          );
        }
        await subjectLimit("task_chain_register", `${session.userId}:${taskId}`, at);
        const key = idempotencyKey(request);
        const requestHash = canonicalKeccak256({
          kind: "donebond.create-task-wallet-outcome",
          taskPublicId: taskId,
          ...outcome,
          nonce: outcome.nonce?.toString() ?? null
        });
        const transaction =
          outcome.status === "replacement_submitted"
            ? await dependencies.store.recordReplacement({
                publicId: deriveOpaquePublicId(
                  dependencies.resourceSecret,
                  "chain-transaction-replacement",
                  [session.userId, taskId, key]
                ),
                taskPublicId: taskId,
                replacedTransactionPublicId: outcome.transactionPublicId,
                actorUserId: session.userId,
                transactionHash: outcome.transactionHash,
                nonce: outcome.nonce,
                idempotencyKey: key,
                requestHash,
                requestedAt: at
              })
            : await dependencies.store.recordWalletOutcome({
                taskPublicId: taskId,
                ...outcome,
                actorUserId: session.userId,
                idempotencyKey: key,
                requestHash,
                requestedAt: at
              });
        return jsonResponse(
          { transaction: transactionDto(transaction) },
          outcome.status === "replacement_submitted" ? 201 : 200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },
    reconcileTransaction: async (
      request: Request,
      transactionPublicId: string
    ): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "task_chain_register", at);
        const transactionId = publicId(transactionPublicId, "transaction");
        const empty = await readBoundedJson(request, 1024);
        if (
          typeof empty !== "object" ||
          empty === null ||
          Array.isArray(empty) ||
          Object.keys(empty).length !== 0
        ) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Expected an empty JSON object",
            400
          );
        }
        await subjectLimit("task_chain_register", `${session.userId}:${transactionId}`, at);
        const result = await reconcileTaskCreation(
          dependencies.store,
          dependencies.receiptProvider,
          transactionId,
          session.userId,
          at
        );
        if (result === null) {
          throw new HttpError(
            ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND,
            "Chain transaction was not found",
            404
          );
        }
        return jsonResponse(
          { reconciliation: result },
          result.status === "unknown_reconcile" ? 202 : 200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
