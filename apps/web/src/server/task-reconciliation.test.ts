import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics } from "viem";

import {
  reconcileTaskCreation,
  type ChainReceipt,
  type ReconciliationContext,
  type TaskReconciliationStore
} from "./task-reconciliation.ts";

const TX = `0x${"11".repeat(32)}` as const;
const BLOCK = `0x${"22".repeat(32)}` as const;
const TASK_HASH = `0x${"33".repeat(32)}` as const;
const POLICY_HASH = `0x${"44".repeat(32)}` as const;
const CREATOR = "0x1111111111111111111111111111111111111111";
const ASSIGNEE = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-07-17T14:00:00.000Z");

const context: ReconciliationContext = {
  transactionPublicId: "01arz3ndektsv4rrffq69g5fay",
  transactionHash: TX,
  status: "submitted",
  chainId: 10_143,
  contractAddress: CONTRACT,
  taskPublicId: "01arz3ndektsv4rrffq69g5fax",
  taskHash: TASK_HASH,
  policyHash: POLICY_HASH,
  creatorWallet: CREATOR,
  assigneeWallet: ASSIGNEE,
  rewardWei: "1234",
  deadlineUnixSeconds: "1784556000"
};

const eventAbi = {
  type: "event",
  name: "TaskCreated",
  anonymous: false,
  inputs: [
    { name: "taskId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "assignee", type: "address", indexed: true },
    { name: "taskHash", type: "bytes32", indexed: false },
    { name: "policyHash", type: "bytes32", indexed: false },
    { name: "reward", type: "uint256", indexed: false },
    { name: "deadline", type: "uint64", indexed: false }
  ]
} as const;

function receipt(overrides: Partial<ChainReceipt> = {}): ChainReceipt {
  return {
    status: "success",
    transactionHash: TX,
    blockHash: BLOCK,
    blockNumber: 99n,
    logs: [
      {
        address: CONTRACT,
        logIndex: 4,
        topics: encodeEventTopics({
          abi: [eventAbi],
          eventName: "TaskCreated",
          args: { taskId: 7n, creator: CREATOR, assignee: ASSIGNEE }
        }).filter((topic): topic is `0x${string}` => typeof topic === "string"),
        data: encodeAbiParameters(
          [
            { name: "taskHash", type: "bytes32" },
            { name: "policyHash", type: "bytes32" },
            { name: "reward", type: "uint256" },
            { name: "deadline", type: "uint64" }
          ],
          [TASK_HASH, POLICY_HASH, 1234n, 1_784_556_000n]
        )
      }
    ],
    ...overrides
  };
}

function store() {
  const calls = { unknown: [] as unknown[], reverted: [] as unknown[], confirmed: [] as unknown[] };
  const implementation: TaskReconciliationStore = {
    async getReconciliationContext() {
      return context;
    },
    async markTransactionUnknown(input) {
      calls.unknown.push(input);
    },
    async markTransactionReverted(input) {
      calls.reverted.push(input);
    },
    async confirmTaskCreated(input) {
      calls.confirmed.push(input);
    }
  };
  return { implementation, calls };
}

test("reconciliation confirms only an exactly bound TaskCreated event", async () => {
  const state = store();
  const result = await reconcileTaskCreation(
    state.implementation,
    {
      async getReceipt() {
        return receipt();
      }
    },
    context.transactionPublicId,
    "user",
    NOW
  );
  assert.deepEqual(result, { status: "confirmed", chainTaskId: "7", blockNumber: "99" });
  assert.equal(state.calls.confirmed.length, 1);
  const confirmation = state.calls.confirmed[0] as {
    decodedEvent: Record<string, string>;
    logIndex: number;
  };
  assert.equal(confirmation.logIndex, 4);
  assert.equal(confirmation.decodedEvent.reward, "1234");
});

test("pending and unavailable RPC remain recoverable unknown states", async () => {
  for (const provider of [
    {
      async getReceipt() {
        return null;
      }
    },
    {
      async getReceipt(): Promise<ChainReceipt> {
        throw new Error("offline");
      }
    }
  ]) {
    const state = store();
    const result = await reconcileTaskCreation(
      state.implementation,
      provider,
      context.transactionPublicId,
      "user",
      NOW
    );
    assert.equal(result?.status, "unknown_reconcile");
    assert.equal(state.calls.unknown.length, 1);
    assert.equal(state.calls.confirmed.length, 0);
  }
});

test("reverted receipts never open the task", async () => {
  const state = store();
  const result = await reconcileTaskCreation(
    state.implementation,
    {
      async getReceipt() {
        return receipt({ status: "reverted", logs: [] });
      }
    },
    context.transactionPublicId,
    "user",
    NOW
  );
  assert.deepEqual(result, { status: "reverted", blockNumber: "99" });
  assert.equal(state.calls.reverted.length, 1);
  assert.equal(state.calls.confirmed.length, 0);
});

test("mismatched, missing, and duplicate events fail closed", async () => {
  for (const candidate of [
    receipt({ logs: [] }),
    receipt({
      logs: [
        {
          ...receipt().logs[0]!,
          data: encodeAbiParameters(
            [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
            [TASK_HASH, POLICY_HASH, 999n, 1_784_556_000n]
          )
        }
      ]
    }),
    receipt({ logs: [receipt().logs[0]!, { ...receipt().logs[0]!, logIndex: 5 }] })
  ]) {
    const state = store();
    const result = await reconcileTaskCreation(
      state.implementation,
      {
        async getReceipt() {
          return candidate;
        }
      },
      context.transactionPublicId,
      "user",
      NOW
    );
    assert.equal(result?.status, "unknown_reconcile");
    assert.equal(state.calls.unknown.length, 1);
    assert.equal(state.calls.confirmed.length, 0);
  }
});

test("unknown transaction IDs remain indistinguishable from unauthorized access", async () => {
  const state = store();
  state.implementation.getReconciliationContext = async () => null;
  const result = await reconcileTaskCreation(
    state.implementation,
    {
      async getReceipt() {
        throw new Error("must not call");
      }
    },
    context.transactionPublicId,
    "user",
    NOW
  );
  assert.equal(result, null);
  assert.equal(state.calls.unknown.length, 0);
});
