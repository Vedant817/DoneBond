import assert from "node:assert/strict";
import test from "node:test";

import { authRateLimits, DrizzleAuthRateLimiter } from "../dist/index.js";

function fakeDatabase({ returns = [], deleted = [] } = {}) {
  const calls = [];
  return {
    calls,
    insert(table) {
      const call = { kind: "insert", table };
      calls.push(call);
      const builder = {
        values(values) {
          call.values = values;
          return builder;
        },
        onConflictDoUpdate(config) {
          call.conflict = config;
          return builder;
        },
        returning() {
          return Promise.resolve(returns.shift() ?? []);
        }
      };
      return builder;
    },
    execute(query) {
      calls.push({ kind: "execute", query });
      return Promise.resolve(deleted);
    }
  };
}

function referencedColumnNames(value) {
  const columns = new Set();
  const visited = new Set();
  const inspect = (candidate) => {
    if (candidate === null || typeof candidate !== "object" || visited.has(candidate)) return;
    visited.add(candidate);
    if (typeof candidate.name === "string" && candidate.table === authRateLimits) {
      columns.add(candidate.name);
    }
    for (const child of Object.values(candidate)) inspect(child);
  };
  inspect(value);
  return columns;
}

const digest = "a".repeat(64);
const at = new Date("2026-07-17T08:00:00.000Z");

test("fixed-window consume uses one conditional upsert and fails closed on no row", async () => {
  const database = fakeDatabase({ returns: [[{ requestCount: 1 }], []] });
  const limiter = new DrizzleAuthRateLimiter(database, {
    scope: "wallet_challenge_ip",
    maxAttempts: 3,
    windowMs: 60_000
  });

  assert.equal(await limiter.consume(digest, at), true);
  assert.equal(await limiter.consume(digest, at), false);
  const inserts = database.calls.filter((call) => call.kind === "insert");
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].conflict.target, [authRateLimits.scope, authRateLimits.keyDigest]);
  const predicateColumns = referencedColumnNames(inserts[0].conflict.setWhere);
  assert(predicateColumns.has("window_expires_at"));
  assert(predicateColumns.has("request_count"));
  const incrementColumns = referencedColumnNames(inserts[0].conflict.set.requestCount);
  assert(incrementColumns.has("window_expires_at"));
  assert(incrementColumns.has("request_count"));
  assert.equal(inserts[0].values.requestCount, 1);
  assert.equal(inserts[0].values.windowExpiresAt.toISOString(), "2026-07-17T08:01:00.000Z");
});

test("limiter rejects unhashed keys and unsafe configuration before querying", async () => {
  const database = fakeDatabase();
  assert.throws(
    () =>
      new DrizzleAuthRateLimiter(database, {
        scope: "Wallet Challenge",
        maxAttempts: 3,
        windowMs: 60_000
      }),
    /stable lowercase identifier/
  );
  const limiter = new DrizzleAuthRateLimiter(database, {
    scope: "wallet_challenge_ip",
    maxAttempts: 3,
    windowMs: 60_000
  });
  await assert.rejects(limiter.consume("raw-client-ip", at), /64 lowercase hex/);
  assert.equal(database.calls.length, 0);
});

test("expired-row cleanup is bounded and reports deleted rows", async () => {
  const database = fakeDatabase({
    deleted: [{ keyDigest: digest }, { keyDigest: "b".repeat(64) }]
  });
  const limiter = new DrizzleAuthRateLimiter(database, {
    scope: "wallet_challenge_ip",
    maxAttempts: 3,
    windowMs: 60_000
  });
  assert.equal(await limiter.deleteExpired(at, 2), 2);
  assert.equal(database.calls.filter((call) => call.kind === "execute").length, 1);
  await assert.rejects(limiter.deleteExpired(at, 1_001), /between 1 and 1000/);
});
