import assert from "node:assert/strict";
import test from "node:test";

import { canonicalKeccak256 } from "@donebond/evidence";
import { ERROR_CODES } from "@donebond/shared";
import { decodeFunctionData } from "viem";

import {
  createTaskHandlers,
  type ChainTransactionRecord,
  type TaskHandlerDependencies,
  type TaskCreationContext,
  type TaskRecord
} from "./task-handlers.ts";

const ORIGIN = "https://donebond.test";
const USER = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const PROJECT = "01arz3ndektsv4rrffq69g5fav";
const POLICY = "01arz3ndektsv4rrffq69g5faw";
const TASK = "01arz3ndektsv4rrffq69g5fax";
const TRANSACTION = "01arz3ndektsv4rrffq69g5fay";
const CREATOR = "0x1111111111111111111111111111111111111111";
const ASSIGNEE = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const POLICY_HASH = `0x${"44".repeat(32)}`;
const TX_HASH = `0x${"55".repeat(32)}`;
const SECRET = Buffer.alloc(32, 9).toString("base64url");
const NOW = new Date("2026-07-17T14:00:00.000Z");

function request(method: string, path: string, body?: unknown, key = "task-handler-test-key-01") {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie: "donebond_session=opaque",
      "x-csrf-token": "valid",
      "idempotency-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function body() {
  return {
    title: "Implement receipt API",
    description: "Bind real evidence to the exact commit.",
    targetBranch: "main",
    baseCommit: "ab".repeat(20),
    acceptanceCriteria: [{ key: "tests", description: "All deterministic checks pass" }],
    assigneeWallet: ASSIGNEE,
    deadline: "2026-07-20T14:00:00.000Z",
    rewardWei: "1234",
    chainId: 10_143
  };
}

function fixture(role: "owner" | "member" = "owner") {
  const calls: {
    creates: unknown[];
    intents: unknown[];
    outcomes: unknown[];
    replacements: unknown[];
    reconciliations: unknown[];
    rates: unknown[][];
  } = {
    creates: [],
    intents: [],
    outcomes: [],
    replacements: [],
    reconciliations: [],
    rates: []
  };
  const task: TaskRecord = {
    publicId: TASK,
    projectPublicId: PROJECT,
    chainId: 10_143,
    contractAddress: CONTRACT,
    chainTaskId: null,
    title: body().title,
    description: body().description,
    repositoryUrl: "https://github.com/vedant817/donebond",
    targetBranch: "main",
    baseCommit: "ab".repeat(20),
    acceptanceCriteria: body().acceptanceCriteria,
    taskHash: canonicalKeccak256({ fixture: "task" }),
    policyHash: POLICY_HASH,
    creatorWallet: CREATOR,
    assigneeWallet: ASSIGNEE,
    rewardWei: "1234",
    deadline: "2026-07-20T14:00:00.000Z",
    offchainStatus: "draft",
    chainStatus: "none",
    createdAt: NOW,
    updatedAt: NOW,
    canonicalTask: {
      kind: "donebond.task",
      schemaVersion: 1,
      projectPublicId: PROJECT,
      repositoryIdentity: "github.com/vedant817/donebond",
      targetBranch: "main",
      baseCommit: "ab".repeat(20),
      title: body().title,
      description: body().description,
      acceptanceCriteria: body().acceptanceCriteria,
      assigneeWallet: ASSIGNEE,
      deadlineUnixSeconds: "1784556000",
      rewardWei: "1234",
      policyHash: POLICY_HASH
    }
  };
  const transaction: ChainTransactionRecord = {
    publicId: TRANSACTION,
    taskPublicId: TASK,
    intentType: "create_task",
    idempotencyKey: "task-handler-test-key-01",
    chainId: 10_143,
    fromAddress: CREATOR,
    toAddress: CONTRACT,
    transactionHash: null,
    nonce: null,
    status: "wallet_requested",
    blockNumber: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW
  };
  const taskRef: { value: TaskRecord } = { value: task };
  const intentReplayRef = { value: false };
  const session = {
    sessionId: "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e002",
    userId: USER,
    address: CREATOR as `0x${string}`,
    chainId: 10_143,
    absoluteExpiresAt: new Date("2026-07-18T00:00:00.000Z")
  };
  const contextRef: { value: TaskCreationContext } = {
    value: {
      projectPublicId: PROJECT,
      repositoryUrl: "https://github.com/vedant817/donebond",
      status: "active",
      activePolicyPublicId: POLICY,
      activePolicyHash: POLICY_HASH
    }
  };
  let persistedTask: TaskRecord | null = null;
  const dependencies: TaskHandlerDependencies = {
    applicationOrigin: ORIGIN,
    resourceSecret: SECRET,
    chain: { chainId: 10_143, contractAddress: CONTRACT },
    auth: {
      async authenticate() {
        return session;
      },
      async requireCsrf() {
        return session;
      }
    },
    accessStore: {
      async findProjectAccess() {
        return { projectPublicId: PROJECT, role };
      }
    },
    rateLimiter: {
      async consume(...args) {
        calls.rates.push(args);
        return true;
      }
    },
    store: {
      async getCreationContext() {
        return contextRef.value;
      },
      async createTask(input) {
        calls.creates.push(input);
        persistedTask ??= {
          ...task,
          publicId: input.publicId,
          taskHash: input.taskHash,
          policyHash: input.canonicalTask.policyHash,
          canonicalTask: input.canonicalTask
        };
        return persistedTask;
      },
      async listTasks() {
        return { items: [taskRef.value], nextCursor: null };
      },
      async getTask() {
        return taskRef.value;
      },
      async createChainIntent(input) {
        calls.intents.push(input);
        return { task: taskRef.value, transaction, replayed: intentReplayRef.value };
      },
      async recordWalletOutcome(input) {
        calls.outcomes.push(input);
        return {
          ...transaction,
          status: input.status,
          transactionHash: input.transactionHash,
          nonce: input.nonce,
          failureCode: input.failureCode
        };
      },
      async recordReplacement(input) {
        calls.replacements.push(input);
        return {
          ...transaction,
          publicId: input.publicId,
          status: "submitted",
          transactionHash: input.transactionHash,
          nonce: input.nonce
        };
      },
      async getReconciliationContext() {
        return null;
      },
      async markTransactionUnknown(input) {
        calls.reconciliations.push(input);
      },
      async markTransactionReverted(input) {
        calls.reconciliations.push(input);
      },
      async confirmTaskCreated(input) {
        calls.reconciliations.push(input);
      }
    },
    receiptProvider: {
      async getReceipt() {
        throw new Error("receipt provider should not be called for an unknown fixture transaction");
      }
    },
    now: () => NOW
  };
  return {
    handlers: createTaskHandlers(dependencies),
    calls,
    task,
    taskRef,
    contextRef,
    intentReplayRef
  };
}

test("owner creates a canonical policy-bound task without trusting client commitments", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, body()),
    PROJECT
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.canonicalTask.repositoryIdentity, "github.com/vedant817/donebond");
  assert.equal(payload.canonicalTask.policyHash, POLICY_HASH);
  assert.equal(payload.task.taskHash, canonicalKeccak256(payload.canonicalTask));
  const create = calls.creates[0] as Record<string, unknown>;
  assert.equal(create.creatorWallet, CREATOR);
  assert.equal(create.contractAddress, CONTRACT);
  assert.match(String(create.publicId), /^[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.deepEqual(
    (calls.rates as unknown[][]).map((call) => call[1]),
    [null, `${USER}:${PROJECT}`]
  );
});

test("task creation rejects members and unsupported connected networks before persistence", async () => {
  const member = fixture("member");
  const forbidden = await member.handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, body()),
    PROJECT
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, ERROR_CODES.AUTH_FORBIDDEN);
  assert.equal(member.calls.creates.length, 0);

  const owner = fixture();
  const unsupported = await owner.handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, { ...body(), chainId: 143 }),
    PROJECT
  );
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).error.code, ERROR_CODES.CHAIN_UNSUPPORTED);
  assert.equal(owner.calls.creates.length, 0);
});

test("task creation rejects a cross-project context before persistence", async () => {
  const state = fixture();
  state.contextRef.value = {
    ...state.contextRef.value,
    projectPublicId: "01arz3ndektsv4rrffq69g5faz"
  };
  const response = await state.handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, body()),
    PROJECT
  );
  assert.equal(response.status, 500);
  assert.equal(state.calls.creates.length, 0);
});

test("task creation request identity survives policy and project-state changes", async () => {
  const state = fixture();
  const first = await state.handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, body()),
    PROJECT
  );
  const original = await first.json();
  state.contextRef.value = {
    ...state.contextRef.value,
    status: "archived",
    activePolicyPublicId: "01arz3ndektsv4rrffq69g5faz",
    activePolicyHash: `0x${"66".repeat(32)}`
  };
  const retry = await state.handlers.createTask(
    request("POST", `/api/v1/projects/${PROJECT}/tasks`, body()),
    PROJECT
  );
  const replay = await retry.json();
  assert.equal(retry.status, 201);
  assert.equal(replay.canonicalTask.policyHash, original.canonicalTask.policyHash);
  const [firstWrite, retryWrite] = state.calls.creates as Record<string, unknown>[];
  assert.equal(firstWrite?.requestHash, retryWrite?.requestHash);
});

test("chain intent returns exact createTask calldata and persists before wallet use", async () => {
  const { handlers, calls, task } = fixture();
  const response = await handlers.createChainIntent(
    request("POST", `/api/v1/tasks/${TASK}/chain-intent`, {}),
    TASK
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(calls.intents.length, 1);
  assert.deepEqual(
    {
      chainId: payload.walletRequest.chainId,
      from: payload.walletRequest.from,
      to: payload.walletRequest.to,
      value: payload.walletRequest.value
    },
    { chainId: 10_143, from: CREATOR, to: CONTRACT, value: "1234" }
  );
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "createTask",
        stateMutability: "payable",
        inputs: [
          { name: "taskHash", type: "bytes32" },
          { name: "policyHash", type: "bytes32" },
          { name: "assignee", type: "address" },
          { name: "deadline", type: "uint64" }
        ],
        outputs: [{ name: "taskId", type: "uint256" }]
      }
    ] as const,
    data: payload.walletRequest.data
  });
  assert.deepEqual(decoded.args, [task.taskHash, POLICY_HASH, ASSIGNEE, 1_784_556_000n]);
});

test("ineligible intent attempts do not mutate persistence", async () => {
  const state = fixture();
  state.taskRef.value = {
    ...state.taskRef.value,
    creatorWallet: "0x4444444444444444444444444444444444444444"
  };
  const response = await state.handlers.createChainIntent(
    request("POST", `/api/v1/tasks/${TASK}/chain-intent`, {}),
    TASK
  );
  assert.equal(response.status, 409);
  assert.equal(state.calls.intents.length, 0);
});

test("exact intent replay does not issue a second wallet prompt", async () => {
  const state = fixture();
  state.intentReplayRef.value = true;
  const response = await state.handlers.createChainIntent(
    request("POST", `/api/v1/tasks/${TASK}/chain-intent`, {}),
    TASK
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).walletRequest, null);
});

test("wallet outcome accepts bounded submission data and rejects browser-confirmed states", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.recordChainTransaction(
    request(
      "POST",
      `/api/v1/tasks/${TASK}/chain-transactions`,
      {
        transactionId: TRANSACTION,
        status: "submitted",
        transactionHash: TX_HASH.toUpperCase().replace("0X", "0x"),
        nonce: "7"
      },
      "task-outcome-test-key-01"
    ),
    TASK
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).transaction.transactionHash, TX_HASH);
  assert.equal(calls.outcomes.length, 1);

  const confirmed = await handlers.recordChainTransaction(
    request(
      "POST",
      `/api/v1/tasks/${TASK}/chain-transactions`,
      { transactionId: TRANSACTION, status: "confirmed" },
      "task-outcome-test-key-02"
    ),
    TASK
  );
  assert.equal(confirmed.status, 400);
  assert.equal(calls.outcomes.length, 1);
});

test("replacement submission creates a separate transaction identity", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.recordChainTransaction(
    request(
      "POST",
      `/api/v1/tasks/${TASK}/chain-transactions`,
      {
        transactionId: TRANSACTION,
        status: "replacement_submitted",
        transactionHash: TX_HASH,
        nonce: "7"
      },
      "task-replacement-key-01"
    ),
    TASK
  );
  assert.equal(response.status, 201);
  assert.equal(calls.replacements.length, 1);
  assert.equal(calls.outcomes.length, 0);
  const replacement = calls.replacements[0] as Record<string, unknown>;
  assert.equal(replacement.replacedTransactionPublicId, TRANSACTION);
  assert.notEqual(replacement.publicId, TRANSACTION);
});

test("member task reads expose canonical public fields and reject malformed pagination", async () => {
  const { handlers } = fixture("member");
  const list = await handlers.listTasks(
    request("GET", `/api/v1/projects/${PROJECT}/tasks?limit=25`),
    PROJECT
  );
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items[0].publicId, TASK);
  const malformed = await handlers.listTasks(
    request("GET", `/api/v1/projects/${PROJECT}/tasks?limit=0`),
    PROJECT
  );
  assert.equal(malformed.status, 400);
});

test("reconciliation is authenticated, mutation-protected, and hides unknown transactions", async () => {
  const { handlers } = fixture();
  const response = await handlers.reconcileTransaction(
    request("POST", `/api/v1/chain/reconcile/${TRANSACTION}`, {}),
    TRANSACTION
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND);
});
