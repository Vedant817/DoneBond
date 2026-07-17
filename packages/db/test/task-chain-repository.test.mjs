import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseServiceError, DrizzleTaskRepository } from "../dist/index.js";

const VALID_PUBLIC_ID = "01arz3ndektsv4rrffq69g5fav";
const VALID_UUID = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const HASH = `0x${"ab".repeat(32)}`;
const NOW = new Date("2026-07-17T14:00:00.000Z");
const IDEMPOTENCY_KEY = "task-key-0123456789abcdef";

function emptyDatabase() {
  const fail = () => {
    throw new Error("database should not be touched for a validation failure");
  };
  const builder = new Proxy(
    {},
    {
      get: () =>
        new Proxy(function () {}, {
          get: () => builder,
          apply: fail
        })
    }
  );
  return {
    transaction: fail,
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder
  };
}

function repository() {
  return new DrizzleTaskRepository(emptyDatabase());
}

function assertInvalidInput(promise, messageContains) {
  return promise.then(
    () => {
      throw new Error("Expected a DatabaseServiceError");
    },
    (error) => {
      assert.ok(error instanceof DatabaseServiceError, "Expected a DatabaseServiceError");
      assert.equal(error.code, "DB_INVALID_INPUT");
      if (messageContains !== undefined) {
        assert.match(
          error.message,
          new RegExp(messageContains, "u"),
          `Expected message to match /${messageContains}/u, got ${error.message}`
        );
      }
    }
  );
}

test("DrizzleTaskRepository rejects malformed public IDs before touching the database", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.getCreationContext("not-a-public-id", VALID_UUID),
    "Project public ID is invalid"
  );
  await assertInvalidInput(
    repo.getCreationContext(VALID_PUBLIC_ID, "not-a-uuid"),
    "Actor user ID is invalid"
  );
  await assertInvalidInput(
    repo.getTask("not-a-public-id", VALID_UUID),
    "Task public ID is invalid"
  );
  await assertInvalidInput(repo.getTask(VALID_PUBLIC_ID, "not-a-uuid"), "Actor user ID is invalid");
  await assertInvalidInput(
    repo.listTasks("not-a-public-id", VALID_UUID, { limit: 25 }),
    "Project public ID is invalid"
  );
  await assertInvalidInput(
    repo.listTasks(VALID_PUBLIC_ID, "not-a-uuid", { limit: 25 }),
    "Actor user ID is invalid"
  );
});

test("DrizzleTaskRepository rejects pagination outside 1..100 and malformed cursors", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.listTasks(VALID_PUBLIC_ID, VALID_UUID, { limit: 0 }),
    "Pagination limit"
  );
  await assertInvalidInput(
    repo.listTasks(VALID_PUBLIC_ID, VALID_UUID, { limit: 101 }),
    "Pagination limit"
  );
  await assertInvalidInput(
    repo.listTasks(VALID_PUBLIC_ID, VALID_UUID, {
      limit: 25,
      cursor: { createdAt: "not-a-date", publicId: VALID_PUBLIC_ID }
    }),
    "Pagination cursor creation time"
  );
  await assertInvalidInput(
    repo.listTasks(VALID_PUBLIC_ID, VALID_UUID, {
      limit: 25,
      cursor: { createdAt: NOW, publicId: "not-a-public-id" }
    }),
    "Pagination cursor public ID"
  );
});

test("DrizzleTaskRepository rejects chain intent proposals with malformed identities or dates", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: "not-a-uuid",
      taskPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Actor user ID is invalid"
  );
  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: VALID_UUID,
      taskPublicId: "not-a-public-id",
      publicId: VALID_PUBLIC_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Task public ID is invalid"
  );
  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: VALID_UUID,
      taskPublicId: VALID_PUBLIC_ID,
      publicId: "not-a-public-id",
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Transaction public ID is invalid"
  );
  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: VALID_UUID,
      taskPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: new Date("invalid")
    }),
    "Chain intent creation time"
  );
  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: VALID_UUID,
      taskPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      idempotencyKey: "short",
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Idempotency scope, operation, key, or request hash is invalid"
  );
  await assertInvalidInput(
    repo.createChainIntent({
      actorUserId: VALID_UUID,
      taskPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: "not-a-hash",
      requestedAt: NOW
    }),
    "Idempotency scope, operation, key, or request hash is invalid"
  );
});

test("DrizzleTaskRepository rejects wallet outcomes with malformed identities or unsafe nonces", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.recordWalletOutcome({
      taskPublicId: "not-a-public-id",
      transactionPublicId: VALID_PUBLIC_ID,
      actorUserId: VALID_UUID,
      status: "submitted",
      transactionHash: HASH,
      nonce: 7n,
      failureCode: null,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Task public ID is invalid"
  );
  await assertInvalidInput(
    repo.recordWalletOutcome({
      taskPublicId: VALID_PUBLIC_ID,
      transactionPublicId: VALID_PUBLIC_ID,
      actorUserId: VALID_UUID,
      status: "submitted",
      transactionHash: HASH,
      nonce: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
      failureCode: null,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Transaction nonce exceeds the safe public boundary"
  );
});

test("DrizzleTaskRepository rejects replacement proposals with malformed hashes, nonces, or identities", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: "not-a-uuid",
      priorTransactionPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      transactionHash: HASH,
      nonce: 7n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Actor user ID is invalid"
  );
  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: VALID_UUID,
      priorTransactionPublicId: "not-a-public-id",
      publicId: VALID_PUBLIC_ID,
      transactionHash: HASH,
      nonce: 7n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Prior transaction public ID is invalid"
  );
  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: VALID_UUID,
      priorTransactionPublicId: VALID_PUBLIC_ID,
      publicId: "not-a-public-id",
      transactionHash: HASH,
      nonce: 7n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Replacement transaction public ID is invalid"
  );
  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: VALID_UUID,
      priorTransactionPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      transactionHash: "not-a-hash",
      nonce: 7n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Replacement transaction hash must be a lowercase nonzero bytes32"
  );
  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: VALID_UUID,
      priorTransactionPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      transactionHash: HASH,
      nonce: -1n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Replacement nonce is outside the safe boundary"
  );
  await assertInvalidInput(
    repo.recordReplacement({
      actorUserId: VALID_UUID,
      priorTransactionPublicId: VALID_PUBLIC_ID,
      publicId: VALID_PUBLIC_ID,
      transactionHash: HASH,
      nonce: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: HASH,
      requestedAt: NOW
    }),
    "Replacement nonce is outside the safe boundary"
  );
});

test("DrizzleTaskRepository rejects reconciliation proposals with malformed identities, statuses, or transitions", async () => {
  const repo = repository();

  await assertInvalidInput(
    repo.reconcileTransaction({
      transactionPublicId: "not-a-public-id",
      reconciledAt: NOW,
      status: "unknown_reconcile",
      expectedStatus: "wallet_requested",
      failureCode: "RPC_UNAVAILABLE"
    }),
    "Transaction public ID is invalid"
  );
  await assertInvalidInput(
    repo.reconcileTransaction({
      transactionPublicId: VALID_PUBLIC_ID,
      reconciledAt: new Date("invalid"),
      status: "unknown_reconcile",
      expectedStatus: "wallet_requested",
      failureCode: "RPC_UNAVAILABLE"
    }),
    "Reconciliation time"
  );
  await assertInvalidInput(
    repo.reconcileTransaction({
      transactionPublicId: VALID_PUBLIC_ID,
      reconciledAt: NOW,
      status: "unknown_reconcile",
      expectedStatus: "wallet_requested",
      failureCode: "lowercase_invalid"
    }),
    "Reconciliation failure code is invalid"
  );
  await assertInvalidInput(
    repo.reconcileTransaction({
      transactionPublicId: VALID_PUBLIC_ID,
      reconciledAt: NOW,
      status: "unknown_reconcile",
      expectedStatus: "confirmed",
      failureCode: "RPC_UNAVAILABLE"
    }),
    "Reconciliation status transition is invalid"
  );
  await assertInvalidInput(
    repo.reconcileTransaction({
      transactionPublicId: VALID_PUBLIC_ID,
      reconciledAt: NOW,
      status: "reverted",
      expectedStatus: "rejected_by_user",
      failureCode: "RPC_TIMEOUT"
    }),
    "Reconciliation status transition is invalid"
  );
});
