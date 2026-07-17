import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  ERROR_CODES,
  NonZeroEthereumAddressSchema,
  SupportedChainIdSchema
} from "@donebond/shared";
import { getAddress, verifyMessage } from "viem";

import { HttpError } from "./http.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
const SESSION_COOKIE = "donebond_session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface StoredWalletChallenge {
  readonly id: string;
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly domain: string;
  readonly uri: string;
  readonly nonceDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface PublicWalletChallenge {
  readonly id: string;
  readonly nonce: string;
  readonly message: string;
  readonly expiresAt: string;
}

export interface ChallengeStore {
  create(challenge: StoredWalletChallenge): Promise<void>;
  find(id: string): Promise<StoredWalletChallenge | null>;
  /** Atomically succeeds exactly once only if the digest matches and expiresAt is after consumedAt. */
  consume(id: string, nonceDigest: string, consumedAt: Date): Promise<boolean>;
}

export interface WalletAccount {
  readonly userId: string;
  readonly address: `0x${string}`;
  readonly chainId: number;
}

export interface WalletAccountResolver {
  findOrCreateVerifiedWallet(address: `0x${string}`, chainId: number): Promise<WalletAccount>;
}

export interface StoredBrowserSession extends WalletAccount {
  readonly id: string;
  readonly tokenDigest: string;
  readonly csrfDigest: string;
  readonly createdAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
}

export interface BrowserSessionStore {
  create(session: StoredBrowserSession): Promise<void>;
  /** Atomically rejects revoked/expired rows and advances idle expiry without exceeding absolute expiry. */
  findActiveByTokenDigest(
    tokenDigest: string,
    accessedAt: Date
  ): Promise<StoredBrowserSession | null>;
  /** Atomically validates both digests before advancing the idle expiry. */
  findActiveByTokenAndCsrfDigest(
    tokenDigest: string,
    csrfDigest: string,
    accessedAt: Date
  ): Promise<StoredBrowserSession | null>;
  revoke(tokenDigest: string, revokedAt: Date): Promise<boolean>;
}

export interface AuthenticatedSession extends WalletAccount {
  readonly sessionId: string;
  readonly absoluteExpiresAt: Date;
}

export interface WalletAuthOptions {
  readonly applicationOrigin: string;
  readonly sessionSecret: string;
  readonly challenges: ChallengeStore;
  readonly accounts: WalletAccountResolver;
  readonly sessions: BrowserSessionStore;
  readonly now?: () => Date;
}

function normalizedOrigin(value: string): URL {
  const origin = new URL(value);
  if (
    origin.username !== "" ||
    origin.password !== "" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new TypeError("applicationOrigin may not contain credentials, query, or fragment");
  }
  const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) {
    throw new TypeError("applicationOrigin must use HTTPS outside local development");
  }
  if (origin.pathname !== "/") throw new TypeError("applicationOrigin must not contain a path");
  return origin;
}

function sessionKey(secret: string): Buffer {
  const key = Buffer.from(secret, "base64url");
  if (key.byteLength < 32)
    throw new TypeError("sessionSecret must be at least 32 random bytes in base64url");
  return key;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function keyedDigest(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function challengeMessage(challenge: StoredWalletChallenge, nonce: string): string {
  return `${challenge.domain} wants you to sign in with your Ethereum account:\n${getAddress(challenge.address)}\n\nSign in to DoneBond. This request will not trigger a blockchain transaction.\n\nURI: ${challenge.uri}\nVersion: 1\nChain ID: ${challenge.chainId}\nNonce: ${nonce}\nIssued At: ${challenge.issuedAt.toISOString()}\nExpiration Time: ${challenge.expiresAt.toISOString()}\nRequest ID: ${challenge.id}`;
}

export class WalletAuthService {
  readonly #origin: URL;
  readonly #key: Buffer;
  readonly #challenges: ChallengeStore;
  readonly #accounts: WalletAccountResolver;
  readonly #sessions: BrowserSessionStore;
  readonly #now: () => Date;

  constructor(options: WalletAuthOptions) {
    this.#origin = normalizedOrigin(options.applicationOrigin);
    this.#key = sessionKey(options.sessionSecret);
    this.#challenges = options.challenges;
    this.#accounts = options.accounts;
    this.#sessions = options.sessions;
    this.#now = options.now ?? (() => new Date());
  }

  async createChallenge(
    addressInput: string,
    chainIdInput: number
  ): Promise<PublicWalletChallenge> {
    const address = NonZeroEthereumAddressSchema.parse(addressInput) as `0x${string}`;
    const chainId = SupportedChainIdSchema.parse(chainIdInput);
    const issuedAt = this.#now();
    const nonce = randomBytes(24).toString("base64url");
    const challenge: StoredWalletChallenge = {
      id: randomUUID(),
      address,
      chainId,
      domain: this.#origin.host,
      uri: this.#origin.origin,
      nonceDigest: sha256(nonce),
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)
    };
    await this.#challenges.create(challenge);
    return {
      id: challenge.id,
      nonce,
      message: challengeMessage(challenge, nonce),
      expiresAt: challenge.expiresAt.toISOString()
    };
  }

  async verifyChallenge(
    id: string,
    nonce: string,
    signature: `0x${string}`
  ): Promise<{ account: WalletAccount; cookie: string; csrfToken: string }> {
    const challenge = UUID.test(id) ? await this.#challenges.find(id) : null;
    const checkedAt = this.#now();
    if (
      challenge === null ||
      challenge.expiresAt.getTime() <= checkedAt.getTime() ||
      !constantTimeHexEqual(challenge.nonceDigest, sha256(nonce))
    ) {
      throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "Wallet challenge is invalid or expired", 401);
    }
    const message = challengeMessage(challenge, nonce);
    const valid = await verifyMessage({
      address: challenge.address,
      message,
      signature
    }).catch(() => false);
    if (!valid) throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "Wallet signature is invalid", 401);
    const consumedAt = this.#now();
    if (challenge.expiresAt.getTime() <= consumedAt.getTime()) {
      throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "Wallet challenge is invalid or expired", 401);
    }
    const consumed = await this.#challenges.consume(
      challenge.id,
      challenge.nonceDigest,
      consumedAt
    );
    if (!consumed)
      throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "Wallet challenge was already used", 401);

    const account = await this.#accounts.findOrCreateVerifiedWallet(
      challenge.address,
      challenge.chainId
    );
    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const absoluteExpiresAt = new Date(consumedAt.getTime() + SESSION_ABSOLUTE_TTL_MS);
    await this.#sessions.create({
      id: randomUUID(),
      ...account,
      tokenDigest: keyedDigest(sessionToken, this.#key),
      csrfDigest: keyedDigest(csrfToken, this.#key),
      createdAt: consumedAt,
      absoluteExpiresAt,
      idleExpiresAt: new Date(consumedAt.getTime() + SESSION_IDLE_TTL_MS)
    });
    return { account, csrfToken, cookie: this.sessionCookie(sessionToken, absoluteExpiresAt) };
  }

  async authenticate(cookieHeader: string | null): Promise<AuthenticatedSession> {
    const token = this.sessionToken(cookieHeader);
    const now = this.#now();
    const session =
      token === null
        ? null
        : await this.#sessions.findActiveByTokenDigest(keyedDigest(token, this.#key), now);
    if (
      session === null ||
      session.absoluteExpiresAt.getTime() <= now.getTime() ||
      session.idleExpiresAt.getTime() <= now.getTime()
    ) {
      throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid session is required", 401);
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      address: session.address,
      chainId: session.chainId,
      absoluteExpiresAt: session.absoluteExpiresAt
    };
  }

  async requireCsrf(
    cookieHeader: string | null,
    csrfToken: string | null
  ): Promise<AuthenticatedSession> {
    const token = this.sessionToken(cookieHeader);
    const now = this.#now();
    const session =
      token === null || csrfToken === null
        ? null
        : await this.#sessions.findActiveByTokenAndCsrfDigest(
            keyedDigest(token, this.#key),
            keyedDigest(csrfToken, this.#key),
            now
          );
    if (session === null) {
      throw new HttpError(ERROR_CODES.AUTH_CSRF_INVALID, "CSRF validation failed", 403);
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      address: session.address,
      chainId: session.chainId,
      absoluteExpiresAt: session.absoluteExpiresAt
    };
  }

  async revoke(cookieHeader: string | null): Promise<boolean> {
    const token = this.sessionToken(cookieHeader);
    return token === null
      ? false
      : this.#sessions.revoke(keyedDigest(token, this.#key), this.#now());
  }

  sessionCookie(token: string, expiresAt: Date): string {
    const secure = this.#origin.protocol === "https:" ? "; Secure" : "";
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`;
  }

  clearSessionCookie(): string {
    const secure = this.#origin.protocol === "https:" ? "; Secure" : "";
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  private sessionToken(cookieHeader: string | null): string | null {
    const value = cookieHeader
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    return value !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
}
