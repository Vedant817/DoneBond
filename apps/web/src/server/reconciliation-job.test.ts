import assert from "node:assert/strict";
import test from "node:test";

import type { PendingReconciliationTransaction } from "@donebond/db";

import { runPendingReconciliation } from "./reconciliation-job.ts";

const TASK: PendingReconciliationTransaction = {
  transactionPublicId: "01J00000000000000000000001",
  actorUserId: "00000000-0000-4000-8000-000000000001",
  intentType: "create_task"
};
const RECEIPT: PendingReconciliationTransaction = {
  transactionPublicId: "01J00000000000000000000002",
  actorUserId: "00000000-0000-4000-8000-000000000002",
  intentType: "submit_receipt"
};

test("scheduled reconciliation routes work by intent and counts terminal outcomes", async () => {
  const called: string[] = [];
  const result = await runPendingReconciliation({
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    listPending: async (limit) => {
      assert.equal(limit, 50);
      return [TASK, RECEIPT];
    },
    reconcileTask: async (item) => {
      called.push(item.transactionPublicId);
      return "confirmed";
    },
    reconcileReceipt: async (item) => {
      called.push(item.transactionPublicId);
      return "reverted";
    }
  });
  assert.deepEqual(called, [TASK.transactionPublicId, RECEIPT.transactionPublicId]);
  assert.deepEqual(result, { scanned: 2, confirmed: 1, reverted: 1, pending: 0, failed: 0 });
});

test("one failed transaction does not stop later pending work", async () => {
  const result = await runPendingReconciliation({
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    listPending: async () => [TASK, RECEIPT],
    reconcileTask: async () => {
      throw new Error("concurrent update");
    },
    reconcileReceipt: async () => "unknown_reconcile"
  });
  assert.deepEqual(result, { scanned: 2, confirmed: 0, reverted: 0, pending: 1, failed: 1 });
});

test("scheduled reconciliation rejects unbounded batch sizes", async () => {
  await assert.rejects(
    runPendingReconciliation(
      {
        now: () => new Date(),
        listPending: async () => [],
        reconcileTask: async () => null,
        reconcileReceipt: async () => null
      },
      101
    ),
    /between 1 and 100/u
  );
});
