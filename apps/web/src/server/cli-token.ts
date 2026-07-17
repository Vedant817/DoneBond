import { createHmac, randomBytes } from "node:crypto";

import { ERROR_CODES } from "@donebond/shared";

import { HttpError } from "./http.ts";

const TOKEN = /^dbt_[A-Za-z0-9_-]{43}$/u;
const PUBLIC_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export interface GeneratedCliToken {
  readonly plaintext: string;
  readonly digest: string;
  readonly prefix: string;
}

export interface CliTokenCreationBinding {
  readonly userId: string;
  readonly projectPublicId: string;
  readonly idempotencyKey: string;
}

export interface DerivedCliToken extends GeneratedCliToken {
  readonly publicId: string;
}

export interface CliTokenPrincipal {
  readonly tokenPublicId: string;
  readonly projectPublicId: string;
}

export interface CliTokenUseStore {
  useActiveCliToken(
    tokenDigest: string,
    expectedProjectPublicId: string,
    usedAt: Date
  ): Promise<CliTokenPrincipal | null>;
}

export interface CliTokenRateLimiter {
  consume(keyDigest: string, at: Date): Promise<boolean>;
}

function key(secret: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43,}$/u.test(secret)) {
    throw new TypeError("CLI_TOKEN_SECRET must be canonical unpadded base64url");
  }
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.byteLength < 32 || decoded.toString("base64url") !== secret) {
    throw new TypeError("CLI_TOKEN_SECRET must be at least 32 random bytes in base64url");
  }
  return decoded;
}

export function validateCliTokenSecret(secret: string): void {
  key(secret);
}

export function cliTokenDigest(plaintext: string, secret: string): string {
  if (!TOKEN.test(plaintext)) {
    throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid CLI token is required", 401);
  }
  return createHmac("sha256", key(secret))
    .update("donebond.cli-token.v1\0", "utf8")
    .update(plaintext, "utf8")
    .digest("hex");
}

export function generateCliToken(secret: string): GeneratedCliToken {
  const plaintext = `dbt_${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    digest: cliTokenDigest(plaintext, secret),
    prefix: plaintext.slice(0, 12)
  };
}

function boundHmac(secret: string, domain: string, binding: CliTokenCreationBinding): Buffer {
  return createHmac("sha256", key(secret))
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(binding.userId, "utf8")
    .update("\0", "utf8")
    .update(binding.projectPublicId, "utf8")
    .update("\0", "utf8")
    .update(binding.idempotencyKey, "utf8")
    .digest();
}

function encodeOpaquePublicId(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.subarray(0, 16).toString("hex")}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = PUBLIC_ID_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

export function deriveCliToken(secret: string, binding: CliTokenCreationBinding): DerivedCliToken {
  const plaintext = `dbt_${boundHmac(secret, "donebond.cli-token-material.v1", binding).toString("base64url")}`;
  return {
    plaintext,
    digest: cliTokenDigest(plaintext, secret),
    prefix: plaintext.slice(0, 12),
    publicId: encodeOpaquePublicId(boundHmac(secret, "donebond.cli-token-public-id.v1", binding))
  };
}

export function cliTokenRateKey(secret: string, scope: string): string {
  return createHmac("sha256", key(secret))
    .update("donebond.cli-token-rate.v1\0", "utf8")
    .update(scope, "utf8")
    .digest("hex");
}

export function deriveOpaquePublicId(
  secret: string,
  namespace: string,
  components: readonly string[]
): string {
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(namespace) || components.length === 0) {
    throw new TypeError("Opaque public ID derivation scope is invalid");
  }
  const material = createHmac("sha256", key(secret))
    .update("donebond.public-id.v1\0", "utf8")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(components), "utf8")
    .digest();
  return encodeOpaquePublicId(material);
}

export function bearerCliToken(authorizationHeader: string | null): string {
  if (authorizationHeader === null) {
    throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid CLI token is required", 401);
  }
  const match = /^Bearer ([^\s]+)$/u.exec(authorizationHeader);
  if (match?.[1] === undefined || !TOKEN.test(match[1])) {
    throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid CLI token is required", 401);
  }
  return match[1];
}

export function generateOpaquePublicId(): string {
  return encodeOpaquePublicId(randomBytes(16));
}

export function safeRequestHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "cookie" ||
      normalized === "x-csrf-token"
    ) {
      safe[normalized] = `[REDACTED:${normalized}]`;
    } else if (
      normalized === "accept" ||
      normalized === "content-type" ||
      normalized === "user-agent" ||
      normalized === "x-correlation-id"
    ) {
      safe[normalized] = value.slice(0, 512);
    }
  }
  return safe;
}

export class CliTokenAuthenticator {
  readonly #secret: string;
  readonly #store: CliTokenUseStore;
  readonly #globalLimiter: CliTokenRateLimiter;
  readonly #tokenLimiter: CliTokenRateLimiter;
  readonly #now: () => Date;

  constructor(
    secret: string,
    store: CliTokenUseStore,
    globalLimiter: CliTokenRateLimiter,
    tokenLimiter: CliTokenRateLimiter,
    now: () => Date = () => new Date()
  ) {
    key(secret);
    this.#secret = secret;
    this.#store = store;
    this.#globalLimiter = globalLimiter;
    this.#tokenLimiter = tokenLimiter;
    this.#now = now;
  }

  async authenticate(
    authorizationHeader: string | null,
    expectedProjectPublicId: string
  ): Promise<CliTokenPrincipal> {
    if (!/^[0-9a-hjkmnp-tv-z]{26}$/u.test(expectedProjectPublicId)) {
      throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
    }
    const attemptedAt = this.#now();
    const globalKey = cliTokenRateKey(this.#secret, "authenticate:global");
    if (!(await this.#globalLimiter.consume(globalKey, attemptedAt))) {
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many CLI authentication attempts", 429, {
        retryable: true
      });
    }
    const plaintext = bearerCliToken(authorizationHeader);
    const digest = cliTokenDigest(plaintext, this.#secret);
    if (!(await this.#tokenLimiter.consume(digest, attemptedAt))) {
      throw new HttpError(ERROR_CODES.RATE_LIMITED, "Too many CLI authentication attempts", 429, {
        retryable: true
      });
    }
    const principal = await this.#store.useActiveCliToken(
      digest,
      expectedProjectPublicId,
      attemptedAt
    );
    if (principal === null || principal.projectPublicId !== expectedProjectPublicId) {
      throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid CLI token is required", 401);
    }
    return principal;
  }
}
