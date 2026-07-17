import { createDatabase, createWalletAuthAdapters, DrizzleAuthRateLimiter } from "@donebond/db";

import { createAuthHandlers, type RequestRateLimiter } from "./auth-handlers.ts";
import { correlationId, errorResponse } from "./http.ts";
import { WalletAuthService } from "./wallet-auth.ts";

let handlers: ReturnType<typeof createAuthHandlers> | undefined;
let databaseHandle: ReturnType<typeof createDatabase> | undefined;

type AuthHandler = keyof ReturnType<typeof createAuthHandlers>;

function maintainedLimiter(limiter: DrizzleAuthRateLimiter): RequestRateLimiter {
  let requestsUntilCleanup = 64;
  return {
    async consume(keyDigest, at) {
      const allowed = await limiter.consume(keyDigest, at);
      requestsUntilCleanup -= 1;
      if (requestsUntilCleanup === 0) {
        await limiter.deleteExpired(at, 500);
        requestsUntilCleanup = 64;
      }
      return allowed;
    }
  };
}

function configuredApplicationOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("NEXT_PUBLIC_APP_URL must be an origin without credentials or a path");
  }
  return url.origin;
}

export function getAuthHandlers(): ReturnType<typeof createAuthHandlers> {
  if (handlers !== undefined) return handlers;
  const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const sessionSecret = process.env.AUTH_SECRET;
  if (applicationOrigin === undefined || sessionSecret === undefined) {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL and AUTH_SECRET are required for wallet authentication"
    );
  }
  const canonicalOrigin = configuredApplicationOrigin(applicationOrigin);
  databaseHandle = createDatabase();
  const adapters = createWalletAuthAdapters(databaseHandle.db);
  const auth = new WalletAuthService({
    applicationOrigin: canonicalOrigin,
    sessionSecret,
    challenges: adapters.challenges,
    accounts: adapters.accounts,
    sessions: adapters.sessions
  });
  handlers = createAuthHandlers({
    applicationOrigin: canonicalOrigin,
    auth,
    globalChallengeLimiter: maintainedLimiter(
      new DrizzleAuthRateLimiter(databaseHandle.db, {
        scope: "auth_challenge_global",
        maxAttempts: 300,
        windowMs: 10 * 60 * 1000
      })
    ),
    challengeLimiter: maintainedLimiter(
      new DrizzleAuthRateLimiter(databaseHandle.db, {
        scope: "auth_challenge_wallet",
        maxAttempts: 10,
        windowMs: 10 * 60 * 1000
      })
    ),
    globalVerificationLimiter: maintainedLimiter(
      new DrizzleAuthRateLimiter(databaseHandle.db, {
        scope: "auth_verify_global",
        maxAttempts: 600,
        windowMs: 10 * 60 * 1000
      })
    ),
    verificationLimiter: maintainedLimiter(
      new DrizzleAuthRateLimiter(databaseHandle.db, {
        scope: "auth_verify_challenge",
        maxAttempts: 10,
        windowMs: 10 * 60 * 1000
      })
    )
  });
  return handlers;
}

export async function dispatchAuthRequest(
  handler: AuthHandler,
  request: Request
): Promise<Response> {
  try {
    return await getAuthHandlers()[handler](request);
  } catch (error) {
    return errorResponse(error, correlationId(request));
  }
}
