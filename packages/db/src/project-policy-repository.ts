import { GitHubRepositoryUrlSchema } from "@donebond/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
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

export interface KeysetCursor {
  readonly createdAt: Date;
  readonly publicId: string;
}

export interface KeysetPagination {
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface KeysetPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: KeysetCursor | null;
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

interface ProjectSnapshot extends Omit<ProjectView, "createdAt" | "updatedAt"> {
  readonly kind: "project";
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PolicySnapshot extends Omit<PolicyVersionView, "canonicalJson" | "createdAt"> {
  readonly kind: "policy";
  readonly createdAt: string;
}

interface StoredReplay {
  readonly responseSafeJson: unknown;
  readonly responseStatus: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BYTES_32 = /^0x[0-9a-f]{64}$/u;

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
  const parsed = GitHubRepositoryUrlSchema.safeParse(value);
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
    value.startsWith("-") ||
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

function assertSourcePath(value: string): void {
  const components = value.split("/");
  if (
    value.length < 1 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    components.some((component) => component === "" || component === "." || component === "..")
  ) {
    throw invalid("Policy source path is unsafe");
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
  assertSourcePath(input.sourcePath);
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

function assertPagination(pagination: KeysetPagination): void {
  if (!Number.isSafeInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 100) {
    throw invalid("Pagination limit must be an integer from 1 through 100");
  }
  if (pagination.cursor) {
    assertDate(pagination.cursor.createdAt, "Pagination cursor creation time");
    assertPublicId(pagination.cursor.publicId, "Pagination cursor public ID");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function projectSnapshot(view: ProjectView): ProjectSnapshot {
  return {
    kind: "project",
    publicId: view.publicId,
    slug: view.slug,
    name: view.name,
    repositoryUrl: view.repositoryUrl,
    defaultBranch: view.defaultBranch,
    visibility: view.visibility,
    status: view.status,
    activePolicyHash: view.activePolicyHash,
    role: view.role,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString()
  };
}

function parseProjectSnapshot(value: unknown): ProjectView {
  const keys = [
    "activePolicyHash",
    "createdAt",
    "defaultBranch",
    "kind",
    "name",
    "publicId",
    "repositoryUrl",
    "role",
    "slug",
    "status",
    "updatedAt",
    "visibility"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.kind !== "project") {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored project replay snapshot is invalid");
  }
  const createdAt = exactIsoDate(value.createdAt);
  const updatedAt = exactIsoDate(value.updatedAt);
  if (
    typeof value.publicId !== "string" ||
    !PUBLIC_ID.test(value.publicId) ||
    typeof value.slug !== "string" ||
    value.slug.length > 63 ||
    !SLUG.test(value.slug) ||
    typeof value.name !== "string" ||
    typeof value.repositoryUrl !== "string" ||
    typeof value.defaultBranch !== "string" ||
    (value.visibility !== "private" && value.visibility !== "public") ||
    (value.status !== "active" && value.status !== "archived") ||
    (value.activePolicyHash !== null &&
      (typeof value.activePolicyHash !== "string" || !BYTES_32.test(value.activePolicyHash))) ||
    (value.role !== "owner" && value.role !== "member") ||
    !createdAt ||
    !updatedAt
  ) {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored project replay snapshot is invalid");
  }
  try {
    assertNormalizedText(value.name, "Stored project name", 120);
    assertRepositoryUrl(value.repositoryUrl);
    assertBranch(value.defaultBranch);
  } catch {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored project replay snapshot is invalid");
  }
  return {
    publicId: value.publicId,
    slug: value.slug,
    name: value.name,
    repositoryUrl: value.repositoryUrl,
    defaultBranch: value.defaultBranch,
    visibility: value.visibility,
    status: value.status,
    activePolicyHash: value.activePolicyHash,
    role: value.role,
    createdAt,
    updatedAt
  };
}

function policySnapshot(view: PolicyVersionView): PolicySnapshot {
  return {
    kind: "policy",
    publicId: view.publicId,
    projectPublicId: view.projectPublicId,
    schemaVersion: view.schemaVersion,
    policyHash: view.policyHash,
    sourcePath: view.sourcePath,
    active: view.active,
    createdAt: view.createdAt.toISOString()
  };
}

function parsePolicySnapshot(value: unknown): PolicySnapshot {
  const keys = [
    "active",
    "createdAt",
    "kind",
    "policyHash",
    "projectPublicId",
    "publicId",
    "schemaVersion",
    "sourcePath"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.kind !== "policy") {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored policy replay snapshot is invalid");
  }
  const createdAt = exactIsoDate(value.createdAt);
  if (
    typeof value.publicId !== "string" ||
    !PUBLIC_ID.test(value.publicId) ||
    typeof value.projectPublicId !== "string" ||
    !PUBLIC_ID.test(value.projectPublicId) ||
    !Number.isSafeInteger(value.schemaVersion) ||
    (value.schemaVersion as number) <= 0 ||
    typeof value.policyHash !== "string" ||
    !BYTES_32.test(value.policyHash) ||
    typeof value.sourcePath !== "string" ||
    typeof value.active !== "boolean" ||
    !createdAt
  ) {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored policy replay snapshot is invalid");
  }
  try {
    assertSourcePath(value.sourcePath);
  } catch {
    throw new DatabaseServiceError("DB_CONFLICT", "Stored policy replay snapshot is invalid");
  }
  return {
    kind: "policy",
    publicId: value.publicId,
    projectPublicId: value.projectPublicId,
    schemaVersion: value.schemaVersion as number,
    policyHash: value.policyHash,
    sourcePath: value.sourcePath,
    active: value.active,
    createdAt: value.createdAt as string
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
        const reservationId = await this.reserve(transaction, idempotency, input.publicId);
        if (!reservationId) {
          await this.requireProject(
            transaction,
            input.publicId,
            input.actorUserId,
            "owner",
            "share"
          );
          return this.replayProject(transaction, idempotency, input.publicId, 201);
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
        const result = this.publicProject(created, null, "owner");
        await this.completeReservation(transaction, reservationId, 201, projectSnapshot(result));
        return result;
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

  public async listProjects(
    actorUserId: string,
    pagination: KeysetPagination
  ): Promise<KeysetPage<ProjectView>> {
    assertUuid(actorUserId, "Project actor user ID");
    assertPagination(pagination);
    try {
      const rows = await this.projectReadQuery(
        this.database,
        actorUserId,
        undefined,
        pagination.cursor
      )
        .orderBy(desc(projects.createdAt), desc(projects.publicId))
        .limit(pagination.limit + 1);
      const visibleRows = rows.slice(0, pagination.limit).map(projectView);
      const last = visibleRows.at(-1);
      return {
        rows: visibleRows,
        nextCursor:
          rows.length > pagination.limit && last
            ? { createdAt: last.createdAt, publicId: last.publicId }
            : null
      };
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
        const reservationId = await this.reserve(transaction, idempotency, input.projectPublicId);
        if (!reservationId) {
          return this.replayProject(transaction, idempotency, input.projectPublicId, 200);
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
        const result = this.publicProject(
          updated,
          await this.activePolicyHash(transaction, updated.activePolicyId),
          project.role
        );
        await this.completeReservation(transaction, reservationId, 200, projectSnapshot(result));
        return result;
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
        const reservationId = await this.reserve(transaction, idempotency, input.policyPublicId);
        if (!reservationId) {
          return this.replayPolicy(
            transaction,
            idempotency,
            project.id,
            input.projectPublicId,
            input.policyPublicId,
            [200, 201]
          );
        }
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
          let activePolicyId = project.activePolicyId;
          if (input.activate === true && activePolicyId !== sameHash.id) {
            await this.switchActivePolicy(
              transaction,
              project.id,
              input.actorUserId,
              sameHash,
              input.activatedAt ?? new Date()
            );
            activePolicyId = sameHash.id;
          }
          const result = policyView(sameHash, input.projectPublicId, activePolicyId);
          await this.completeReservation(transaction, reservationId, 200, policySnapshot(result));
          return result;
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
        const result = policyView(created, input.projectPublicId, activePolicyId);
        await this.completeReservation(transaction, reservationId, 201, policySnapshot(result));
        return result;
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
        const reservationId = await this.reserve(transaction, idempotency, input.policyPublicId);
        if (!reservationId) {
          return this.replayPolicy(
            transaction,
            idempotency,
            project.id,
            input.projectPublicId,
            input.policyPublicId,
            [200]
          );
        }
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
        if (project.activePolicyId === policy.id) {
          const result = policyView(policy, input.projectPublicId, project.activePolicyId);
          await this.completeReservation(transaction, reservationId, 200, policySnapshot(result));
          return result;
        }
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
        const result = policyView(policy, input.projectPublicId, policy.id);
        await this.completeReservation(transaction, reservationId, 200, policySnapshot(result));
        return result;
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async listPolicyVersions(
    projectPublicId: string,
    actorUserId: string,
    pagination: KeysetPagination
  ): Promise<KeysetPage<PolicyVersionView> | null> {
    assertPublicId(projectPublicId, "Project public ID");
    assertUuid(actorUserId, "Policy actor user ID");
    assertPagination(pagination);
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
        const cursorPredicate = pagination.cursor
          ? or(
              lt(policies.createdAt, pagination.cursor.createdAt),
              and(
                eq(policies.createdAt, pagination.cursor.createdAt),
                lt(policies.publicId, pagination.cursor.publicId)
              )
            )
          : undefined;
        const rows = await transaction
          .select()
          .from(policies)
          .where(
            cursorPredicate
              ? and(eq(policies.projectId, project.id), cursorPredicate)
              : eq(policies.projectId, project.id)
          )
          .orderBy(desc(policies.createdAt), desc(policies.publicId))
          .limit(pagination.limit + 1);
        const visibleRows = rows
          .slice(0, pagination.limit)
          .map((row) => policyView(row, projectPublicId, project.activePolicyId));
        const last = visibleRows.at(-1);
        return {
          rows: visibleRows,
          nextCursor:
            rows.length > pagination.limit && last
              ? { createdAt: last.createdAt, publicId: last.publicId }
              : null
        };
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
    projectPublicId?: string,
    cursor?: KeysetCursor
  ) {
    const cursorPredicate = cursor
      ? or(
          lt(projects.createdAt, cursor.createdAt),
          and(eq(projects.createdAt, cursor.createdAt), lt(projects.publicId, cursor.publicId))
        )
      : undefined;
    const accessPredicate =
      projectPublicId === undefined
        ? eq(projectMembers.userId, actorUserId)
        : and(eq(projectMembers.userId, actorUserId), eq(projects.publicId, projectPublicId));
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
      .where(cursorPredicate ? and(accessPredicate, cursorPredicate) : accessPredicate);
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

  private async completeReservation(
    transaction: Transaction,
    reservationId: string,
    responseStatus: number,
    responseSafeJson: ProjectSnapshot | PolicySnapshot
  ): Promise<void> {
    const completed = await transaction
      .update(apiIdempotencyKeys)
      .set({ responseSafeJson, responseStatus })
      .where(eq(apiIdempotencyKeys.id, reservationId))
      .returning({ id: apiIdempotencyKeys.id });
    if (completed.length !== 1) {
      throw new DatabaseServiceError("DB_CONFLICT", "Idempotency response could not be persisted");
    }
  }

  private async replay(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string,
    allowedStatuses: readonly number[]
  ): Promise<StoredReplay> {
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
    if (
      existing.responseSafeJson === null ||
      existing.responseSafeJson === undefined ||
      existing.responseStatus === null ||
      !allowedStatuses.includes(existing.responseStatus)
    ) {
      throw new DatabaseServiceError("DB_CONFLICT", "Stored idempotency response is incomplete");
    }
    return {
      responseSafeJson: existing.responseSafeJson,
      responseStatus: existing.responseStatus
    };
  }

  private async replayProject(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    resourcePublicId: string,
    responseStatus: number
  ): Promise<ProjectView> {
    const stored = await this.replay(transaction, idempotency, resourcePublicId, [responseStatus]);
    const snapshot = parseProjectSnapshot(stored.responseSafeJson);
    if (snapshot.publicId !== resourcePublicId || snapshot.role !== "owner") {
      throw new DatabaseServiceError("DB_CONFLICT", "Stored project replay binding is invalid");
    }
    return snapshot;
  }

  private async replayPolicy(
    transaction: Transaction,
    idempotency: IdempotencyContext,
    projectId: string,
    projectPublicId: string,
    policyPublicId: string,
    allowedStatuses: readonly number[]
  ): Promise<PolicyVersionView> {
    const stored = await this.replay(transaction, idempotency, policyPublicId, allowedStatuses);
    const snapshot = parsePolicySnapshot(stored.responseSafeJson);
    if (snapshot.publicId !== policyPublicId || snapshot.projectPublicId !== projectPublicId) {
      throw new DatabaseServiceError("DB_CONFLICT", "Stored policy replay binding is invalid");
    }
    const [policy] = await transaction
      .select()
      .from(policies)
      .where(and(eq(policies.projectId, projectId), eq(policies.publicId, policyPublicId)))
      .limit(1);
    if (
      !policy ||
      policy.schemaVersion !== snapshot.schemaVersion ||
      policy.policyHash !== snapshot.policyHash ||
      policy.sourcePath !== snapshot.sourcePath ||
      policy.createdAt.getTime() !== exactIsoDate(snapshot.createdAt)?.getTime()
    ) {
      throw new DatabaseServiceError("DB_CONFLICT", "Stored policy replay binding is invalid");
    }
    return {
      publicId: snapshot.publicId,
      projectPublicId: snapshot.projectPublicId,
      schemaVersion: snapshot.schemaVersion,
      canonicalJson: policy.canonicalJson,
      policyHash: snapshot.policyHash,
      sourcePath: snapshot.sourcePath,
      active: snapshot.active,
      createdAt: policy.createdAt
    };
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
