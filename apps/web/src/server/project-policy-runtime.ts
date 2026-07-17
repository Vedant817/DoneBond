import {
  DatabaseServiceError,
  type IdempotencyContext,
  type PolicyVersionView,
  type ProjectView
} from "@donebond/db";
import { ERROR_CODES } from "@donebond/shared";

import { getProjectPolicyServices } from "./auth-runtime.ts";
import { correlationId, errorResponse, HttpError } from "./http.ts";
import {
  createProjectPolicyHandlers,
  type ListCursor,
  type PolicyRecord,
  type ProjectPolicyStore,
  type ProjectRecord
} from "./project-policy-handlers.ts";

let handlers: ReturnType<typeof createProjectPolicyHandlers> | undefined;

function idempotency(
  actorUserId: string,
  operation: IdempotencyContext["operation"],
  idempotencyKey: string,
  requestHash: string,
  requestedAt: Date
): IdempotencyContext {
  return {
    actorScope: `user:${actorUserId}`,
    operation,
    idempotencyKey,
    requestHash,
    expiresAt: new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000)
  };
}

export function translateProjectPolicyDatabaseError(
  error: unknown,
  missing: "project" | "policy"
): never {
  if (!(error instanceof DatabaseServiceError)) throw error;
  switch (error.code) {
    case "DB_IDEMPOTENCY_CONFLICT":
      throw new HttpError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        "The idempotency key was already used for a different request",
        409,
        { cause: error }
      );
    case "DB_PROJECT_SLUG_CONFLICT":
      throw new HttpError(
        ERROR_CODES.PROJECT_SLUG_CONFLICT,
        "A project with this slug already exists",
        409,
        { cause: error }
      );
    case "DB_POLICY_HASH_CONFLICT":
      throw new HttpError(
        ERROR_CODES.POLICY_ALREADY_EXISTS,
        "This policy already exists as an immutable version",
        409,
        { cause: error }
      );
    case "DB_PROJECT_ARCHIVED":
      throw new HttpError(
        ERROR_CODES.INVALID_STATE,
        "Archived projects cannot change verification policies",
        409,
        { cause: error }
      );
    case "DB_REPOSITORY_IMMUTABLE":
      throw new HttpError(
        ERROR_CODES.INVALID_STATE,
        "Repository identity cannot change after a task is created",
        409,
        { cause: error }
      );
    case "DB_NOT_FOUND":
      throw new HttpError(
        missing === "project" ? ERROR_CODES.PROJECT_NOT_FOUND : ERROR_CODES.POLICY_NOT_FOUND,
        missing === "project" ? "Project was not found" : "Policy was not found",
        404,
        { cause: error }
      );
    case "DB_CONFLICT":
      throw new HttpError(ERROR_CODES.INVALID_STATE, "The resource state changed", 409, {
        cause: error,
        retryable: true
      });
    case "DB_INVALID_INPUT":
      throw error;
  }
}

async function databaseCall<T>(
  missing: "project" | "policy",
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    translateProjectPolicyDatabaseError(error, missing);
  }
}

function projectRecord(view: ProjectView): ProjectRecord {
  return {
    schemaVersion: 1,
    publicId: view.publicId,
    slug: view.slug,
    name: view.name,
    repositoryUrl: view.repositoryUrl,
    defaultBranch: view.defaultBranch,
    visibility: view.visibility,
    status: view.status,
    activePolicyHash: view.activePolicyHash,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  };
}

function policyRecord(view: PolicyVersionView): PolicyRecord {
  return {
    publicId: view.publicId,
    schemaVersion: view.schemaVersion,
    policyHash: view.policyHash,
    sourcePath: view.sourcePath,
    canonicalPolicy: view.canonicalJson,
    active: view.active,
    createdAt: view.createdAt
  };
}

function databasePage(page: { readonly cursor: ListCursor | null; readonly limit: number }) {
  return {
    limit: page.limit,
    ...(page.cursor === null ? {} : { cursor: page.cursor })
  };
}

function initialize(): ReturnType<typeof createProjectPolicyHandlers> {
  if (handlers !== undefined) return handlers;
  const services = getProjectPolicyServices();
  const repository = services.repository;
  const store: ProjectPolicyStore = {
    async createProject(input) {
      return projectRecord(
        await databaseCall("project", () =>
          repository.createProject(
            {
              actorUserId: input.ownerUserId,
              publicId: input.publicId,
              ...input.project
            },
            idempotency(
              input.ownerUserId,
              "project_create",
              input.idempotencyKey,
              input.requestHash,
              input.requestedAt
            )
          )
        )
      );
    },
    async listProjects(userId, requestedPage) {
      const selected = await databaseCall("project", () =>
        repository.listProjects(userId, databasePage(requestedPage))
      );
      return {
        items: selected.rows.map((view) => ({ project: projectRecord(view), role: view.role })),
        nextCursor: selected.nextCursor
      };
    },
    async getProject(projectPublicId, userId) {
      const view = await databaseCall("project", () =>
        repository.findProject(projectPublicId, userId)
      );
      return view === null ? null : projectRecord(view);
    },
    async updateProject(input) {
      return projectRecord(
        await databaseCall("project", () =>
          repository.updateProject(
            {
              actorUserId: input.actorUserId,
              projectPublicId: input.projectPublicId,
              changedAt: input.requestedAt,
              ...input.update
            },
            idempotency(
              input.actorUserId,
              "project_update",
              input.idempotencyKey,
              input.requestHash,
              input.requestedAt
            )
          )
        )
      );
    },
    async savePolicy(input) {
      return policyRecord(
        await databaseCall("project", () =>
          repository.createPolicyVersion(
            {
              actorUserId: input.actorUserId,
              projectPublicId: input.projectPublicId,
              policyPublicId: input.publicId,
              schemaVersion: input.canonicalPolicy.schemaVersion,
              canonicalJson: input.canonicalPolicy,
              policyHash: input.policyHash,
              sourcePath: input.sourcePath,
              activate: input.activate,
              activatedAt: input.requestedAt
            },
            idempotency(
              input.actorUserId,
              "policy_create",
              input.idempotencyKey,
              input.requestHash,
              input.requestedAt
            )
          )
        )
      );
    },
    async listPolicies(projectPublicId, userId, requestedPage) {
      const views = await databaseCall("project", () =>
        repository.listPolicyVersions(projectPublicId, userId, databasePage(requestedPage))
      );
      if (views === null) {
        throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
      }
      return {
        items: views.rows.map(policyRecord),
        nextCursor: views.nextCursor
      };
    },
    async getPolicy(projectPublicId, policyPublicId, userId) {
      const view = await databaseCall("policy", () =>
        repository.findPolicyVersion(projectPublicId, policyPublicId, userId)
      );
      return view === null ? null : policyRecord(view);
    },
    async activatePolicy(input) {
      return policyRecord(
        await databaseCall("policy", () =>
          repository.activatePolicy(
            {
              actorUserId: input.actorUserId,
              projectPublicId: input.projectPublicId,
              policyPublicId: input.policyPublicId,
              activatedAt: input.requestedAt
            },
            idempotency(
              input.actorUserId,
              "policy_activate",
              input.idempotencyKey,
              input.requestHash,
              input.requestedAt
            )
          )
        )
      );
    }
  };
  handlers = createProjectPolicyHandlers({
    applicationOrigin: services.applicationOrigin,
    resourceSecret: services.resourceSecret,
    auth: services.auth,
    accessStore: services.accessStore,
    rateLimiter: services.rateLimiter,
    store
  });
  return handlers;
}

export type ProjectPolicyAction = keyof ReturnType<typeof createProjectPolicyHandlers>;

export async function dispatchProjectPolicy(
  action: ProjectPolicyAction,
  request: Request,
  projectPublicId?: string,
  policyPublicId?: string
): Promise<Response> {
  try {
    const selected = initialize();
    switch (action) {
      case "createProject":
      case "listProjects":
        return selected[action](request);
      case "getProject":
      case "updateProject":
      case "savePolicy":
      case "listPolicies":
        if (projectPublicId === undefined) throw new TypeError("Project ID is required");
        return selected[action](request, projectPublicId);
      case "getPolicy":
      case "activatePolicy":
        if (projectPublicId === undefined || policyPublicId === undefined) {
          throw new TypeError("Project and policy IDs are required");
        }
        return selected[action](request, projectPublicId, policyPublicId);
    }
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}
