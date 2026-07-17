import { DatabaseServiceError } from "@donebond/db";
import { ERROR_CODES } from "@donebond/shared";
import { keccak256, toBytes } from "viem";

import { createCliTokenHandlers } from "./cli-token-handlers.ts";
import { CliTokenAuthenticator } from "./cli-token.ts";
import { getCliTokenServices } from "./auth-runtime.ts";
import { correlationId, errorResponse, HttpError } from "./http.ts";

let handlers: ReturnType<typeof createCliTokenHandlers> | undefined;
let authenticator: CliTokenAuthenticator | undefined;

function creationRequestHash(projectPublicId: string): `0x${string}` {
  return keccak256(
    toBytes(
      JSON.stringify({
        kind: "donebond.cli-token-create",
        projectPublicId
      })
    )
  );
}

function translateTokenWriteError(error: unknown): never {
  if (error instanceof DatabaseServiceError) {
    if (error.code === "DB_IDEMPOTENCY_CONFLICT") {
      throw new HttpError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        "The idempotency key was already used for a different request",
        409,
        { cause: error }
      );
    }
    if (error.code === "DB_NOT_FOUND") {
      throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404, {
        cause: error
      });
    }
  }
  throw error;
}

function initialize() {
  if (handlers !== undefined && authenticator !== undefined) return;
  const services = getCliTokenServices();
  handlers = createCliTokenHandlers({
    applicationOrigin: services.applicationOrigin,
    tokenSecret: services.tokenSecret,
    auth: services.auth,
    accessStore: services.accessStore,
    createGlobalLimiter: services.createGlobalLimiter,
    createSubjectLimiter: services.createSubjectLimiter,
    revokeGlobalLimiter: services.revokeGlobalLimiter,
    revokeSubjectLimiter: services.revokeSubjectLimiter,
    tokenStore: {
      async createCliToken(input) {
        try {
          return await services.tokenRepository.create(
            {
              actorUserId: input.createdByUserId,
              projectPublicId: input.projectPublicId,
              tokenPublicId: input.tokenPublicId,
              tokenPrefix: input.tokenPrefix,
              tokenDigest: input.tokenDigest
            },
            {
              actorScope: `user:${input.createdByUserId}`,
              idempotencyKey: input.idempotencyKey,
              operation: "cli_token_create",
              requestHash: creationRequestHash(input.projectPublicId),
              expiresAt: new Date(input.requestedAt.getTime() + 24 * 60 * 60 * 1000)
            }
          );
        } catch (error) {
          translateTokenWriteError(error);
        }
      },
      async revokeCliToken(projectPublicId, tokenPublicId, actorUserId, revokedAt) {
        return (
          (await services.tokenRepository.revoke(
            actorUserId,
            projectPublicId,
            tokenPublicId,
            revokedAt
          )) !== null
        );
      }
    }
  });
  authenticator = new CliTokenAuthenticator(
    services.tokenSecret,
    {
      async useActiveCliToken(tokenDigest, expectedProjectPublicId, usedAt) {
        return services.tokenRepository.authenticate(expectedProjectPublicId, tokenDigest, usedAt);
      }
    },
    services.globalLimiter,
    services.tokenLimiter
  );
}

export function getCliTokenAuthenticator(): CliTokenAuthenticator {
  initialize();
  if (authenticator === undefined)
    throw new TypeError("CLI token authenticator failed to initialize");
  return authenticator;
}

export async function dispatchCliTokenCreate(
  request: Request,
  projectPublicId: string
): Promise<Response> {
  try {
    initialize();
    if (handlers === undefined) throw new TypeError("CLI token handlers failed to initialize");
    return await handlers.create(request, projectPublicId);
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}

export async function dispatchCliTokenRevoke(
  request: Request,
  projectPublicId: string,
  tokenPublicId: string
): Promise<Response> {
  try {
    initialize();
    if (handlers === undefined) throw new TypeError("CLI token handlers failed to initialize");
    return await handlers.revoke(request, projectPublicId, tokenPublicId);
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}
