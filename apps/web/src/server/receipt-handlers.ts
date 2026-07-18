import { canonicalKeccak256 } from "@donebond/evidence";
import { ChainTransactionSchema, ERROR_CODES, PublicIdentifierSchema } from "@donebond/shared";
import { encodeFunctionData } from "viem";

import { computeIntegrityStatus, type ReceiptAttestationResult } from "./receipt-attestation.ts";
import {
  reconcileReceiptSubmission,
  type ReceiptReconciliationStore
} from "./receipt-reconciliation.ts";
import { deriveOpaquePublicId } from "./cli-token.ts";
import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import type { ProjectMutationAuth, ProjectWriteRateLimiter } from "./project-policy-handlers.ts";
import type { ChainTransactionRecord, TaskRecord } from "./task-handlers.ts";
import type { TaskReceiptProvider } from "./task-reconciliation.ts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const OPAQUE_PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;

const SUBMIT_RECEIPT_ABI = [
  {
    type: "function",
    name: "submitReceipt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "commitHash", type: "bytes32" },
      { name: "attestationExpiry", type: "uint64" },
      { name: "verifierSignature", type: "bytes" }
    ],
    outputs: []
  }
] as const;

export interface PassingEvidenceRecord {
  readonly publicId: string;
  readonly evidenceHash: string;
  readonly commitHashDerived: string;
  readonly gitObjectId: string;
}

export interface ReceiptCheckSummary {
  readonly checkKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: string;
  readonly startedAt: Date | string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  /**
   * The store may carry the full redacted output preview (as persisted for
   * the authenticated evidence-detail endpoint); `receiptDto` deliberately
   * never selects these two fields into the public/member receipt response,
   * which only exposes terse check summaries and a link to the full
   * evidence bundle for anyone who needs the actual output.
   */
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
}

export interface ReceiptRecord {
  readonly taskPublicId: string;
  readonly projectPublicId: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly chainTaskId: string;
  readonly title: string;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly creatorWallet: string;
  readonly assigneeWallet: string;
  readonly rewardWei: string;
  readonly deadline: Date | string | null;
  readonly offchainStatus: string;
  readonly chainStatus: string;
  readonly evidencePublicId: string;
  readonly evidenceHash: string;
  readonly commitHashDerived: string;
  readonly gitObjectId: string;
  readonly checks: readonly ReceiptCheckSummary[];
  readonly verifierAddress: string;
  readonly signature: string;
  readonly typedDataDigest: string;
  readonly attestationExpiryUnixSeconds: string;
  readonly submissionTransactionHash: string;
  readonly submittedAt: Date | string;
}

export interface ReceiptStore extends ReceiptReconciliationStore {
  getTask(taskPublicId: string, actorUserId: string): Promise<TaskRecord | null>;
  getLatestPassingEvidence(taskPublicId: string): Promise<PassingEvidenceRecord | null>;
  createReceiptChainIntent(input: {
    readonly publicId: string;
    readonly taskPublicId: string;
    readonly actorUserId: string;
    readonly assigneeWallet: string;
    readonly evidenceBundlePublicId: string;
    readonly evidenceHash: string;
    readonly commitHash: string;
    readonly attestationExpiryUnixSeconds: string;
    readonly verifierAddress: string;
    readonly signature: string;
    readonly typedDataDigest: string;
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
  getPublicReceipt(taskPublicId: string): Promise<ReceiptRecord | null>;
  getReceiptForMember(taskPublicId: string, actorUserId: string): Promise<ReceiptRecord | null>;
}

export interface ReceiptHandlerDependencies {
  readonly applicationOrigin: string;
  readonly resourceSecret: string;
  readonly chain: {
    readonly chainId: 143 | 10_143;
    readonly contractAddress: string;
    readonly explorerUrl: string;
  };
  readonly auth: ProjectMutationAuth;
  readonly store: ReceiptStore;
  readonly receiptProvider: TaskReceiptProvider;
  readonly signAttestation: (input: {
    readonly chainId: 143 | 10_143;
    readonly contractAddress: string;
    readonly taskId: string;
    readonly taskHash: string;
    readonly policyHash: string;
    readonly assignee: string;
    readonly evidenceHash: string;
    readonly commitHash: string;
    readonly attestationExpiry: string;
  }) => Promise<ReceiptAttestationResult>;
  readonly verifierAddress: string;
  readonly attestationTtlSeconds: number;
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

function publicId(value: string, kind: "task" | "transaction"): string {
  try {
    const parsed = PublicIdentifierSchema.parse(value);
    if (!OPAQUE_PUBLIC_ID.test(parsed)) throw new TypeError("Expected an opaque public ID");
    return parsed;
  } catch (cause) {
    throw new HttpError(
      kind === "task" ? ERROR_CODES.TASK_NOT_FOUND : ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND,
      kind === "task" ? "Task was not found" : "Transaction was not found",
      404,
      { cause }
    );
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function requireEmptyBody(request: Request): Promise<void> {
  return readBoundedJson(request, 1024).then((body) => {
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    ) {
      throw new HttpError(
        ERROR_CODES.VALIDATION_INVALID_INPUT,
        "Expected an empty JSON object",
        400
      );
    }
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

/**
 * The explicit, allowlisted shape returned by both the public and
 * member-authenticated receipt reads. No field beyond this object is ever
 * serialized — the DTO is built with a literal object, not a spread, so an
 * accidental new column on `ReceiptRecord` cannot silently leak.
 */
async function receiptDto(
  record: ReceiptRecord,
  chain: ReceiptHandlerDependencies["chain"],
  expectedVerifierAddress: string
) {
  if (record.chainId !== chain.chainId || record.contractAddress !== chain.contractAddress) {
    throw new TypeError("Receipt record chain identity does not match the configured deployment");
  }
  const integrityStatus = await computeIntegrityStatus(
    {
      chainId: record.chainId as 143 | 10_143,
      contractAddress: record.contractAddress,
      taskId: record.chainTaskId,
      taskHash: record.taskHash,
      policyHash: record.policyHash,
      assignee: record.assigneeWallet,
      evidenceHash: record.evidenceHash,
      commitHash: record.commitHashDerived,
      attestationExpiry: record.attestationExpiryUnixSeconds
    },
    {
      verifierAddress: record.verifierAddress,
      signature: record.signature,
      typedDataDigest: record.typedDataDigest
    },
    expectedVerifierAddress
  );
  return {
    schemaVersion: 1 as const,
    taskPublicId: record.taskPublicId,
    projectPublicId: record.projectPublicId,
    title: record.title,
    taskHash: record.taskHash,
    policyHash: record.policyHash,
    creatorWallet: record.creatorWallet,
    assigneeWallet: record.assigneeWallet,
    rewardWei: record.rewardWei,
    offchainStatus: record.offchainStatus,
    chainStatus: record.chainStatus,
    evidenceHash: record.evidenceHash,
    commitHash: record.commitHashDerived,
    gitObjectId: record.gitObjectId,
    evidenceBundlePublicId: record.evidencePublicId,
    checks: record.checks.map((check) => ({
      key: check.checkKey,
      label: check.label,
      required: check.required,
      status: check.status,
      durationMs: check.durationMs,
      exitCode: check.exitCode,
      signal: check.signal,
      stdoutDigest: check.stdoutDigest,
      stderrDigest: check.stderrDigest
    })),
    chainId: chain.chainId,
    contractAddress: chain.contractAddress,
    chainTaskId: record.chainTaskId,
    submissionTransactionHash: record.submissionTransactionHash,
    explorerTransactionUrl: `${chain.explorerUrl}/tx/${record.submissionTransactionHash}`,
    verifierAttestation: {
      verifierAddress: record.verifierAddress,
      signature: record.signature,
      typedDataDigest: record.typedDataDigest,
      attestationExpiryUnixSeconds: record.attestationExpiryUnixSeconds
    },
    integrityStatus,
    submittedAt: iso(record.submittedAt)
  };
}

export function createReceiptHandlers(dependencies: ReceiptHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function mutation(
    request: Request,
    operation: "receipt_chain_intent" | "receipt_chain_register",
    at: Date
  ) {
    requireTrustedOrigin(request, dependencies.applicationOrigin);
    if (!(await dependencies.rateLimiter.consume(operation, null, at)))
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many receipt requests", 429, {
        retryable: true
      });
    return dependencies.auth.requireCsrf(cookie(request), request.headers.get("x-csrf-token"));
  }

  async function subjectLimit(
    operation: "receipt_chain_intent" | "receipt_chain_register",
    subject: string,
    at: Date
  ) {
    if (!(await dependencies.rateLimiter.consume(operation, subject, at)))
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many receipt requests", 429, {
        retryable: true
      });
  }

  return {
    createReceiptIntent: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "receipt_chain_intent", at);
        const taskId = publicId(taskPublicId, "task");
        await requireEmptyBody(request);

        const task = await dependencies.store.getTask(taskId, session.userId);
        if (task === null)
          throw new HttpError(ERROR_CODES.TASK_NOT_FOUND, "Task was not found", 404);
        if (task.assigneeWallet !== session.address) {
          throw new HttpError(
            ERROR_CODES.AUTH_FORBIDDEN,
            "Only the task assignee wallet may submit a receipt",
            403
          );
        }
        if (
          session.chainId !== dependencies.chain.chainId ||
          task.chainId !== dependencies.chain.chainId ||
          task.contractAddress !== dependencies.chain.contractAddress
        ) {
          throw new HttpError(
            ERROR_CODES.CHAIN_UNSUPPORTED,
            "Connect the assignee wallet on the configured Monad network",
            400
          );
        }
        if (
          task.chainTaskId === null ||
          task.chainStatus !== "open" ||
          task.offchainStatus !== "open"
        ) {
          throw new HttpError(
            ERROR_CODES.INVALID_STATE,
            "Task is not eligible for a receipt intent",
            409
          );
        }
        const deadline = task.deadline === null ? null : new Date(iso(task.deadline));
        if (deadline !== null && deadline.getTime() <= at.getTime()) {
          throw new HttpError(
            ERROR_CODES.INVALID_STATE,
            "Task is not eligible for a receipt intent",
            409
          );
        }

        const evidence = await dependencies.store.getLatestPassingEvidence(taskId);
        if (evidence === null) {
          throw new HttpError(
            ERROR_CODES.EVIDENCE_NOT_PASSING,
            "Task has no passing evidence bundle to attest",
            409
          );
        }

        await subjectLimit("receipt_chain_intent", `${session.userId}:${taskId}`, at);
        const key = idempotencyKey(request);
        const attestationExpiryUnixSeconds = String(
          Math.floor(at.getTime() / 1000) + dependencies.attestationTtlSeconds
        );
        const attestation = await dependencies.signAttestation({
          chainId: dependencies.chain.chainId,
          contractAddress: dependencies.chain.contractAddress,
          taskId: task.chainTaskId.toString(),
          taskHash: task.taskHash,
          policyHash: task.policyHash,
          assignee: task.assigneeWallet,
          evidenceHash: evidence.evidenceHash,
          commitHash: evidence.commitHashDerived,
          attestationExpiry: attestationExpiryUnixSeconds
        });
        if (attestation.verifierAddress !== dependencies.verifierAddress) {
          throw new TypeError(
            "Configured verifier address does not match the signing key's own address"
          );
        }

        const result = await dependencies.store.createReceiptChainIntent({
          publicId: deriveOpaquePublicId(dependencies.resourceSecret, "receipt-transaction", [
            session.userId,
            taskId,
            key
          ]),
          taskPublicId: taskId,
          actorUserId: session.userId,
          assigneeWallet: session.address,
          evidenceBundlePublicId: evidence.publicId,
          evidenceHash: evidence.evidenceHash,
          commitHash: evidence.commitHashDerived,
          attestationExpiryUnixSeconds,
          verifierAddress: attestation.verifierAddress,
          signature: attestation.signature,
          typedDataDigest: attestation.typedDataDigest,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.submit-receipt-intent",
            taskPublicId: taskId
          }),
          requestedAt: at
        });

        const data = encodeFunctionData({
          abi: SUBMIT_RECEIPT_ABI,
          functionName: "submitReceipt",
          args: [
            BigInt(task.chainTaskId.toString()),
            evidence.evidenceHash as `0x${string}`,
            evidence.commitHashDerived as `0x${string}`,
            BigInt(attestationExpiryUnixSeconds),
            attestation.signature
          ]
        });

        return jsonResponse(
          {
            transaction: transactionDto(result.transaction),
            walletRequest: result.replayed
              ? null
              : {
                  chainId: dependencies.chain.chainId,
                  from: task.assigneeWallet,
                  to: dependencies.chain.contractAddress,
                  value: "0",
                  data,
                  method: "submitReceipt"
                }
          },
          result.replayed ? 200 : 201,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    recordReceiptTransaction: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "receipt_chain_register", at);
        const taskId = publicId(taskPublicId, "task");
        const body = await readBoundedJson(request, 4096);
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Expected a JSON object", 400);
        }
        const input = body as Record<string, unknown>;
        const allowed = new Set(["transactionId", "status", "transactionHash", "nonce"]);
        if (Object.keys(input).some((key) => !allowed.has(key))) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Request contains an unknown field",
            400
          );
        }
        const status = input.status;
        if (
          status !== "wallet_requested" &&
          status !== "submitted" &&
          status !== "rejected_by_user"
        ) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Wallet outcome status is invalid",
            400
          );
        }
        const transactionId = publicId(String(input.transactionId ?? ""), "transaction");
        const hash = input.transactionHash;
        const nonce = input.nonce;
        if (status === "submitted") {
          if (
            typeof hash !== "string" ||
            !/^0x[0-9a-fA-F]{64}$/u.test(hash) ||
            typeof nonce !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/u.test(nonce)
          ) {
            throw new HttpError(
              ERROR_CODES.VALIDATION_INVALID_INPUT,
              "Submitted transactions require a hash and safe nonce",
              400
            );
          }
        } else if (
          (hash !== null && hash !== undefined) ||
          (nonce !== null && nonce !== undefined)
        ) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Only submitted outcomes may include transaction fields",
            400
          );
        }

        const task = await dependencies.store.getTask(taskId, session.userId);
        if (task === null)
          throw new HttpError(ERROR_CODES.TASK_NOT_FOUND, "Task was not found", 404);
        if (
          task.assigneeWallet !== session.address ||
          task.chainId !== dependencies.chain.chainId ||
          session.chainId !== dependencies.chain.chainId ||
          task.contractAddress !== dependencies.chain.contractAddress
        ) {
          throw new HttpError(
            ERROR_CODES.AUTH_FORBIDDEN,
            "Only the task assignee may register its receipt transaction",
            403
          );
        }
        await subjectLimit("receipt_chain_register", `${session.userId}:${taskId}`, at);
        const key = idempotencyKey(request);
        const requestHash = canonicalKeccak256({
          kind: "donebond.submit-receipt-wallet-outcome",
          taskPublicId: taskId,
          transactionPublicId: transactionId,
          status,
          transactionHash: status === "submitted" ? (hash as string).toLowerCase() : null,
          nonce: status === "submitted" ? (nonce as string) : null
        });
        const transaction = await dependencies.store.recordWalletOutcome({
          taskPublicId: taskId,
          transactionPublicId: transactionId,
          actorUserId: session.userId,
          status,
          transactionHash: status === "submitted" ? (hash as string).toLowerCase() : null,
          nonce: status === "submitted" ? BigInt(nonce as string) : null,
          failureCode: status === "rejected_by_user" ? "WALLET_REJECTED" : null,
          idempotencyKey: key,
          requestHash,
          requestedAt: at
        });
        return jsonResponse({ transaction: transactionDto(transaction) }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    reconcileReceipt: async (request: Request, transactionPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const at = now();
        const session = await mutation(request, "receipt_chain_register", at);
        const transactionId = publicId(transactionPublicId, "transaction");
        await requireEmptyBody(request);
        await subjectLimit("receipt_chain_register", `${session.userId}:${transactionId}`, at);
        const result = await reconcileReceiptSubmission(
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
    },

    getPublicReceipt: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const record = await dependencies.store.getPublicReceipt(publicId(taskPublicId, "task"));
        if (record === null) {
          throw new HttpError(ERROR_CODES.RECEIPT_NOT_FOUND, "Receipt was not found", 404);
        }
        const dto = await receiptDto(record, dependencies.chain, dependencies.verifierAddress);
        return jsonResponse(
          { receipt: dto },
          200,
          id,
          "public, max-age=60, stale-while-revalidate=30"
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    getMemberReceipt: async (request: Request, taskPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const session = await dependencies.auth.authenticate(cookie(request));
        const record = await dependencies.store.getReceiptForMember(
          publicId(taskPublicId, "task"),
          session.userId
        );
        if (record === null) {
          throw new HttpError(ERROR_CODES.RECEIPT_NOT_FOUND, "Receipt was not found", 404);
        }
        const dto = await receiptDto(record, dependencies.chain, dependencies.verifierAddress);
        return jsonResponse({ receipt: dto }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
