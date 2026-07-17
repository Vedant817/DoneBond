import { ERROR_CODES } from "@donebond/shared";

import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import { cliTokenRateKey, deriveCliToken, type CliTokenRateLimiter } from "./cli-token.ts";
import { authorizeProjectSession, type ProjectAccessStore } from "./project-authorization.ts";
import type { AuthenticatedSession } from "./wallet-auth.ts";

export interface CliTokenManagementAuth {
  requireCsrf(cookieHeader: string | null, csrfToken: string | null): Promise<AuthenticatedSession>;
}

export interface CliTokenCreation {
  readonly tokenPublicId: string;
  readonly projectPublicId: string;
  readonly createdByUserId: string;
  readonly tokenPrefix: string;
  readonly tokenDigest: string;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
}

export interface CreatedCliTokenMetadata {
  readonly createdAt: Date;
}

export interface CliTokenManagementStore {
  createCliToken(input: CliTokenCreation): Promise<CreatedCliTokenMetadata>;
  revokeCliToken(
    projectPublicId: string,
    tokenPublicId: string,
    actorUserId: string,
    revokedAt: Date
  ): Promise<boolean>;
}

export interface CliTokenHandlerDependencies {
  readonly applicationOrigin: string;
  readonly tokenSecret: string;
  readonly auth: CliTokenManagementAuth;
  readonly accessStore: ProjectAccessStore;
  readonly tokenStore: CliTokenManagementStore;
  readonly createGlobalLimiter: CliTokenRateLimiter;
  readonly createSubjectLimiter: CliTokenRateLimiter;
  readonly revokeGlobalLimiter: CliTokenRateLimiter;
  readonly revokeSubjectLimiter: CliTokenRateLimiter;
  readonly now?: () => Date;
}

function cookie(request: Request): string | null {
  return request.headers.get("cookie");
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (value === null || !/^[A-Za-z0-9._:-]{16,128}$/u.test(value)) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "A valid Idempotency-Key header is required",
      400
    );
  }
  return value;
}

export function createCliTokenHandlers(dependencies: CliTokenHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function requireRateLimit(
    operation: "create" | "revoke",
    scope: string,
    at: Date,
    global: boolean
  ): Promise<void> {
    const limiter =
      operation === "create"
        ? global
          ? dependencies.createGlobalLimiter
          : dependencies.createSubjectLimiter
        : global
          ? dependencies.revokeGlobalLimiter
          : dependencies.revokeSubjectLimiter;
    if (!(await limiter.consume(cliTokenRateKey(dependencies.tokenSecret, scope), at))) {
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many CLI token management requests", 429, {
        retryable: true
      });
    }
  }

  return {
    create: async (request: Request, projectPublicId: string): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireTrustedOrigin(request, dependencies.applicationOrigin);
        const requestedAt = now();
        await requireRateLimit("create", "manage:create:global", requestedAt, true);
        const session = await dependencies.auth.requireCsrf(
          cookie(request),
          request.headers.get("x-csrf-token")
        );
        const body = await readBoundedJson(request, 1024);
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        ) {
          throw new HttpError(
            ERROR_CODES.VALIDATION_INVALID_INPUT,
            "CLI token creation body must be an empty object",
            400
          );
        }
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await requireRateLimit(
          "create",
          `manage:create:${session.userId}:${access.projectPublicId}`,
          requestedAt,
          false
        );
        const key = idempotencyKey(request);
        const generated = deriveCliToken(dependencies.tokenSecret, {
          userId: session.userId,
          projectPublicId: access.projectPublicId,
          idempotencyKey: key
        });
        const metadata = await dependencies.tokenStore.createCliToken({
          tokenPublicId: generated.publicId,
          projectPublicId: access.projectPublicId,
          createdByUserId: session.userId,
          tokenPrefix: generated.prefix,
          tokenDigest: generated.digest,
          idempotencyKey: key,
          requestedAt
        });
        return jsonResponse(
          {
            token: {
              publicId: generated.publicId,
              prefix: generated.prefix,
              plaintext: generated.plaintext,
              createdAt: metadata.createdAt
            }
          },
          201,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    revoke: async (
      request: Request,
      projectPublicId: string,
      tokenPublicId: string
    ): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireTrustedOrigin(request, dependencies.applicationOrigin);
        const requestedAt = now();
        await requireRateLimit("revoke", "manage:revoke:global", requestedAt, true);
        const session = await dependencies.auth.requireCsrf(
          cookie(request),
          request.headers.get("x-csrf-token")
        );
        const access = await authorizeProjectSession(
          dependencies.accessStore,
          session,
          projectPublicId,
          "owner"
        );
        await requireRateLimit(
          "revoke",
          `manage:revoke:${session.userId}:${access.projectPublicId}`,
          requestedAt,
          false
        );
        if (!/^[0-9a-hjkmnp-tv-z]{26}$/u.test(tokenPublicId)) {
          throw new HttpError(ERROR_CODES.TOKEN_REVOKED, "CLI token was not found", 404);
        }
        const revoked = await dependencies.tokenStore.revokeCliToken(
          access.projectPublicId,
          tokenPublicId,
          session.userId,
          requestedAt
        );
        return jsonResponse({ revoked }, 200, id);
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
