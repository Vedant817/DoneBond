import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  buildPostgresOptions,
  databaseSchema,
  DoneBondRepository,
  DrizzleAuthRateLimiter,
  DrizzleBrowserSessionStore,
  DrizzleCliTokenRepository,
  DrizzleProjectPolicyRepository,
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
      assert.equal(tableCount, 16);

      const requiredConstraints = [
        "tasks_policy_same_project_hash_fk",
        "evidence_task_policy_project_fk",
        "evidence_token_project_fk",
        "chain_transactions_replacement_scope_fk",
        "browser_sessions_wallet_user_fk",
        "wallet_auth_challenges_nonce_digest_unique",
        "auth_rate_limits_scope_key_pk",
        "api_idempotency_response_complete",
        "projects_default_branch_not_option",
        "policies_source_relative"
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
      await client`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${projectId}, ${userId}, 'owner')
      `;
      const memberUserId = "00000000-0000-4000-8000-000000000103";
      const nonmemberUserId = "00000000-0000-4000-8000-000000000104";
      const crossProjectUserId = "00000000-0000-4000-8000-000000000105";
      const crossProjectId = "00000000-0000-4000-8000-000000000106";
      const crossProjectPublicId = "01arz3ndektsv4rrffq69g5fax";
      await client`
        INSERT INTO users (id, display_name) VALUES
          (${memberUserId}, 'Integration member'),
          (${nonmemberUserId}, 'Integration nonmember'),
          (${crossProjectUserId}, 'Cross-project member')
      `;
      await client`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${projectId}, ${memberUserId}, 'member')
      `;
      await client`
        INSERT INTO projects (
          id, public_id, owner_user_id, slug, name, repository_url, default_branch
        ) VALUES (
          ${crossProjectId}, ${crossProjectPublicId}, ${crossProjectUserId}, 'cross-project',
          'Cross project', 'https://example.test/owner/cross-project', 'main'
        )
      `;
      await client`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${crossProjectId}, ${crossProjectUserId}, 'owner')
      `;

      const repository = new DoneBondRepository(database);
      const targetProjectPublicId = "01arz3ndektsv4rrffq69g5fav";
      assert.deepEqual(await repository.findProjectAccess(targetProjectPublicId, userId), {
        projectPublicId: targetProjectPublicId,
        role: "owner"
      });
      assert.equal(
        (await repository.findProjectAccess(targetProjectPublicId, memberUserId))?.role,
        "member"
      );
      assert.equal(
        await repository.findProjectAccess(targetProjectPublicId, nonmemberUserId),
        null
      );
      assert.equal(
        await repository.findProjectAccess(targetProjectPublicId, crossProjectUserId),
        null
      );
      assert.equal(
        await repository.findProjectAccess("01arz3ndektsv4rrffq69g5fay", crossProjectUserId),
        null
      );

      const projectPolicyRepository = new DrizzleProjectPolicyRepository(database);
      const managedProjectPublicId = "01arz3ndektsv4rrffq69g5faz";
      const managedPolicyPublicId = "01arz3ndektsv4rrffq69g5fap";
      const managedPolicyHash = `0x${"a".repeat(64)}`;
      const idempotency = (operation, key, requestHash) => ({
        actorScope: `user:${userId}`,
        operation,
        idempotencyKey: key,
        requestHash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      });
      const managedProjectInput = {
        actorUserId: userId,
        publicId: managedProjectPublicId,
        slug: "repository-integration",
        name: "Repository integration",
        repositoryUrl: "https://example.test/owner/repository-integration.git",
        defaultBranch: "main",
        visibility: "private"
      };
      const projectCreateIdempotency = idempotency(
        "project_create",
        "integration-project-create",
        `0x${"1".repeat(64)}`
      );
      const managedProject = await projectPolicyRepository.createProject(
        managedProjectInput,
        projectCreateIdempotency
      );
      assert.equal(managedProject.publicId, managedProjectPublicId);
      assert.equal("id" in managedProject, false);
      const projectUpdateAInput = {
        actorUserId: userId,
        projectPublicId: managedProjectPublicId,
        changedAt: new Date("2026-07-17T08:30:00.000Z"),
        name: "Repository update A"
      };
      const projectUpdateAIdempotency = idempotency(
        "project_update",
        "integration-project-update-a",
        `0x${"f".repeat(64)}`
      );
      const projectUpdateA = await projectPolicyRepository.updateProject(
        projectUpdateAInput,
        projectUpdateAIdempotency
      );
      await projectPolicyRepository.updateProject(
        {
          ...projectUpdateAInput,
          changedAt: new Date("2026-07-17T08:31:00.000Z"),
          name: "Repository update B"
        },
        idempotency("project_update", "integration-project-update-b", `0x${"e".repeat(64)}`)
      );
      assert.deepEqual(
        await projectPolicyRepository.updateProject(projectUpdateAInput, projectUpdateAIdempotency),
        projectUpdateA
      );
      assert.deepEqual(
        await projectPolicyRepository.createProject(managedProjectInput, projectCreateIdempotency),
        managedProject
      );
      assert.equal(
        (await projectPolicyRepository.findProject(managedProjectPublicId, userId))?.role,
        "owner"
      );
      assert.equal(
        await projectPolicyRepository.findProject(managedProjectPublicId, memberUserId),
        null
      );
      const firstProjectPage = await projectPolicyRepository.listProjects(userId, { limit: 1 });
      assert.equal(firstProjectPage.rows.length, 1);
      assert(firstProjectPage.nextCursor);
      const secondProjectPage = await projectPolicyRepository.listProjects(userId, {
        limit: 1,
        cursor: firstProjectPage.nextCursor
      });
      assert.equal(secondProjectPage.rows.length, 1);
      assert.notEqual(secondProjectPage.rows[0].publicId, firstProjectPage.rows[0].publicId);
      await assert.rejects(
        projectPolicyRepository.createProject(
          { ...managedProjectInput, publicId: "01arz3ndektsv4rrffq69g5faq" },
          idempotency("project_create", "integration-project-slug-conflict", `0x${"2".repeat(64)}`)
        ),
        (error) => error.code === "DB_PROJECT_SLUG_CONFLICT"
      );

      const managedPolicyInput = {
        actorUserId: userId,
        projectPublicId: managedProjectPublicId,
        policyPublicId: managedPolicyPublicId,
        schemaVersion: 7,
        canonicalJson: {
          kind: "donebond.policy",
          schemaVersion: 7,
          checks: [{ command: "pnpm", args: ["test"], required: true }]
        },
        policyHash: managedPolicyHash,
        sourcePath: ".donebond/policy.json",
        activate: true,
        activatedAt: new Date("2026-07-17T09:00:00.000Z")
      };
      const policyCreateIdempotency = idempotency(
        "policy_create",
        "integration-policy-create",
        `0x${"3".repeat(64)}`
      );
      const managedPolicy = await projectPolicyRepository.createPolicyVersion(
        managedPolicyInput,
        policyCreateIdempotency
      );
      assert.equal(managedPolicy.active, true);
      assert.equal(managedPolicy.schemaVersion, 7);
      const [policyReplayStorage] = await client`
        SELECT response_status, response_safe_json
        FROM api_idempotency_keys
        WHERE actor_scope = ${`user:${userId}`}
          AND operation = 'policy_create'
          AND idempotency_key = 'integration-policy-create'
      `;
      assert.equal(policyReplayStorage.response_status, 201);
      assert.equal("canonicalJson" in policyReplayStorage.response_safe_json, false);
      assert.equal("id" in policyReplayStorage.response_safe_json, false);
      assert.deepEqual(
        (
          await projectPolicyRepository.findPolicyVersion(
            managedProjectPublicId,
            managedPolicyPublicId,
            userId
          )
        )?.canonicalJson,
        managedPolicyInput.canonicalJson
      );
      assert.equal(
        (await projectPolicyRepository.findProject(managedProjectPublicId, userId))
          ?.activePolicyHash,
        managedPolicyHash
      );
      assert.equal(
        (
          await projectPolicyRepository.createPolicyVersion(
            managedPolicyInput,
            idempotency("policy_create", "integration-policy-existing", `0x${"4".repeat(64)}`)
          )
        ).publicId,
        managedPolicyPublicId
      );
      await assert.rejects(
        projectPolicyRepository.createPolicyVersion(
          { ...managedPolicyInput, policyPublicId: "01arz3ndektsv4rrffq69g5far", activate: false },
          idempotency("policy_create", "integration-policy-hash-conflict", `0x${"5".repeat(64)}`)
        ),
        (error) => error.code === "DB_POLICY_HASH_CONFLICT"
      );
      await assert.rejects(
        projectPolicyRepository.createPolicyVersion(
          {
            ...managedPolicyInput,
            actorUserId: memberUserId,
            policyPublicId: "01arz3ndektsv4rrffq69g5fas",
            policyHash: `0x${"b".repeat(64)}`,
            activate: false
          },
          {
            ...idempotency("policy_create", "integration-policy-member", `0x${"6".repeat(64)}`),
            actorScope: `user:${memberUserId}`
          }
        ),
        (error) => error.code === "DB_NOT_FOUND"
      );

      const secondPolicyInput = {
        ...managedPolicyInput,
        policyPublicId: "01arz3ndektsv4rrffq69g5faw",
        policyHash: `0x${"e".repeat(64)}`,
        canonicalJson: {
          ...managedPolicyInput.canonicalJson,
          checks: [{ command: "pnpm", args: ["typecheck"], required: true }]
        },
        activatedAt: new Date("2026-07-17T09:00:01.000Z")
      };
      const secondPolicy = await projectPolicyRepository.createPolicyVersion(
        secondPolicyInput,
        idempotency("policy_create", "integration-policy-second", `0x${"0".repeat(64)}`)
      );
      assert.equal(secondPolicy.active, true);
      assert.deepEqual(
        await projectPolicyRepository.createPolicyVersion(
          managedPolicyInput,
          policyCreateIdempotency
        ),
        managedPolicy
      );

      const activateOriginalInput = {
        actorUserId: userId,
        projectPublicId: managedProjectPublicId,
        policyPublicId: managedPolicyPublicId,
        activatedAt: new Date("2026-07-17T09:00:02.000Z")
      };
      const activateOriginalIdempotency = idempotency(
        "policy_activate",
        "integration-policy-activate-original",
        `0x${"6".repeat(64)}`
      );
      const activatedOriginal = await projectPolicyRepository.activatePolicy(
        activateOriginalInput,
        activateOriginalIdempotency
      );
      await projectPolicyRepository.activatePolicy(
        {
          ...activateOriginalInput,
          policyPublicId: secondPolicyInput.policyPublicId,
          activatedAt: new Date("2026-07-17T09:00:03.000Z")
        },
        idempotency(
          "policy_activate",
          "integration-policy-reactivate-second",
          `0x${"7".repeat(64)}`
        )
      );
      assert.deepEqual(
        await projectPolicyRepository.activatePolicy(
          activateOriginalInput,
          activateOriginalIdempotency
        ),
        activatedOriginal
      );
      const history = await projectPolicyRepository.listPolicyVersions(
        managedProjectPublicId,
        userId,
        { limit: 1 }
      );
      assert.equal(history?.rows.length, 1);
      assert(history?.nextCursor);
      const nextHistory = await projectPolicyRepository.listPolicyVersions(
        managedProjectPublicId,
        userId,
        { limit: 1, cursor: history.nextCursor }
      );
      assert.equal(nextHistory?.rows.length, 1);
      assert.notEqual(nextHistory?.rows[0].publicId, history.rows[0].publicId);

      const concurrentPolicyHash = `0x${"d".repeat(64)}`;
      const concurrentPolicyResults = await Promise.allSettled([
        projectPolicyRepository.createPolicyVersion(
          {
            ...managedPolicyInput,
            policyPublicId: "01arz3ndektsv4rrffq69g5fau",
            policyHash: concurrentPolicyHash,
            activate: false
          },
          idempotency("policy_create", "integration-policy-race-a", `0x${"a".repeat(64)}`)
        ),
        projectPolicyRepository.createPolicyVersion(
          {
            ...managedPolicyInput,
            policyPublicId: "01arz3ndektsv4rrffq69g5fav",
            policyHash: concurrentPolicyHash,
            activate: false
          },
          idempotency("policy_create", "integration-policy-race-b", `0x${"b".repeat(64)}`)
        )
      ]);
      assert.equal(
        concurrentPolicyResults.filter((result) => result.status === "fulfilled").length,
        1
      );
      const concurrentPolicyRejection = concurrentPolicyResults.find(
        (result) => result.status === "rejected"
      );
      assert.equal(concurrentPolicyRejection?.reason.code, "DB_POLICY_HASH_CONFLICT");

      const [managedIds] = await client`
        SELECT p.id AS project_id, policy.id AS policy_id
        FROM projects p
        JOIN policies policy ON policy.project_id = p.id
        WHERE p.public_id = ${managedProjectPublicId}
          AND policy.public_id = ${managedPolicyPublicId}
      `;
      await client`
        INSERT INTO tasks (
          project_id, public_id, policy_id, chain_id, contract_address, title, description,
          canonical_json, target_branch, base_commit, acceptance_criteria_json,
          task_hash, policy_hash, creator_wallet, assignee_wallet
        ) VALUES (
          ${managedIds.project_id}, '01arz3ndektsv4rrffq69g5fat', ${managedIds.policy_id}, 10143,
          ${`0x${"1".repeat(40)}`}, 'Immutable repository task', 'Integration task',
          ${client.json({ kind: "donebond.task", schemaVersion: 1 })}, 'main', NULL,
          ${client.json([{ text: "Tests pass" }])}, ${`0x${"c".repeat(64)}`},
          ${managedPolicyHash}, ${`0x${"2".repeat(40)}`}, ${`0x${"3".repeat(40)}`}
        )
      `;
      await assert.rejects(
        projectPolicyRepository.updateProject(
          {
            actorUserId: userId,
            projectPublicId: managedProjectPublicId,
            changedAt: new Date("2026-07-17T09:01:00.000Z"),
            repositoryUrl: "https://example.test/owner/changed.git"
          },
          idempotency(
            "project_update",
            "integration-project-repository-change",
            `0x${"7".repeat(64)}`
          )
        ),
        (error) => error.code === "DB_REPOSITORY_IMMUTABLE"
      );
      const archived = await projectPolicyRepository.updateProject(
        {
          actorUserId: userId,
          projectPublicId: managedProjectPublicId,
          changedAt: new Date("2026-07-17T09:02:00.000Z"),
          status: "archived"
        },
        idempotency("project_update", "integration-project-archive", `0x${"8".repeat(64)}`)
      );
      assert.equal(archived.status, "archived");
      assert.deepEqual(
        await projectPolicyRepository.createPolicyVersion(
          managedPolicyInput,
          policyCreateIdempotency
        ),
        managedPolicy
      );
      await assert.rejects(
        projectPolicyRepository.activatePolicy(
          {
            actorUserId: userId,
            projectPublicId: managedProjectPublicId,
            policyPublicId: managedPolicyPublicId,
            activatedAt: new Date("2026-07-17T09:03:00.000Z")
          },
          idempotency("policy_activate", "integration-policy-archived", `0x${"9".repeat(64)}`)
        ),
        (error) => error.code === "DB_PROJECT_ARCHIVED"
      );
      const cliTokenRepository = new DrizzleCliTokenRepository(database);
      const cliTokenTestStartedAt = new Date();
      const cliTokenPublicId = "01arz3ndektsv4rrffq69g5fab";
      const cliTokenDigest = "7".repeat(64);
      const cliTokenInput = {
        actorUserId: userId,
        projectPublicId: targetProjectPublicId,
        tokenPublicId: cliTokenPublicId,
        tokenPrefix: "dbt_abcd",
        tokenDigest: cliTokenDigest
      };
      const cliTokenIdempotency = {
        actorScope: `user:${userId}`,
        operation: "cli_token_create",
        idempotencyKey: "integration-cli-token-create",
        requestHash: `0x${"7".repeat(64)}`,
        expiresAt: new Date(cliTokenTestStartedAt.getTime() + 24 * 60 * 60 * 1000)
      };
      const createdCliToken = await cliTokenRepository.create(cliTokenInput, cliTokenIdempotency);
      assert.equal(createdCliToken.tokenPublicId, cliTokenPublicId);
      assert.equal("tokenDigest" in createdCliToken, false);
      assert.equal(
        (await cliTokenRepository.create(cliTokenInput, cliTokenIdempotency)).tokenPublicId,
        cliTokenPublicId
      );
      const [persistedCliToken] = await client`
        SELECT token_digest, last_used_at, revoked_at
        FROM cli_tokens
        WHERE public_id = ${cliTokenPublicId}
      `;
      assert.equal(persistedCliToken.token_digest, cliTokenDigest);
      assert.equal(persistedCliToken.last_used_at, null);

      await assert.rejects(
        cliTokenRepository.create(
          {
            ...cliTokenInput,
            actorUserId: memberUserId,
            tokenPublicId: "01arz3ndektsv4rrffq69g5fac"
          },
          {
            ...cliTokenIdempotency,
            actorScope: `user:${memberUserId}`,
            idempotencyKey: "integration-cli-token-member-create"
          }
        ),
        (error) => error.code === "DB_NOT_FOUND"
      );
      assert.equal(
        await cliTokenRepository.authenticate(
          crossProjectPublicId,
          cliTokenDigest,
          new Date(cliTokenTestStartedAt.getTime() + 1)
        ),
        null
      );
      const [afterWrongProject] = await client`
        SELECT last_used_at FROM cli_tokens WHERE public_id = ${cliTokenPublicId}
      `;
      assert.equal(afterWrongProject.last_used_at, null);
      await client`DELETE FROM projects WHERE id = ${crossProjectId}`;
      assert.equal(
        await repository.findProjectAccess(crossProjectPublicId, crossProjectUserId),
        null
      );
      const usedAt = new Date(cliTokenTestStartedAt.getTime() + 2);
      assert.equal(
        (await cliTokenRepository.authenticate(targetProjectPublicId, cliTokenDigest, usedAt))
          ?.tokenPublicId,
        cliTokenPublicId
      );

      const raceDigest = "8".repeat(64);
      const raceResults = await Promise.allSettled([
        cliTokenRepository.create(
          {
            ...cliTokenInput,
            tokenPublicId: "01arz3ndektsv4rrffq69g5fad",
            tokenDigest: raceDigest
          },
          {
            ...cliTokenIdempotency,
            idempotencyKey: "integration-cli-token-race-a",
            requestHash: `0x${"8".repeat(64)}`
          }
        ),
        cliTokenRepository.create(
          {
            ...cliTokenInput,
            tokenPublicId: "01arz3ndektsv4rrffq69g5fae",
            tokenDigest: raceDigest
          },
          {
            ...cliTokenIdempotency,
            idempotencyKey: "integration-cli-token-race-b",
            requestHash: `0x${"9".repeat(64)}`
          }
        )
      ]);
      assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
      const duplicateRejection = raceResults.find((result) => result.status === "rejected");
      assert.equal(duplicateRejection?.reason.code, "DB_CONFLICT");

      const revokedAt = new Date(cliTokenTestStartedAt.getTime() + 3);
      await assert.rejects(
        cliTokenRepository.revoke(memberUserId, targetProjectPublicId, cliTokenPublicId, revokedAt),
        (error) => error.code === "DB_NOT_FOUND"
      );
      assert.equal(
        (
          await cliTokenRepository.revoke(
            userId,
            targetProjectPublicId,
            cliTokenPublicId,
            revokedAt
          )
        )?.revokedAt.getTime(),
        revokedAt.getTime()
      );
      assert.equal(
        (
          await cliTokenRepository.revoke(
            userId,
            targetProjectPublicId,
            cliTokenPublicId,
            revokedAt
          )
        )?.revokedAt.getTime(),
        revokedAt.getTime()
      );
      assert.equal(
        await cliTokenRepository.authenticate(targetProjectPublicId, cliTokenDigest, revokedAt),
        null
      );
      const [afterRevokedAuthentication] = await client`
        SELECT last_used_at FROM cli_tokens WHERE public_id = ${cliTokenPublicId}
      `;
      assert.equal(afterRevokedAuthentication.last_used_at.getTime(), usedAt.getTime());
      const [{ revokeAuditCount }] = await client`
        SELECT count(*)::int AS "revokeAuditCount"
        FROM audit_events
        WHERE action = 'cli_token.revoked'
          AND metadata_safe_json->>'tokenPublicId' = ${cliTokenPublicId}
      `;
      assert.equal(revokeAuditCount, 1);
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

      const rateLimiter = new DrizzleAuthRateLimiter(database, {
        scope: "wallet_challenge_ip",
        maxAttempts: 3,
        windowMs: 60_000
      });
      const rateKeyDigest = "9".repeat(64);
      const rateResults = await Promise.all(
        Array.from({ length: 12 }, () => rateLimiter.consume(rateKeyDigest, issuedAt))
      );
      assert.equal(rateResults.filter(Boolean).length, 3);
      assert.equal(
        await rateLimiter.consume(rateKeyDigest, new Date("2026-07-17T08:00:59.999Z")),
        false
      );
      assert.equal(
        await rateLimiter.consume(rateKeyDigest, new Date("2026-07-17T08:01:00.000Z")),
        true
      );
      assert.equal(await rateLimiter.deleteExpired(new Date("2026-07-17T08:02:00.000Z"), 1), 1);
      const [{ rateLimitCount }] = await client`
        SELECT count(*)::int AS "rateLimitCount"
        FROM auth_rate_limits
      `;
      assert.equal(rateLimitCount, 0);

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
