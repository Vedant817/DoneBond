import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  buildPostgresOptions,
  databaseSchema,
  DrizzleBrowserSessionStore,
  DrizzleWalletAccountResolver,
  DrizzleWalletChallengeStore,
  parseDatabaseEnvironment
} from "../dist/index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "initial migration applies to a clean real PostgreSQL database",
  { skip: !testDatabaseUrl, timeout: 60_000 },
  async () => {
    assert.equal(
      process.env.DONEBOND_ALLOW_DATABASE_RESET,
      "test-only-confirmed",
      "Set DONEBOND_ALLOW_DATABASE_RESET=test-only-confirmed for the disposable test database"
    );
    const url = new URL(testDatabaseUrl);
    assert.match(url.pathname, /_test$/, "TEST_DATABASE_URL database name must end with _test");
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    assert(
      loopback || process.env.DONEBOND_ALLOW_REMOTE_TEST_DATABASE === "test-only-confirmed",
      "Remote database reset requires DONEBOND_ALLOW_REMOTE_TEST_DATABASE=test-only-confirmed"
    );

    const environment = parseDatabaseEnvironment({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_SSL: process.env.DATABASE_SSL ?? (loopback ? "disable" : "require"),
      DATABASE_CA_CERT: process.env.DATABASE_CA_CERT
    });
    const client = postgres(testDatabaseUrl, buildPostgresOptions(environment));
    try {
      await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
      const database = drizzle(client, { schema: databaseSchema });
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url))
      });

      const [{ tableCount }] = await client`
        SELECT count(*)::int AS "tableCount"
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `;
      assert.equal(tableCount, 15);

      const requiredConstraints = [
        "tasks_policy_same_project_hash_fk",
        "evidence_task_policy_project_fk",
        "evidence_token_project_fk",
        "chain_transactions_replacement_scope_fk",
        "browser_sessions_wallet_user_fk",
        "wallet_auth_challenges_nonce_digest_unique"
      ];
      const constraintRows = await client`
        SELECT conname
        FROM pg_constraint
        WHERE conname = ANY(${requiredConstraints}::text[])
      `;
      assert.deepEqual(constraintRows.map((row) => row.conname).sort(), requiredConstraints.sort());

      const userId = "00000000-0000-4000-8000-000000000101";
      const projectId = "00000000-0000-4000-8000-000000000102";
      await client`INSERT INTO users (id, display_name) VALUES (${userId}, 'Integration user')`;
      await client`
        INSERT INTO projects (
          id, public_id, owner_user_id, slug, name, repository_url, default_branch
        ) VALUES (
          ${projectId}, '01arz3ndektsv4rrffq69g5fav', ${userId}, 'integration',
          'Integration', 'https://example.test/owner/repository', 'main'
        )
      `;
      const invalidDigest = "test-only-invalid-digest";
      await assert.rejects(
        client`
          INSERT INTO cli_tokens (
            public_id, project_id, created_by_user_id, token_prefix, token_digest
          ) VALUES (
            '01arz3ndektsv4rrffq69g5faw', ${projectId}, ${userId}, 'db_test', ${invalidDigest}
          )
        `,
        /cli_tokens_digest_format/
      );

      const testOnlyAddress = `0x${"3".repeat(40)}`;
      const accounts = new DrizzleWalletAccountResolver(database);
      const [firstAccount, concurrentAccount] = await Promise.all([
        accounts.findOrCreateVerifiedWallet(testOnlyAddress, 10_143),
        accounts.findOrCreateVerifiedWallet(testOnlyAddress, 10_143)
      ]);
      assert.equal(firstAccount.userId, concurrentAccount.userId);

      const challenges = new DrizzleWalletChallengeStore(database);
      const challengeId = "00000000-0000-4000-8000-000000000301";
      const testOnlyNonceDigest = "d".repeat(64);
      const issuedAt = new Date("2026-07-17T08:00:00.000Z");
      await challenges.create({
        id: challengeId,
        address: testOnlyAddress,
        chainId: 10_143,
        domain: "example.test",
        uri: "https://example.test",
        nonceDigest: testOnlyNonceDigest,
        issuedAt,
        expiresAt: new Date("2026-07-17T08:05:00.000Z")
      });
      const consumedAt = new Date("2026-07-17T08:01:00.000Z");
      const consumeResults = await Promise.all([
        challenges.consume(challengeId, testOnlyNonceDigest, consumedAt),
        challenges.consume(challengeId, testOnlyNonceDigest, consumedAt)
      ]);
      assert.deepEqual(consumeResults.sort(), [false, true]);

      const sessions = new DrizzleBrowserSessionStore(database);
      const testOnlySessionDigest = "e".repeat(64);
      const testOnlyCsrfDigest = "f".repeat(64);
      const absoluteExpiresAt = new Date("2026-07-17T08:30:00.000Z");
      await sessions.create({
        id: "00000000-0000-4000-8000-000000000302",
        ...firstAccount,
        tokenDigest: testOnlySessionDigest,
        csrfDigest: testOnlyCsrfDigest,
        createdAt: issuedAt,
        absoluteExpiresAt,
        idleExpiresAt: new Date("2026-07-17T08:20:00.000Z")
      });
      const [beforeInvalidCsrf] = await client`
        SELECT last_seen_at, idle_expires_at
        FROM browser_sessions
        WHERE token_digest = ${testOnlySessionDigest}
      `;
      assert.equal(
        await sessions.findActiveByTokenAndCsrfDigest(
          testOnlySessionDigest,
          "0".repeat(64),
          new Date("2026-07-17T08:10:00.000Z")
        ),
        null
      );
      const [afterInvalidCsrf] = await client`
        SELECT last_seen_at, idle_expires_at
        FROM browser_sessions
        WHERE token_digest = ${testOnlySessionDigest}
      `;
      assert.deepEqual(afterInvalidCsrf, beforeInvalidCsrf);

      const active = await sessions.findActiveByTokenAndCsrfDigest(
        testOnlySessionDigest,
        testOnlyCsrfDigest,
        new Date("2026-07-17T08:10:00.000Z")
      );
      assert.equal(active?.idleExpiresAt.getTime(), absoluteExpiresAt.getTime());
      assert.equal(
        await sessions.revoke(testOnlySessionDigest, new Date("2026-07-17T08:11:00.000Z")),
        true
      );
      assert.equal(
        await sessions.findActiveByTokenDigest(
          testOnlySessionDigest,
          new Date("2026-07-17T08:12:00.000Z")
        ),
        null
      );
    } finally {
      await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
      await client.end({ timeout: 5 });
    }
  }
);
