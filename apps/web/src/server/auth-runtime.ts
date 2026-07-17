import {
  createDatabase,
  createWalletAuthAdapters,
  DoneBondRepository,
  DrizzleAuthRateLimiter,
  DrizzleCliTokenRepository
} from "@donebond/db";

import { createAuthHandlers, type RequestRateLimiter } from "./auth-handlers.ts";
import { validateCliTokenSecret } from "./cli-token.ts";
import { correlationId, errorResponse } from "./http.ts";
import { WalletAuthService } from "./wallet-auth.ts";

let handlers: ReturnType<typeof createAuthHandlers> | undefined;
let databaseHandle: ReturnType<typeof createDatabase> | undefined;
let walletAuthService: WalletAuthService | undefined;
let projectRepository: DoneBondRepository | undefined;
let cliTokenRepository: DrizzleCliTokenRepository | undefined;
let cliTokenGlobalLimiter: RequestRateLimiter | undefined;
let cliTokenSubjectLimiter: RequestRateLimiter | undefined;
let cliTokenCreateGlobalLimiter: RequestRateLimiter | undefined;
let cliTokenCreateSubjectLimiter: RequestRateLimiter | undefined;
let cliTokenRevokeGlobalLimiter: RequestRateLimiter | undefined;
let cliTokenRevokeSubjectLimiter: RequestRateLimiter | undefined;
let runtimeApplicationOrigin: string | undefined;
let runtimeCliTokenSecret: string | undefined;

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
  const cliTokenSecret = process.env.CLI_TOKEN_SECRET;
  if (cliTokenSecret === undefined) {
    throw new TypeError("CLI_TOKEN_SECRET is required for CLI authentication");
  }
  validateCliTokenSecret(cliTokenSecret);
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
  walletAuthService = auth;
  projectRepository = new DoneBondRepository(databaseHandle.db);
  cliTokenRepository = new DrizzleCliTokenRepository(databaseHandle.db);
  runtimeApplicationOrigin = canonicalOrigin;
  runtimeCliTokenSecret = cliTokenSecret;
  cliTokenGlobalLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_auth_global",
      maxAttempts: 1200,
      windowMs: 10 * 60 * 1000
    })
  );
  cliTokenSubjectLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_auth_token",
      maxAttempts: 120,
      windowMs: 10 * 60 * 1000
    })
  );
  cliTokenCreateGlobalLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_create_global",
      maxAttempts: 300,
      windowMs: 10 * 60 * 1000
    })
  );
  cliTokenCreateSubjectLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_create_project",
      maxAttempts: 30,
      windowMs: 10 * 60 * 1000
    })
  );
  cliTokenRevokeGlobalLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_revoke_global",
      maxAttempts: 1200,
      windowMs: 10 * 60 * 1000
    })
  );
  cliTokenRevokeSubjectLimiter = maintainedLimiter(
    new DrizzleAuthRateLimiter(databaseHandle.db, {
      scope: "cli_revoke_project",
      maxAttempts: 300,
      windowMs: 10 * 60 * 1000
    })
  );
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

export function getCliTokenServices(): {
  readonly applicationOrigin: string;
  readonly tokenSecret: string;
  readonly auth: WalletAuthService;
  readonly accessStore: DoneBondRepository;
  readonly tokenRepository: DrizzleCliTokenRepository;
  readonly globalLimiter: RequestRateLimiter;
  readonly tokenLimiter: RequestRateLimiter;
  readonly createGlobalLimiter: RequestRateLimiter;
  readonly createSubjectLimiter: RequestRateLimiter;
  readonly revokeGlobalLimiter: RequestRateLimiter;
  readonly revokeSubjectLimiter: RequestRateLimiter;
} {
  getAuthHandlers();
  if (
    runtimeApplicationOrigin === undefined ||
    runtimeCliTokenSecret === undefined ||
    walletAuthService === undefined ||
    projectRepository === undefined ||
    cliTokenRepository === undefined ||
    cliTokenGlobalLimiter === undefined ||
    cliTokenSubjectLimiter === undefined ||
    cliTokenCreateGlobalLimiter === undefined ||
    cliTokenCreateSubjectLimiter === undefined ||
    cliTokenRevokeGlobalLimiter === undefined ||
    cliTokenRevokeSubjectLimiter === undefined
  ) {
    throw new TypeError("CLI token services failed to initialize");
  }
  return {
    applicationOrigin: runtimeApplicationOrigin,
    tokenSecret: runtimeCliTokenSecret,
    auth: walletAuthService,
    accessStore: projectRepository,
    tokenRepository: cliTokenRepository,
    globalLimiter: cliTokenGlobalLimiter,
    tokenLimiter: cliTokenSubjectLimiter,
    createGlobalLimiter: cliTokenCreateGlobalLimiter,
    createSubjectLimiter: cliTokenCreateSubjectLimiter,
    revokeGlobalLimiter: cliTokenRevokeGlobalLimiter,
    revokeSubjectLimiter: cliTokenRevokeSubjectLimiter
  };
}

export function getProjectAuthorizationServices(): {
  readonly authenticator: WalletAuthService;
  readonly accessStore: DoneBondRepository;
} {
  getAuthHandlers();
  if (walletAuthService === undefined || projectRepository === undefined) {
    throw new TypeError("Project authorization services failed to initialize");
  }
  return { authenticator: walletAuthService, accessStore: projectRepository };
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
