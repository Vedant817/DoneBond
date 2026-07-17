import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  CanonicalTaskV1Schema,
  ChainTransactionStatusSchema,
  EvidenceBundleSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  PASSING_RECEIPT_TYPEHASH,
  ReceiptSchema,
  TaskSchema,
  computeReceiptAttestationDigest,
  createVerifiedReceiptSchema
} from "../dist/index.js";

const HASH = `0x${"ab".repeat(32)}`;
const ADDRESS = `0x${"12".repeat(20)}`;
const NOW = "2026-07-17T00:00:00.000Z";

test("parses and normalizes a complete task", () => {
  const task = TaskSchema.parse({
    schemaVersion: 1,
    publicId: "task_001",
    projectPublicId: "project_001",
    chainId: 10143,
    chainTaskId: null,
    title: "Implement verification",
    description: "Run deterministic checks and bind the result.",
    repositoryUrl: "https://github.com/Vedant817/donebond",
    targetBranch: "main",
    baseCommit: "A".repeat(40),
    acceptanceCriteria: [{ key: "tests", description: "All required tests pass." }],
    taskHash: HASH.toUpperCase().replace("0X", "0x"),
    policyHash: HASH,
    creatorWallet: ADDRESS.toUpperCase().replace("0X", "0x"),
    assigneeWallet: ADDRESS,
    rewardWei: "0",
    deadline: null,
    offchainStatus: "draft",
    chainStatus: "none",
    createdAt: NOW,
    updatedAt: NOW
  });

  assert.equal(task.publicId, "task_001");
  assert.equal(task.baseCommit, "a".repeat(40));
  assert.equal(task.creatorWallet, ADDRESS);
});

test("freezes the EIP-712 receipt digest and rejects impossible receipts", async () => {
  const contractAddress = ADDRESS;
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const fields = {
    chainId: 10143,
    contractAddress,
    taskId: "1",
    taskHash: `0x${"11".repeat(32)}`,
    policyHash: `0x${"22".repeat(32)}`,
    assignee: `0x${"34".repeat(20)}`,
    evidenceHash: `0x${"44".repeat(32)}`,
    commitHash: `0x${"55".repeat(32)}`,
    attestationExpiry: "1784246400"
  };
  const digest = computeReceiptAttestationDigest(fields);
  assert.equal(
    PASSING_RECEIPT_TYPEHASH,
    "0x59d552f1cf676b302e799cde1beeb4544365adc2c515c19ced9e43da442e29ff"
  );
  assert.equal(digest, "0xc3195344fe8ff265b688cbfc6dadcf403a0de25d776fe9e56d38be4496d56a59");

  const signature = await account.sign({ hash: digest });
  const check = {
    key: "tests",
    label: "Tests",
    required: true,
    status: "passed",
    startedAt: NOW,
    durationMs: 10,
    exitCode: 0,
    stdout: { preview: "", digest: HASH, originalBytes: 0, truncated: false },
    stderr: { preview: "", digest: HASH, originalBytes: 0, truncated: false }
  };
  const receipt = {
    schemaVersion: 1,
    publicId: "receipt_001",
    task: {
      schemaVersion: 1,
      publicId: "task_001",
      projectPublicId: "project_001",
      chainId: fields.chainId,
      chainTaskId: fields.taskId,
      title: "Task",
      description: "Verified task",
      repositoryUrl: "https://github.com/vedant817/donebond",
      targetBranch: "main",
      baseCommit: null,
      acceptanceCriteria: [{ key: "tests", description: "Tests pass." }],
      taskHash: fields.taskHash,
      policyHash: fields.policyHash,
      creatorWallet: ADDRESS,
      assigneeWallet: fields.assignee,
      rewardWei: "0",
      deadline: null,
      offchainStatus: "receipt_submitted",
      chainStatus: "receipt_submitted",
      createdAt: NOW,
      updatedAt: NOW
    },
    evidenceHash: fields.evidenceHash,
    commitHash: fields.commitHash,
    gitObjectId: "a".repeat(40),
    checks: [check],
    verifierAttestation: {
      schemaVersion: 1,
      domainName: "DoneBondRegistry",
      domainVersion: "1",
      primaryType: "PassingReceipt",
      typeHash: PASSING_RECEIPT_TYPEHASH,
      signatureEncoding: "rsv-65-byte-hex",
      verifierAddress: account.address,
      expiryUnixSeconds: fields.attestationExpiry,
      signature,
      typedDataDigest: digest
    },
    contractAddress,
    submissionTransactionHash: HASH,
    approvalTransactionHash: null,
    payoutTransactionHash: null,
    payoutStatus: "unfunded",
    integrityStatus: "verified",
    createdAt: NOW
  };
  assert.equal(ReceiptSchema.safeParse(receipt).success, false);
  const trustedReceiptSchema = createVerifiedReceiptSchema(account.address);
  assert.equal((await trustedReceiptSchema.safeParseAsync(receipt)).success, true);
  assert.equal(
    (
      await trustedReceiptSchema.safeParseAsync({
        ...receipt,
        task: { ...receipt.task, offchainStatus: "draft", chainStatus: "none", chainTaskId: null }
      })
    ).success,
    false
  );
  assert.equal(
    (
      await trustedReceiptSchema.safeParseAsync({
        ...receipt,
        verifierAttestation: { ...receipt.verifierAttestation, signature: `0x${"00".repeat(65)}` }
      })
    ).success,
    false
  );
  const attacker = privateKeyToAccount(`0x${"02".repeat(32)}`);
  const attackerSignature = await attacker.sign({ hash: digest });
  assert.equal(
    (
      await trustedReceiptSchema.safeParseAsync({
        ...receipt,
        verifierAttestation: {
          ...receipt.verifierAttestation,
          verifierAddress: attacker.address,
          signature: attackerSignature
        }
      })
    ).success,
    false
  );
});

test("normalizes commitment text and rejects unsafe task authorities", () => {
  const canonical = CanonicalTaskV1Schema.parse({
    kind: "donebond.task",
    schemaVersion: 1,
    projectPublicId: "project_001",
    repositoryIdentity: "github.com/Vedant817/donebond",
    targetBranch: "main",
    baseCommit: null,
    title: "Cafe\u0301",
    description: "Bind deterministic evidence.",
    acceptanceCriteria: [{ key: "tests", description: "Tests pass." }],
    assigneeWallet: ADDRESS,
    deadlineUnixSeconds: "1784246400",
    rewardWei: "0",
    policyHash: HASH
  });
  assert.equal(canonical.title, "Café");
  assert.equal(canonical.repositoryIdentity, "github.com/vedant817/donebond");
  assert.equal(
    TaskSchema.safeParse({
      schemaVersion: 1,
      publicId: "task_001",
      projectPublicId: "project_001",
      chainId: 1,
      chainTaskId: null,
      title: "Unsafe",
      description: "Unsafe task",
      repositoryUrl: "https://token@example.com/repo",
      targetBranch: "main",
      baseCommit: null,
      acceptanceCriteria: [{ key: "tests", description: "Tests pass." }],
      taskHash: HASH,
      policyHash: HASH,
      creatorWallet: `0x${"0".repeat(40)}`,
      assigneeWallet: ADDRESS,
      rewardWei: "0",
      deadline: null,
      offchainStatus: "draft",
      chainStatus: "none",
      createdAt: NOW,
      updatedAt: NOW
    }).success,
    false
  );
});

test("evidence validation fails closed on contradictory or unsafe results", () => {
  const output = { preview: "", digest: HASH, originalBytes: 0, truncated: false };
  const evidence = {
    schemaVersion: 1,
    task: { publicId: "task_001", taskHash: HASH },
    policy: { policyHash: HASH, sourcePath: ".donebond/policy.json" },
    git: {
      objectId: "a".repeat(40),
      derivedCommitHash: HASH,
      treeId: "b".repeat(40),
      branch: "main",
      remote: "github.com/Vedant817/donebond",
      clean: true,
      changedFiles: []
    },
    checks: [
      {
        key: "tests",
        label: "Tests",
        required: true,
        status: "passed",
        startedAt: NOW,
        durationMs: 10,
        exitCode: 0,
        stdout: output,
        stderr: output
      }
    ],
    result: { passing: true, requiredPassed: 1, requiredTotal: 1, failureCodes: [] },
    tool: { name: "donebond-cli", version: "1.0.0", platform: "darwin", nodeVersion: "22" },
    redactions: {}
  };
  assert.equal(EvidenceBundleSchema.safeParse(evidence).success, true);
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      result: { ...evidence.result, requiredPassed: 0 }
    }).success,
    false
  );
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      git: { ...evidence.git, clean: false },
      result: { ...evidence.result, passing: true }
    }).success,
    false
  );
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      git: { ...evidence.git, remote: "ssh://secret@github.com/o/r.git" }
    }).success,
    false
  );
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      policy: { ...evidence.policy, sourcePath: "../policy.json" }
    }).success,
    false
  );
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      checks: [{ ...evidence.checks[0], exitCode: 7 }]
    }).success,
    false
  );
  assert.equal(
    EvidenceBundleSchema.safeParse({
      ...evidence,
      git: { ...evidence.git, changedFiles: ["dirty.ts"] }
    }).success,
    false
  );
});

test("rejects unknown task fields and invalid reward representations", () => {
  const result = TaskSchema.safeParse({ unexpected: true });
  assert.equal(result.success, false);
  assert.equal(TaskSchema.safeParse({ rewardWei: 1 }).success, false);
});

test("keeps transaction states and error codes stable", () => {
  assert.equal(ChainTransactionStatusSchema.parse("unknown_reconcile"), "unknown_reconcile");
  assert.equal(ErrorCodeSchema.parse(ERROR_CODES.IDEMPOTENCY_CONFLICT), "IDEMPOTENCY_CONFLICT");
  assert.equal(ErrorCodeSchema.safeParse("UNKNOWN_ERROR").success, false);
});

test("requires explicit nullable canonical task fields and rejects generated state", () => {
  const canonical = CanonicalTaskV1Schema.parse({
    kind: "donebond.task",
    schemaVersion: 1,
    projectPublicId: "project_001",
    repositoryIdentity: "github.com/Vedant817/donebond",
    targetBranch: "main",
    baseCommit: null,
    title: "Verification task",
    description: "Bind deterministic evidence.",
    acceptanceCriteria: [{ key: "tests", description: "Tests pass." }],
    assigneeWallet: ADDRESS,
    deadlineUnixSeconds: null,
    rewardWei: "0",
    policyHash: HASH
  });
  assert.equal(canonical.baseCommit, null);
  assert.equal(
    CanonicalTaskV1Schema.safeParse({ ...canonical, offchainStatus: "approved" }).success,
    false
  );
  const { baseCommit: _baseCommit, ...withoutBaseCommit } = canonical;
  assert.equal(CanonicalTaskV1Schema.safeParse(withoutBaseCommit).success, false);
});
