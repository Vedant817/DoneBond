import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import {
  apiIdempotencyKeys,
  auditEvents,
  chainTransactions,
  contractEvents,
  databaseSchema,
  evidenceBundles,
  policies,
  projectMembers,
  projects,
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
type ContractEventInsert = typeof contractEvents.$inferInsert;
type AuditEventInsert = typeof auditEvents.$inferInsert;
type IdempotencyInsert = typeof apiIdempotencyKeys.$inferInsert;

export interface EvidencePersistenceInput {
  readonly bundle: EvidenceInsert;
  readonly checks: readonly VerificationCheckInsert[];
  readonly audit: AuditEventInsert;
}

export interface IdempotencyReservation {
  readonly replay: boolean;
  readonly resourcePublicId: string | null;
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

export class DoneBondRepository {
  public constructor(private readonly database: Database) {}

  public async createProject(input: ProjectInsert, audit: AuditEventInsert) {
    try {
      return await this.database.transaction(async (transaction) => {
        const [project] = await transaction.insert(projects).values(input).returning();
        if (!project)
          throw new DatabaseServiceError("DB_INVALID_INPUT", "Project insert returned no row");
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

  public async savePolicy(input: PolicyInsert, activate: boolean, audit: AuditEventInsert) {
    try {
      return await this.database.transaction(async (transaction) => {
        const [policy] = await transaction.insert(policies).values(input).returning();
        if (!policy)
          throw new DatabaseServiceError("DB_INVALID_INPUT", "Policy insert returned no row");
        if (activate) {
          await transaction
            .update(projects)
            .set({ activePolicyId: policy.id, updatedAt: new Date() })
            .where(eq(projects.id, policy.projectId));
        }
        await transaction.insert(auditEvents).values({ ...audit, projectId: policy.projectId });
        return policy;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async createTask(input: TaskInsert, audit: AuditEventInsert) {
    try {
      return await this.database.transaction(async (transaction) => {
        const [task] = await transaction.insert(tasks).values(input).returning();
        if (!task)
          throw new DatabaseServiceError("DB_INVALID_INPUT", "Task insert returned no row");
        await transaction.insert(auditEvents).values({
          ...audit,
          projectId: task.projectId,
          taskId: task.id
        });
        return task;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async persistEvidence(input: EvidencePersistenceInput) {
    try {
      return await this.database.transaction(async (transaction) => {
        const [bundle] = await transaction.insert(evidenceBundles).values(input.bundle).returning();
        if (!bundle) {
          throw new DatabaseServiceError("DB_INVALID_INPUT", "Evidence insert returned no row");
        }
        if (input.checks.length > 0) {
          await transaction
            .insert(verificationChecks)
            .values(input.checks.map((check) => ({ ...check, evidenceBundleId: bundle.id })));
        }
        await transaction.insert(auditEvents).values({ ...input.audit, taskId: bundle.taskId });
        return bundle;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async reserveIdempotencyKey(input: IdempotencyInsert): Promise<IdempotencyReservation> {
    try {
      return await this.database.transaction(async (transaction) => {
        const inserted = await transaction
          .insert(apiIdempotencyKeys)
          .values(input)
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning();
        if (inserted[0]) {
          return { replay: false, resourcePublicId: inserted[0].resourcePublicId };
        }
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
          .limit(1);
        if (!existing) {
          throw new DatabaseServiceError(
            "DB_CONFLICT",
            "Concurrent idempotency reservation disappeared"
          );
        }
        if (existing.requestHash !== input.requestHash) {
          throw new DatabaseServiceError(
            "DB_IDEMPOTENCY_CONFLICT",
            "The idempotency key was already used with different content"
          );
        }
        return { replay: true, resourcePublicId: existing.resourcePublicId };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async registerChainTransaction(input: ChainTransactionInsert) {
    try {
      return await this.database.transaction(async (transaction) => {
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
        if (inserted[0]) return inserted[0];
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
        if (!existing) {
          throw new DatabaseServiceError("DB_CONFLICT", "Concurrent chain transaction disappeared");
        }
        if (existing.requestHash !== input.requestHash) {
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

  public async appendContractEvent(input: ContractEventInsert) {
    try {
      return await this.database.transaction(async (transaction) => {
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
        if (inserted[0]) return inserted[0];
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
          .limit(1);
        if (
          !existing ||
          existing.blockHash !== input.blockHash ||
          existing.contractAddress !== input.contractAddress ||
          existing.eventName !== input.eventName ||
          !sameJson(existing.decodedJson, input.decodedJson)
        ) {
          throw new DatabaseServiceError(
            "DB_CONFLICT",
            "A conflicting contract event already occupies this chain log identity"
          );
        }
        return existing;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async findTaskByPublicId(publicId: string) {
    const [task] = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.publicId, publicId))
      .limit(1);
    return task ?? null;
  }

  public async findProjectByPublicId(publicId: string) {
    const [project] = await this.database
      .select()
      .from(projects)
      .where(eq(projects.publicId, publicId))
      .limit(1);
    return project ?? null;
  }

  public async appendAuditEvent(input: AuditEventInsert): Promise<void> {
    try {
      await this.database.insert(auditEvents).values(input);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}
