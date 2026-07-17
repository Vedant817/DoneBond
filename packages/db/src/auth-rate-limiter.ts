import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseServiceError, translateDatabaseError } from "./errors.js";
import { authRateLimits, databaseSchema } from "./schema.js";

type Database = PostgresJsDatabase<typeof databaseSchema>;

export interface AuthRateLimiterOptions {
  readonly scope: string;
  readonly maxAttempts: number;
  readonly windowMs: number;
}

function invalid(message: string): DatabaseServiceError {
  return new DatabaseServiceError("DB_INVALID_INPUT", message);
}

function assertDigest(keyDigest: string): void {
  if (!/^[0-9a-f]{64}$/u.test(keyDigest)) {
    throw invalid("Rate-limit key digest must be 64 lowercase hex characters");
  }
}

function assertDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalid(`${field} must be a valid date`);
  }
}

export class DrizzleAuthRateLimiter {
  readonly #scope: string;
  readonly #maxAttempts: number;
  readonly #windowMs: number;

  public constructor(
    private readonly database: Database,
    options: AuthRateLimiterOptions
  ) {
    if (!/^[a-z][a-z0-9_:-]{0,63}$/u.test(options.scope)) {
      throw new TypeError("Rate-limit scope must be a stable lowercase identifier");
    }
    if (
      !Number.isSafeInteger(options.maxAttempts) ||
      options.maxAttempts <= 0 ||
      options.maxAttempts > 2_147_483_647
    ) {
      throw new TypeError("maxAttempts must fit a positive PostgreSQL integer");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new TypeError("windowMs must be a positive safe integer");
    }
    this.#scope = options.scope;
    this.#maxAttempts = options.maxAttempts;
    this.#windowMs = options.windowMs;
  }

  /**
   * Atomically consumes one attempt. A conflict updates only when the stored
   * window expired or still has capacity, so concurrent callers cannot exceed
   * maxAttempts for a scope/key pair.
   */
  public async consume(keyDigest: string, at: Date): Promise<boolean> {
    assertDigest(keyDigest);
    assertDate(at, "Rate-limit access time");
    const expiresAtMs = at.getTime() + this.#windowMs;
    if (!Number.isSafeInteger(expiresAtMs)) throw invalid("Rate-limit window is out of range");
    const newWindowExpiresAt = new Date(expiresAtMs);
    assertDate(newWindowExpiresAt, "Rate-limit window expiry");

    try {
      const consumed = await this.database
        .insert(authRateLimits)
        .values({
          scope: this.#scope,
          keyDigest,
          windowStartedAt: at,
          windowExpiresAt: newWindowExpiresAt,
          requestCount: 1
        })
        .onConflictDoUpdate({
          target: [authRateLimits.scope, authRateLimits.keyDigest],
          set: {
            windowStartedAt: sql`case when ${authRateLimits.windowExpiresAt} <= ${at} then ${at} else ${authRateLimits.windowStartedAt} end`,
            windowExpiresAt: sql`case when ${authRateLimits.windowExpiresAt} <= ${at} then ${newWindowExpiresAt} else ${authRateLimits.windowExpiresAt} end`,
            requestCount: sql`case when ${authRateLimits.windowExpiresAt} <= ${at} then 1 else ${authRateLimits.requestCount} + 1 end`
          },
          setWhere: sql`${authRateLimits.windowExpiresAt} <= ${at} or ${authRateLimits.requestCount} < ${this.#maxAttempts}`
        })
        .returning({ requestCount: authRateLimits.requestCount });
      return consumed.length === 1;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  /** Deletes at most limit expired rows, allowing periodic cleanup without a long table lock. */
  public async deleteExpired(before: Date, limit = 500): Promise<number> {
    assertDate(before, "Rate-limit cleanup time");
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw invalid("Rate-limit cleanup limit must be between 1 and 1000");
    }
    try {
      const deleted = await this.database.execute(sql`
        with expired as (
          select ${authRateLimits.scope}, ${authRateLimits.keyDigest}
          from ${authRateLimits}
          where ${authRateLimits.windowExpiresAt} <= ${before}
          order by ${authRateLimits.windowExpiresAt}
          limit ${limit}
          for update skip locked
        )
        delete from ${authRateLimits}
        using expired
        where ${authRateLimits.scope} = expired.scope
          and ${authRateLimits.keyDigest} = expired.key_digest
        returning ${authRateLimits.keyDigest}
      `);
      return deleted.length;
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }
}
