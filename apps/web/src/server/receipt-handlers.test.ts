import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";
import { decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createReceiptHandlers,
  type ReceiptHandlerDependencies,
  type ReceiptRecord
} from "./receipt-handlers.ts";
import { signReceiptAttestation } from "./receipt-attestation.ts";
import type { ChainTransactionRecord, TaskRecord } from "./task-handlers.ts";

const ORIGIN = "https://donebond.test";
const USER = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const PROJECT = "01arz3ndektsv4rrffq69g5fav";
const TASK = "01arz3ndektsv4rrffq69g5fax";
const TRANSACTION = "01arz3ndektsv4rrffq69g5fay";
const EVIDENCE = "01arz3ndektsv4rrffq69g5faz";
const CREATOR = "0x1111111111111111111111111111111111111111";
const ASSIGNEE = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const TASK_HASH = `0x${"aa".repeat(32)}`;
const POLICY_HASH = `0x${"bb".repeat(32)}`;
const EVIDENCE_HASH = `0x${"cc".repeat(32)}`;
const COMMIT_HASH = `0x${"dd".repeat(32)}`;
const SECRET = Buffer.alloc(32, 9).toString("base64url");
const NOW = new Date("2026-07-17T14:00:00.000Z");
const FUTURE_EXPIRY = String(Math.floor(NOW.getTime() / 1000) + 3600);

// A well-known, publicly documented local test private key (Hardhat/Anvil default
// account #0). It never controls real funds and is safe to hardcode in a test file.
const TEST_VERIFIER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const VERIFIER = privateKeyToAccount(TEST_VERIFIER_PRIVATE_KEY).address.toLowerCase();
const REAL_ATTESTATION = await signReceiptAttestation(TEST_VERIFIER_PRIVATE_KEY, {
  chainId: 10_143,
  contractAddress: CONTRACT,
  taskId: "42",
  taskHash: TASK_HASH,
  policyHash: POLICY_HASH,
  assignee: ASSIGNEE,
  evidenceHash: EVIDENCE_HASH,
  commitHash: COMMIT_HASH,
  attestationExpiry: FUTURE_EXPIRY
});
const SIGNATURE = REAL_ATTESTATION.signature;
const DIGEST = REAL_ATTESTATION.typedDataDigest;

function request(method: string, path: string, body?: unknown, key = "receipt-handler-key-01") {
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

function baseTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    publicId: TASK,
    projectPublicId: PROJECT,
    chainId: 10_143,
    contractAddress: CONTRACT,
    chainTaskId: 42n,
    title: "Fix rate limit",
    description: "Add the missing rate limit check.",
    repositoryUrl: "https://github.com/vedant817/donebond",
    targetBranch: "main",
    baseCommit: "ab".repeat(20),
    acceptanceCriteria: [{ key: "tests", description: "All deterministic checks pass" }],
    taskHash: TASK_HASH,
    policyHash: POLICY_HASH,
    creatorWallet: CREATOR,
    assigneeWallet: ASSIGNEE,
    rewardWei: "0",
    deadline: null,
    offchainStatus: "open",
    chainStatus: "open",
    createdAt: NOW,
    updatedAt: NOW,
    canonicalTask: {
      kind: "donebond.task",
      schemaVersion: 1,
      projectPublicId: PROJECT,
      repositoryIdentity: "github.com/vedant817/donebond",
      targetBranch: "main",
      baseCommit: "ab".repeat(20),
      title: "Fix rate limit",
      description: "Add the missing rate limit check.",
      acceptanceCriteria: [{ key: "tests", description: "All deterministic checks pass" }],
      assigneeWallet: ASSIGNEE,
      deadlineUnixSeconds: null,
      rewardWei: "0",
      policyHash: POLICY_HASH
    },
    ...overrides
  };
}

function baseTransaction(overrides: Partial<ChainTransactionRecord> = {}): ChainTransactionRecord {
  return {
    publicId: TRANSACTION,
    taskPublicId: TASK,
    intentType: "submit_receipt",
    idempotencyKey: "receipt-handler-key-01",
    chainId: 10_143,
    fromAddress: ASSIGNEE,
    toAddress: CONTRACT,
    transactionHash: null,
    nonce: null,
    status: "wallet_requested",
    blockNumber: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function baseReceiptRecord(): ReceiptRecord {
  return {
    taskPublicId: TASK,
    projectPublicId: PROJECT,
    chainId: 10_143,
    contractAddress: CONTRACT,
    chainTaskId: "42",
    title: "Fix rate limit",
    taskHash: TASK_HASH,
    policyHash: POLICY_HASH,
    creatorWallet: CREATOR,
    assigneeWallet: ASSIGNEE,
    rewardWei: "0",
    deadline: null,
    offchainStatus: "receipt_submitted",
    chainStatus: "receipt_submitted",
    evidencePublicId: EVIDENCE,
    evidenceHash: EVIDENCE_HASH,
    commitHashDerived: COMMIT_HASH,
    gitObjectId: "a".repeat(40),
    checks: [
      {
        checkKey: "tests",
        label: "Tests",
        required: true,
        status: "passed",
        startedAt: NOW,
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdoutDigest: `0x${"11".repeat(32)}`,
        stderrDigest: `0x${"22".repeat(32)}`,
        stdoutPreview: "secret-looking-but-irrelevant-output",
        stderrPreview: ""
      }
    ],
    verifierAddress: VERIFIER,
    signature: SIGNATURE,
    typedDataDigest: DIGEST,
    attestationExpiryUnixSeconds: FUTURE_EXPIRY,
    submissionTransactionHash: `0x${"33".repeat(32)}`,
    submittedAt: NOW
  };
}

function fixture(options: { session?: { address: string }; passingEvidence?: boolean } = {}) {
  const calls: { intents: unknown[]; outcomes: unknown[]; rates: unknown[][] } = {
    intents: [],
    outcomes: [],
    rates: []
  };
  const taskRef = { value: baseTask() };
  const evidenceRef = {
    value:
      options.passingEvidence === false
        ? null
        : {
            publicId: EVIDENCE,
            evidenceHash: EVIDENCE_HASH,
            commitHashDerived: COMMIT_HASH,
            gitObjectId: "a".repeat(40)
          }
  };
  const publicReceiptRef: { value: ReceiptRecord | null } = { value: null };
  const memberReceiptRef: { value: ReceiptRecord | null } = { value: null };
  const intentReplayRef = { value: false };
  const session = {
    sessionId: "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e002",
    userId: USER,
    address: (options.session?.address ?? ASSIGNEE) as `0x${string}`,
    chainId: 10_143,
    absoluteExpiresAt: new Date("2026-07-18T00:00:00.000Z")
  };
  const transaction = baseTransaction();

  const dependencies: ReceiptHandlerDependencies = {
    applicationOrigin: ORIGIN,
    resourceSecret: SECRET,
    chain: {
      chainId: 10_143,
      contractAddress: CONTRACT,
      explorerUrl: "https://testnet.monadscan.com"
    },
    auth: {
      async authenticate() {
        return session;
      },
      async requireCsrf() {
        return session;
      }
    },
    receiptProvider: {
      async getReceipt() {
        throw new Error("receipt provider should not be called for this fixture");
      }
    },
    signAttestation: async () => ({
      signature: SIGNATURE as `0x${string}`,
      typedDataDigest: DIGEST as `0x${string}`,
      verifierAddress: VERIFIER
    }),
    verifierAddress: VERIFIER,
    attestationTtlSeconds: 3600,
    rateLimiter: {
      async consume(...args) {
        calls.rates.push(args);
        return true;
      }
    },
    store: {
      async getTask() {
        return taskRef.value;
      },
      async getLatestPassingEvidence() {
        return evidenceRef.value;
      },
      async createReceiptChainIntent(input) {
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
      async getReceiptReconciliationContext() {
        return null;
      },
      async markTransactionUnknown() {},
      async markTransactionReverted() {},
      async confirmReceiptSubmitted() {},
      async getPublicReceipt() {
        return publicReceiptRef.value;
      },
      async getReceiptForMember() {
        return memberReceiptRef.value;
      }
    },
    now: () => NOW
  };
  return {
    handlers: createReceiptHandlers(dependencies),
    calls,
    taskRef,
    evidenceRef,
    publicReceiptRef,
    memberReceiptRef,
    intentReplayRef
  };
}

test("the assignee wallet creates a receipt intent with exact submitReceipt calldata", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
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
    { chainId: 10_143, from: ASSIGNEE, to: CONTRACT, value: "0" }
  );
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "submitReceipt",
        stateMutability: "nonpayable",
        inputs: [
          { name: "taskId", type: "uint256" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "commitHash", type: "bytes32" },
          { name: "attestationExpiry", type: "uint64" },
          { name: "verifierSignature", type: "bytes" }
        ],
        outputs: []
      }
    ] as const,
    data: payload.walletRequest.data
  });
  assert.deepEqual(decoded.args, [
    42n,
    EVIDENCE_HASH,
    COMMIT_HASH,
    BigInt(FUTURE_EXPIRY),
    SIGNATURE
  ]);
});

test("only the task assignee may submit a receipt; the creator and other wallets are rejected", async () => {
  const asCreator = fixture({ session: { address: CREATOR } });
  const rejected = await asCreator.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, ERROR_CODES.AUTH_FORBIDDEN);
  assert.equal(asCreator.calls.intents.length, 0);

  const asStranger = fixture({
    session: { address: "0x9999999999999999999999999999999999999999" }
  });
  const strangerRejected = await asStranger.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(strangerRejected.status, 403);
  assert.equal(asStranger.calls.intents.length, 0);
});

test("a non-member wallet is indistinguishable from an unknown task", async () => {
  const state = fixture();
  state.taskRef.value = null as unknown as TaskRecord;
  const response = await state.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, ERROR_CODES.TASK_NOT_FOUND);
  assert.equal(state.calls.intents.length, 0);
});

test("a task without a passing evidence bundle cannot receive a receipt intent", async () => {
  const state = fixture({ passingEvidence: false });
  const response = await state.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, ERROR_CODES.EVIDENCE_NOT_PASSING);
  assert.equal(state.calls.intents.length, 0);
});

test("a task that is not chain-confirmed open cannot receive a receipt intent", async () => {
  const state = fixture();
  state.taskRef.value = baseTask({
    chainStatus: "receipt_submitted",
    offchainStatus: "receipt_submitted"
  });
  const response = await state.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, ERROR_CODES.INVALID_STATE);
  assert.equal(state.calls.intents.length, 0);
});

test("exact receipt intent replay does not issue a second wallet prompt", async () => {
  const state = fixture();
  state.intentReplayRef.value = true;
  const response = await state.handlers.createReceiptIntent(
    request("POST", `/api/v1/tasks/${TASK}/receipt-intent`, {}),
    TASK
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).walletRequest, null);
});

test("reconciliation hides unknown receipt transactions", async () => {
  const { handlers } = fixture();
  const response = await handlers.reconcileReceipt(
    request("POST", `/api/v1/chain/reconcile-receipt/${TRANSACTION}`, {}),
    TRANSACTION
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND);
});

const EXPECTED_RECEIPT_FIELDS = [
  "schemaVersion",
  "taskPublicId",
  "projectPublicId",
  "title",
  "taskHash",
  "policyHash",
  "creatorWallet",
  "assigneeWallet",
  "rewardWei",
  "offchainStatus",
  "chainStatus",
  "evidenceHash",
  "commitHash",
  "gitObjectId",
  "evidenceBundlePublicId",
  "checks",
  "chainId",
  "contractAddress",
  "chainTaskId",
  "submissionTransactionHash",
  "explorerTransactionUrl",
  "verifierAttestation",
  "integrityStatus",
  "submittedAt"
].sort();

const EXPECTED_CHECK_FIELDS = [
  "key",
  "label",
  "required",
  "status",
  "durationMs",
  "exitCode",
  "signal",
  "stdoutDigest",
  "stderrDigest"
].sort();

const EXPECTED_ATTESTATION_FIELDS = [
  "verifierAddress",
  "signature",
  "typedDataDigest",
  "attestationExpiryUnixSeconds"
].sort();

test("the public receipt read 404s for a receipt-less task and returns only the exact allowlisted fields once confirmed", async () => {
  const missing = fixture();
  const notFound = await missing.handlers.getPublicReceipt(
    request("GET", `/api/v1/receipt/${TASK}`),
    TASK
  );
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).error.code, ERROR_CODES.RECEIPT_NOT_FOUND);

  const state = fixture();
  state.publicReceiptRef.value = baseReceiptRecord();
  const response = await state.handlers.getPublicReceipt(
    request("GET", `/api/v1/receipt/${TASK}`),
    TASK
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=60, stale-while-revalidate=30"
  );
  const payload = await response.json();
  const receipt = payload.receipt as Record<string, unknown>;
  assert.deepEqual(Object.keys(receipt).sort(), EXPECTED_RECEIPT_FIELDS);
  const check = (receipt.checks as Record<string, unknown>[])[0]!;
  assert.deepEqual(Object.keys(check).sort(), EXPECTED_CHECK_FIELDS);
  assert.equal(JSON.stringify(check).includes("secret-looking-but-irrelevant-output"), false);
  assert.equal(JSON.stringify(receipt).includes("secret-looking-but-irrelevant-output"), false);
  const attestation = receipt.verifierAttestation as Record<string, unknown>;
  assert.deepEqual(Object.keys(attestation).sort(), EXPECTED_ATTESTATION_FIELDS);
  assert.equal(receipt.integrityStatus, "verified");
});

test("member receipt read requires authentication and returns the same allowlisted shape", async () => {
  const state = fixture();
  state.memberReceiptRef.value = baseReceiptRecord();
  const response = await state.handlers.getMemberReceipt(
    request("GET", `/api/v1/tasks/${TASK}/receipt`),
    TASK
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.receipt).sort(), EXPECTED_RECEIPT_FIELDS);
});

test("integrity status reflects a verifier mismatch instead of silently claiming verified", async () => {
  const state = fixture();
  state.publicReceiptRef.value = {
    ...baseReceiptRecord(),
    verifierAddress: "0x8888888888888888888888888888888888888888"
  };
  const response = await state.handlers.getPublicReceipt(
    request("GET", `/api/v1/receipt/${TASK}`),
    TASK
  );
  const payload = await response.json();
  assert.equal(payload.receipt.integrityStatus, "mismatch");
});
