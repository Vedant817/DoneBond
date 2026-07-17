import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { buildPostgresOptions, parseDatabaseEnvironment } from "../dist/index.js";

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
      await migrate(drizzle(client), {
        migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url))
      });

      const [{ tableCount }] = await client`
        SELECT count(*)::int AS "tableCount"
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `;
      assert.equal(tableCount, 13);

      const requiredConstraints = [
        "tasks_policy_same_project_hash_fk",
        "evidence_task_policy_project_fk",
        "evidence_token_project_fk",
        "chain_transactions_replacement_scope_fk"
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
    } finally {
      await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
      await client.end({ timeout: 5 });
    }
  }
);
