import assert from "node:assert/strict";
import test from "node:test";

import {
  DurableProjectWriteRateLimiter,
  type ProjectWriteLimiterPair
} from "./project-write-rate-limiter.ts";

const SECRET = Buffer.alloc(32, 12).toString("base64url");

test("project write limits use separate operation and global/subject stores", async () => {
  const calls = new Map<string, string[]>();
  function pair(operation: string): ProjectWriteLimiterPair {
    return {
      global: {
        async consume(key) {
          calls.set(`${operation}:global`, [key]);
          return true;
        }
      },
      subject: {
        async consume(key) {
          calls.set(`${operation}:subject`, [key]);
          return true;
        }
      }
    };
  }
  const limiter = new DurableProjectWriteRateLimiter(SECRET, {
    project_create: pair("project_create"),
    project_update: pair("project_update"),
    policy_save: pair("policy_save"),
    policy_activate: pair("policy_activate"),
    task_create: pair("task_create"),
    task_chain_intent: pair("task_chain_intent"),
    task_chain_register: pair("task_chain_register"),
    receipt_chain_intent: pair("receipt_chain_intent"),
    receipt_chain_register: pair("receipt_chain_register")
  });
  const at = new Date("2026-07-17T14:00:00.000Z");
  assert.equal(await limiter.consume("project_create", null, at), true);
  assert.equal(await limiter.consume("project_create", "user-1", at), true);
  assert.equal(await limiter.consume("policy_activate", null, at), true);
  assert.deepEqual(
    [...calls.keys()],
    ["project_create:global", "project_create:subject", "policy_activate:global"]
  );
  const keys = [...calls.values()].flat();
  assert.equal(new Set(keys).size, 3);
  keys.forEach((key) => assert.match(key, /^[0-9a-f]{64}$/u));
});
