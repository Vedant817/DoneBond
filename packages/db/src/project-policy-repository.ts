import { SafeRepositoryUrlSchema } from "@donebond/shared";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import type { IdempotencyContext } from "./repository.js";
import {
  apiIdempotencyKeys,
  auditEvents,
  databaseSchema,
  policies,
  projectMembers,
  projects,
  tasks
} from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ProjectRole = "owner" | "member";

export interface CreateProjectInput {
  readonly actorUserId: string;
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly defaultBranch: string;
  readonly visibility: "private" | "public";
}

export interface UpdateProjectInput {
  readonly actorUserId: string;
  readonly projectPublicId: string;
  readonly changedAt: Date;
  readonly name?: string;
  readonly repositoryUrl?: string;
  readonly defaultBranch?: string;
  readonly visibility?: "private" | "public";
  readonly status?: "active" | "archived";
}

export interface ProjectView {
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly defaultBranch: string;
  readonly visibility: "private" | "public";
  readonly status: "active" | "archived";
  readonly activePolicyHash: string | null;
  readonly role: ProjectRole;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePolicyVersionInput {
  readonly actorUserId: string;
  readonly projectPublicId: string;
  readonly policyPublicId: string;
  readonly schemaVersion: number;
  readonly canonicalJson: unknown;
  readonly policyHash: string;
  readonly sourcePath: string;
  readonly activate?: boolean;
  readonly activatedAt?: Date;
}

export interface ActivatePolicyInput {
  readonly actorUserId: string;
  readonly projectPublicId: string;
  readonly policyPublicId: string;
  readonly activatedAt: Date;
}

export interface PolicyVersionView {
  readonly publicId: string;
  readonly projectPublicId: string;
  readonly schemaVersion: number;
  readonly canonicalJson: unknown;
  readonly policyHash: string;
  readonly sourcePath: string;
  readonly active: boolean;
  readonly createdAt: Date;
}

interface AuthorizedProject {
  readonly id: string;
  readonly activePolicyId: string | null;
  readonly role: ProjectRole;
  readonly repositoryUrl: string;
  readonly status: "active" | "archived";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BYTES_32 = /^0x[0-9a-f]{64}$/u;
const SAFE_SOURCE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).{1,512}$/u;

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function notFound(): DatabaseServiceError {
  return new DatabaseServiceError("DB_NOT_FOUND", "Project or policy was not found");
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw invalid(`${label} is invalid`);
}

function assertPublicId(value: string, label: string): void {
  if (!PUBLIC_ID.test(value)) throw invalid(`${label} is invalid`);
}

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalid(`${label} must be a valid date`);
  }
}

function assertNormalizedText(value: string, label: string, maximum: number): void {
  if (
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalid(`${label} is not normalized or is outside its size boundary`);
  }
}

function assertRepositoryUrl(value: string): void {
  const parsed = SafeRepositoryUrlSchema.safeParse(value);
  if (!parsed.success) throw invalid("Repository URL is invalid or contains credentials");
  const url = new URL(value);
  if (url.search !== "" || url.hash !== "") {
    throw invalid("Repository URL may not contain query parameters or a fragment");
  }
}

function assertBranch(value: string): void {
  const components = value.split("/");
  if (
    value.length < 1 ||
    value.length > 255 ||
    value !== value.trim() ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("//") ||
    components.some((component) => component.startsWith(".") || component.endsWith(".lock")) ||
    /[\u0000-\u0020\u007f~^:?*\\[]/u.test(value)
  ) {
    throw invalid("Default branch is not a safe Git branch name");
  }
}

function assertProjectCreate(input: CreateProjectInput): void {
  assertUuid(input.actorUserId, "Project actor user ID");
  assertPublicId(input.publicId, "Project public ID");
  if (input.slug.length > 63 || !SLUG.test(input.slug)) throw invalid("Project slug is invalid");
  assertNormalizedText(input.name, "Project name", 120);
  assertRepositoryUrl(input.repositoryUrl);
  assertBranch(input.defaultBranch);
  if (input.visibility !== "private" && input.visibility !== "public") {
    throw invalid("Project visibility is invalid");
  }
}

function assertProjectUpdate(input: UpdateProjectInput): void {
  assertUuid(input.actorUserId, "Project actor user ID");
  assertPublicId(input.projectPublicId, "Project public ID");
  assertDate(input.changedAt, "Project change time");
  const supplied = [
    input.name,
    input.repositoryUrl,
    input.defaultBranch,
    input.visibility,
    input.status
  ].filter((value) => value !== undefined);
  if (supplied.length === 0) throw invalid("Project update must contain at least one field");
  if (input.name !== undefined) assertNormalizedText(input.name, "Project name", 120);
  if (input.repositoryUrl !== undefined) assertRepositoryUrl(input.repositoryUrl);
  if (input.defaultBranch !== undefined) assertBranch(input.defaultBranch);
  if (
    input.visibility !== undefined &&
    input.visibility !== "private" &&
    input.visibility !== "public"
  ) {
    throw invalid("Project visibility is invalid");
  }
  if (input.status !== undefined && input.status !== "active" && input.status !== "archived") {
    throw invalid("Project status is invalid");
  }
}

function assertPolicyCreate(input: CreatePolicyVersionInput): void {
  assertUuid(input.actorUserId, "Policy actor user ID");
  assertPublicId(input.projectPublicId, "Project public ID");
  assertPublicId(input.policyPublicId, "Policy public ID");
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion <= 0) {
    throw invalid("Policy schema version must be a positive safe integer");
  }
  if (!BYTES_32.test(input.policyHash)) {
    throw invalid("Policy hash must be an exact lowercase bytes32 value");
  }
  if (!SAFE_SOURCE_PATH.test(input.sourcePath)) throw invalid("Policy source path is unsafe");
  if (input.activate !== undefined && typeof input.activate !== "boolean") {
    throw invalid("Policy activation flag is invalid");
  }
  if (input.activatedAt !== undefined) assertDate(input.activatedAt, "Policy activation time");
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.canonicalJson);
  } catch {
    throw invalid("Canonical policy payload must be JSON-serializable");
  }
  if (serialized === undefined || serialized.length > 1_048_576) {
    throw invalid("Canonical policy payload is missing or too large");
  }
}

function assertIdempotency(
  idempotency: IdempotencyContext,
  actorUserId: string,
  operation: "project_create" | "project_update" | "policy_create" | "policy_activate"
): void {
  if (
    idempotency.actorScope !== `user:${actorUserId}` ||
    idempotency.operation !== operation ||
    idempotency.idempotencyKey.length < 1 ||
    idempotency.idempotencyKey.length > 128 ||
    !BYTES_32.test(idempotency.requestHash)
  ) {
    throw invalid("Idempotency scope, operation, key, or request hash is invalid");
  }
  assertDate(idempotency.expiresAt, "Idempotency expiry");
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

function projectView(row: ProjectView): ProjectView {
  return { ...row };
}

function policyView(
  row: typeof policies.$inferSelect,
  projectPublicId: string,
  activePolicyId: string | null
): PolicyVersionView {
  return {
    publicId: row.publicId,
    projectPublicId,
    schemaVersion: row.schemaVersion,
    canonicalJson: row.canonicalJson,
    policyHash: row.policyHash,
    sourcePath: row.sourcePath,
    active: row.id === activePolicyId,
    createdAt: row.createdAt
  };
}

export class DrizzleProjectPolicyRepository {
  public constructor(private readonly database: Database) {}

  public async createProject(
    input: CreateProjectInput,
    idempotency: IdempotencyContext
  ): Promise<ProjectView> {
    assertProjectCreate(input);
    assertIdempotency(idempotency, input.actorUserId, "project_create");
    try {
      return await this.database.transaction(async (transaction) => {
        const reserved = await this.reserve(transaction, idempotency, input.publicId);
        if (!reserved) {
          const existing = await this.replayedProject(transaction, input, idempotency);
          return this.publicProject(existing, null, "owner");
        }
        const [created] = await transaction
          .insert(projects)
          .values({
            publicId: input.publicId,
            ownerUserId: input.actorUserId,
            slug: input.slug,
            name: input.name,
            repositoryUrl: input.repositoryUrl,
            defaultBranch: input.defaultBranch,
            visibility: input.visibility,
            status: "active"
          })
          .returning();
        if (!created)
          throw new DatabaseServiceError("DB_CONFLICT", "Project insert returned no row");
        await transaction.insert(projectMembers).values({
          projectId: created.id,
          userId: input.actorUserId,
          role: "owner"
        });
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: created.id,
          action: "project.created",
          metadataSafeJson: { projectPublicId: input.publicId }
        });
        return this.publicProject(created, null, "owner");
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async findProject(
    projectPublicId: string,
    actorUserId: string
  ): Promise<ProjectView | null> {
    assertPublicId(projectPublicId, "Project public ID");
    assertUuid(actorUserId, "Project actor user ID");
    try {
      const [row] = await this.projectReadQuery(this.database, actorUserId, projectPublicId).limit(
        1
      );
      return row ? projectView(row) : null;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async listProjects(actorUserId: string): Promise<readonly ProjectView[]> {
    assertUuid(actorUserId, "Project actor user ID");
    try {
      const rows = await this.projectReadQuery(this.database, actorUserId).orderBy(
        desc(projects.createdAt),
        desc(projects.publicId)
      );
      return rows.map(projectView);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async updateProject(
    input: UpdateProjectInput,
    idempotency: IdempotencyContext
  ): Promise<ProjectView> {
    assertProjectUpdate(input);
    assertIdempotency(idempotency, input.actorUserId, "project_update");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProject(
          transaction,
          input.projectPublicId,
          input.actorUserId,
          "owner",
          "update"
        );
        const reserved = await this.reserve(transaction, idempotency, input.projectPublicId);
        if (!reserved) {
          await this.assertReplay(transaction, idempotency, input.projectPublicId);
          return this.projectById(transaction, project.id, project.role);
        }
        const patch = {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.repositoryUrl === undefined ? {} : { repositoryUrl: input.repositoryUrl }),
          ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
          ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
          ...(input.status === undefined ? {} : { status: input.status }),
          updatedAt: input.changedAt
        };
        if (input.repositoryUrl !== undefined && input.repositoryUrl !== project.repositoryUrl) {
          const [existingTask] = await transaction
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.projectId, project.id))
            .limit(1);
          if (existingTask) {
            throw new DatabaseServiceError(
              "DB_REPOSITORY_IMMUTABLE",
              "Repository URL is immutable after the first task is created"
            );
          }
        }
        const [updated] = await transaction
          .update(projects)
          .set(patch)
          .where(eq(projects.id, project.id))
          .returning();
        if (!updated) throw new DatabaseServiceError("DB_CONFLICT", "Project update lost a race");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: project.id,
          action: input.status === "archived" ? "project.archived" : "project.updated",
          metadataSafeJson: {
            projectPublicId: input.projectPublicId,
            changedFields: Object.keys(patch)
              .filter((key) => key !== "updatedAt")
              .sort()
          }
        });
        return this.publicProject(
          updated,
          await this.activePolicyHash(transaction, updated.activePolicyId),
          project.role
        );
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async createPolicyVersion(
    input: CreatePolicyVersionInput,
    idempotency: IdempotencyContext
  ): Promise<PolicyVersionView> {
    assertPolicyCreate(input);
    assertIdempotency(idempotency, input.actorUserId, "policy_create");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProject(
          transaction,
          input.projectPublicId,
          input.actorUserId,
          "owner",
          input.activate === true ? "update" : "share"
        );
        if (project.status !== "active") {
          throw new DatabaseServiceError(
            "DB_PROJECT_ARCHIVED",
            "Archived projects cannot accept policy versions"
          );
        }
        const [sameHash] = await transaction
          .select()
          .from(policies)
          .where(and(eq(policies.projectId, project.id), eq(policies.policyHash, input.policyHash)))
          .for("share")
          .limit(1);
        if (sameHash) {
          if (
            sameHash.publicId !== input.policyPublicId ||
            sameHash.schemaVersion !== input.schemaVersion ||
            sameHash.sourcePath !== input.sourcePath ||
            !sameJson(sameHash.canonicalJson, input.canonicalJson)
          ) {
            throw new DatabaseServiceError(
              "DB_POLICY_HASH_CONFLICT",
              "Policy hash already identifies a different immutable version"
            );
          }
          const reservedExisting = await this.reserve(transaction, idempotency, sameHash.publicId);
          if (!reservedExisting) {
            await this.assertReplay(transaction, idempotency, sameHash.publicId);
          }
          let activePolicyId = project.activePolicyId;
          if (reservedExisting && input.activate === true && activePolicyId !== sameHash.id) {
            await this.switchActivePolicy(
              transaction,
              project.id,
              input.actorUserId,
              sameHash,
              input.activatedAt ?? new Date()
            );
            activePolicyId = sameHash.id;
          }
          return policyView(sameHash, input.projectPublicId, activePolicyId);
        }
        const reserved = await this.reserve(transaction, idempotency, input.policyPublicId);
        if (!reserved) {
          await this.assertReplay(transaction, idempotency, input.policyPublicId);
          const [existing] = await transaction
            .select()
            .from(policies)
            .where(
              and(eq(policies.publicId, input.policyPublicId), eq(policies.projectId, project.id))
            )
            .limit(1);
          if (
            !existing ||
            existing.schemaVersion !== input.schemaVersion ||
            existing.policyHash !== input.policyHash ||
            existing.sourcePath !== input.sourcePath ||
            !sameJson(existing.canonicalJson, input.canonicalJson)
          ) {
            throw new DatabaseServiceError(
              "DB_IDEMPOTENCY_CONFLICT",
              "Policy replay differs from the immutable version"
            );
          }
          return policyView(existing, input.projectPublicId, project.activePolicyId);
        }
        const [created] = await transaction
          .insert(policies)
          .values({
            publicId: input.policyPublicId,
            projectId: project.id,
            schemaVersion: input.schemaVersion,
            canonicalJson: input.canonicalJson,
            policyHash: input.policyHash,
            sourcePath: input.sourcePath
          })
          .returning();
        if (!created)
          throw new DatabaseServiceError("DB_CONFLICT", "Policy insert returned no row");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: project.id,
          action: "policy.created",
          metadataSafeJson: {
            policyPublicId: input.policyPublicId,
            policyHash: input.policyHash,
            schemaVersion: input.schemaVersion
          }
        });
        let activePolicyId = project.activePolicyId;
        if (input.activate === true) {
          await this.switchActivePolicy(
            transaction,
            project.id,
            input.actorUserId,
            created,
            input.activatedAt ?? new Date()
          );
          activePolicyId = created.id;
        }
        return policyView(created, input.projectPublicId, activePolicyId);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async activatePolicy(
    input: ActivatePolicyInput,
    idempotency: IdempotencyContext
  ): Promise<PolicyVersionView> {
    assertUuid(input.actorUserId, "Policy actor user ID");
    assertPublicId(input.projectPublicId, "Project public ID");
    assertPublicId(input.policyPublicId, "Policy public ID");
    assertDate(input.activatedAt, "Policy activation time");
    assertIdempotency(idempotency, input.actorUserId, "policy_activate");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProject(
          transaction,
          input.projectPublicId,
          input.actorUserId,
          "owner",
          "update"
        );
        if (project.status !== "active") {
          throw new DatabaseServiceError(
            "DB_PROJECT_ARCHIVED",
            "Archived projects cannot activate policies"
          );
        }
        const [policy] = await transaction
          .select()
          .from(policies)
          .where(
            and(eq(policies.publicId, input.policyPublicId), eq(policies.projectId, project.id))
          )
          .for("share")
          .limit(1);
        if (!policy) throw notFound();
        const reserved = await this.reserve(transaction, idempotency, input.policyPublicId);
        if (!reserved) {
          await this.assertReplay(transaction, idempotency, input.policyPublicId);
          return policyView(policy, input.projectPublicId, project.activePolicyId);
        }
        if (project.activePolicyId === policy.id)
          return policyView(policy, input.projectPublicId, project.activePolicyId);
        const [updated] = await transaction
          .update(projects)
          .set({ activePolicyId: policy.id, updatedAt: input.activatedAt })
          .where(eq(projects.id, project.id))
          .returning({ id: projects.id });
        if (!updated)
          throw new DatabaseServiceError("DB_CONFLICT", "Policy activation lost a race");
        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          projectId: project.id,
          action: "policy.activated",
          metadataSafeJson: { policyPublicId: input.policyPublicId, policyHash: policy.policyHash }
        });
        return policyView(policy, input.projectPublicId, policy.id);
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async listPolicyVersions(
    projectPublicId: string,
    actorUserId: string
  ): Promise<readonly PolicyVersionView[] | null> {
    assertPublicId(projectPublicId, "Project public ID");
    assertUuid(actorUserId, "Policy actor user ID");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProject(
          transaction,
          projectPublicId,
          actorUserId,
          "member",
          "share",
          true
        );
        if (!project) return null;
        const rows = await transaction
          .select()
          .from(policies)
          .where(eq(policies.projectId, project.id))
          .orderBy(desc(policies.createdAt), desc(policies.publicId));
        return rows.map((row) => policyView(row, projectPublicId, project.activePolicyId));
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async findPolicyVersion(
    projectPublicId: string,
    policyPublicId: string,
    actorUserId: string
  ): Promise<PolicyVersionView | null> {
    assertPublicId(projectPublicId, "Project public ID");
    assertPublicId(policyPublicId, "Policy public ID");
    assertUuid(actorUserId, "Policy actor user ID");
    try {
      return await this.database.transaction(async (transaction) => {
        const project = await this.requireProject(
          transaction,
          projectPublicId,
          actorUserId,
          "member",
          "share",
          true
        );
        if (!project) return null;
        const [policy] = await transaction
          .select()
          .from(policies)
          .where(and(eq(policies.publicId, policyPublicId), eq(policies.projectId, project.id)))
          .limit(1);
        return policy ? policyView(policy, projectPublicId, project.activePolicyId) : null;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private projectReadQuery(
    database: Database | Transaction,
    actorUserId: string,
    projectPublicId?: string
  ) {
    return database
      .select({
        publicId: projects.publicId,
        slug: projects.slug,
        name: projects.name,
        repositoryUrl: projects.repositoryUrl,
        defaultBranch: projects.defaultBranch,
        visibility: projects.visibility,
        status: projects.status,
        activePolicyHash: policies.policyHash,
        role: projectMembers.role,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .leftJoin(policies, eq(policies.id, projects.activePolicyId))
      .where(
        projectPublicId === undefined
          ? eq(projectMembers.userId, actorUserId)
          : and(eq(projectMembers.userId, actorUserId), eq(projects.publicId, projectPublicId))
      );
  }

  private async requireProject(
    transaction: Transaction,
    projectPublicId: string,
    actorUserId: string,
    requiredRole: ProjectRole,
    lock: "share" | "update",
    nullable: true
  ): Promise<AuthorizedProject | null>;
  private async requireProject(
    transaction: Transaction,
    projectPublicId: string,
    actorUserId: string,
    requiredRole: ProjectRole,
    lock: "share" | "update",
    nullable?: false
  ): Promise<AuthorizedProject>;
  private async requireProject(
    transaction: Transaction,
    projectPublicId: string,
    actorUserId: string,
    requiredRole: ProjectRole,
    lock: "share" | "update",
    nullable = false
  ): Promise<AuthorizedProject | null> {
    const [row] = await transaction
      .select({
        id: projects.id,
        activePolicyId: projects.activePolicyId,
        status: projects.status,
        ownerUserId: projects.ownerUserId,
        repositoryUrl: projects.repositoryUrl,
        userId: projectMembers.userId,
        role: projectMembers.role
      })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))
      )
      .where(eq(projects.publicId, projectPublicId))
      .for(lock)
      .limit(1);
    if (!row) {
      if (nullable) return null;
      throw notFound();
    }
    if ((row.role === "owner") !== (row.ownerUserId === row.userId)) {
      throw new DatabaseServiceError("DB_CONFLICT", "Project owner membership is inconsistent");
    }
    if (requiredRole === "owner" && row.role !== "owner") throw notFound();
    return {
      id: row.id,
      activePolicyId: row.activePolicyId,
      role: row.role,
      repositoryUrl: row.repositoryUrl,
      status: row.status
    };
  }

  private async reserve(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string
  ): Promise<boolean> {
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
    return rows.length === 1;
  }

  private async assertReplay(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string
  ): Promise<void> {
    const [existing] = await transaction
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
      !existing ||
      existing.requestHash !== idempotency.requestHash ||
      existing.resourcePublicId !== resourcePublicId
    ) {
      throw new DatabaseServiceError(
        "DB_IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used with different project or policy content"
      );
    }
  }

  private async replayedProject(
    transaction: Transaction,
    input: CreateProjectInput,
    idempotency: IdempotencyContext
  ): Promise<typeof projects.$inferSelect> {
    await this.assertReplay(transaction, idempotency, input.publicId);
    const [existing] = await transaction
      .select()
      .from(projects)
      .where(eq(projects.publicId, input.publicId))
      .limit(1);
    if (
      !existing ||
      existing.ownerUserId !== input.actorUserId ||
      existing.slug !== input.slug ||
      existing.name !== input.name ||
      existing.repositoryUrl !== input.repositoryUrl ||
      existing.defaultBranch !== input.defaultBranch ||
      existing.visibility !== input.visibility
    ) {
      throw new DatabaseServiceError(
        "DB_IDEMPOTENCY_CONFLICT",
        "Project replay differs from the persisted project"
      );
    }
    return existing;
  }

  private async activePolicyHash(
    transaction: Transaction,
    activePolicyId: string | null
  ): Promise<string | null> {
    if (!activePolicyId) return null;
    const [policy] = await transaction
      .select({ policyHash: policies.policyHash })
      .from(policies)
      .where(eq(policies.id, activePolicyId))
      .limit(1);
    if (!policy) throw new DatabaseServiceError("DB_CONFLICT", "Active policy binding is missing");
    return policy.policyHash;
  }

  private async projectById(
    transaction: Transaction,
    projectId: string,
    role: ProjectRole
  ): Promise<ProjectView> {
    const [row] = await transaction
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) throw new DatabaseServiceError("DB_CONFLICT", "Project replay lost its resource");
    return this.publicProject(
      row,
      await this.activePolicyHash(transaction, row.activePolicyId),
      role
    );
  }

  private async switchActivePolicy(
    transaction: Transaction,
    projectId: string,
    actorUserId: string,
    policy: typeof policies.$inferSelect,
    activatedAt: Date
  ): Promise<void> {
    const [updated] = await transaction
      .update(projects)
      .set({ activePolicyId: policy.id, updatedAt: activatedAt })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    if (!updated) throw new DatabaseServiceError("DB_CONFLICT", "Policy activation lost a race");
    await transaction.insert(auditEvents).values({
      actorUserId,
      projectId,
      action: "policy.activated",
      metadataSafeJson: { policyPublicId: policy.publicId, policyHash: policy.policyHash }
    });
  }

  private publicProject(
    row: typeof projects.$inferSelect,
    activePolicyHash: string | null,
    role: ProjectRole
  ): ProjectView {
    return projectView({
      publicId: row.publicId,
      slug: row.slug,
      name: row.name,
      repositoryUrl: row.repositoryUrl,
      defaultBranch: row.defaultBranch,
      visibility: row.visibility,
      status: row.status,
      activePolicyHash,
      role,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }
}
