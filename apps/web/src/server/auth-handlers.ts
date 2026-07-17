import { createHash } from "node:crypto";

import {
  ERROR_CODES,
  NonZeroEthereumAddressSchema,
  SupportedChainIdSchema
} from "@donebond/shared";

import {
  correlationId,
  errorResponse,
  HttpError,
  jsonResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";
import type { AuthenticatedSession, PublicWalletChallenge, WalletAccount } from "./wallet-auth.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NONCE = /^[A-Za-z0-9_-]{32}$/u;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;

export interface WalletAuthApi {
  createChallenge(address: string, chainId: number): Promise<PublicWalletChallenge>;
  verifyChallenge(
    id: string,
    nonce: string,
    signature: `0x${string}`
  ): Promise<{ account: WalletAccount; cookie: string; csrfToken: string }>;
  authenticate(cookieHeader: string | null): Promise<AuthenticatedSession>;
  requireCsrf(cookieHeader: string | null, csrfToken: string | null): Promise<AuthenticatedSession>;
  revoke(cookieHeader: string | null): Promise<boolean>;
  clearSessionCookie(): string;
}

export interface RequestRateLimiter {
  consume(keyDigest: string, at: Date): Promise<boolean>;
}

interface WindowEntry {
  count: number;
  resetsAt: number;
}

export class FixedWindowRateLimiter implements RequestRateLimiter {
  readonly #entries = new Map<string, WindowEntry>();
  readonly #maximumAttempts: number;
  readonly #windowMs: number;
  readonly #maximumKeys: number;

  constructor(maximumAttempts: number, windowMs: number, maximumKeys = 10_000) {
    if (
      !Number.isSafeInteger(maximumAttempts) ||
      maximumAttempts < 1 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1 ||
      !Number.isSafeInteger(maximumKeys) ||
      maximumKeys < 1
    ) {
      throw new TypeError("Rate-limit settings must be positive safe integers");
    }
    this.#maximumAttempts = maximumAttempts;
    this.#windowMs = windowMs;
    this.#maximumKeys = maximumKeys;
  }

  async consume(key: string, at: Date): Promise<boolean> {
    const now = at.getTime();
    const current = this.#entries.get(key);
    if (current !== undefined && current.resetsAt > now) {
      current.count += 1;
      return current.count <= this.#maximumAttempts;
    }
    if (current === undefined && this.#entries.size >= this.#maximumKeys) {
      for (const [candidate, entry] of this.#entries) {
        if (entry.resetsAt <= now) this.#entries.delete(candidate);
      }
      if (this.#entries.size >= this.#maximumKeys) return false;
    }
    this.#entries.set(key, { count: 1, resetsAt: now + this.#windowMs });
    return true;
  }
}

export interface AuthHandlerDependencies {
  readonly applicationOrigin: string;
  readonly auth: WalletAuthApi;
  readonly globalChallengeLimiter: RequestRateLimiter;
  readonly challengeLimiter: RequestRateLimiter;
  readonly globalVerificationLimiter: RequestRateLimiter;
  readonly verificationLimiter: RequestRateLimiter;
  readonly now?: () => Date;
}

function strictRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput();
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some((field) => !(field in record))) {
    throw invalidInput();
  }
  return record;
}

function invalidInput(): HttpError {
  return new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Request fields are invalid", 400);
}

function rateLimited(): HttpError {
  return new HttpError(ERROR_CODES.RATE_LIMITED, "Too many authentication attempts", 429, {
    retryable: true
  });
}

function rateKey(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}\0${value}`, "utf8").digest("hex");
}

function authErrorResponse(error: unknown, id: string): Response {
  const response = errorResponse(error, id);
  if (error instanceof HttpError && error.code === ERROR_CODES.RATE_LIMITED) {
    response.headers.set("retry-after", "600");
  }
  return response;
}

function cookie(request: Request): string | null {
  return request.headers.get("cookie");
}

export function createAuthHandlers(dependencies: AuthHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    challenge: async (request: Request): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireTrustedOrigin(request, dependencies.applicationOrigin);
        const body = strictRecord(await readBoundedJson(request, 2048), ["address", "chainId"]);
        const address = NonZeroEthereumAddressSchema.safeParse(body.address);
        const chainId = SupportedChainIdSchema.safeParse(body.chainId);
        if (!address.success || !chainId.success) {
          throw invalidInput();
        }
        const key = rateKey("challenge", `${chainId.data}:${address.data}`);
        const attemptedAt = now();
        if (
          !(await dependencies.globalChallengeLimiter.consume(
            rateKey("challenge", "global"),
            attemptedAt
          )) ||
          !(await dependencies.challengeLimiter.consume(key, attemptedAt))
        ) {
          throw rateLimited();
        }
        const challenge = await dependencies.auth.createChallenge(address.data, chainId.data);
        return jsonResponse({ challenge }, 201, id);
      } catch (error) {
        return authErrorResponse(error, id);
      }
    },

    verify: async (request: Request): Promise<Response> => {
      const correlation = correlationId(request);
      try {
        requireTrustedOrigin(request, dependencies.applicationOrigin);
        const body = strictRecord(await readBoundedJson(request, 4096), [
          "id",
          "nonce",
          "signature"
        ]);
        if (
          typeof body.id !== "string" ||
          !UUID_V4.test(body.id) ||
          typeof body.nonce !== "string" ||
          !NONCE.test(body.nonce) ||
          typeof body.signature !== "string" ||
          !SIGNATURE.test(body.signature)
        ) {
          throw invalidInput();
        }
        const attemptedAt = now();
        if (
          !(await dependencies.globalVerificationLimiter.consume(
            rateKey("verify", "global"),
            attemptedAt
          )) ||
          !(await dependencies.verificationLimiter.consume(rateKey("verify", body.id), attemptedAt))
        ) {
          throw rateLimited();
        }
        const verified = await dependencies.auth.verifyChallenge(
          body.id,
          body.nonce,
          body.signature as `0x${string}`
        );
        const response = jsonResponse(
          {
            account: {
              address: verified.account.address,
              chainId: verified.account.chainId
            },
            csrfToken: verified.csrfToken
          },
          200,
          correlation
        );
        response.headers.append("set-cookie", verified.cookie);
        return response;
      } catch (error) {
        return authErrorResponse(error, correlation);
      }
    },

    session: async (request: Request): Promise<Response> => {
      const id = correlationId(request);
      try {
        const session = await dependencies.auth.authenticate(cookie(request));
        return jsonResponse(
          {
            session: {
              address: session.address,
              chainId: session.chainId,
              absoluteExpiresAt: session.absoluteExpiresAt
            }
          },
          200,
          id
        );
      } catch (error) {
        return errorResponse(error, id);
      }
    },

    logout: async (request: Request): Promise<Response> => {
      const id = correlationId(request);
      try {
        requireTrustedOrigin(request, dependencies.applicationOrigin);
        await dependencies.auth.requireCsrf(cookie(request), request.headers.get("x-csrf-token"));
        await dependencies.auth.revoke(cookie(request));
        const response = jsonResponse({ revoked: true }, 200, id);
        response.headers.append("set-cookie", dependencies.auth.clearSessionCookie());
        return response;
      } catch (error) {
        return errorResponse(error, id);
      }
    }
  };
}
