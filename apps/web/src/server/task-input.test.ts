import assert from "node:assert/strict";
import test from "node:test";

import { parseCreateTaskInput } from "./task-input.ts";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const ADDRESS = `0x${"12".repeat(20)}`;

function valid() {
  return {
    title: " Ship it ",
    description: "Implement the exact slice",
    targetBranch: "main",
    baseCommit: "ab".repeat(20),
    acceptanceCriteria: [{ key: "tests", description: "All checks pass" }],
    assigneeWallet: ADDRESS,
    deadline: "2026-07-18T12:00:00.000Z",
    rewardWei: "1000000000000000000",
    chainId: 10_143
  };
}

test("task input normalizes contract-bound fields", () => {
  const result = parseCreateTaskInput(valid(), NOW);
  assert.equal(result.title, "Ship it");
  assert.equal(result.baseCommit, "ab".repeat(20));
  assert.equal(result.assigneeWallet, ADDRESS);
  assert.equal(result.deadlineUnixSeconds, "1784376000");
});

test("task input permits an explicit no-deadline task", () => {
  const result = parseCreateTaskInput({ ...valid(), deadline: null, baseCommit: null }, NOW);
  assert.equal(result.deadline, null);
  assert.equal(result.deadlineUnixSeconds, null);
});

test("task input fails closed on unsafe or unrepresentable fields", () => {
  for (const changed of [
    { unexpected: true },
    { targetBranch: "-main" },
    { baseCommit: "../HEAD" },
    { assigneeWallet: `0x${"0".repeat(40)}` },
    { deadline: "2026-07-17T11:59:59.000Z" },
    { deadline: "2026-07-18T12:00:00.001Z" },
    { rewardWei: (1n << 96n).toString() },
    { rewardWei: "01" },
    { chainId: 1 },
    {
      acceptanceCriteria: [
        { key: "same", description: "One" },
        { key: "same", description: "Two" }
      ]
    }
  ]) {
    assert.throws(() => parseCreateTaskInput({ ...valid(), ...changed }, NOW));
  }
});
