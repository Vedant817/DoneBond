import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import type { IdempotencyContext } from "./repository.js";
import {
  apiIdempotencyKeys,
  auditEvents,
  cliTokens,
  databaseSchema,
  projectMembers,
  projects
} from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateCliTokenInput {
  readonly actorUserId: string;
  readonly projectPublicId: string;
  readonly tokenPublicId: string;
  readonly tokenPrefix: string;
  /** HMAC-SHA-256 (or equivalent keyed SHA-256) of a 32-byte random token. */
  readonly tokenDigest: string;
}

export interface CliTokenMetadata {
  readonly tokenPublicId: string;
  readonly projectPublicId: string;
  readonly tokenPrefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface CliTokenPrincipal {
  readonly tokenId: string;
  readonly tokenPublicId: string;
  readonly projectId: string;
  readonly projectPublicId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PREFIX = /^[A-Za-z0-9_-]{4,16}$/u;

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function notFound(): DatabaseServiceError {
  return new DatabaseServiceError("DB_NOT_FOUND", "Project or CLI token was not found");
}

function assertDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalid(`${name} must be a valid date`);
  }
}

function assertIdentity(input: CreateCliTokenInput): void {
  if (!UUID.test(input.actorUserId)) throw invalid("CLI token actor user ID is invalid");
  if (!PUBLIC_ID.test(input.projectPublicId)) throw invalid("Project public ID is invalid");
  if (!PUBLIC_ID.test(input.tokenPublicId)) throw invalid("CLI token public ID is invalid");
  if (!PREFIX.test(input.tokenPrefix)) throw invalid("CLI token prefix is invalid");
  if (!DIGEST.test(input.tokenDigest)) {
    throw invalid("CLI token digest must be 64 lowercase hex characters");
  }
}

function toMetadata(row: typeof cliTokens.$inferSelect, projectPublicId: string): CliTokenMetadata {
  return {
    tokenPublicId: row.publicId,
    projectPublicId,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt
  };
}

export class DrizzleCliTokenRepository {
  public constructor(private readonly database: Database) {}

  public async create(
    input: CreateCliTokenInput,
    idempotency: IdempotencyContext
  ): Promise<CliTokenMetadata> {
    assertIdentity(input);
    if (
      idempotency.actorScope !== `user:${input.actorUserId}` ||
      idempotency.operation !== "cli_token_create"
    ) {
      throw invalid("CLI token idempotency scope or operation is invalid");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const projectId = await this.requireOwnerProject(
          transaction,
          input.projectPublicId,
          input.actorUserId
        );
        const reserved = await transaction
          .insert(apiIdempotencyKeys)
          .values({ ...idempotency, resourcePublicId: input.tokenPublicId })
          .onConflictDoNothing({
            target: [
              apiIdempotencyKeys.actorScope,
              apiIdempotencyKeys.operation,
              apiIdempotencyKeys.idempotencyKey
            ]
          })
          .returning({ resourcePublicId: apiIdempotencyKeys.resourcePublicId });
        if (!reserved[0]) {
          await this.assertReplay(transaction, input, idempotency, projectId);
          const [existing] = await transaction
            .select()
            .from(cliTokens)
            .where(
              and(eq(cliTokens.publicId, input.tokenPublicId), eq(cliTokens.projectId, projectId))
            )
            .limit(1);
          if (!existing)
            throw new DatabaseServiceError("DB_CONFLICT", "CLI token replay lost its resource");
          return toMetadata(existing, input.projectPublicId);
        }

        const [created] = await transaction
          .insert(cliTokens)
          .values({
            publicId: input.tokenPublicId,
            projectId,
            createdByUserId: input.actorUserId,
            tokenPrefix: input.tokenPrefix,
            tokenDigest: input.tokenDigest
          })
          .returning();
        if (!created)
          throw new DatabaseServiceError("DB_CONFLICT", "CLI token insert returned no row");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId,
          action: "cli_token.created",
          metadataSafeJson: {
            tokenPublicId: input.tokenPublicId,
            tokenPrefix: input.tokenPrefix
          }
        });
        return toMetadata(created, input.projectPublicId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  /** Authenticates and advances last_used_at in the same conditional UPDATE. */
  public async authenticate(
    projectPublicId: string,
    tokenDigest: string,
    usedAt: Date
  ): Promise<CliTokenPrincipal | null> {
    if (!PUBLIC_ID.test(projectPublicId)) throw invalid("Project public ID is invalid");
    if (!DIGEST.test(tokenDigest)) {
      throw invalid("CLI token digest must be 64 lowercase hex characters");
    }
    assertDate(usedAt, "CLI token use time");
    const usedAtSql = sql`${usedAt.toISOString()}::timestamptz`;
    try {
      const [authenticated] = await this.database
        .update(cliTokens)
        .set({
          lastUsedAt: sql`greatest(coalesce(${cliTokens.lastUsedAt}, ${usedAtSql}), ${usedAtSql})`
        })
        .from(projects)
        .where(
          and(
            eq(cliTokens.projectId, projects.id),
            eq(projects.publicId, projectPublicId),
            eq(cliTokens.tokenDigest, tokenDigest),
            isNull(cliTokens.revokedAt)
          )
        )
        .returning({
          tokenId: cliTokens.id,
          tokenPublicId: cliTokens.publicId,
          projectId: cliTokens.projectId
        });
      return authenticated ? { ...authenticated, projectPublicId } : null;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async revoke(
    actorUserId: string,
    projectPublicId: string,
    tokenPublicId: string,
    revokedAt: Date
  ): Promise<CliTokenMetadata | null> {
    if (!UUID.test(actorUserId)) throw invalid("CLI token actor user ID is invalid");
    if (!PUBLIC_ID.test(projectPublicId)) throw invalid("Project public ID is invalid");
    if (!PUBLIC_ID.test(tokenPublicId)) throw invalid("CLI token public ID is invalid");
    assertDate(revokedAt, "CLI token revocation time");
    try {
      return await this.database.transaction(async (transaction) => {
        const projectId = await this.requireOwnerProject(transaction, projectPublicId, actorUserId);
        const [revoked] = await transaction
          .update(cliTokens)
          .set({ revokedAt })
          .where(
            and(
              eq(cliTokens.publicId, tokenPublicId),
              eq(cliTokens.projectId, projectId),
              isNull(cliTokens.revokedAt)
            )
          )
          .returning();
        if (revoked) {
          await transaction.insert(auditEvents).values({
            actorUserId,
            projectId,
            action: "cli_token.revoked",
            metadataSafeJson: { tokenPublicId }
          });
          return toMetadata(revoked, projectPublicId);
        }
        const [existing] = await transaction
          .select()
          .from(cliTokens)
          .where(and(eq(cliTokens.publicId, tokenPublicId), eq(cliTokens.projectId, projectId)))
          .limit(1);
        return existing?.revokedAt ? toMetadata(existing, projectPublicId) : null;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private async requireOwnerProject(
    transaction: Transaction,
    projectPublicId: string,
    actorUserId: string
  ): Promise<string> {
    const [project] = await transaction
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, actorUserId),
          eq(projectMembers.role, "owner")
        )
      )
      .where(and(eq(projects.publicId, projectPublicId), eq(projects.ownerUserId, actorUserId)))
      .for("share")
      .limit(1);
    if (!project) throw notFound();
    return project.id;
  }

  private async assertReplay(
    transaction: Transaction,
    input: CreateCliTokenInput,
    idempotency: IdempotencyContext,
    projectId: string
  ): Promise<void> {
    const [replay] = await transaction
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
    const [token] = await transaction
      .select()
      .from(cliTokens)
      .where(and(eq(cliTokens.publicId, input.tokenPublicId), eq(cliTokens.projectId, projectId)))
      .for("share")
      .limit(1);
    if (
      !replay ||
      replay.requestHash !== idempotency.requestHash ||
      replay.resourcePublicId !== input.tokenPublicId ||
      !token ||
      token.createdByUserId !== input.actorUserId ||
      token.tokenDigest !== input.tokenDigest ||
      token.tokenPrefix !== input.tokenPrefix
    ) {
      throw new DatabaseServiceError(
        "DB_IDEMPOTENCY_CONFLICT",
        "CLI token idempotency key was already used with different content"
      );
    }
  }
}
