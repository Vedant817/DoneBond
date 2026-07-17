import assert from "node:assert/strict";
import test from "node:test";

import {
  apiIdempotencyKeys,
  auditEvents,
  cliTokens,
  DatabaseServiceError,
  DrizzleCliTokenRepository,
  projects
} from "../dist/index.js";

function createFakeDatabase({ selects = [], returns = [] } = {}) {
  const calls = [];
  const mutation = (kind, table) => {
    const call = { kind, table };
    calls.push(call);
    const builder = {
      values(value) {
        call.values = value;
        return builder;
      },
      set(value) {
        call.set = value;
        return builder;
      },
      from(tableValue) {
        call.from = tableValue;
        return builder;
      },
      where(condition) {
        call.where = condition;
        return builder;
      },
      onConflictDoNothing(config) {
        call.conflict = config;
        return builder;
      },
      returning() {
        return Promise.resolve(returns.shift() ?? []);
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      }
    };
    return builder;
  };
  const executor = {
    insert: (table) => mutation("insert", table),
    update: (table) => mutation("update", table),
    select(projection) {
      const call = { kind: "select", projection };
      calls.push(call);
      const builder = {
        from(table) {
          call.table = table;
          return builder;
        },
        innerJoin(table, condition) {
          call.join = { table, condition };
          return builder;
        },
        where(condition) {
          call.where = condition;
          return builder;
        },
        for(mode) {
          call.lock = mode;
          return builder;
        },
        limit() {
          return Promise.resolve(selects.shift() ?? []);
        }
      };
      return builder;
    }
  };
  return {
    ...executor,
    calls,
    transaction: async (callback) => callback(executor)
  };
}

const actorUserId = "00000000-0000-4000-8000-000000000501";
const projectId = "00000000-0000-4000-8000-000000000502";
const tokenId = "00000000-0000-4000-8000-000000000503";
const projectPublicId = "01arz3ndektsv4rrffq69g5fav";
const tokenPublicId = "01arz3ndektsv4rrffq69g5fab";
const digest = "7".repeat(64);
const createdAt = new Date("2026-07-17T08:00:00.000Z");

const input = {
  actorUserId,
  projectPublicId,
  tokenPublicId,
  tokenPrefix: "dbt_abcd",
  tokenDigest: digest
};
const idempotency = {
  actorScope: `user:${actorUserId}`,
  operation: "cli_token_create",
  idempotencyKey: "cli-token-create-0001",
  requestHash: `0x${"a".repeat(64)}`,
  expiresAt: new Date("2026-07-18T08:00:00.000Z")
};
const stored = {
  id: tokenId,
  publicId: tokenPublicId,
  projectId,
  createdByUserId: actorUserId,
  tokenPrefix: input.tokenPrefix,
  tokenDigest: digest,
  lastUsedAt: null,
  revokedAt: null,
  createdAt
};

test("owner token creation persists only keyed digest and safe metadata atomically", async () => {
  const database = createFakeDatabase({
    selects: [[{ id: projectId }]],
    returns: [[{ resourcePublicId: tokenPublicId }], [stored]]
  });
  const result = await new DrizzleCliTokenRepository(database).create(input, idempotency);
  assert.deepEqual(result, {
    tokenPublicId,
    projectPublicId,
    tokenPrefix: input.tokenPrefix,
    createdAt,
    lastUsedAt: null,
    revokedAt: null
  });
  assert.equal("tokenDigest" in result, false);
  const tokenInsert = database.calls.find(
    (call) => call.kind === "insert" && call.table === cliTokens
  );
  assert.equal(tokenInsert.values.tokenDigest, digest);
  assert.equal(Object.values(tokenInsert.values).includes("test-only-plaintext-token"), false);
  assert.deepEqual(
    database.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [apiIdempotencyKeys, cliTokens, auditEvents]
  );
});

test("non-owner creation fails without reserving idempotency or persisting a token", async () => {
  const database = createFakeDatabase({ selects: [[]] });
  await assert.rejects(
    new DrizzleCliTokenRepository(database).create(input, idempotency),
    (error) => error instanceof DatabaseServiceError && error.code === "DB_NOT_FOUND"
  );
  assert.equal(
    database.calls.some((call) => call.kind === "insert"),
    false
  );
});

test("exact create replay returns existing metadata while conflicting replay fails", async () => {
  const replay = {
    actorScope: idempotency.actorScope,
    operation: idempotency.operation,
    idempotencyKey: idempotency.idempotencyKey,
    requestHash: idempotency.requestHash,
    resourcePublicId: tokenPublicId
  };
  const exactDatabase = createFakeDatabase({
    selects: [[{ id: projectId }], [replay], [stored], [stored]],
    returns: [[]]
  });
  assert.equal(
    (await new DrizzleCliTokenRepository(exactDatabase).create(input, idempotency)).tokenPublicId,
    tokenPublicId
  );
  assert.equal(exactDatabase.calls.filter((call) => call.table === auditEvents).length, 0);

  const conflictDatabase = createFakeDatabase({
    selects: [[{ id: projectId }], [{ ...replay, requestHash: `0x${"b".repeat(64)}` }], [stored]],
    returns: [[]]
  });
  await assert.rejects(
    new DrizzleCliTokenRepository(conflictDatabase).create(input, idempotency),
    (error) => error instanceof DatabaseServiceError && error.code === "DB_IDEMPOTENCY_CONFLICT"
  );
});

test("authentication is one project-bound active-token update", async () => {
  const usedAt = new Date("2026-07-17T08:30:00.000Z");
  const database = createFakeDatabase({
    returns: [[{ tokenId, tokenPublicId, projectId }], [], []]
  });
  const repository = new DrizzleCliTokenRepository(database);
  assert.deepEqual(await repository.authenticate(projectPublicId, digest, usedAt), {
    tokenId,
    tokenPublicId,
    projectId,
    projectPublicId
  });
  assert.equal(await repository.authenticate(projectPublicId, "8".repeat(64), usedAt), null);
  assert.equal(await repository.authenticate("01arz3ndektsv4rrffq69g5fac", digest, usedAt), null);
  const update = database.calls.find((call) => call.kind === "update" && call.table === cliTokens);
  assert.equal(update.from, projects);
  assert.equal(typeof update.set.lastUsedAt, "object");
});

test("revocation is owner-bound and idempotent without duplicate audit", async () => {
  const revokedAt = new Date("2026-07-17T09:00:00.000Z");
  const revoked = { ...stored, revokedAt };
  const database = createFakeDatabase({
    selects: [[{ id: projectId }], [{ id: projectId }], [revoked]],
    returns: [[revoked], []]
  });
  const repository = new DrizzleCliTokenRepository(database);
  assert.equal(
    (await repository.revoke(actorUserId, projectPublicId, tokenPublicId, revokedAt))?.revokedAt,
    revokedAt
  );
  assert.equal(
    (await repository.revoke(actorUserId, projectPublicId, tokenPublicId, revokedAt))?.revokedAt,
    revokedAt
  );
  assert.equal(database.calls.filter((call) => call.table === auditEvents).length, 1);
});

test("raw, uppercase, or malformed token digests never reach the database", async () => {
  for (const tokenDigest of ["test-only-plaintext-token", "A".repeat(64), "a".repeat(63)]) {
    const database = createFakeDatabase();
    await assert.rejects(
      new DrizzleCliTokenRepository(database).authenticate(projectPublicId, tokenDigest, createdAt),
      /64 lowercase hex/
    );
    assert.equal(database.calls.length, 0);
  }
});
