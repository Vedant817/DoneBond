import {
  CanonicalTaskV1Schema,
  ChainTransactionSchema,
  TaskSchema,
  type CanonicalTaskV1
} from "@donebond/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import type { IdempotencyContext } from "./repository.js";
import {
  apiIdempotencyKeys,
  auditEvents,
  chainTransactions,
  contractEvents,
  databaseSchema,
  policies,
  projectMembers,
  projects,
  tasks,
  wallets
} from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ChainStatus = typeof chainTransactions.$inferSelect.status;

export interface TaskCursor {
  readonly createdAt: Date;
  readonly publicId: string;
}

export interface TaskPagination {
  readonly cursor?: TaskCursor | null;
  readonly limit: number;
}

export interface TaskPage {
  readonly items: readonly TaskView[];
  readonly nextCursor: TaskCursor | null;
}

export interface TaskView {
  readonly schemaVersion: 1;
  readonly publicId: string;
  readonly projectPublicId: string;
  readonly chainId: 143 | 10_143;
  readonly contractAddress: string;
  readonly chainTaskId: string | null;
  readonly title: string;
  readonly description: string;
  readonly repositoryUrl: string;
  readonly targetBranch: string;
  readonly baseCommit: string | null;
  readonly acceptanceCriteria: CanonicalTaskV1["acceptanceCriteria"];
  readonly taskHash: string;
  readonly policyHash: string;
  readonly creatorWallet: string;
  readonly assigneeWallet: string;
  readonly rewardWei: string;
  readonly deadline: Date | null;
  readonly offchainStatus:
    | "draft"
    | "awaiting_chain"
    | "open"
    | "receipt_submitted"
    | "approved"
    | "rejected"
    | "cancelled"
    | "expired";
  readonly chainStatus:
    "none" | "open" | "receipt_submitted" | "approved" | "rejected" | "cancelled" | "expired";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly canonicalTask: CanonicalTaskV1;
}

export interface CreateTaskDraftInput {
  readonly actorUserId: string;
  readonly publicId: string;
  readonly projectPublicId: string;
  readonly policyPublicId: string;
  readonly canonicalTask: CanonicalTaskV1;
  readonly taskHash: string;
  readonly repositoryUrl: string;
  readonly creatorWallet: string;
  readonly contractAddress: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestedAt: Date;
}

export interface ChainTransactionView {
  readonly schemaVersion: 1;
  readonly publicId: string;
  readonly taskPublicId: string;
  readonly intentType: "create_task";
  readonly idempotencyKey: string;
  readonly chainId: 143 | 10_143;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly transactionHash: string | null;
  readonly nonce: string | null;
  readonly status: ChainStatus;
  readonly blockNumber: string | null;
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateTaskChainIntentInput {
  readonly actorUserId: string;
  readonly taskPublicId: string;
  readonly publicId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestedAt: Date;
}

interface ChainTransitionInput {
  readonly actorUserId: string;
  readonly transactionPublicId: string;
  readonly expectedStatus: ChainStatus;
  readonly status:
    | "wallet_requested"
    | "submitted"
    | "rejected_by_user"
    | "replaced"
    | "reverted"
    | "unknown_reconcile";
  readonly changedAt: Date;
  readonly transactionHash?: string;
  readonly nonce?: number;
  readonly blockNumber?: bigint;
  readonly failureCode?: string;
  readonly replacementPublicId?: string;
}

export interface TaskCreatedEventInput {
  readonly transactionPublicId: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly chainTaskId: bigint;
  readonly creator: string;
  readonly assignee: string;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly rewardWei: bigint;
  readonly deadlineUnixSeconds: bigint;
  readonly confirmedAt: Date;
}

export interface TaskChainReconciliationContext {
  readonly transactionPublicId: string;
  readonly transactionHash: `0x${string}`;
  readonly status: "submitted" | "unknown_reconcile";
  readonly chainId: 143 | 10_143;
  readonly contractAddress: string;
  readonly taskPublicId: string;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly creatorWallet: string;
  readonly assigneeWallet: string;
  readonly rewardWei: string;
  readonly deadlineUnixSeconds: string;
}

export interface WalletOutcomeInput {
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
}

export interface RecordReplacementInput {
  readonly actorUserId: string;
  readonly priorTransactionPublicId: string;
  readonly publicId: string;
  readonly transactionHash: string;
  readonly nonce: bigint;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestedAt: Date;
}

export interface ReconcileTransactionInput {
  readonly transactionPublicId: string;
  readonly expectedStatus: "wallet_requested" | "submitted" | "unknown_reconcile";
  readonly status: "unknown_reconcile" | "reverted";
  readonly failureCode: string;
  readonly blockNumber?: bigint;
  readonly reconciledAt: Date;
}

export interface ConfirmedTaskCreated {
  readonly task: TaskView;
  readonly transaction: ChainTransactionView;
}

interface TaskRow {
  readonly task: typeof tasks.$inferSelect;
  readonly projectPublicId: string;
  readonly repositoryUrl: string;
  readonly policyPublicId: string;
}

interface OwnedTask extends TaskRow {
  readonly projectStatus: "active" | "archived";
  readonly ownerUserId: string;
  readonly memberUserId: string;
  readonly role: "owner" | "member";
}

interface TransactionScope {
  readonly transaction: typeof chainTransactions.$inferSelect;
  readonly task: typeof tasks.$inferSelect;
  readonly taskPublicId: string;
  readonly ownerUserId: string;
  readonly memberUserId: string;
  readonly role: "owner" | "member";
  readonly projectStatus: "active" | "archived";
}

type TaskSnapshot = Omit<TaskView, "createdAt" | "updatedAt" | "deadline"> & {
  readonly kind: "task";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadline: string | null;
};

type ChainSnapshot = Omit<ChainTransactionView, "createdAt" | "updatedAt"> & {
  readonly kind: "chain_transaction";
  readonly createdAt: string;
  readonly updatedAt: string;
};

interface ChainIntentSnapshot {
  readonly kind: "chain_intent";
  readonly task: TaskSnapshot;
  readonly transaction: ChainSnapshot;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const NONZERO_BYTES32 = /^0x(?!0{64})[0-9a-f]{64}$/u;
const ADDRESS = /^0x(?!0{40})[0-9a-f]{40}$/u;
const GIT_OBJECT = /^([0-9a-f]{40}|[0-9a-f]{64})$/u;
const UINT96_MAX = (1n << 96n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const SUPPORTED_CHAIN_IDS = new Set([143, 10_143]);

const transitions: Readonly<Record<ChainStatus, readonly ChainStatus[]>> = {
  prepared: ["wallet_requested", "rejected_by_user"],
  wallet_requested: ["submitted", "rejected_by_user", "unknown_reconcile"],
  submitted: ["replaced", "reverted", "unknown_reconcile"],
  unknown_reconcile: ["submitted", "replaced", "reverted"],
  confirmed: [],
  rejected_by_user: [],
  replaced: [],
  reverted: []
};

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function notFound(): DatabaseServiceError {
  return new DatabaseServiceError("DB_NOT_FOUND", "Task or chain transaction was not found");
}

function conflict(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_CONFLICT", message);
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) throw invalid("Actor user ID is invalid");
}

function assertPublicId(value: string, label: string): void {
  if (!PUBLIC_ID.test(value)) throw invalid(`${label} is invalid`);
}

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalid(`${label} must be a valid date`);
  }
}

function assertChainId(value: number): asserts value is 143 | 10_143 {
  if (!Number.isSafeInteger(value) || !SUPPORTED_CHAIN_IDS.has(value)) {
    throw invalid("Chain ID is unsupported");
  }
}

function assertAddress(value: string, label: string): void {
  if (!ADDRESS.test(value)) throw invalid(`${label} must be a lowercase nonzero address`);
}

function assertHash(value: string, label: string): void {
  if (!NONZERO_BYTES32.test(value)) throw invalid(`${label} must be a lowercase nonzero bytes32`);
}

function assertIdempotency(
  value: IdempotencyContext,
  actorUserId: string,
  operation: string
): void {
  if (
    value.actorScope !== `user:${actorUserId}` ||
    value.operation !== operation ||
    value.idempotencyKey.length < 16 ||
    value.idempotencyKey.length > 128 ||
    !BYTES32.test(value.requestHash)
  ) {
    throw invalid("Idempotency scope, operation, key, or request hash is invalid");
  }
  assertDate(value.expiresAt, "Idempotency expiry");
}

function assertPagination(value: TaskPagination): void {
  if (!value || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100) {
    throw invalid("Pagination limit must be an integer from 1 through 100");
  }
  if (value.cursor) {
    assertDate(value.cursor.createdAt, "Pagination cursor creation time");
    assertPublicId(value.cursor.publicId, "Pagination cursor public ID");
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, child]) => [key, normalize(child)])
      );
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function repositoryIdentity(repositoryUrl: string): string {
  const url = new URL(repositoryUrl);
  return `github.com${url.pathname}`
    .toLowerCase()
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "");
}

function parseCanonicalTask(input: CreateTaskDraftInput): CanonicalTaskV1 {
  assertUuid(input.actorUserId);
  assertPublicId(input.publicId, "Task public ID");
  assertPublicId(input.projectPublicId, "Project public ID");
  assertPublicId(input.policyPublicId, "Policy public ID");
  assertHash(input.taskHash, "Task hash");
  assertAddress(input.creatorWallet, "Creator wallet");
  assertAddress(input.contractAddress, "Contract address");
  assertDate(input.requestedAt, "Task creation time");
  const parsed = CanonicalTaskV1Schema.safeParse(input.canonicalTask);
  if (!parsed.success || !sameJson(parsed.data, input.canonicalTask)) {
    throw invalid("Canonical task payload is malformed or not normalized");
  }
  if (parsed.data.projectPublicId !== input.projectPublicId) {
    throw invalid("Canonical task project binding is invalid");
  }
  const reward = BigInt(parsed.data.rewardWei);
  if (reward > UINT96_MAX) throw invalid("Task reward exceeds the contract boundary");
  if (parsed.data.baseCommit !== null && !GIT_OBJECT.test(parsed.data.baseCommit)) {
    throw invalid("Task base commit is invalid");
  }
  if (parsed.data.deadlineUnixSeconds !== null) {
    const deadline = BigInt(parsed.data.deadlineUnixSeconds);
    if (deadline > UINT64_MAX || deadline * 1000n <= BigInt(input.requestedAt.getTime())) {
      throw invalid("Task deadline is expired or outside uint64");
    }
  }
  return parsed.data;
}

function taskView(row: TaskRow): TaskView {
  const canonical = CanonicalTaskV1Schema.parse(row.task.canonicalJson);
  const candidate = {
    schemaVersion: 1 as const,
    publicId: row.task.publicId,
    projectPublicId: row.projectPublicId,
    chainId: row.task.chainId,
    chainTaskId: row.task.chainTaskId?.toString() ?? null,
    title: row.task.title,
    description: row.task.description,
    repositoryUrl: row.repositoryUrl,
    targetBranch: row.task.targetBranch,
    baseCommit: row.task.baseCommit,
    acceptanceCriteria: row.task.acceptanceCriteriaJson,
    taskHash: row.task.taskHash,
    policyHash: row.task.policyHash,
    creatorWallet: row.task.creatorWallet,
    assigneeWallet: row.task.assigneeWallet,
    rewardWei: row.task.rewardWei.toString(),
    deadline: row.task.deadline?.toISOString() ?? null,
    offchainStatus: row.task.offchainStatus,
    chainStatus: row.task.chainStatus,
    createdAt: row.task.createdAt.toISOString(),
    updatedAt: row.task.updatedAt.toISOString()
  };
  const parsed = TaskSchema.safeParse(candidate);
  if (
    !parsed.success ||
    canonical.projectPublicId !== row.projectPublicId ||
    canonical.repositoryIdentity !== repositoryIdentity(row.repositoryUrl) ||
    canonical.targetBranch !== row.task.targetBranch ||
    canonical.baseCommit !== row.task.baseCommit ||
    canonical.title !== row.task.title ||
    canonical.description !== row.task.description ||
    !sameJson(canonical.acceptanceCriteria, row.task.acceptanceCriteriaJson) ||
    canonical.assigneeWallet !== row.task.assigneeWallet ||
    canonical.rewardWei !== row.task.rewardWei.toString() ||
    canonical.policyHash !== row.task.policyHash ||
    canonical.deadlineUnixSeconds !==
      (row.task.deadline === null ? null : String(row.task.deadline.getTime() / 1000))
  ) {
    throw conflict("Persisted task payload is inconsistent");
  }
  assertChainId(row.task.chainId);
  return {
    ...candidate,
    chainId: row.task.chainId,
    contractAddress: row.task.contractAddress,
    deadline: row.task.deadline,
    createdAt: row.task.createdAt,
    updatedAt: row.task.updatedAt,
    acceptanceCriteria: canonical.acceptanceCriteria,
    canonicalTask: canonical
  };
}

function taskSnapshot(view: TaskView): TaskSnapshot {
  return {
    kind: "task",
    ...view,
    deadline: view.deadline?.toISOString() ?? null,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString()
  };
}

function parseTaskSnapshot(value: unknown): TaskView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw conflict("Stored task replay snapshot is invalid");
  }
  const snapshot = value as Record<string, unknown>;
  const expectedKeys = [
    "acceptanceCriteria",
    "assigneeWallet",
    "baseCommit",
    "chainId",
    "chainStatus",
    "chainTaskId",
    "contractAddress",
    "createdAt",
    "creatorWallet",
    "deadline",
    "description",
    "kind",
    "offchainStatus",
    "policyHash",
    "projectPublicId",
    "publicId",
    "repositoryUrl",
    "rewardWei",
    "schemaVersion",
    "targetBranch",
    "taskHash",
    "title",
    "updatedAt",
    "canonicalTask"
  ].sort();
  if (
    Object.keys(snapshot).sort().join("\0") !== expectedKeys.join("\0") ||
    snapshot.kind !== "task"
  ) {
    throw conflict("Stored task replay snapshot is invalid");
  }
  const parsed = TaskSchema.safeParse(
    Object.fromEntries(
      Object.entries(snapshot).filter(
        ([key]) => !["kind", "contractAddress", "canonicalTask"].includes(key)
      )
    )
  );
  const canonical = CanonicalTaskV1Schema.safeParse(snapshot.canonicalTask);
  if (
    !parsed.success ||
    !canonical.success ||
    typeof snapshot.contractAddress !== "string" ||
    !ADDRESS.test(snapshot.contractAddress) ||
    canonical.data.projectPublicId !== parsed.data.projectPublicId ||
    canonical.data.repositoryIdentity !== repositoryIdentity(parsed.data.repositoryUrl) ||
    canonical.data.targetBranch !== parsed.data.targetBranch ||
    canonical.data.baseCommit !== parsed.data.baseCommit ||
    canonical.data.title !== parsed.data.title ||
    canonical.data.description !== parsed.data.description ||
    !sameJson(canonical.data.acceptanceCriteria, parsed.data.acceptanceCriteria) ||
    canonical.data.assigneeWallet !== parsed.data.assigneeWallet ||
    canonical.data.rewardWei !== parsed.data.rewardWei ||
    canonical.data.policyHash !== parsed.data.policyHash ||
    canonical.data.deadlineUnixSeconds !==
      (parsed.data.deadline === null
        ? null
        : String(new Date(parsed.data.deadline).getTime() / 1000))
  ) {
    throw conflict("Stored task replay snapshot is invalid");
  }
  const createdAt = new Date(parsed.data.createdAt);
  const updatedAt = new Date(parsed.data.updatedAt);
  const deadline = parsed.data.deadline === null ? null : new Date(parsed.data.deadline);
  if (
    createdAt.toISOString() !== parsed.data.createdAt ||
    updatedAt.toISOString() !== parsed.data.updatedAt ||
    (deadline && deadline.toISOString() !== parsed.data.deadline)
  ) {
    throw conflict("Stored task replay dates are invalid");
  }
  return {
    ...parsed.data,
    contractAddress: snapshot.contractAddress,
    deadline,
    createdAt,
    updatedAt,
    canonicalTask: canonical.data
  };
}

function chainSnapshot(view: ChainTransactionView): ChainSnapshot {
  return {
    kind: "chain_transaction",
    ...view,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString()
  };
}

function parseChainSnapshot(value: unknown): ChainTransactionView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw conflict("Stored chain transaction snapshot is invalid");
  }
  const snapshot = value as Record<string, unknown>;
  const expectedKeys = [
    "blockNumber",
    "chainId",
    "createdAt",
    "failureCode",
    "fromAddress",
    "idempotencyKey",
    "intentType",
    "kind",
    "nonce",
    "publicId",
    "schemaVersion",
    "status",
    "taskPublicId",
    "toAddress",
    "transactionHash",
    "updatedAt"
  ].sort();
  if (
    Object.keys(snapshot).sort().join("\0") !== expectedKeys.join("\0") ||
    snapshot.kind !== "chain_transaction"
  ) {
    throw conflict("Stored chain transaction snapshot is invalid");
  }
  const parsed = ChainTransactionSchema.safeParse({
    ...Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "kind")),
    nonce:
      snapshot.nonce === null || snapshot.nonce === undefined
        ? null
        : typeof snapshot.nonce === "string" && /^(?:0|[1-9][0-9]*)$/u.test(snapshot.nonce)
          ? Number(snapshot.nonce)
          : Number.NaN
  });
  if (!parsed.success || parsed.data.taskPublicId === null) {
    throw conflict("Stored chain transaction snapshot is invalid");
  }
  const createdAt = new Date(parsed.data.createdAt);
  const updatedAt = new Date(parsed.data.updatedAt);
  if (
    createdAt.toISOString() !== parsed.data.createdAt ||
    updatedAt.toISOString() !== parsed.data.updatedAt
  ) {
    throw conflict("Stored chain transaction snapshot dates are invalid");
  }
  return {
    ...parsed.data,
    taskPublicId: parsed.data.taskPublicId,
    nonce: snapshot.nonce as string | null,
    chainId: parsed.data.chainId as 143 | 10_143,
    intentType: "create_task",
    createdAt,
    updatedAt
  };
}

function parseChainIntentSnapshot(value: unknown): {
  readonly task: TaskView;
  readonly transaction: ChainTransactionView;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["kind", "task", "transaction"].join("\0")
  ) {
    throw conflict("Stored chain intent snapshot is invalid");
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.kind !== "chain_intent") throw conflict("Stored chain intent snapshot is invalid");
  return {
    task: parseTaskSnapshot(snapshot.task),
    transaction: parseChainSnapshot(snapshot.transaction)
  };
}

export class DrizzleTaskRepository {
  public constructor(private readonly database: Database) {}

  public async getCreationContext(projectPublicId: string, actorUserId: string) {
    assertPublicId(projectPublicId, "Project public ID");
    assertUuid(actorUserId);
    try {
      const [row] = await this.database
        .select({
          projectPublicId: projects.publicId,
          repositoryUrl: projects.repositoryUrl,
          status: projects.status,
          activePolicyPublicId: policies.publicId,
          activePolicyHash: policies.policyHash,
          ownerUserId: projects.ownerUserId,
          memberUserId: projectMembers.userId,
          role: projectMembers.role
        })
        .from(projects)
        .innerJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
        )
        .innerJoin(policies, eq(policies.id, projects.activePolicyId))
        .where(eq(projects.publicId, projectPublicId))
        .limit(1);
      if (!row || row.role !== "owner" || row.ownerUserId !== row.memberUserId) return null;
      return {
        projectPublicId: row.projectPublicId,
        repositoryUrl: row.repositoryUrl,
        status: row.status,
        activePolicyPublicId: row.activePolicyPublicId,
        activePolicyHash: row.activePolicyHash
      };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async createTask(input: CreateTaskDraftInput): Promise<TaskView> {
    const canonical = parseCanonicalTask(input);
    const idempotency: IdempotencyContext = {
      actorScope: `user:${input.actorUserId}`,
      operation: "task_create",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(input.requestedAt.getTime() + 24 * 60 * 60 * 1000)
    };
    assertIdempotency(idempotency, input.actorUserId, "task_create");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProjectOwner(
          transaction,
          input.projectPublicId,
          input.actorUserId,
          "update"
        );
        const reservationId = await this.reserveApi(transaction, idempotency, input.publicId);
        if (!reservationId) {
          return this.replayTask(transaction, idempotency, input.publicId);
        }
        if (project.status !== "active") {
          throw new DatabaseServiceError(
            "DB_PROJECT_ARCHIVED",
            "Archived projects cannot accept tasks"
          );
        }
        if (repositoryIdentity(project.repositoryUrl) !== canonical.repositoryIdentity) {
          throw invalid("Canonical task repository identity differs from the locked project");
        }
        if (project.repositoryUrl !== input.repositoryUrl) {
          throw invalid("Task repository URL differs from the locked project");
        }
        const [policy] = await transaction
          .select()
          .from(policies)
          .where(
            and(
              eq(policies.publicId, input.policyPublicId),
              eq(policies.projectId, project.id),
              eq(policies.policyHash, canonical.policyHash)
            )
          )
          .for("share")
          .limit(1);
        if (!policy || project.activePolicyId !== policy.id) {
          throw new DatabaseServiceError("DB_NOT_FOUND", "Active task policy was not found");
        }
        const walletRows = await transaction
          .select({ id: wallets.id, chainId: wallets.chainId })
          .from(wallets)
          .where(
            and(
              eq(wallets.userId, input.actorUserId),
              eq(wallets.addressNormalized, input.creatorWallet)
            )
          )
          .for("share")
          .limit(2);
        const wallet = walletRows[0];
        if (!wallet || walletRows.length !== 1)
          throw new DatabaseServiceError("DB_NOT_FOUND", "Verified creator wallet was not found");
        assertChainId(wallet.chainId);
        const [duplicateHash] = await transaction
          .select({ publicId: tasks.publicId })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.taskHash, input.taskHash)))
          .for("share")
          .limit(1);
        if (duplicateHash) {
          throw new DatabaseServiceError(
            "DB_TASK_HASH_CONFLICT",
            "Task hash already identifies a project task"
          );
        }
        const deadline =
          canonical.deadlineUnixSeconds === null
            ? null
            : new Date(Number(BigInt(canonical.deadlineUnixSeconds) * 1000n));
        const [created] = await transaction
          .insert(tasks)
          .values({
            publicId: input.publicId,
            projectId: project.id,
            policyId: policy.id,
            chainId: wallet.chainId,
            contractAddress: input.contractAddress,
            title: canonical.title,
            description: canonical.description,
            canonicalJson: canonical,
            targetBranch: canonical.targetBranch,
            baseCommit: canonical.baseCommit,
            acceptanceCriteriaJson: canonical.acceptanceCriteria,
            taskHash: input.taskHash,
            policyHash: canonical.policyHash,
            creatorWallet: input.creatorWallet,
            assigneeWallet: canonical.assigneeWallet,
            rewardWei: BigInt(canonical.rewardWei),
            deadline,
            offchainStatus: "draft",
            chainStatus: "none",
            createdAt: input.requestedAt,
            updatedAt: input.requestedAt
          })
          .returning();
        if (!created) throw conflict("Task insert returned no row");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: project.id,
          taskId: created.id,
          action: "task.created",
          metadataSafeJson: {
            taskPublicId: created.publicId,
            taskHash: created.taskHash,
            policyHash: created.policyHash
          }
        });
        const result = taskView({
          task: created,
          projectPublicId: input.projectPublicId,
          repositoryUrl: project.repositoryUrl,
          policyPublicId: policy.publicId
        });
        await this.completeApi(transaction, reservationId, 201, taskSnapshot(result));
        return result;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async getTask(taskPublicId: string, actorUserId: string): Promise<TaskView | null> {
    assertPublicId(taskPublicId, "Task public ID");
    assertUuid(actorUserId);
    try {
      const [row] = await this.taskReadQuery(actorUserId, undefined, taskPublicId).limit(1);
      return row ? taskView(row) : null;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async listTasks(
    projectPublicId: string,
    actorUserId: string,
    pagination: TaskPagination
  ): Promise<TaskPage> {
    assertPublicId(projectPublicId, "Project public ID");
    assertUuid(actorUserId);
    assertPagination(pagination);
    try {
      const [access] = await this.database
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
        )
        .where(eq(projects.publicId, projectPublicId))
        .limit(1);
      if (!access) throw notFound();
      const rows = await this.taskReadQuery(
        actorUserId,
        projectPublicId,
        undefined,
        pagination.cursor ?? undefined
      )
        .orderBy(desc(tasks.createdAt), desc(tasks.publicId))
        .limit(pagination.limit + 1);
      const visible = rows.slice(0, pagination.limit).map(taskView);
      const last = visible.at(-1);
      return {
        items: visible,
        nextCursor:
          rows.length > pagination.limit && last
            ? { createdAt: last.createdAt, publicId: last.publicId }
            : null
      };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async createChainIntent(input: CreateTaskChainIntentInput): Promise<{
    readonly task: TaskView;
    readonly transaction: ChainTransactionView;
    readonly replayed: boolean;
  }> {
    assertUuid(input.actorUserId);
    assertPublicId(input.taskPublicId, "Task public ID");
    assertPublicId(input.publicId, "Transaction public ID");
    assertDate(input.requestedAt, "Chain intent creation time");
    const idempotency: IdempotencyContext = {
      actorScope: `user:${input.actorUserId}`,
      operation: "chain_intent_create",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(input.requestedAt.getTime() + 24 * 60 * 60 * 1000)
    };
    assertIdempotency(idempotency, input.actorUserId, "chain_intent_create");
    try {
      return await this.database.transaction(async (transaction) => {
        const scope = await this.requireTaskOwner(
          transaction,
          input.taskPublicId,
          input.actorUserId,
          "update"
        );
        const inserted = await transaction
          .insert(chainTransactions)
          .values({
            publicId: input.publicId,
            userId: input.actorUserId,
            projectId: scope.task.projectId,
            taskId: scope.task.id,
            intentType: "create_task",
            idempotencyKey: idempotency.idempotencyKey,
            requestHash: idempotency.requestHash,
            chainId: scope.task.chainId,
            fromAddress: scope.task.creatorWallet,
            toAddress: scope.task.contractAddress,
            status: "wallet_requested",
            createdAt: input.requestedAt,
            updatedAt: input.requestedAt
          })
          .onConflictDoNothing({
            target: [
              chainTransactions.userId,
              chainTransactions.intentType,
              chainTransactions.idempotencyKey
            ]
          })
          .returning();
        if (!inserted[0]) {
          return {
            ...(await this.replayChainIntent(transaction, scope, input.publicId, idempotency)),
            replayed: true
          };
        }
        if (scope.projectStatus !== "active") {
          throw new DatabaseServiceError(
            "DB_PROJECT_ARCHIVED",
            "Archived projects cannot create chain intents"
          );
        }
        if (scope.task.offchainStatus !== "draft" || scope.task.chainStatus !== "none") {
          throw conflict("Task is not eligible for a creation intent");
        }
        if (scope.task.deadline !== null && scope.task.deadline <= input.requestedAt) {
          throw conflict("Task deadline elapsed before wallet request");
        }
        const initial = await this.chainView(transaction, inserted[0], input.taskPublicId);
        const initialTask = taskView(scope);
        const snapshotRows = await transaction
          .update(chainTransactions)
          .set({
            responseSafeJson: {
              kind: "chain_intent",
              task: taskSnapshot(initialTask),
              transaction: chainSnapshot(initial)
            } satisfies ChainIntentSnapshot,
            responseStatus: 201
          })
          .where(eq(chainTransactions.id, inserted[0].id))
          .returning({ id: chainTransactions.id });
        if (snapshotRows.length !== 1)
          throw conflict("Chain intent snapshot could not be persisted");
        await transaction
          .update(tasks)
          .set({ offchainStatus: "awaiting_chain", updatedAt: input.requestedAt })
          .where(eq(tasks.id, scope.task.id));
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: scope.task.projectId,
          taskId: scope.task.id,
          action: "chain.wallet_requested",
          metadataSafeJson: { transactionPublicId: input.publicId }
        });
        return { task: initialTask, transaction: initial, replayed: false };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async markWalletRequested(
    input: Omit<ChainTransitionInput, "expectedStatus" | "status">,
    idempotency: IdempotencyContext
  ): Promise<ChainTransactionView> {
    return this.transitionChainTransaction(
      { ...input, expectedStatus: "prepared", status: "wallet_requested" },
      idempotency
    );
  }

  public async recordWalletOutcome(input: WalletOutcomeInput): Promise<ChainTransactionView> {
    assertPublicId(input.taskPublicId, "Task public ID");
    const expectedStatus = input.status === "wallet_requested" ? "prepared" : "wallet_requested";
    const nonce = input.nonce === null ? undefined : Number(input.nonce);
    if (input.nonce !== null && BigInt(nonce!) !== input.nonce) {
      throw invalid("Transaction nonce exceeds the safe public boundary");
    }
    const idempotency: IdempotencyContext = {
      actorScope: `user:${input.actorUserId}`,
      operation: `chain_${input.status}`,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(input.requestedAt.getTime() + 24 * 60 * 60 * 1000)
    };
    const result = await this.transitionChainTransaction(
      {
        actorUserId: input.actorUserId,
        transactionPublicId: input.transactionPublicId,
        expectedStatus,
        status: input.status,
        changedAt: input.requestedAt,
        ...(input.transactionHash === null ? {} : { transactionHash: input.transactionHash }),
        ...(nonce === undefined ? {} : { nonce }),
        ...(input.status === "rejected_by_user"
          ? { failureCode: input.failureCode ?? "USER_REJECTED" }
          : {})
      },
      idempotency
    );
    if (result.taskPublicId !== input.taskPublicId) throw notFound();
    return result;
  }

  public async recordReplacement(input: RecordReplacementInput): Promise<{
    readonly replaced: ChainTransactionView;
    readonly replacement: ChainTransactionView;
  }> {
    assertUuid(input.actorUserId);
    assertPublicId(input.priorTransactionPublicId, "Prior transaction public ID");
    assertPublicId(input.publicId, "Replacement transaction public ID");
    assertHash(input.transactionHash, "Replacement transaction hash");
    assertDate(input.requestedAt, "Replacement time");
    if (input.nonce < 0n || input.nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalid("Replacement nonce is outside the safe boundary");
    }
    const idempotency: IdempotencyContext = {
      actorScope: `user:${input.actorUserId}`,
      operation: "chain_replacement",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(input.requestedAt.getTime() + 24 * 60 * 60 * 1000)
    };
    assertIdempotency(idempotency, input.actorUserId, "chain_replacement");
    try {
      return await this.database.transaction(async (transaction) => {
        const scope = await this.requireTransactionOwner(
          transaction,
          input.priorTransactionPublicId,
          input.actorUserId
        );
        const inserted = await transaction
          .insert(chainTransactions)
          .values({
            publicId: input.publicId,
            userId: scope.transaction.userId,
            projectId: scope.transaction.projectId,
            taskId: scope.transaction.taskId,
            intentType: scope.transaction.intentType,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            chainId: scope.transaction.chainId,
            fromAddress: scope.transaction.fromAddress,
            toAddress: scope.transaction.toAddress,
            transactionHash: input.transactionHash,
            nonce: input.nonce,
            status: "submitted",
            createdAt: input.requestedAt,
            updatedAt: input.requestedAt
          })
          .onConflictDoNothing({
            target: [
              chainTransactions.userId,
              chainTransactions.intentType,
              chainTransactions.idempotencyKey
            ]
          })
          .returning();
        if (!inserted[0]) {
          const replacement = await this.replayReplacement(
            transaction,
            scope,
            input.publicId,
            idempotency
          );
          if (
            scope.transaction.status !== "replaced" ||
            scope.transaction.replacedByTransactionId === null
          ) {
            throw conflict("Replacement replay is not bound to the prior transaction");
          }
          return {
            replaced: await this.chainView(transaction, scope.transaction, scope.taskPublicId),
            replacement
          };
        }
        if (
          !["submitted", "unknown_reconcile"].includes(scope.transaction.status) ||
          scope.transaction.nonce !== input.nonce ||
          scope.transaction.transactionHash === input.transactionHash
        ) {
          throw invalid("Prior transaction cannot be replaced by this transaction");
        }
        const replacementView = await this.chainView(transaction, inserted[0], scope.taskPublicId);
        const snapshotRows = await transaction
          .update(chainTransactions)
          .set({ responseSafeJson: chainSnapshot(replacementView), responseStatus: 201 })
          .where(eq(chainTransactions.id, inserted[0].id))
          .returning({ id: chainTransactions.id });
        const [replaced] = await transaction
          .update(chainTransactions)
          .set({
            status: "replaced",
            replacedByTransactionId: inserted[0].id,
            failureCode: "TRANSACTION_REPLACED",
            updatedAt: input.requestedAt
          })
          .where(
            and(
              eq(chainTransactions.id, scope.transaction.id),
              eq(chainTransactions.status, scope.transaction.status)
            )
          )
          .returning();
        if (snapshotRows.length !== 1 || !replaced)
          throw conflict("Replacement update lost a race");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: scope.transaction.projectId,
          taskId: scope.task.id,
          action: "chain.replaced",
          metadataSafeJson: {
            transactionPublicId: input.priorTransactionPublicId,
            replacementPublicId: input.publicId,
            transactionHash: input.transactionHash
          }
        });
        return {
          replaced: await this.chainView(transaction, replaced, scope.taskPublicId),
          replacement: replacementView
        };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async reconcileTransaction(
    input: ReconcileTransactionInput
  ): Promise<ChainTransactionView> {
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertDate(input.reconciledAt, "Reconciliation time");
    if (!/^[A-Z][A-Z0-9_]{0,99}$/u.test(input.failureCode)) {
      throw invalid("Reconciliation failure code is invalid");
    }
    const allowed =
      (input.status === "unknown_reconcile" &&
        ["wallet_requested", "submitted"].includes(input.expectedStatus)) ||
      (input.status === "reverted" &&
        ["submitted", "unknown_reconcile"].includes(input.expectedStatus));
    if (!allowed || (input.blockNumber !== undefined && input.status !== "reverted")) {
      throw invalid("Reconciliation status transition is invalid");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, input.transactionPublicId))
          .for("update")
          .limit(1);
        if (!row || !row.taskId) throw notFound();
        if (row.status === input.status) {
          if (
            row.failureCode !== input.failureCode ||
            (input.blockNumber !== undefined && row.blockNumber !== input.blockNumber)
          ) {
            throw conflict("Reconciliation replay differs from persisted state");
          }
          const [task] = await transaction
            .select({ publicId: tasks.publicId })
            .from(tasks)
            .where(eq(tasks.id, row.taskId))
            .limit(1);
          if (!task) throw notFound();
          return this.chainView(transaction, row, task.publicId);
        }
        if (row.status !== input.expectedStatus) throw conflict("Chain transaction state changed");
        if (input.status === "reverted" && row.transactionHash === null) {
          throw invalid("A transaction without a hash cannot be marked reverted");
        }
        const [updated] = await transaction
          .update(chainTransactions)
          .set({
            status: input.status,
            failureCode: input.failureCode,
            ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
            updatedAt: input.reconciledAt
          })
          .where(and(eq(chainTransactions.id, row.id), eq(chainTransactions.status, row.status)))
          .returning();
        if (!updated) throw conflict("Reconciliation update lost a race");
        await transaction.insert(auditEvents).values({
          projectId: row.projectId,
          taskId: row.taskId,
          action: `chain.${input.status}`,
          metadataSafeJson: {
            transactionPublicId: input.transactionPublicId,
            failureCode: input.failureCode,
            ...(input.blockNumber === undefined
              ? {}
              : { blockNumber: input.blockNumber.toString() })
          }
        });
        const [task] = await transaction
          .select({ publicId: tasks.publicId })
          .from(tasks)
          .where(eq(tasks.id, row.taskId))
          .limit(1);
        if (!task) throw notFound();
        return this.chainView(transaction, updated, task.publicId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async registerSubmittedTransaction(
    input: Omit<ChainTransitionInput, "status"> & {
      readonly expectedStatus: "wallet_requested" | "unknown_reconcile";
      readonly transactionHash: string;
      readonly nonce: number;
    },
    idempotency: IdempotencyContext
  ): Promise<ChainTransactionView> {
    return this.transitionChainTransaction({ ...input, status: "submitted" }, idempotency);
  }

  private async transitionChainTransaction(
    input: ChainTransitionInput,
    idempotency: IdempotencyContext
  ): Promise<ChainTransactionView> {
    this.assertTransition(input);
    assertIdempotency(idempotency, input.actorUserId, `chain_${input.status}`);
    try {
      return await this.database.transaction(async (transaction) => {
        const scope = await this.requireTransactionOwner(
          transaction,
          input.transactionPublicId,
          input.actorUserId
        );
        const reservationId = await this.reserveApi(
          transaction,
          idempotency,
          input.transactionPublicId
        );
        if (!reservationId) {
          return this.replayChain(transaction, idempotency, input.transactionPublicId);
        }
        if (scope.transaction.status !== input.expectedStatus) {
          throw conflict("Chain transaction state changed");
        }
        if (!transitions[input.expectedStatus].includes(input.status)) {
          throw invalid("Chain transaction status transition is invalid");
        }
        let replacementId: string | null = null;
        if (input.status === "replaced") {
          const replacement = await this.requireReplacement(transaction, scope, input);
          replacementId = replacement.id;
        }
        const patch = this.transitionPatch(scope.transaction, input, replacementId);
        const [updated] = await transaction
          .update(chainTransactions)
          .set(patch)
          .where(
            and(
              eq(chainTransactions.id, scope.transaction.id),
              eq(chainTransactions.status, input.expectedStatus)
            )
          )
          .returning();
        if (!updated) throw conflict("Chain transaction update lost a race");
        if (input.status === "rejected_by_user") {
          await transaction
            .update(tasks)
            .set({ offchainStatus: "draft", updatedAt: input.changedAt })
            .where(eq(tasks.id, scope.task.id));
        }
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: scope.task.projectId,
          taskId: scope.task.id,
          action: `chain.${input.status}`,
          metadataSafeJson: {
            transactionPublicId: input.transactionPublicId,
            ...(input.transactionHash ? { transactionHash: input.transactionHash } : {}),
            ...(input.failureCode ? { failureCode: input.failureCode } : {}),
            ...(input.replacementPublicId ? { replacementPublicId: input.replacementPublicId } : {})
          }
        });
        const result = await this.chainView(transaction, updated, scope.taskPublicId);
        await this.completeApi(transaction, reservationId, 200, chainSnapshot(result));
        return result;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async confirmTaskCreatedEvent(
    input: TaskCreatedEventInput
  ): Promise<ConfirmedTaskCreated> {
    this.assertTaskCreatedEvent(input);
    try {
      return await this.database.transaction(async (transaction) => {
        const [chainTransaction] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, input.transactionPublicId))
          .for("update")
          .limit(1);
        if (!chainTransaction || !chainTransaction.taskId) throw notFound();
        const [row] = await transaction
          .select({
            task: tasks,
            projectPublicId: projects.publicId,
            repositoryUrl: projects.repositoryUrl,
            policyPublicId: policies.publicId
          })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .innerJoin(policies, eq(policies.id, tasks.policyId))
          .where(eq(tasks.id, chainTransaction.taskId))
          .for("update")
          .limit(1);
        if (!row) throw notFound();
        this.assertEventBinding(chainTransaction, row.task, input);
        const decodedJson = {
          taskId: input.chainTaskId.toString(),
          creator: input.creator,
          assignee: input.assignee,
          taskHash: input.taskHash,
          policyHash: input.policyHash,
          reward: input.rewardWei.toString(),
          deadline: input.deadlineUnixSeconds.toString()
        };
        const inserted = await transaction
          .insert(contractEvents)
          .values({
            chainId: input.chainId,
            contractAddress: input.contractAddress,
            transactionHash: input.transactionHash,
            logIndex: input.logIndex,
            eventName: "TaskCreated",
            decodedJson,
            blockNumber: input.blockNumber,
            blockHash: input.blockHash,
            removed: false
          })
          .onConflictDoNothing({
            target: [
              contractEvents.chainId,
              contractEvents.transactionHash,
              contractEvents.logIndex
            ]
          })
          .returning();
        if (!inserted[0]) {
          const [existing] = await transaction
            .select()
            .from(contractEvents)
            .where(
              and(
                eq(contractEvents.chainId, input.chainId),
                eq(contractEvents.transactionHash, input.transactionHash),
                eq(contractEvents.logIndex, input.logIndex)
              )
            )
            .for("share")
            .limit(1);
          if (
            !existing ||
            existing.contractAddress !== input.contractAddress ||
            existing.eventName !== "TaskCreated" ||
            existing.blockNumber !== input.blockNumber ||
            existing.blockHash !== input.blockHash ||
            existing.removed ||
            !sameJson(existing.decodedJson, decodedJson)
          ) {
            throw conflict("TaskCreated event replay conflicts with persisted chain data");
          }
        }
        if (chainTransaction.status !== "confirmed") {
          if (
            !(["submitted", "unknown_reconcile"] as ChainStatus[]).includes(chainTransaction.status)
          ) {
            throw conflict("Transaction is not eligible for confirmation");
          }
          const [confirmedTransaction] = await transaction
            .update(chainTransactions)
            .set({
              status: "confirmed",
              blockNumber: input.blockNumber,
              failureCode: null,
              updatedAt: input.confirmedAt
            })
            .where(eq(chainTransactions.id, chainTransaction.id))
            .returning();
          const [confirmedTask] = await transaction
            .update(tasks)
            .set({
              chainTaskId: input.chainTaskId,
              offchainStatus: "open",
              chainStatus: "open",
              updatedAt: input.confirmedAt
            })
            .where(eq(tasks.id, row.task.id))
            .returning();
          if (!confirmedTransaction || !confirmedTask)
            throw conflict("Confirmation update lost a race");
          await transaction.insert(auditEvents).values([
            {
              projectId: row.task.projectId,
              taskId: row.task.id,
              action: "chain.confirmed",
              metadataSafeJson: {
                transactionPublicId: chainTransaction.publicId,
                transactionHash: input.transactionHash,
                blockNumber: input.blockNumber.toString()
              }
            },
            {
              projectId: row.task.projectId,
              taskId: row.task.id,
              action: "task.opened",
              metadataSafeJson: { chainTaskId: input.chainTaskId.toString() }
            }
          ]);
          row.task = confirmedTask;
          Object.assign(chainTransaction, confirmedTransaction);
        } else if (
          row.task.chainTaskId !== input.chainTaskId ||
          row.task.offchainStatus !== "open" ||
          row.task.chainStatus !== "open"
        ) {
          throw conflict("Confirmed transaction and task state are inconsistent");
        }
        return {
          task: taskView(row),
          transaction: await this.chainView(transaction, chainTransaction, row.task.publicId)
        };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async getTaskChainReconciliationContext(
    transactionPublicId: string,
    actorUserId: string
  ): Promise<TaskChainReconciliationContext | null> {
    assertPublicId(transactionPublicId, "Transaction public ID");
    assertUuid(actorUserId);
    try {
      const [row] = await this.database
        .select({
          transaction: chainTransactions,
          taskPublicId: tasks.publicId,
          projectId: tasks.projectId,
          taskHash: tasks.taskHash,
          policyHash: tasks.policyHash,
          creatorWallet: tasks.creatorWallet,
          assigneeWallet: tasks.assigneeWallet,
          rewardWei: tasks.rewardWei,
          deadline: tasks.deadline,
          canonicalJson: tasks.canonicalJson,
          contractAddress: tasks.contractAddress,
          chainId: tasks.chainId,
          ownerUserId: projects.ownerUserId,
          memberUserId: projectMembers.userId,
          role: projectMembers.role
        })
        .from(chainTransactions)
        .innerJoin(tasks, eq(tasks.id, chainTransactions.taskId))
        .innerJoin(projects, eq(projects.id, chainTransactions.projectId))
        .innerJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, chainTransactions.projectId),
            eq(projectMembers.userId, actorUserId)
          )
        )
        .where(eq(chainTransactions.publicId, transactionPublicId))
        .limit(1);
      if (
        !row ||
        !row.transaction.taskId ||
        row.transaction.userId !== actorUserId ||
        row.role !== "owner" ||
        row.ownerUserId !== row.memberUserId
      ) {
        return null;
      }
      if (
        row.transaction.status !== "submitted" &&
        row.transaction.status !== "unknown_reconcile"
      ) {
        return null;
      }
      if (row.transaction.transactionHash === null) return null;
      const canonical = CanonicalTaskV1Schema.parse(row.canonicalJson);
      assertChainId(row.chainId);
      assertChainId(row.transaction.chainId);
      return {
        transactionPublicId: row.transaction.publicId,
        transactionHash: row.transaction.transactionHash as `0x${string}`,
        status: row.transaction.status as "submitted" | "unknown_reconcile",
        chainId: row.transaction.chainId,
        contractAddress: row.contractAddress,
        taskPublicId: row.taskPublicId,
        taskHash: row.taskHash,
        policyHash: row.policyHash,
        creatorWallet: row.creatorWallet,
        assigneeWallet: row.assigneeWallet,
        rewardWei: row.rewardWei.toString(),
        deadlineUnixSeconds:
          canonical.deadlineUnixSeconds === null ? "0" : canonical.deadlineUnixSeconds
      };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async markTransactionUnknown(input: {
    readonly transactionPublicId: string;
    readonly expectedStatus: "wallet_requested" | "submitted" | "unknown_reconcile";
    readonly failureCode: string;
    readonly reconciledAt: Date;
  }): Promise<ChainTransactionView | null> {
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertDate(input.reconciledAt, "Reconciliation time");
    if (!/^[A-Z][A-Z0-9_]{0,99}$/u.test(input.failureCode)) {
      throw invalid("Reconciliation failure code is invalid");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, input.transactionPublicId))
          .for("update")
          .limit(1);
        if (!row || !row.taskId) throw notFound();
        if (row.status === "unknown_reconcile" && row.failureCode === input.failureCode) {
          const [task] = await transaction
            .select({ publicId: tasks.publicId })
            .from(tasks)
            .where(eq(tasks.id, row.taskId))
            .limit(1);
          if (!task) throw notFound();
          return this.chainView(transaction, row, task.publicId);
        }
        if (row.status !== input.expectedStatus) throw conflict("Chain transaction state changed");
        const [updated] = await transaction
          .update(chainTransactions)
          .set({
            status: "unknown_reconcile",
            failureCode: input.failureCode,
            updatedAt: input.reconciledAt
          })
          .where(eq(chainTransactions.id, row.id))
          .returning();
        if (!updated) throw conflict("Unknown reconciliation update lost a race");
        const [task] = await transaction
          .select({ publicId: tasks.publicId })
          .from(tasks)
          .where(eq(tasks.id, row.taskId))
          .limit(1);
        if (!task) throw notFound();
        await transaction.insert(auditEvents).values({
          projectId: row.projectId,
          taskId: row.taskId,
          action: "chain.unknown_reconcile",
          metadataSafeJson: {
            transactionPublicId: row.publicId,
            failureCode: input.failureCode
          }
        });
        return this.chainView(transaction, updated, task.publicId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async markTransactionReverted(input: {
    readonly transactionPublicId: string;
    readonly expectedStatus: "submitted" | "unknown_reconcile";
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly reconciledAt: Date;
  }): Promise<ChainTransactionView | null> {
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertDate(input.reconciledAt, "Reconciliation time");
    if (!/^0x[0-9a-f]{64}$/u.test(input.blockHash)) {
      throw invalid("Revert block hash must be a 32-byte lowercase hex value");
    }
    if (input.blockNumber < 0n) throw invalid("Revert block number must be non-negative");
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, input.transactionPublicId))
          .for("update")
          .limit(1);
        if (!row || !row.taskId) throw notFound();
        if (row.status === "reverted" && row.blockNumber === input.blockNumber) {
          const [task] = await transaction
            .select({ publicId: tasks.publicId })
            .from(tasks)
            .where(eq(tasks.id, row.taskId))
            .limit(1);
          if (!task) throw notFound();
          return this.chainView(transaction, row, task.publicId);
        }
        if (row.status !== input.expectedStatus) throw conflict("Chain transaction state changed");
        if (row.transactionHash === null) {
          throw invalid("A transaction without a hash cannot be marked reverted");
        }
        const [updated] = await transaction
          .update(chainTransactions)
          .set({
            status: "reverted",
            blockNumber: input.blockNumber,
            failureCode: "TRANSACTION_REVERTED",
            updatedAt: input.reconciledAt
          })
          .where(eq(chainTransactions.id, row.id))
          .returning();
        if (!updated) throw conflict("Reverted reconciliation update lost a race");
        const [task] = await transaction
          .select({ publicId: tasks.publicId })
          .from(tasks)
          .where(eq(tasks.id, row.taskId))
          .limit(1);
        if (!task) throw notFound();
        await transaction.insert(auditEvents).values({
          projectId: row.projectId,
          taskId: row.taskId,
          action: "chain.reverted",
          metadataSafeJson: {
            transactionPublicId: row.publicId,
            transactionHash: row.transactionHash,
            blockNumber: input.blockNumber.toString()
          }
        });
        return this.chainView(transaction, updated, task.publicId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async confirmTaskCreatedFromReconciliation(input: {
    readonly transactionPublicId: string;
    readonly expectedStatus: "submitted" | "unknown_reconcile";
    readonly chainTaskId: bigint;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly logIndex: number;
    readonly reconciledAt: Date;
  }): Promise<ChainTransactionView | null> {
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertDate(input.reconciledAt, "Reconciliation time");
    if (input.chainTaskId < 0n) throw invalid("Chain task ID must be non-negative");
    if (!/^0x[0-9a-f]{64}$/u.test(input.blockHash)) {
      throw invalid("Confirmed block hash must be a 32-byte lowercase hex value");
    }
    if (input.blockNumber < 0n) throw invalid("Confirmed block number must be non-negative");
    if (!Number.isSafeInteger(input.logIndex) || input.logIndex < 0) {
      throw invalid("Confirmed log index must be a non-negative safe integer");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [chainRow] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, input.transactionPublicId))
          .for("update")
          .limit(1);
        if (!chainRow || !chainRow.taskId) throw notFound();
        const [taskRow] = await transaction
          .select({
            task: tasks,
            projectPublicId: projects.publicId,
            repositoryUrl: projects.repositoryUrl,
            policyPublicId: policies.publicId
          })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .innerJoin(policies, eq(policies.id, tasks.policyId))
          .where(eq(tasks.id, chainRow.taskId))
          .for("update")
          .limit(1);
        if (!taskRow) throw notFound();
        if (chainRow.status === "confirmed" && taskRow.task.chainTaskId === input.chainTaskId) {
          return this.chainView(transaction, chainRow, taskRow.task.publicId);
        }
        if (chainRow.status !== input.expectedStatus) {
          throw conflict("Chain transaction state changed");
        }
        if (chainRow.transactionHash === null) {
          throw invalid("A transaction without a hash cannot be confirmed");
        }
        const existingEvent = await transaction
          .select({ id: contractEvents.id })
          .from(contractEvents)
          .where(
            and(
              eq(contractEvents.chainId, chainRow.chainId),
              eq(contractEvents.transactionHash, chainRow.transactionHash),
              eq(contractEvents.logIndex, input.logIndex)
            )
          )
          .for("update")
          .limit(1);
        if (existingEvent.length > 0) {
          throw conflict("TaskCreated event already indexed for this transaction and log index");
        }
        const canonical = CanonicalTaskV1Schema.parse(taskRow.task.canonicalJson);
        await transaction.insert(contractEvents).values({
          chainId: chainRow.chainId,
          contractAddress: taskRow.task.contractAddress,
          transactionHash: chainRow.transactionHash,
          logIndex: input.logIndex,
          eventName: "TaskCreated",
          decodedJson: {
            taskId: input.chainTaskId.toString(),
            creator: taskRow.task.creatorWallet,
            assignee: taskRow.task.assigneeWallet,
            taskHash: taskRow.task.taskHash,
            policyHash: taskRow.task.policyHash,
            reward: taskRow.task.rewardWei.toString(),
            deadline: canonical.deadlineUnixSeconds === null ? "0" : canonical.deadlineUnixSeconds
          },
          blockHash: input.blockHash,
          blockNumber: input.blockNumber,
          removed: false
        });
        const [confirmedTransaction] = await transaction
          .update(chainTransactions)
          .set({
            status: "confirmed",
            blockNumber: input.blockNumber,
            failureCode: null,
            updatedAt: input.reconciledAt
          })
          .where(eq(chainTransactions.id, chainRow.id))
          .returning();
        const [confirmedTask] = await transaction
          .update(tasks)
          .set({
            chainTaskId: input.chainTaskId,
            offchainStatus: "open",
            chainStatus: "open",
            updatedAt: input.reconciledAt
          })
          .where(eq(tasks.id, taskRow.task.id))
          .returning();
        if (!confirmedTransaction || !confirmedTask) {
          throw conflict("Confirmation update lost a race");
        }
        await transaction.insert(auditEvents).values([
          {
            projectId: taskRow.task.projectId,
            taskId: taskRow.task.id,
            action: "chain.confirmed",
            metadataSafeJson: {
              transactionPublicId: chainRow.publicId,
              transactionHash: chainRow.transactionHash,
              blockNumber: input.blockNumber.toString()
            }
          },
          {
            projectId: taskRow.task.projectId,
            taskId: taskRow.task.id,
            action: "task.opened",
            metadataSafeJson: { chainTaskId: input.chainTaskId.toString() }
          }
        ]);
        return this.chainView(transaction, confirmedTransaction, confirmedTask.publicId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private taskReadQuery(
    actorUserId: string,
    projectPublicId?: string,
    taskPublicId?: string,
    cursor?: TaskCursor
  ) {
    const predicates = [eq(projectMembers.userId, actorUserId)];
    if (projectPublicId) predicates.push(eq(projects.publicId, projectPublicId));
    if (taskPublicId) predicates.push(eq(tasks.publicId, taskPublicId));
    if (cursor) {
      const cursorPredicate = or(
        lt(tasks.createdAt, cursor.createdAt),
        and(eq(tasks.createdAt, cursor.createdAt), lt(tasks.publicId, cursor.publicId))
      );
      if (cursorPredicate) predicates.push(cursorPredicate);
    }
    return this.database
      .select({
        task: tasks,
        projectPublicId: projects.publicId,
        repositoryUrl: projects.repositoryUrl,
        policyPublicId: policies.publicId
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(policies, eq(policies.id, tasks.policyId))
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, actorUserId))
      )
      .where(and(...predicates));
  }

  private async requireProjectOwner(
    transaction: Transaction,
    projectPublicId: string,
    actorUserId: string,
    lock: "share" | "update"
  ) {
    const [row] = await transaction
      .select({
        id: projects.id,
        ownerUserId: projects.ownerUserId,
        memberUserId: projectMembers.userId,
        role: projectMembers.role,
        status: projects.status,
        activePolicyId: projects.activePolicyId,
        repositoryUrl: projects.repositoryUrl
      })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
      )
      .where(eq(projects.publicId, projectPublicId))
      .for(lock)
      .limit(1);
    if (
      !row ||
      row.role !== "owner" ||
      row.ownerUserId !== row.memberUserId ||
      row.memberUserId !== actorUserId
    ) {
      throw notFound();
    }
    return row;
  }

  private async requireTaskOwner(
    transaction: Transaction,
    taskPublicId: string,
    actorUserId: string,
    lock: "share" | "update"
  ): Promise<OwnedTask> {
    const [row] = await transaction
      .select({
        task: tasks,
        projectPublicId: projects.publicId,
        repositoryUrl: projects.repositoryUrl,
        policyPublicId: policies.publicId,
        projectStatus: projects.status,
        ownerUserId: projects.ownerUserId,
        memberUserId: projectMembers.userId,
        role: projectMembers.role
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(policies, eq(policies.id, tasks.policyId))
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, actorUserId))
      )
      .where(eq(tasks.publicId, taskPublicId))
      .for(lock)
      .limit(1);
    if (!row || row.role !== "owner" || row.ownerUserId !== row.memberUserId) throw notFound();
    return row;
  }

  private async requireTransactionOwner(
    transaction: Transaction,
    transactionPublicId: string,
    actorUserId: string
  ): Promise<TransactionScope> {
    const [row] = await transaction
      .select({
        transaction: chainTransactions,
        task: tasks,
        taskPublicId: tasks.publicId,
        ownerUserId: projects.ownerUserId,
        memberUserId: projectMembers.userId,
        role: projectMembers.role,
        projectStatus: projects.status
      })
      .from(chainTransactions)
      .innerJoin(tasks, eq(tasks.id, chainTransactions.taskId))
      .innerJoin(projects, eq(projects.id, chainTransactions.projectId))
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, chainTransactions.projectId),
          eq(projectMembers.userId, actorUserId)
        )
      )
      .where(eq(chainTransactions.publicId, transactionPublicId))
      .for("update")
      .limit(1);
    if (
      !row ||
      row.transaction.userId !== actorUserId ||
      row.role !== "owner" ||
      row.ownerUserId !== row.memberUserId
    ) {
      throw notFound();
    }
    return row;
  }

  private async reserveApi(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string
  ): Promise<string | null> {
    const rows = await transaction
      .insert(apiIdempotencyKeys)
      .values({ ...idempotency, resourcePublicId })
      .onConflictDoNothing({
        target: [
          apiIdempotencyKeys.actorScope,
          apiIdempotencyKeys.operation,
          apiIdempotencyKeys.idempotencyKey
        ]
      })
      .returning({ id: apiIdempotencyKeys.id });
    return rows[0]?.id ?? null;
  }

  private async completeApi(
    transaction: Transaction,
    reservationId: string,
    responseStatus: number,
    responseSafeJson: TaskSnapshot | ChainSnapshot
  ): Promise<void> {
    const rows = await transaction
      .update(apiIdempotencyKeys)
      .set({ responseStatus, responseSafeJson })
      .where(eq(apiIdempotencyKeys.id, reservationId))
      .returning({ id: apiIdempotencyKeys.id });
    if (rows.length !== 1) throw conflict("Idempotency response could not be persisted");
  }

  private async replayApi(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string
  ) {
    const [row] = await transaction
      .select()
      .from(apiIdempotencyKeys)
      .where(
        and(
          eq(apiIdempotencyKeys.actorScope, idempotency.actorScope),
          eq(apiIdempotencyKeys.operation, idempotency.operation),
          eq(apiIdempotencyKeys.idempotencyKey, idempotency.idempotencyKey)
        )
      )
      .for("share")
      .limit(1);
    if (
      !row ||
      row.requestHash !== idempotency.requestHash ||
      row.resourcePublicId !== resourcePublicId
    ) {
      throw new DatabaseServiceError(
        "DB_IDEMPOTENCY_CONFLICT",
        "Idempotency key content conflicts"
      );
    }
    if (row.responseStatus === null || row.responseSafeJson === null) {
      throw conflict("Idempotency response snapshot is incomplete");
    }
    return row;
  }

  private async replayTask(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    taskPublicId: string
  ): Promise<TaskView> {
    const replay = await this.replayApi(transaction, idempotency, taskPublicId);
    if (replay.responseStatus !== 201) throw conflict("Task replay status is invalid");
    const snapshot = parseTaskSnapshot(replay.responseSafeJson);
    if (snapshot.publicId !== taskPublicId) throw conflict("Task replay binding is invalid");
    return snapshot;
  }

  private async replayChain(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    transactionPublicId: string
  ): Promise<ChainTransactionView> {
    const replay = await this.replayApi(transaction, idempotency, transactionPublicId);
    if (replay.responseStatus !== 200) throw conflict("Chain replay status is invalid");
    const snapshot = parseChainSnapshot(replay.responseSafeJson);
    if (snapshot.publicId !== transactionPublicId)
      throw conflict("Chain replay binding is invalid");
    return snapshot;
  }

  private async replayChainIntent(
    transaction: Transaction,
    scope: Pick<OwnedTask, "task">,
    transactionPublicId: string,
    idempotency: IdempotencyContext
  ): Promise<{ readonly task: TaskView; readonly transaction: ChainTransactionView }> {
    const [row] = await transaction
      .select()
      .from(chainTransactions)
      .where(
        and(
          eq(chainTransactions.userId, idempotency.actorScope.slice(5)),
          eq(chainTransactions.intentType, "create_task"),
          eq(chainTransactions.idempotencyKey, idempotency.idempotencyKey)
        )
      )
      .for("share")
      .limit(1);
    if (
      !row ||
      row.requestHash !== idempotency.requestHash ||
      row.publicId !== transactionPublicId ||
      row.taskId !== scope.task.id ||
      row.responseStatus !== 201 ||
      row.responseSafeJson === null
    ) {
      throw new DatabaseServiceError("DB_IDEMPOTENCY_CONFLICT", "Chain intent replay conflicts");
    }
    const snapshot = parseChainIntentSnapshot(row.responseSafeJson);
    if (
      snapshot.transaction.publicId !== transactionPublicId ||
      snapshot.transaction.taskPublicId !== scope.task.publicId ||
      snapshot.task.publicId !== scope.task.publicId
    ) {
      throw conflict("Chain intent replay snapshot binding is invalid");
    }
    return snapshot;
  }

  private async replayReplacement(
    transaction: Transaction,
    scope: Pick<OwnedTask, "task">,
    transactionPublicId: string,
    idempotency: IdempotencyContext
  ): Promise<ChainTransactionView> {
    const [row] = await transaction
      .select()
      .from(chainTransactions)
      .where(
        and(
          eq(chainTransactions.userId, idempotency.actorScope.slice(5)),
          eq(chainTransactions.intentType, "create_task"),
          eq(chainTransactions.idempotencyKey, idempotency.idempotencyKey)
        )
      )
      .for("share")
      .limit(1);
    if (
      !row ||
      row.requestHash !== idempotency.requestHash ||
      row.publicId !== transactionPublicId ||
      row.taskId !== scope.task.id ||
      row.responseStatus !== 201 ||
      row.responseSafeJson === null
    ) {
      throw new DatabaseServiceError("DB_IDEMPOTENCY_CONFLICT", "Replacement replay conflicts");
    }
    const snapshot = parseChainSnapshot(row.responseSafeJson);
    if (
      snapshot.publicId !== transactionPublicId ||
      snapshot.taskPublicId !== scope.task.publicId
    ) {
      throw conflict("Replacement replay snapshot binding is invalid");
    }
    return snapshot;
  }

  private async chainView(
    transaction: Transaction,
    row: typeof chainTransactions.$inferSelect,
    taskPublicId: string
  ): Promise<ChainTransactionView> {
    if (row.replacedByTransactionId) {
      const [replacement] = await transaction
        .select({ publicId: chainTransactions.publicId })
        .from(chainTransactions)
        .where(eq(chainTransactions.id, row.replacedByTransactionId))
        .limit(1);
      if (!replacement) throw conflict("Replacement transaction binding is missing");
    }
    assertChainId(row.chainId);
    if (row.nonce !== null && row.nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw conflict("Persisted transaction nonce exceeds the public DTO boundary");
    }
    return {
      schemaVersion: 1,
      publicId: row.publicId,
      taskPublicId,
      intentType: "create_task",
      idempotencyKey: row.idempotencyKey,
      chainId: row.chainId,
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      transactionHash: row.transactionHash,
      nonce: row.nonce?.toString() ?? null,
      status: row.status,
      blockNumber: row.blockNumber?.toString() ?? null,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private assertTransition(input: ChainTransitionInput): void {
    assertUuid(input.actorUserId);
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertDate(input.changedAt, "Chain transaction change time");
    if (!transitions[input.expectedStatus]?.includes(input.status)) {
      throw invalid("Chain transaction status transition is invalid");
    }
    if (input.status === "submitted") {
      if (!input.transactionHash || input.nonce === undefined) {
        throw invalid("Submitted transactions require a hash and nonce");
      }
      assertHash(input.transactionHash, "Transaction hash");
      if (!Number.isSafeInteger(input.nonce) || input.nonce < 0)
        throw invalid("Transaction nonce is invalid");
    } else if (input.transactionHash !== undefined || input.nonce !== undefined) {
      throw invalid("Only submission may set transaction hash and nonce");
    }
    if (input.blockNumber !== undefined && input.status !== "reverted") {
      throw invalid("Only a reverted transition may set a block number");
    }
    if (input.status === "replaced") {
      if (!input.replacementPublicId) throw invalid("Replacement transaction is required");
    } else if (input.replacementPublicId !== undefined) {
      throw invalid("Only a replaced transition may bind a replacement");
    }
    const requiresFailure = ["rejected_by_user", "reverted", "unknown_reconcile"].includes(
      input.status
    );
    if (
      (requiresFailure &&
        (!input.failureCode || !/^[A-Z][A-Z0-9_]{0,99}$/u.test(input.failureCode))) ||
      (!requiresFailure && input.failureCode !== undefined)
    ) {
      throw invalid("Chain failure code is missing or invalid for the transition");
    }
  }

  private transitionPatch(
    existing: typeof chainTransactions.$inferSelect,
    input: ChainTransitionInput,
    replacementId: string | null
  ) {
    return {
      status: input.status,
      updatedAt: input.changedAt,
      ...(input.status === "submitted"
        ? { transactionHash: input.transactionHash, nonce: BigInt(input.nonce!) }
        : {}),
      ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      failureCode: input.failureCode ?? null,
      replacedByTransactionId: replacementId,
      ...(input.status === "submitted" && existing.status === "unknown_reconcile"
        ? { blockNumber: null }
        : {})
    };
  }

  private async requireReplacement(
    transaction: Transaction,
    scope: TransactionScope,
    input: ChainTransitionInput
  ) {
    const [replacement] = await transaction
      .select()
      .from(chainTransactions)
      .where(eq(chainTransactions.publicId, input.replacementPublicId!))
      .for("share")
      .limit(1);
    if (
      !replacement ||
      replacement.id === scope.transaction.id ||
      replacement.userId !== scope.transaction.userId ||
      replacement.projectId !== scope.transaction.projectId ||
      replacement.taskId !== scope.transaction.taskId ||
      replacement.intentType !== scope.transaction.intentType ||
      replacement.chainId !== scope.transaction.chainId ||
      replacement.fromAddress !== scope.transaction.fromAddress ||
      replacement.toAddress !== scope.transaction.toAddress ||
      replacement.nonce === null ||
      scope.transaction.nonce === null ||
      replacement.nonce !== scope.transaction.nonce ||
      replacement.transactionHash === null ||
      replacement.transactionHash === scope.transaction.transactionHash ||
      !["submitted", "confirmed", "unknown_reconcile"].includes(replacement.status)
    ) {
      throw invalid("Replacement transaction scope or nonce is invalid");
    }
    return replacement;
  }

  private assertTaskCreatedEvent(input: TaskCreatedEventInput): void {
    assertPublicId(input.transactionPublicId, "Transaction public ID");
    assertChainId(input.chainId);
    assertAddress(input.contractAddress, "Contract address");
    assertHash(input.transactionHash, "Transaction hash");
    assertHash(input.blockHash, "Block hash");
    assertAddress(input.creator, "Event creator");
    assertAddress(input.assignee, "Event assignee");
    assertHash(input.taskHash, "Event task hash");
    assertHash(input.policyHash, "Event policy hash");
    assertDate(input.confirmedAt, "Confirmation time");
    if (
      !Number.isSafeInteger(input.logIndex) ||
      input.logIndex < 0 ||
      input.blockNumber < 0n ||
      input.chainTaskId <= 0n ||
      input.rewardWei < 0n ||
      input.rewardWei > UINT96_MAX ||
      input.deadlineUnixSeconds < 0n ||
      input.deadlineUnixSeconds > UINT64_MAX
    ) {
      throw invalid("TaskCreated event numeric fields are invalid");
    }
  }

  private assertEventBinding(
    transaction: typeof chainTransactions.$inferSelect,
    task: typeof tasks.$inferSelect,
    input: TaskCreatedEventInput
  ): void {
    const expectedDeadline = task.deadline === null ? 0n : BigInt(task.deadline.getTime() / 1000);
    if (
      transaction.chainId !== input.chainId ||
      transaction.transactionHash !== input.transactionHash ||
      transaction.fromAddress !== input.creator ||
      transaction.toAddress !== input.contractAddress ||
      task.chainId !== input.chainId ||
      task.contractAddress !== input.contractAddress ||
      task.creatorWallet !== input.creator ||
      task.assigneeWallet !== input.assignee ||
      task.taskHash !== input.taskHash ||
      task.policyHash !== input.policyHash ||
      task.rewardWei !== input.rewardWei ||
      expectedDeadline !== input.deadlineUnixSeconds ||
      (task.chainTaskId !== null && task.chainTaskId !== input.chainTaskId)
    ) {
      throw conflict("TaskCreated event does not exactly bind the task and transaction");
    }
  }
}
