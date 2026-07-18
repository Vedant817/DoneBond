import { and, desc, eq, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import {
  apiIdempotencyKeys,
  auditEvents,
  chainTransactions,
  cliTokens,
  contractEvents,
  databaseSchema,
  evidenceBundles,
  policies,
  projectMembers,
  projects,
  receiptAttestations,
  tasks,
  verificationChecks
} from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type ProjectInsert = typeof projects.$inferInsert;
type PolicyInsert = typeof policies.$inferInsert;
type TaskInsert = typeof tasks.$inferInsert;
type EvidenceInsert = typeof evidenceBundles.$inferInsert;
type VerificationCheckInsert = Omit<typeof verificationChecks.$inferInsert, "evidenceBundleId">;
type ChainTransactionInsert = typeof chainTransactions.$inferInsert;
type ChainTransactionStatus = NonNullable<ChainTransactionInsert["status"]>;
type ChainTransactionUpdate = Partial<
  Pick<
    typeof chainTransactions.$inferInsert,
    | "blockNumber"
    | "failureCode"
    | "nonce"
    | "replacedByTransactionId"
    | "status"
    | "transactionHash"
  >
>;
type ContractEventInsert = typeof contractEvents.$inferInsert;
type AuditEventInsert = typeof auditEvents.$inferInsert;

const persistedPolicySchema = z.object({
  checks: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
        label: z.string().min(1).max(128),
        required: z.boolean()
      })
    )
    .min(1)
    .max(100)
});

export interface IdempotencyContext {
  readonly actorScope: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestHash: string;
  readonly expiresAt: Date;
}

export interface EvidencePersistenceInput {
  readonly bundle: EvidenceInsert;
  readonly checks: readonly VerificationCheckInsert[];
  readonly actorScope: string;
  readonly expiresAt: Date;
  readonly audit: AuditEventInsert;
}

export interface ProjectAccessRecord {
  readonly projectPublicId: string;
  readonly role: "owner" | "member";
}

export interface ReceiptCheckSummary {
  readonly checkKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: string;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
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
  readonly deadline: Date | null;
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
  readonly submittedAt: Date;
}

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeJson(child)])
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function assertAuditScope(
  audit: AuditEventInsert,
  projectId: string,
  taskId: string | null = null,
  actorUserId?: string
): void {
  if (audit.projectId !== projectId || (audit.taskId ?? null) !== taskId) {
    throw invalid("Audit scope does not match the mutated resource");
  }
  if (actorUserId !== undefined && audit.actorUserId !== actorUserId) {
    throw invalid("Audit actor does not match the mutation actor");
  }
}

function expectedActorScope(kind: "user" | "cli-token", id: string): string {
  return `${kind}:${id}`;
}

function assertActorScope(input: IdempotencyContext, expected: string): void {
  if (input.actorScope !== expected) {
    throw invalid("Idempotency actor scope does not match the authenticated actor");
  }
}

function assertChecksMatchPolicy(
  canonicalPolicy: unknown,
  checks: readonly VerificationCheckInsert[]
): void {
  const parsed = persistedPolicySchema.safeParse(canonicalPolicy);
  if (!parsed.success) throw invalid("Persisted canonical policy checks are malformed");
  const expected = parsed.data.checks;
  if (new Set(expected.map((check) => check.key)).size !== expected.length) {
    throw invalid("Persisted canonical policy contains duplicate check keys");
  }
  if (checks.length !== expected.length) {
    throw invalid("Evidence checks do not exactly match the canonical policy");
  }
  const actualByKey = new Map(checks.map((check) => [check.checkKey, check]));
  if (actualByKey.size !== checks.length) throw invalid("Evidence check keys must be unique");
  for (const policyCheck of expected) {
    const actual = actualByKey.get(policyCheck.key);
    if (!actual || actual.required !== policyCheck.required || actual.label !== policyCheck.label) {
      throw invalid("Evidence check identity differs from the canonical policy");
    }
  }
}

const allowedChainTransitions: Readonly<
  Record<ChainTransactionStatus, readonly ChainTransactionStatus[]>
> = {
  prepared: ["wallet_requested", "rejected_by_user"],
  wallet_requested: ["submitted", "rejected_by_user", "unknown_reconcile"],
  submitted: ["confirmed", "replaced", "reverted", "unknown_reconcile"],
  unknown_reconcile: ["submitted", "confirmed", "replaced", "reverted"],
  replaced: [],
  confirmed: [],
  rejected_by_user: [],
  reverted: []
};

const initialChainTransactionStatuses = new Set<ChainTransactionStatus>([
  "prepared",
  "wallet_requested",
  "submitted"
]);

export class DoneBondRepository {
  public constructor(private readonly database: Database) {}

  public async createProject(
    input: ProjectInsert,
    audit: AuditEventInsert,
    idempotency: IdempotencyContext
  ) {
    if (audit.actorUserId !== input.ownerUserId) {
      throw invalid("Project creation audit actor must be the owner");
    }
    assertActorScope(idempotency, expectedActorScope("user", input.ownerUserId));
    if (idempotency.operation !== "project_create") {
      throw invalid("Project creation idempotency operation is invalid");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const reserved = await transaction
          .insert(apiIdempotencyKeys)
          .values({ ...idempotency, resourcePublicId: input.publicId })
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning();
        if (!reserved[0]) {
          await this.assertIdempotentReplay(transaction, idempotency, input.publicId);
          const [existing] = await transaction
            .select()
            .from(projects)
            .where(eq(projects.publicId, input.publicId))
            .limit(1);
          if (!existing) throw invalid("Idempotency record has no project resource");
          return existing;
        }
        const [project] = await transaction.insert(projects).values(input).returning();
        if (!project) throw invalid("Project insert returned no row");
        if (audit.projectId && audit.projectId !== project.id)
          throw invalid("Audit project ID must match created project");
        await transaction.insert(projectMembers).values({
          projectId: project.id,
          role: "owner",
          userId: project.ownerUserId
        });
        await transaction.insert(auditEvents).values({ ...audit, projectId: project.id });
        return project;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async savePolicy(
    input: PolicyInsert,
    activate: boolean,
    audit: AuditEventInsert,
    idempotency: IdempotencyContext
  ) {
    assertAuditScope(audit, input.projectId);
    if (idempotency.operation !== "policy_save") {
      throw invalid("Policy idempotency operation is invalid");
    }
    const actorUserId = audit.actorUserId;
    if (!actorUserId) throw invalid("Policy mutation requires an authenticated actor");
    assertActorScope(idempotency, expectedActorScope("user", actorUserId));
    try {
      return await this.database.transaction(async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id, ownerUserId: projects.ownerUserId, status: projects.status })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .for("update")
          .limit(1);
        const [membership] = await transaction
          .select({ role: projectMembers.role, userId: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.userId, actorUserId)
            )
          )
          .for("share")
          .limit(1);
        if (
          !project ||
          !membership ||
          project.status !== "active" ||
          membership.role !== "owner" ||
          project.ownerUserId !== membership.userId
        ) {
          throw new DatabaseServiceError("DB_NOT_FOUND", "Policy project was not found");
        }
        const reserved = await transaction
          .insert(apiIdempotencyKeys)
          .values({ ...idempotency, resourcePublicId: input.publicId })
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning();
        if (!reserved[0]) {
          await this.assertIdempotentReplay(transaction, idempotency, input.publicId);
          const [existing] = await transaction
            .select()
            .from(policies)
            .where(eq(policies.publicId, input.publicId))
            .limit(1);
          if (!existing) throw invalid("Idempotency record has no policy resource");
          return existing;
        }
        const [policy] = await transaction.insert(policies).values(input).returning();
        if (!policy) throw invalid("Policy insert returned no row");
        if (activate) {
          await transaction
            .update(projects)
            .set({ activePolicyId: policy.id, updatedAt: new Date() })
            .where(eq(projects.id, policy.projectId));
        }
        await transaction.insert(auditEvents).values(audit);
        return policy;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async createTask(
    input: TaskInsert,
    audit: AuditEventInsert,
    idempotency: IdempotencyContext
  ) {
    assertAuditScope(audit, input.projectId);
    if (idempotency.operation !== "task_create") {
      throw invalid("Task idempotency operation is invalid");
    }
    const actorUserId = audit.actorUserId;
    if (!actorUserId) throw invalid("Task mutation requires an authenticated actor");
    assertActorScope(idempotency, expectedActorScope("user", actorUserId));
    try {
      return await this.database.transaction(async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .for("update")
          .limit(1);
        const [policy] = await transaction
          .select({ id: policies.id })
          .from(policies)
          .where(
            and(
              eq(policies.id, input.policyId),
              eq(policies.projectId, input.projectId),
              eq(policies.policyHash, input.policyHash)
            )
          )
          .for("share")
          .limit(1);
        const [membership] = await transaction
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.userId, actorUserId)
            )
          )
          .for("share")
          .limit(1);
        if (!project || !policy || !membership)
          throw invalid("Task project, policy, or membership binding is invalid");
        const reserved = await transaction
          .insert(apiIdempotencyKeys)
          .values({ ...idempotency, resourcePublicId: input.publicId })
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning();
        if (!reserved[0]) {
          await this.assertIdempotentReplay(transaction, idempotency, input.publicId);
          const [existing] = await transaction
            .select()
            .from(tasks)
            .where(eq(tasks.publicId, input.publicId))
            .limit(1);
          if (!existing) throw invalid("Idempotency record has no task resource");
          return existing;
        }
        const [task] = await transaction.insert(tasks).values(input).returning();
        if (!task) throw invalid("Task insert returned no row");
        if (audit.taskId && audit.taskId !== task.id)
          throw invalid("Audit task ID must match created task");
        await transaction.insert(auditEvents).values({ ...audit, taskId: task.id });
        return task;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async persistEvidence(input: EvidencePersistenceInput) {
    assertAuditScope(input.audit, input.bundle.projectId, input.bundle.taskId);
    if (input.actorScope !== expectedActorScope("cli-token", input.bundle.submittedByTokenId)) {
      throw invalid("Evidence actor scope does not match the submitting token");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [task] = await transaction
          .select()
          .from(tasks)
          .where(eq(tasks.id, input.bundle.taskId))
          .for("update")
          .limit(1);
        const [policy] = await transaction
          .select()
          .from(policies)
          .where(eq(policies.id, input.bundle.policyId))
          .for("share")
          .limit(1);
        const [token] = await transaction
          .select()
          .from(cliTokens)
          .where(eq(cliTokens.id, input.bundle.submittedByTokenId))
          .for("update")
          .limit(1);
        if (
          !task ||
          !policy ||
          !token ||
          task.projectId !== input.bundle.projectId ||
          task.policyId !== input.bundle.policyId ||
          task.policyHash !== policy.policyHash ||
          policy.projectId !== input.bundle.projectId ||
          token.projectId !== input.bundle.projectId ||
          token.revokedAt !== null
        ) {
          throw invalid("Evidence task, project, policy, or token binding is invalid");
        }
        assertChecksMatchPolicy(policy.canonicalJson, input.checks);
        const required = input.checks.filter((check) => check.required);
        if (required.length === 0) throw invalid("Evidence requires at least one required check");
        const passing = required.every(
          (check) => check.status === "passed" && check.exitCode === 0
        );
        if (input.bundle.passing !== passing) {
          throw invalid("Evidence passing status is not derived correctly");
        }
        const idempotency = {
          actorScope: input.actorScope,
          idempotencyKey: input.bundle.idempotencyKey,
          operation: "evidence_upload",
          requestHash: input.bundle.requestHash,
          expiresAt: input.expiresAt
        } satisfies IdempotencyContext;
        const reserved = await transaction
          .insert(apiIdempotencyKeys)
          .values({ ...idempotency, resourcePublicId: input.bundle.publicId })
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning();
        if (!reserved[0]) {
          await this.assertIdempotentReplay(transaction, idempotency, input.bundle.publicId);
          const [existing] = await transaction
            .select()
            .from(evidenceBundles)
            .where(
              and(
                eq(evidenceBundles.submittedByTokenId, input.bundle.submittedByTokenId),
                eq(evidenceBundles.idempotencyKey, input.bundle.idempotencyKey)
              )
            )
            .limit(1);
          if (!existing || existing.requestHash !== input.bundle.requestHash) {
            throw new DatabaseServiceError(
              "DB_IDEMPOTENCY_CONFLICT",
              "Evidence replay does not match the persisted request"
            );
          }
          return existing;
        }
        const [bundle] = await transaction.insert(evidenceBundles).values(input.bundle).returning();
        if (!bundle) throw invalid("Evidence insert returned no row");
        await transaction
          .insert(verificationChecks)
          .values(input.checks.map((check) => ({ ...check, evidenceBundleId: bundle.id })));
        await transaction.insert(auditEvents).values(input.audit);
        return bundle;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async registerChainTransaction(input: ChainTransactionInsert, audit: AuditEventInsert) {
    const initialStatus = input.status ?? "prepared";
    if (!initialChainTransactionStatuses.has(initialStatus)) {
      throw invalid("Chain transaction registration status is not an initial state");
    }
    if (input.replacedByTransactionId !== undefined && input.replacedByTransactionId !== null) {
      throw invalid("A new chain transaction cannot predeclare a replacement");
    }
    assertAuditScope(audit, input.projectId, input.taskId ?? null, input.userId);
    try {
      return await this.database.transaction(async (transaction) => {
        const [membership] = await transaction
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.userId, input.userId)
            )
          )
          .for("update")
          .limit(1);
        if (!membership) throw invalid("Chain transaction actor is not a project member");
        if (input.taskId) {
          const [task] = await transaction
            .select({ id: tasks.id })
            .from(tasks)
            .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId)))
            .for("share")
            .limit(1);
          if (!task) throw invalid("Chain transaction task is outside the project");
        }
        const inserted = await transaction
          .insert(chainTransactions)
          .values(input)
          .onConflictDoNothing({
            target: [
              chainTransactions.userId,
              chainTransactions.intentType,
              chainTransactions.idempotencyKey
            ]
          })
          .returning();
        if (inserted[0]) {
          await transaction.insert(auditEvents).values(audit);
          return inserted[0];
        }
        const [existing] = await transaction
          .select()
          .from(chainTransactions)
          .where(
            and(
              eq(chainTransactions.userId, input.userId),
              eq(chainTransactions.intentType, input.intentType),
              eq(chainTransactions.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (!existing || existing.requestHash !== input.requestHash) {
          throw new DatabaseServiceError(
            "DB_IDEMPOTENCY_CONFLICT",
            "The chain transaction key was already used with different content"
          );
        }
        return existing;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async updateChainTransactionState(
    publicId: string,
    expectedStatus: ChainTransactionStatus,
    update: ChainTransactionUpdate,
    audit: AuditEventInsert
  ) {
    if (!update.status || !allowedChainTransitions[expectedStatus]?.includes(update.status)) {
      throw invalid("Chain transaction status transition is invalid");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(chainTransactions)
          .where(eq(chainTransactions.publicId, publicId))
          .for("update")
          .limit(1);
        if (!existing || existing.status !== expectedStatus) {
          throw new DatabaseServiceError("DB_CONFLICT", "Chain transaction state changed");
        }
        assertAuditScope(audit, existing.projectId, existing.taskId);
        if (update.status === "replaced") {
          if (!update.replacedByTransactionId) {
            throw invalid("A replaced transaction requires its replacement ID");
          }
          const [replacement] = await transaction
            .select()
            .from(chainTransactions)
            .where(eq(chainTransactions.id, update.replacedByTransactionId))
            .for("share")
            .limit(1);
          const replacementStatusAllowed =
            replacement &&
            ["submitted", "confirmed", "unknown_reconcile"].includes(replacement.status);
          if (
            !replacement ||
            replacement.id === existing.id ||
            replacement.userId !== existing.userId ||
            replacement.projectId !== existing.projectId ||
            replacement.chainId !== existing.chainId ||
            replacement.taskId !== existing.taskId ||
            replacement.intentType !== existing.intentType ||
            replacement.fromAddress !== existing.fromAddress ||
            replacement.toAddress !== existing.toAddress ||
            replacement.nonce === null ||
            existing.nonce === null ||
            replacement.nonce !== existing.nonce ||
            replacement.transactionHash === null ||
            replacement.transactionHash === existing.transactionHash ||
            !replacementStatusAllowed
          ) {
            throw invalid("Replacement transaction scope or nonce is invalid");
          }
        } else if (update.replacedByTransactionId !== undefined) {
          throw invalid("Only a replaced state may reference a replacement transaction");
        }
        const [updated] = await transaction
          .update(chainTransactions)
          .set({ ...update, updatedAt: new Date() })
          .where(
            and(
              eq(chainTransactions.id, existing.id),
              eq(chainTransactions.status, existing.status)
            )
          )
          .returning();
        if (!updated) throw new DatabaseServiceError("DB_CONFLICT", "Chain update lost a race");
        await transaction.insert(auditEvents).values(audit);
        return updated;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async appendContractEvent(input: ContractEventInsert, audit: AuditEventInsert) {
    const projectId = audit.projectId;
    const taskId = audit.taskId;
    if (!projectId || !taskId) throw invalid("Contract event audit requires task scope");
    try {
      return await this.database.transaction(async (transaction) => {
        const [task] = await transaction
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
          .for("update")
          .limit(1);
        if (
          !task ||
          task.chainId !== input.chainId ||
          task.contractAddress !== input.contractAddress
        ) {
          throw invalid("Contract event does not match its audited task");
        }
        const inserted = await transaction
          .insert(contractEvents)
          .values(input)
          .onConflictDoNothing({
            target: [
              contractEvents.chainId,
              contractEvents.transactionHash,
              contractEvents.logIndex
            ]
          })
          .returning();
        if (inserted[0]) {
          await transaction.insert(auditEvents).values(audit);
          return inserted[0];
        }
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
          .for("update")
          .limit(1);
        if (
          !existing ||
          existing.contractAddress !== input.contractAddress ||
          existing.eventName !== input.eventName ||
          !sameJson(existing.decodedJson, input.decodedJson)
        ) {
          throw new DatabaseServiceError(
            "DB_CONFLICT",
            "A conflicting contract event already occupies this chain log identity"
          );
        }
        if (
          existing.blockHash === input.blockHash &&
          existing.blockNumber === input.blockNumber &&
          existing.removed === (input.removed ?? false)
        ) {
          return existing;
        }
        if (existing.removed === (input.removed ?? false)) {
          throw new DatabaseServiceError(
            "DB_CONFLICT",
            "A chain log may change block identity only during a removed-state transition"
          );
        }
        const [updated] = await transaction
          .update(contractEvents)
          .set({
            blockHash: input.blockHash,
            blockNumber: input.blockNumber,
            removed: input.removed ?? false
          })
          .where(eq(contractEvents.id, existing.id))
          .returning();
        if (!updated) throw new DatabaseServiceError("DB_CONFLICT", "Event update lost a race");
        await transaction.insert(auditEvents).values(audit);
        return updated;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async findTaskForMember(publicId: string, actorUserId: string) {
    const [task] = await this.database
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, actorUserId))
      )
      .where(eq(tasks.publicId, publicId))
      .limit(1);
    return task?.task ?? null;
  }

  public async findProjectForMember(publicId: string, actorUserId: string) {
    const [project] = await this.database
      .select({ project: projects })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
      )
      .where(eq(projects.publicId, publicId))
      .limit(1);
    return project?.project ?? null;
  }

  public async findTaskBinding(taskPublicId: string): Promise<{
    readonly id: string;
    readonly projectId: string;
    readonly projectPublicId: string;
    readonly policyId: string;
    readonly taskHash: string;
    readonly policyHash: string;
  } | null> {
    try {
      const [task] = await this.database
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          projectPublicId: projects.publicId,
          policyId: tasks.policyId,
          taskHash: tasks.taskHash,
          policyHash: policies.policyHash
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(policies, eq(policies.id, tasks.policyId))
        .where(eq(tasks.publicId, taskPublicId))
        .limit(1);
      return task ?? null;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async listEvidence(
    taskPublicId: string,
    options: { readonly limit: number; readonly cursor?: { createdAt: Date; publicId: string } }
  ) {
    try {
      const [task] = await this.database
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.publicId, taskPublicId))
        .limit(1);
      if (!task) return { items: [], nextCursor: null };
      const cursorCondition = options.cursor
        ? or(
            lt(evidenceBundles.createdAt, options.cursor.createdAt),
            and(
              eq(evidenceBundles.createdAt, options.cursor.createdAt),
              lt(evidenceBundles.publicId, options.cursor.publicId)
            )
          )
        : undefined;
      const rows = await this.database
        .select({
          publicId: evidenceBundles.publicId,
          taskPublicId: tasks.publicId,
          projectPublicId: projects.publicId,
          evidenceHash: evidenceBundles.evidenceHash,
          commitHashDerived: evidenceBundles.commitHashDerived,
          gitObjectId: evidenceBundles.gitObjectId,
          passing: evidenceBundles.passing,
          bundleSizeBytes: evidenceBundles.bundleSizeBytes,
          schemaVersion: evidenceBundles.schemaVersion,
          createdAt: evidenceBundles.createdAt
        })
        .from(evidenceBundles)
        .innerJoin(tasks, eq(tasks.id, evidenceBundles.taskId))
        .innerJoin(projects, eq(projects.id, evidenceBundles.projectId))
        .where(
          cursorCondition
            ? and(eq(evidenceBundles.taskId, task.id), cursorCondition)
            : eq(evidenceBundles.taskId, task.id)
        )
        .orderBy(desc(evidenceBundles.createdAt), desc(evidenceBundles.publicId))
        .limit(options.limit + 1);
      const items = rows.slice(0, options.limit);
      const last = rows[options.limit];
      const nextCursor =
        last === undefined ? null : { createdAt: last.createdAt, publicId: last.publicId };
      return { items, nextCursor };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async getEvidence(publicId: string) {
    try {
      const [bundle] = await this.database
        .select({
          id: evidenceBundles.id,
          publicId: evidenceBundles.publicId,
          taskPublicId: tasks.publicId,
          projectPublicId: projects.publicId,
          bundleJson: evidenceBundles.bundleJson,
          evidenceHash: evidenceBundles.evidenceHash,
          commitHashDerived: evidenceBundles.commitHashDerived,
          gitObjectId: evidenceBundles.gitObjectId,
          passing: evidenceBundles.passing,
          bundleSizeBytes: evidenceBundles.bundleSizeBytes,
          schemaVersion: evidenceBundles.schemaVersion,
          createdAt: evidenceBundles.createdAt
        })
        .from(evidenceBundles)
        .innerJoin(tasks, eq(tasks.id, evidenceBundles.taskId))
        .innerJoin(projects, eq(projects.id, evidenceBundles.projectId))
        .where(eq(evidenceBundles.publicId, publicId))
        .limit(1);
      if (!bundle) return null;
      const checks = await this.database
        .select()
        .from(verificationChecks)
        .where(eq(verificationChecks.evidenceBundleId, bundle.id))
        .orderBy(verificationChecks.checkKey);
      return {
        ...bundle,
        checks: checks.map((check) => ({
          checkKey: check.checkKey,
          label: check.label,
          required: check.required,
          status: check.status,
          startedAt: check.startedAt,
          durationMs: check.durationMs,
          exitCode: check.exitCode,
          signal: check.signal,
          stdoutDigest: check.stdoutDigest,
          stderrDigest: check.stderrDigest,
          stdoutPreview: check.stdoutPreview,
          stderrPreview: check.stderrPreview
        }))
      };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  /**
   * Public, no-auth receipt read for a task whose `submit_receipt` chain
   * transaction has been confirmed. Returns `null` for any task that does not
   * yet have a confirmed receipt (unknown task, no receipt intent, or the
   * intent is still pending) so callers cannot distinguish "task does not
   * exist" from "receipt not yet submitted" beyond a generic not-found.
   */
  public async getPublicReceipt(taskPublicId: string): Promise<ReceiptRecord | null> {
    try {
      const [row] = await this.database
        .select({
          task: tasks,
          projectPublicId: projects.publicId,
          transactionHash: chainTransactions.transactionHash,
          transactionCreatedAt: chainTransactions.updatedAt,
          attestation: receiptAttestations,
          evidence: evidenceBundles
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(
          chainTransactions,
          and(
            eq(chainTransactions.taskId, tasks.id),
            eq(chainTransactions.intentType, "submit_receipt"),
            eq(chainTransactions.status, "confirmed")
          )
        )
        .innerJoin(
          receiptAttestations,
          eq(receiptAttestations.chainTransactionId, chainTransactions.id)
        )
        .innerJoin(evidenceBundles, eq(evidenceBundles.id, receiptAttestations.evidenceBundleId))
        .where(eq(tasks.publicId, taskPublicId))
        .limit(1);
      if (!row || row.task.chainTaskId === null || row.transactionHash === null) return null;
      return this.receiptRecord(row);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  /**
   * Same data as {@link getPublicReceipt} for an authenticated project member
   * (owner or member). Returns `null` for a nonmember, matching the existing
   * task/evidence read conventions of not distinguishing "not found" from
   * "not authorized".
   */
  public async getReceiptForMember(
    taskPublicId: string,
    actorUserId: string
  ): Promise<ReceiptRecord | null> {
    try {
      const [row] = await this.database
        .select({
          task: tasks,
          projectPublicId: projects.publicId,
          transactionHash: chainTransactions.transactionHash,
          transactionCreatedAt: chainTransactions.updatedAt,
          attestation: receiptAttestations,
          evidence: evidenceBundles
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(
          projectMembers,
          and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, actorUserId))
        )
        .innerJoin(
          chainTransactions,
          and(
            eq(chainTransactions.taskId, tasks.id),
            eq(chainTransactions.intentType, "submit_receipt"),
            eq(chainTransactions.status, "confirmed")
          )
        )
        .innerJoin(
          receiptAttestations,
          eq(receiptAttestations.chainTransactionId, chainTransactions.id)
        )
        .innerJoin(evidenceBundles, eq(evidenceBundles.id, receiptAttestations.evidenceBundleId))
        .where(eq(tasks.publicId, taskPublicId))
        .limit(1);
      if (!row || row.task.chainTaskId === null || row.transactionHash === null) return null;
      return this.receiptRecord(row);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private async receiptRecord(row: {
    readonly task: typeof tasks.$inferSelect;
    readonly projectPublicId: string;
    readonly transactionHash: string | null;
    readonly transactionCreatedAt: Date;
    readonly attestation: typeof receiptAttestations.$inferSelect;
    readonly evidence: typeof evidenceBundles.$inferSelect;
  }): Promise<ReceiptRecord> {
    if (row.task.chainTaskId === null || row.transactionHash === null) {
      throw invalid("Receipt is missing its confirmed chain task ID or transaction hash");
    }
    const checks = await this.database
      .select()
      .from(verificationChecks)
      .where(eq(verificationChecks.evidenceBundleId, row.evidence.id))
      .orderBy(verificationChecks.checkKey);
    return {
      taskPublicId: row.task.publicId,
      projectPublicId: row.projectPublicId,
      chainId: row.task.chainId,
      contractAddress: row.task.contractAddress,
      chainTaskId: row.task.chainTaskId.toString(),
      title: row.task.title,
      taskHash: row.task.taskHash,
      policyHash: row.task.policyHash,
      creatorWallet: row.task.creatorWallet,
      assigneeWallet: row.task.assigneeWallet,
      rewardWei: row.task.rewardWei.toString(),
      deadline: row.task.deadline,
      offchainStatus: row.task.offchainStatus,
      chainStatus: row.task.chainStatus,
      evidencePublicId: row.evidence.publicId,
      evidenceHash: row.evidence.evidenceHash,
      commitHashDerived: row.evidence.commitHashDerived,
      gitObjectId: row.evidence.gitObjectId,
      checks: checks.map((check) => ({
        checkKey: check.checkKey,
        label: check.label,
        required: check.required,
        status: check.status,
        startedAt: check.startedAt,
        durationMs: check.durationMs,
        exitCode: check.exitCode,
        signal: check.signal,
        stdoutDigest: check.stdoutDigest,
        stderrDigest: check.stderrDigest,
        stdoutPreview: check.stdoutPreview,
        stderrPreview: check.stderrPreview
      })),
      verifierAddress: row.attestation.verifierAddress,
      signature: row.attestation.signature,
      typedDataDigest: row.attestation.typedDataDigest,
      attestationExpiryUnixSeconds: row.attestation.attestationExpiry.toString(),
      submissionTransactionHash: row.transactionHash,
      submittedAt: row.transactionCreatedAt
    };
  }

  /**
   * Resolves project authorization without a separate project-existence query.
   * Missing projects and projects the actor cannot access both return null so a
   * service can expose the same PROJECT_NOT_FOUND response for either case.
   */
  public async findProjectAccess(
    publicId: string,
    actorUserId: string
  ): Promise<ProjectAccessRecord | null> {
    try {
      const [authorization] = await this.database
        .select({
          projectPublicId: projects.publicId,
          ownerUserId: projects.ownerUserId,
          userId: projectMembers.userId,
          role: projectMembers.role
        })
        .from(projects)
        .innerJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
        )
        .where(eq(projects.publicId, publicId))
        .limit(1);
      if (!authorization) return null;
      const isProjectOwner = authorization.ownerUserId === authorization.userId;
      if ((authorization.role === "owner") !== isProjectOwner) {
        throw new DatabaseServiceError(
          "DB_CONFLICT",
          "Project owner and membership role are inconsistent"
        );
      }
      return {
        projectPublicId: authorization.projectPublicId,
        role: authorization.role
      };
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private async assertIdempotentReplay(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: IdempotencyContext,
    resourcePublicId: string
  ): Promise<void> {
    const [existing] = await transaction
      .select()
      .from(apiIdempotencyKeys)
      .where(
        and(
          eq(apiIdempotencyKeys.actorScope, input.actorScope),
          eq(apiIdempotencyKeys.operation, input.operation),
          eq(apiIdempotencyKeys.idempotencyKey, input.idempotencyKey)
        )
      )
      .for("share")
      .limit(1);
    if (
      !existing ||
      existing.requestHash !== input.requestHash ||
      existing.resourcePublicId !== resourcePublicId
    ) {
      throw new DatabaseServiceError(
        "DB_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used with different content"
      );
    }
  }
}
