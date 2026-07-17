import { randomUUID } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import { browserSessions, databaseSchema, users, walletAuthChallenges, wallets } from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;
type EthereumAddress = `0x${string}`;

export interface StoredWalletChallengeRecord {
  readonly id: string;
  readonly address: EthereumAddress;
  readonly chainId: number;
  readonly domain: string;
  readonly uri: string;
  readonly nonceDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface WalletAccountRecord {
  readonly userId: string;
  readonly address: EthereumAddress;
  readonly chainId: number;
}

export interface StoredBrowserSessionRecord extends WalletAccountRecord {
  readonly id: string;
  readonly tokenDigest: string;
  readonly csrfDigest: string;
  readonly createdAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
}

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function assertDigest(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw invalid(`${field} must be 64 lowercase hex characters`);
}

function assertWallet(address: string, chainId: number): asserts address is EthereumAddress {
  if (
    !/^0x[0-9a-f]{40}$/u.test(address) ||
    address === "0x0000000000000000000000000000000000000000" ||
    (chainId !== 143 && chainId !== 10_143)
  ) {
    throw invalid("Wallet address or chain is unsupported");
  }
}

function assertOriginBinding(domain: string, uri: string): void {
  let origin: URL;
  try {
    origin = new URL(uri);
  } catch {
    throw invalid("Challenge URI must be a valid application origin");
  }
  const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (
    origin.host !== domain ||
    origin.origin !== uri ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
  ) {
    throw invalid("Challenge domain and URI are not the same safe application origin");
  }
}

function toChallenge(row: typeof walletAuthChallenges.$inferSelect): StoredWalletChallengeRecord {
  return {
    id: row.id,
    address: row.addressNormalized as EthereumAddress,
    chainId: row.chainId,
    domain: row.domain,
    uri: row.uri,
    nonceDigest: row.nonceDigest,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt
  };
}

export class DrizzleWalletChallengeStore {
  public constructor(private readonly database: Database) {}

  public async create(challenge: StoredWalletChallengeRecord): Promise<void> {
    assertWallet(challenge.address, challenge.chainId);
    assertDigest(challenge.nonceDigest, "Challenge nonce digest");
    assertOriginBinding(challenge.domain, challenge.uri);
    try {
      await this.database.insert(walletAuthChallenges).values({
        id: challenge.id,
        addressNormalized: challenge.address,
        chainId: challenge.chainId,
        domain: challenge.domain,
        uri: challenge.uri,
        nonceDigest: challenge.nonceDigest,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async find(id: string): Promise<StoredWalletChallengeRecord | null> {
    const [challenge] = await this.database
      .select()
      .from(walletAuthChallenges)
      .where(eq(walletAuthChallenges.id, id))
      .limit(1);
    return challenge ? toChallenge(challenge) : null;
  }

  public async consume(id: string, nonceDigest: string, consumedAt: Date): Promise<boolean> {
    assertDigest(nonceDigest, "Challenge nonce digest");
    try {
      const consumed = await this.database
        .update(walletAuthChallenges)
        .set({ consumedAt })
        .where(
          and(
            eq(walletAuthChallenges.id, id),
            eq(walletAuthChallenges.nonceDigest, nonceDigest),
            isNull(walletAuthChallenges.consumedAt),
            gt(walletAuthChallenges.expiresAt, consumedAt)
          )
        )
        .returning({ id: walletAuthChallenges.id });
      return consumed.length === 1;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}

export class DrizzleWalletAccountResolver {
  public constructor(private readonly database: Database) {}

  public async findOrCreateVerifiedWallet(
    address: EthereumAddress,
    chainId: number
  ): Promise<WalletAccountRecord> {
    assertWallet(address, chainId);
    try {
      return await this.database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(wallets)
          .where(and(eq(wallets.chainId, chainId), eq(wallets.addressNormalized, address)))
          .for("share")
          .limit(1);
        if (existing) {
          return { userId: existing.userId, address, chainId };
        }

        const candidateUserId = randomUUID();
        await transaction.insert(users).values({
          id: candidateUserId,
          displayName: `Wallet ${address.slice(0, 8)}…${address.slice(-6)}`
        });
        const inserted = await transaction
          .insert(wallets)
          .values({
            userId: candidateUserId,
            chainId,
            addressNormalized: address,
            verifiedAt: new Date()
          })
          .onConflictDoNothing({
            target: [wallets.chainId, wallets.addressNormalized]
          })
          .returning();
        if (inserted[0]) return { userId: candidateUserId, address, chainId };

        const [winner] = await transaction
          .select()
          .from(wallets)
          .where(and(eq(wallets.chainId, chainId), eq(wallets.addressNormalized, address)))
          .for("share")
          .limit(1);
        if (!winner)
          throw new DatabaseServiceError("DB_CONFLICT", "Wallet claim race was unresolved");
        await transaction.delete(users).where(eq(users.id, candidateUserId));
        return { userId: winner.userId, address, chainId };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}

export class DrizzleBrowserSessionStore {
  public constructor(
    private readonly database: Database,
    private readonly idleTtlMs = 60 * 60 * 1000
  ) {
    if (!Number.isSafeInteger(idleTtlMs) || idleTtlMs <= 0) {
      throw new TypeError("idleTtlMs must be a positive safe integer");
    }
  }

  public async create(session: StoredBrowserSessionRecord): Promise<void> {
    assertWallet(session.address, session.chainId);
    assertDigest(session.tokenDigest, "Session token digest");
    assertDigest(session.csrfDigest, "Session CSRF digest");
    try {
      await this.database.transaction(async (transaction) => {
        const [wallet] = await transaction
          .select()
          .from(wallets)
          .where(
            and(
              eq(wallets.userId, session.userId),
              eq(wallets.chainId, session.chainId),
              eq(wallets.addressNormalized, session.address)
            )
          )
          .for("share")
          .limit(1);
        if (!wallet) throw invalid("Session wallet does not belong to its user");
        await transaction.insert(browserSessions).values({
          id: session.id,
          userId: session.userId,
          walletId: wallet.id,
          tokenDigest: session.tokenDigest,
          csrfDigest: session.csrfDigest,
          createdAt: session.createdAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          idleExpiresAt: session.idleExpiresAt,
          lastSeenAt: session.createdAt
        });
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async findActiveByTokenDigest(
    tokenDigest: string,
    accessedAt: Date
  ): Promise<StoredBrowserSessionRecord | null> {
    assertDigest(tokenDigest, "Session token digest");
    const requestedIdleExpiry = new Date(accessedAt.getTime() + this.idleTtlMs);
    try {
      return await this.database.transaction(async (transaction) => {
        const [session] = await transaction
          .update(browserSessions)
          .set({
            lastSeenAt: sql`greatest(${browserSessions.lastSeenAt}, ${accessedAt})`,
            idleExpiresAt: sql`least(${browserSessions.absoluteExpiresAt}, greatest(${browserSessions.idleExpiresAt}, ${requestedIdleExpiry}))`
          })
          .where(
            and(
              eq(browserSessions.tokenDigest, tokenDigest),
              isNull(browserSessions.revokedAt),
              gt(browserSessions.absoluteExpiresAt, accessedAt),
              gt(browserSessions.idleExpiresAt, accessedAt)
            )
          )
          .returning();
        if (!session) return null;
        const [wallet] = await transaction
          .select()
          .from(wallets)
          .where(and(eq(wallets.id, session.walletId), eq(wallets.userId, session.userId)))
          .limit(1);
        if (!wallet)
          throw new DatabaseServiceError("DB_CONFLICT", "Session wallet binding disappeared");
        return {
          id: session.id,
          userId: session.userId,
          address: wallet.addressNormalized as EthereumAddress,
          chainId: wallet.chainId,
          tokenDigest: session.tokenDigest,
          csrfDigest: session.csrfDigest,
          createdAt: session.createdAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          idleExpiresAt: session.idleExpiresAt
        };
      });
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  public async revoke(tokenDigest: string, revokedAt: Date): Promise<boolean> {
    assertDigest(tokenDigest, "Session token digest");
    try {
      const revoked = await this.database
        .update(browserSessions)
        .set({ revokedAt })
        .where(and(eq(browserSessions.tokenDigest, tokenDigest), isNull(browserSessions.revokedAt)))
        .returning({ id: browserSessions.id });
      return revoked.length === 1;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}

export function createWalletAuthAdapters(database: Database) {
  return {
    challenges: new DrizzleWalletChallengeStore(database),
    accounts: new DrizzleWalletAccountResolver(database),
    sessions: new DrizzleBrowserSessionStore(database)
  };
}
