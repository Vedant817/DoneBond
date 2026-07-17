import assert from "node:assert/strict";
import test from "node:test";

import { TransactionReceiptNotFoundError } from "viem";

import { MonadTaskReceiptProvider } from "./task-receipt-provider.ts";

const TX = `0x${"11".repeat(32)}` as const;
const BLOCK = `0x${"22".repeat(32)}` as const;
const ADDRESS = `0x${"33".repeat(20)}` as const;

test("Monad receipt provider preserves authoritative receipt and log fields", async () => {
  const provider = new MonadTaskReceiptProvider(10_143, "https://rpc.example", {
    async getTransactionReceipt() {
      return {
        status: "success",
        transactionHash: TX,
        blockHash: BLOCK,
        blockNumber: 9n,
        logs: [{ address: ADDRESS, logIndex: 2, data: "0x", topics: [TX] }]
      };
    }
  });
  const receipt = await provider.getReceipt(10_143, TX);
  assert.equal(receipt?.blockNumber, 9n);
  assert.equal(receipt?.logs[0]?.logIndex, 2);
});

test("only receipt-not-found is represented as pending", async () => {
  const pending = new MonadTaskReceiptProvider(10_143, "https://rpc.example", {
    async getTransactionReceipt() {
      throw new TransactionReceiptNotFoundError({ hash: TX });
    }
  });
  assert.equal(await pending.getReceipt(10_143, TX), null);

  const offline = new MonadTaskReceiptProvider(10_143, "https://rpc.example", {
    async getTransactionReceipt() {
      throw new Error("offline");
    }
  });
  await assert.rejects(offline.getReceipt(10_143, TX), /offline/u);
  await assert.rejects(pending.getReceipt(143, TX), /does not match/u);
});

test("incomplete confirmed logs fail closed", async () => {
  const provider = new MonadTaskReceiptProvider(10_143, "https://rpc.example", {
    async getTransactionReceipt() {
      return {
        status: "success",
        transactionHash: TX,
        blockHash: BLOCK,
        blockNumber: 9n,
        logs: [{ address: ADDRESS, logIndex: null, data: "0x", topics: [TX] }]
      };
    }
  });
  await assert.rejects(provider.getReceipt(10_143, TX), /incomplete/u);
});
