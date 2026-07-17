import assert from "node:assert/strict";
import test from "node:test";

import {
  browserSessions,
  DrizzleBrowserSessionStore,
  DrizzleWalletAccountResolver,
  DrizzleWalletChallengeStore,
  users,
  wallets,
  walletAuthChallenges
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
      onConflictDoNothing() {
        return builder;
      },
      where() {
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
    delete: (table) => mutation("delete", table),
    select(projection) {
      const call = { kind: "select", projection };
      calls.push(call);
      const builder = {
        from(table) {
          call.table = table;
          return builder;
        },
        where() {
          return builder;
        },
        for() {
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

const address = `0x${"1".repeat(40)}`;
const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);
const challengeId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000202";
const walletId = "00000000-0000-4000-8000-000000000203";
const sessionId = "00000000-0000-4000-8000-000000000204";

test("challenge consume is a one-row compare-and-set", async () => {
  const database = createFakeDatabase({ returns: [[{ id: challengeId }], []] });
  const store = new DrizzleWalletChallengeStore(database);
  const consumedAt = new Date("2026-07-17T08:01:00.000Z");
  assert.equal(await store.consume(challengeId, digest, consumedAt), true);
  assert.equal(await store.consume(challengeId, digest, consumedAt), false);
  const updates = database.calls.filter(
    (call) => call.kind === "update" && call.table === walletAuthChallenges
  );
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].set, { consumedAt });
});

test("challenge creation rejects malformed and cross-origin bindings before persistence", async () => {
  const database = createFakeDatabase();
  const store = new DrizzleWalletChallengeStore(database);
  const challenge = {
    id: challengeId,
    address,
    chainId: 10_143,
    domain: "example.test",
    uri: "not a URI",
    nonceDigest: digest,
    issuedAt: new Date("2026-07-17T08:00:00.000Z"),
    expiresAt: new Date("2026-07-17T08:05:00.000Z")
  };
  await assert.rejects(store.create(challenge), /valid application origin/);
  await assert.rejects(
    store.create({ ...challenge, uri: "https://attacker.example" }),
    /same safe application origin/
  );
  assert.equal(database.calls.length, 0);
});

test("active session lookup atomically advances idle time and rejects no-row CAS", async () => {
  const accessedAt = new Date("2026-07-17T08:30:00.000Z");
  const absoluteExpiresAt = new Date("2026-07-17T09:00:00.000Z");
  const idleExpiresAt = absoluteExpiresAt;
  const session = {
    id: sessionId,
    userId,
    walletId,
    tokenDigest: digest,
    csrfDigest: otherDigest,
    createdAt: new Date("2026-07-17T08:00:00.000Z"),
    absoluteExpiresAt,
    idleExpiresAt
  };
  const wallet = { id: walletId, userId, addressNormalized: address, chainId: 10_143 };
  const database = createFakeDatabase({ selects: [[wallet]], returns: [[session]] });
  const active = await new DrizzleBrowserSessionStore(database).findActiveByTokenDigest(
    digest,
    accessedAt
  );
  assert.equal(active?.id, sessionId);
  assert.equal(active?.address, address);
  const update = database.calls.find(
    (call) => call.kind === "update" && call.table === browserSessions
  );
  assert.equal(typeof update.set.lastSeenAt, "object");
  assert.equal(typeof update.set.idleExpiresAt, "object");

  const expiredDatabase = createFakeDatabase({ returns: [[]] });
  assert.equal(
    await new DrizzleBrowserSessionStore(expiredDatabase).findActiveByTokenDigest(
      digest,
      accessedAt
    ),
    null
  );
  assert.equal(expiredDatabase.calls.filter((call) => call.kind === "select").length, 0);
});

test("session creation rejects a wallet owned by another user", async () => {
  const database = createFakeDatabase({ selects: [[]] });
  const store = new DrizzleBrowserSessionStore(database);
  await assert.rejects(
    store.create({
      id: sessionId,
      userId,
      address,
      chainId: 10_143,
      tokenDigest: digest,
      csrfDigest: otherDigest,
      createdAt: new Date("2026-07-17T08:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-07-17T20:00:00.000Z"),
      idleExpiresAt: new Date("2026-07-17T09:00:00.000Z")
    }),
    /does not belong/
  );
  assert.equal(
    database.calls.some((call) => call.table === browserSessions),
    false
  );
});

test("wallet claim race returns the established owner and deletes only the unused candidate", async () => {
  const winnerUserId = "00000000-0000-4000-8000-000000000299";
  const winner = {
    id: walletId,
    userId: winnerUserId,
    addressNormalized: address,
    chainId: 10_143
  };
  const database = createFakeDatabase({ selects: [[], [winner]], returns: [[]] });
  const account = await new DrizzleWalletAccountResolver(database).findOrCreateVerifiedWallet(
    address,
    10_143
  );
  assert.equal(account.userId, winnerUserId);
  assert.equal(database.calls.filter((call) => call.table === wallets).length, 3);
  assert.equal(
    database.calls.some((call) => call.kind === "delete" && call.table === users),
    true
  );
  assert.equal(
    database.calls.some((call) => call.kind === "update"),
    false
  );
});

test("session revoke is an idempotent compare-and-set", async () => {
  const database = createFakeDatabase({ returns: [[{ id: sessionId }], []] });
  const store = new DrizzleBrowserSessionStore(database);
  const revokedAt = new Date("2026-07-17T08:30:00.000Z");
  assert.equal(await store.revoke(digest, revokedAt), true);
  assert.equal(await store.revoke(digest, revokedAt), false);
});
