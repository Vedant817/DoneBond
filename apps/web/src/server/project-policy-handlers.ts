import { canonicalKeccak256 } from "@donebond/evidence";
import {
  CanonicalPolicyV1Schema,
  ERROR_CODES,
  ProjectSchema,
  PublicIdentifierSchema,
  type CanonicalPolicyV1
} from "@donebond/shared";

import { deriveOpaquePublicId } from "./cli-token.ts";
import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import {
  parseCreateProjectInput,
  parsePolicyUploadInput,
  parseUpdateProjectInput,
  type CreateProjectInput,
  type UpdateProjectInput
} from "./project-policy-input.ts";
import {
  authorizeProjectSession,
  requireProjectAccess,
  type ProjectAccessStore,
  type SessionAuthenticator
} from "./project-authorization.ts";
import type { AuthenticatedSession } from "./wallet-auth.ts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const OPAQUE_PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;

export type ProjectWriteOperation =
  | "project_create"
  | "project_update"
  | "policy_save"
  | "policy_activate"
  | "task_create"
  | "task_chain_intent"
  | "task_chain_register";

export interface ProjectWriteRateLimiter {
  consume(operation: ProjectWriteOperation, subject: string | null, at: Date): Promise<boolean>;
}

export interface ProjectMutationAuth extends SessionAuthenticator {
  requireCsrf(cookieHeader: string | null, csrfToken: string | null): Promise<AuthenticatedSession>;
}

export interface ProjectRecord {
  readonly schemaVersion: 1;
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly defaultBranch: string;
  readonly visibility: "private" | "public";
  readonly status: "active" | "archived";
  readonly activePolicyHash: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

export interface PolicyRecord {
  readonly publicId: string;
  readonly schemaVersion: number;
  readonly policyHash: string;
  readonly sourcePath: string;
  readonly canonicalPolicy: unknown;
  readonly active: boolean;
  readonly createdAt: Date | string;
}

export interface ListCursor {
  readonly createdAt: Date;
  readonly publicId: string;
}

export interface ProjectPolicyStore {
  createProject(input: {
    readonly publicId: string;
    readonly ownerUserId: string;
    readonly project: CreateProjectInput;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<ProjectRecord>;
  listProjects(
    userId: string,
    page: { readonly cursor: ListCursor | null; readonly limit: number }
  ): Promise<{
    readonly items: readonly { project: ProjectRecord; role: "owner" | "member" }[];
    readonly nextCursor: ListCursor | null;
  }>;
  getProject(projectPublicId: string, userId: string): Promise<ProjectRecord | null>;
  updateProject(input: {
    readonly projectPublicId: string;
    readonly actorUserId: string;
    readonly update: UpdateProjectInput;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<ProjectRecord>;
  savePolicy(input: {
    readonly publicId: string;
    readonly projectPublicId: string;
    readonly actorUserId: string;
    readonly sourcePath: string;
    readonly canonicalPolicy: CanonicalPolicyV1;
    readonly policyHash: string;
    readonly activate: boolean;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<PolicyRecord>;
  listPolicies(
    projectPublicId: string,
    userId: string,
    page: { readonly cursor: ListCursor | null; readonly limit: number }
  ): Promise<{ readonly items: readonly PolicyRecord[]; readonly nextCursor: ListCursor | null }>;
  getPolicy(
    projectPublicId: string,
    policyPublicId: string,
    userId: string
  ): Promise<PolicyRecord | null>;
  activatePolicy(input: {
    readonly projectPublicId: string;
    readonly policyPublicId: string;
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly requestedAt: Date;
  }): Promise<PolicyRecord>;
}

export interface ProjectPolicyHandlerDependencies {
  readonly applicationOrigin: string;
  readonly resourceSecret: string;
  readonly auth: ProjectMutationAuth;
  readonly accessStore: ProjectAccessStore;
  readonly store: ProjectPolicyStore;
  readonly rateLimiter: ProjectWriteRateLimiter;
  readonly now?: () => Date;
}

function cookie(request: Request): string | null {
  return request.headers.get("cookie");
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

function requireNoQuery(request: Request): void {
  if (new URL(request.url).search !== "") {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "This endpoint does not accept query parameters",
      400
    );
  }
}

function publicId(value: string, kind: "project" | "policy" = "project"): string {
  try {
    const parsed = PublicIdentifierSchema.parse(value);
    if (!OPAQUE_PUBLIC_ID.test(parsed)) throw new TypeError("Expected an opaque public ID");
    return parsed;
  } catch (cause) {
    throw new HttpError(
      kind === "project" ? ERROR_CODES.PROJECT_NOT_FOUND : ERROR_CODES.POLICY_NOT_FOUND,
      kind === "project" ? "Project was not found" : "Policy was not found",
      404,
      { cause }
    );
  }
}

function projectDto(project: ProjectRecord) {
  if (!OPAQUE_PUBLIC_ID.test(project.publicId)) {
    throw new TypeError("Persisted project public ID is invalid");
  }
  return ProjectSchema.parse({
    ...project,
    createdAt:
      project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
    updatedAt:
      project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt
  });
}

function policyDto(policy: PolicyRecord, detail: boolean) {
  const canonicalPolicy = CanonicalPolicyV1Schema.parse(policy.canonicalPolicy);
  const normalizedPublicId = PublicIdentifierSchema.parse(policy.publicId);
  if (!OPAQUE_PUBLIC_ID.test(normalizedPublicId)) {
    throw new TypeError("Persisted policy public ID is invalid");
  }
  return {
    publicId: normalizedPublicId,
    schemaVersion: canonicalPolicy.schemaVersion,
    policyHash: policy.policyHash,
    sourcePath: policy.sourcePath,
    active: policy.active,
    createdAt: policy.createdAt instanceof Date ? policy.createdAt.toISOString() : policy.createdAt,
    ...(detail ? { canonicalPolicy } : {})
  };
}

function parsePage(request: Request): { cursor: ListCursor | null; limit: number } {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Unknown pagination field", 400);
    }
  }
  const limitValue = url.searchParams.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "limit must be from 1 to 100", 400);
  }
  const suppliedCursor = url.searchParams.get("cursor");
  if (suppliedCursor === null) return { cursor: null, limit: Number(limitValue) };
  try {
    const decoded = JSON.parse(
      Buffer.from(suppliedCursor, "base64url").toString("utf8")
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      Object.keys(decoded).length !== 2 ||
      !("createdAt" in decoded) ||
      !("publicId" in decoded) ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.publicId !== "string"
    ) {
      throw new TypeError("Malformed cursor");
    }
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new TypeError("Malformed cursor date");
    return {
      cursor: { createdAt, publicId: publicId(decoded.publicId) },
      limit: Number(limitValue)
    };
  } catch (cause) {
    throw new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "cursor is invalid", 400, {
      cause
    });
  }
}

function encodeCursor(cursor: ListCursor | null): string | null {
  return cursor === null
    ? null
    : Buffer.from(
        JSON.stringify({ createdAt: cursor.createdAt.toISOString(), publicId: cursor.publicId }),
        "utf8"
      ).toString("base64url");
}

export function createProjectPolicyHandlers(dependencies: ProjectPolicyHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function rateLimit(
    operation: ProjectWriteOperation,
    subject: string | null,
    at: Date
  ): Promise<void> {
    if (!(await dependencies.rateLimiter.consume(operation, subject, at))) {
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many project requests", 429, {
        retryable: true
      });
    }
  }

  async function mutationSession(
    request: Request,
    operation: ProjectWriteOperation,
    requestedAt: Date
  ): Promise<AuthenticatedSession> {
    requireTrustedOrigin(request, dependencies.applicationOrigin);
    await rateLimit(operation, null, requestedAt);
    return dependencies.auth.requireCsrf(cookie(request), request.headers.get("x-csrf-token"));
  }

  return {
    createProject: async (request: Request): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const requestedAt = now();
        const session = await mutationSession(request, "project_create", requestedAt);
        const project = parseCreateProjectInput(await readBoundedJson(request, 16_384));
        await rateLimit("project_create", session.userId, requestedAt);
        const key = idempotencyKey(request);
        const created = await dependencies.store.createProject({
          publicId: deriveOpaquePublicId(dependencies.resourceSecret, "project", [
            session.userId,
            key
          ]),
          ownerUserId: session.userId,
          project,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({ kind: "donebond.project-create", ...project }),
          requestedAt
        });
        return jsonResponse({ project: projectDto(created), role: "owner" }, 201, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    listProjects: async (request: Request): Promise<Response> => {
      const id = correlationId(request);
      try {
        const session = await dependencies.auth.authenticate(cookie(request));
        const page = await dependencies.store.listProjects(session.userId, parsePage(request));
        return jsonResponse(
          {
            items: page.items.map((item) => ({
              project: projectDto(item.project),
              role: item.role
            })),
            nextCursor: encodeCursor(page.nextCursor)
          },
          200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    getProject: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const { session, access } = await requireProjectAccess(
          dependencies.auth,
          dependencies.accessStore,
          cookie(request),
          projectPublicId
        );
        const project = await dependencies.store.getProject(access.projectPublicId, session.userId);
        if (project === null) {
          throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
        }
        return jsonResponse({ project: projectDto(project), role: access.role }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    updateProject: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const requestedAt = now();
        const session = await mutationSession(request, "project_update", requestedAt);
        const update = parseUpdateProjectInput(await readBoundedJson(request, 16_384));
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await rateLimit(
          "project_update",
          `${session.userId}:${access.projectPublicId}`,
          requestedAt
        );
        const key = idempotencyKey(request);
        const project = await dependencies.store.updateProject({
          projectPublicId: access.projectPublicId,
          actorUserId: session.userId,
          update,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.project-update",
            projectPublicId: access.projectPublicId,
            update
          }),
          requestedAt
        });
        return jsonResponse({ project: projectDto(project), role: "owner" }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    savePolicy: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const requestedAt = now();
        const session = await mutationSession(request, "policy_save", requestedAt);
        const upload = parsePolicyUploadInput(await readBoundedJson(request, 163_840));
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await rateLimit("policy_save", `${session.userId}:${access.projectPublicId}`, requestedAt);
        const key = idempotencyKey(request);
        const policy = await dependencies.store.savePolicy({
          publicId: deriveOpaquePublicId(dependencies.resourceSecret, "policy", [
            session.userId,
            access.projectPublicId,
            key
          ]),
          projectPublicId: access.projectPublicId,
          actorUserId: session.userId,
          sourcePath: upload.sourcePath,
          canonicalPolicy: upload.parsed.canonicalPolicy,
          policyHash: upload.parsed.policyHash,
          activate: upload.activate,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.policy-save",
            projectPublicId: access.projectPublicId,
            sourcePath: upload.sourcePath,
            activate: upload.activate,
            policy: upload.parsed.canonicalPolicy
          }),
          requestedAt
        });
        return jsonResponse({ policy: policyDto(policy, true) }, 201, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    listPolicies: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        const { session, access } = await requireProjectAccess(
          dependencies.auth,
          dependencies.accessStore,
          cookie(request),
          projectPublicId
        );
        const page = await dependencies.store.listPolicies(
          access.projectPublicId,
          session.userId,
          parsePage(request)
        );
        return jsonResponse(
          {
            items: page.items.map((policy) => policyDto(policy, false)),
            nextCursor: encodeCursor(page.nextCursor)
          },
          200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    getPolicy: async (
      request: Request,
      projectPublicId: string,
      policyPublicId: string
    ): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const { session, access } = await requireProjectAccess(
          dependencies.auth,
          dependencies.accessStore,
          cookie(request),
          projectPublicId
        );
        const policy = await dependencies.store.getPolicy(
          access.projectPublicId,
          publicId(policyPublicId, "policy"),
          session.userId
        );
        if (policy === null) {
          throw new HttpError(ERROR_CODES.POLICY_NOT_FOUND, "Policy was not found", 404);
        }
        return jsonResponse({ policy: policyDto(policy, true) }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    activatePolicy: async (
      request: Request,
      projectPublicId: string,
      policyPublicId: string
    ): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireNoQuery(request);
        const requestedAt = now();
        const session = await mutationSession(request, "policy_activate", requestedAt);
        const body = await readBoundedJson(request, 1024);
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        ) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "Policy activation body must be an empty object",
            400
          );
        }
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await rateLimit(
          "policy_activate",
          `${session.userId}:${access.projectPublicId}`,
          requestedAt
        );
        const key = idempotencyKey(request);
        const normalizedPolicyId = publicId(policyPublicId, "policy");
        const policy = await dependencies.store.activatePolicy({
          projectPublicId: access.projectPublicId,
          policyPublicId: normalizedPolicyId,
          actorUserId: session.userId,
          idempotencyKey: key,
          requestHash: canonicalKeccak256({
            kind: "donebond.policy-activate",
            projectPublicId: access.projectPublicId,
            policyPublicId: normalizedPolicyId
          }),
          requestedAt
        });
        return jsonResponse({ policy: policyDto(policy, false) }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
