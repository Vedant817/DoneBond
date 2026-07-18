import assert from "node:assert/strict";
import test from "node:test";

import {
  apiIdempotencyKeys,
  auditEvents,
  chainTransactions,
  contractEvents,
  evidenceBundles,
  projectMembers,
  projects,
  verificationChecks
} from "../dist/schema.js";
import { DatabaseServiceError, DoneBondRepository } from "../dist/index.js";

function createFakeDatabase({ selects = [], returns = [] } = {}) {
  const calls = [];
  let transactions = 0;
  const mutation = (kind, table) => {
    const call = { kind, table };
    calls.push(call);
    const builder = {
      values(value) {
        call.values = value;
        return builder;
      },
      set(value) {
        call.set = value;
        return builder;
      },
      onConflictDoNothing() {
        return builder;
      },
      where() {
        return builder;
      },
      returning() {
        return Promise.resolve(returns.shift() ?? []);
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      }
    };
    return builder;
  };
  const transaction = {
    insert: (table) => mutation("insert", table),
    update: (table) => mutation("update", table),
    select(projection) {
      const call = { kind: "select", projection };
      calls.push(call);
      const builder = {
        from(table) {
          call.table = table;
          return builder;
        },
        innerJoin() {
          return builder;
        },
        where() {
          return builder;
        },
        for() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return Promise.resolve(selects.shift() ?? []);
        },
        then(resolve, reject) {
          return Promise.resolve(selects.shift() ?? []).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  return {
    calls,
    get transactions() {
      return transactions;
    },
    async transaction(callback) {
      transactions += 1;
      return callback(transaction);
    },
    select: transaction.select
  };
}

const ids = {
  task: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  policy: "00000000-0000-4000-8000-000000000003",
  testOnlyTokenId: "00000000-0000-4000-8000-000000000004"
};
const hash = `0x${"a".repeat(64)}`;
const publicId = "01arz3ndektsv4rrffq69g5fav";

function evidenceInput(overrides = {}) {
  return {
    actorScope: overrides.actorScope ?? `cli-token:${ids.testOnlyTokenId}`,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    bundle: {
      id: "00000000-0000-4000-8000-000000000005",
      taskId: ids.task,
      projectId: ids.project,
      policyId: ids.policy,
      publicId,
      passing: true,
      submittedByTokenId: ids.testOnlyTokenId,
      idempotencyKey: "idempotency-key-0001",
      requestHash: hash,
      ...overrides.bundle
    },
    checks: overrides.checks ?? [
      {
        checkKey: "Test.Unit",
        label: "Unit tests",
        required: true,
        status: "passed",
        exitCode: 0
      }
    ],
    audit: overrides.audit ?? {
      projectId: ids.project,
      taskId: ids.task,
      action: "evidence.uploaded",
      metadataSafeJson: {}
    }
  };
}

function consistentBindings() {
  return [
    [{ id: ids.task, projectId: ids.project, policyId: ids.policy, policyHash: hash }],
    [
      {
        id: ids.policy,
        projectId: ids.project,
        policyHash: hash,
        canonicalJson: {
          checks: [{ key: "Test.Unit", label: "Unit tests", required: true }]
        }
      }
    ],
    [{ id: ids.testOnlyTokenId, projectId: ids.project, revokedAt: null }]
  ];
}

test("project creation binds idempotency, owner membership, resource, and audit atomically", async () => {
  const ownerUserId = "00000000-0000-4000-8000-000000000010";
  const project = { id: ids.project, publicId, ownerUserId };
  const database = createFakeDatabase({
    returns: [[{ resourcePublicId: publicId }], [project]]
  });
  const repository = new DoneBondRepository(database);
  assert.equal(
    await repository.createProject(
      { publicId, ownerUserId },
      { actorUserId: ownerUserId, action: "project.created", metadataSafeJson: {} },
      {
        actorScope: `user:${ownerUserId}`,
        operation: "project_create",
        idempotencyKey: "idempotency-key-project",
        requestHash: hash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      }
    ),
    project
  );
  assert.deepEqual(
    database.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [apiIdempotencyKeys, projects, projectMembers, auditEvents]
  );
  const auditInsert = database.calls.find(
    (call) => call.kind === "insert" && call.table === auditEvents
  );
  assert.equal(auditInsert.values.projectId, ids.project);
});

test("project replay returns its bound resource without another audit", async () => {
  const ownerUserId = "00000000-0000-4000-8000-000000000010";
  const project = { id: ids.project, publicId, ownerUserId };
  const database = createFakeDatabase({
    selects: [[{ requestHash: hash, resourcePublicId: publicId }], [project]],
    returns: [[]]
  });
  const repository = new DoneBondRepository(database);
  assert.equal(
    await repository.createProject(
      { publicId, ownerUserId },
      { actorUserId: ownerUserId, action: "project.created", metadataSafeJson: {} },
      {
        actorScope: `user:${ownerUserId}`,
        operation: "project_create",
        idempotencyKey: "idempotency-key-project",
        requestHash: hash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      }
    ),
    project
  );
  assert.equal(
    database.calls.some((call) => call.table === auditEvents),
    false
  );
});

test("idempotency actor scope cannot be poisoned", async () => {
  const ownerUserId = "00000000-0000-4000-8000-000000000010";
  const projectDatabase = createFakeDatabase();
  await assert.rejects(
    new DoneBondRepository(projectDatabase).createProject(
      { publicId, ownerUserId },
      { actorUserId: ownerUserId, action: "project.created", metadataSafeJson: {} },
      {
        actorScope: "user:00000000-0000-4000-8000-000000000099",
        operation: "project_create",
        idempotencyKey: "idempotency-key-project",
        requestHash: hash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      }
    ),
    /actor scope/
  );
  assert.equal(projectDatabase.transactions, 0);

  const evidenceDatabase = createFakeDatabase();
  await assert.rejects(
    new DoneBondRepository(evidenceDatabase).persistEvidence(
      evidenceInput({ actorScope: "cli-token:test-only-wrong-scope" })
    ),
    /actor scope/
  );
  assert.equal(evidenceDatabase.transactions, 0);
});

test("evidence rejects omitted, relabeled, extra, and required-flag policy drift", async () => {
  const adversarialChecks = [
    [],
    [{ checkKey: "Test.Unit", label: "Relabeled", required: true, status: "passed", exitCode: 0 }],
    [
      { checkKey: "Test.Unit", label: "Unit tests", required: true, status: "passed", exitCode: 0 },
      { checkKey: "Extra", label: "Extra", required: false, status: "skipped", exitCode: null }
    ],
    [{ checkKey: "Test.Unit", label: "Unit tests", required: false, status: "passed", exitCode: 0 }]
  ];
  for (const checks of adversarialChecks) {
    const database = createFakeDatabase({ selects: consistentBindings() });
    await assert.rejects(
      new DoneBondRepository(database).persistEvidence(evidenceInput({ checks })),
      /canonical policy/
    );
    assert.equal(database.calls.filter((call) => call.kind === "insert").length, 0);
  }
});

test("evidence derives passing only after exact policy matching", async () => {
  const database = createFakeDatabase({ selects: consistentBindings() });
  await assert.rejects(
    new DoneBondRepository(database).persistEvidence(evidenceInput({ bundle: { passing: false } })),
    /not derived correctly/
  );
  assert.equal(database.calls.filter((call) => call.kind === "insert").length, 0);
});

test("evidence rejects cross-project token/policy binding before persistence", async () => {
  const selects = consistentBindings();
  selects[2] = [
    {
      id: ids.testOnlyTokenId,
      projectId: "00000000-0000-4000-8000-000000000099",
      revokedAt: null
    }
  ];
  const database = createFakeDatabase({ selects });
  const repository = new DoneBondRepository(database);
  await assert.rejects(repository.persistEvidence(evidenceInput()), /binding is invalid/);
  assert.equal(database.calls.filter((call) => call.kind === "insert").length, 0);
});

test("evidence persists idempotency, bundle, checks, and audit in one transaction", async () => {
  const bundle = evidenceInput().bundle;
  const database = createFakeDatabase({
    selects: consistentBindings(),
    returns: [[{ resourcePublicId: publicId }], [bundle]]
  });
  const repository = new DoneBondRepository(database);
  assert.equal(await repository.persistEvidence(evidenceInput()), bundle);
  assert.equal(database.transactions, 1);
  assert.deepEqual(
    database.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [apiIdempotencyKeys, evidenceBundles, verificationChecks, auditEvents]
  );
});

test("evidence retry returns only the matching persisted request", async () => {
  const bundle = evidenceInput().bundle;
  const database = createFakeDatabase({
    selects: [
      ...consistentBindings(),
      [{ requestHash: hash, resourcePublicId: publicId }],
      [bundle]
    ],
    returns: [[]]
  });
  const repository = new DoneBondRepository(database);
  assert.equal(await repository.persistEvidence(evidenceInput()), bundle);
  assert.equal(
    database.calls.some((call) => call.table === verificationChecks),
    false
  );

  const conflictDatabase = createFakeDatabase({
    selects: [
      ...consistentBindings(),
      [{ requestHash: `0x${"b".repeat(64)}`, resourcePublicId: publicId }]
    ],
    returns: [[]]
  });
  await assert.rejects(
    new DoneBondRepository(conflictDatabase).persistEvidence(evidenceInput()),
    (error) => error instanceof DatabaseServiceError && error.code === "DB_IDEMPOTENCY_CONFLICT"
  );
});

test("findTaskBinding resolves task, project, and policy identity or null", async () => {
  const binding = {
    id: ids.task,
    projectId: ids.project,
    projectPublicId: publicId,
    policyId: ids.policy,
    taskHash: hash,
    policyHash: hash
  };
  const found = createFakeDatabase({ selects: [[binding]] });
  assert.deepEqual(await new DoneBondRepository(found).findTaskBinding(publicId), binding);

  const missing = createFakeDatabase({ selects: [[]] });
  assert.equal(await new DoneBondRepository(missing).findTaskBinding(publicId), null);
});

test("listEvidence returns nothing for an unknown task and paginates known evidence", async () => {
  const missing = createFakeDatabase({ selects: [[]] });
  assert.deepEqual(await new DoneBondRepository(missing).listEvidence(publicId, { limit: 25 }), {
    items: [],
    nextCursor: null
  });

  const row = (suffix) => ({
    publicId: `${publicId.slice(0, -1)}${suffix}`,
    taskPublicId: publicId,
    projectPublicId: publicId,
    evidenceHash: hash,
    commitHashDerived: hash,
    gitObjectId: "a".repeat(40),
    passing: true,
    bundleSizeBytes: 10,
    schemaVersion: 1,
    createdAt: new Date("2026-07-17T00:00:00.000Z")
  });
  const underLimit = createFakeDatabase({
    selects: [[{ id: ids.task }], [row("a")]]
  });
  const underLimitResult = await new DoneBondRepository(underLimit).listEvidence(publicId, {
    limit: 25
  });
  assert.equal(underLimitResult.items.length, 1);
  assert.equal(underLimitResult.nextCursor, null);

  const overLimit = createFakeDatabase({
    selects: [[{ id: ids.task }], [row("a"), row("b")]]
  });
  const overLimitResult = await new DoneBondRepository(overLimit).listEvidence(publicId, {
    limit: 1
  });
  assert.equal(overLimitResult.items.length, 1);
  assert.deepEqual(overLimitResult.nextCursor, {
    createdAt: row("b").createdAt,
    publicId: row("b").publicId
  });
});

test("getEvidence returns null for an unknown ID and a full detail record otherwise", async () => {
  const missing = createFakeDatabase({ selects: [[]] });
  assert.equal(await new DoneBondRepository(missing).getEvidence(publicId), null);

  const bundleRow = {
    id: "00000000-0000-4000-8000-000000000005",
    publicId,
    taskPublicId: publicId,
    projectPublicId: publicId,
    evidenceHash: hash,
    commitHashDerived: hash,
    gitObjectId: "a".repeat(40),
    passing: true,
    bundleSizeBytes: 10,
    schemaVersion: 1,
    createdAt: new Date("2026-07-17T00:00:00.000Z")
  };
  const checkRow = {
    checkKey: "Test.Unit",
    label: "Unit tests",
    required: true,
    status: "passed",
    startedAt: new Date("2026-07-17T00:00:00.000Z"),
    durationMs: 5,
    exitCode: 0,
    signal: null,
    stdoutDigest: hash,
    stderrDigest: hash,
    stdoutPreview: "",
    stderrPreview: ""
  };
  const found = createFakeDatabase({ selects: [[bundleRow], [checkRow]] });
  const detail = await new DoneBondRepository(found).getEvidence(publicId);
  assert.deepEqual(detail, { ...bundleRow, checks: [checkRow] });
});

test("contract event exact replay is a no-op while removed transition is audited", async () => {
  const event = {
    id: 1n,
    chainId: 10_143,
    contractAddress: `0x${"1".repeat(40)}`,
    transactionHash: hash,
    logIndex: 0,
    eventName: "ReceiptSubmitted",
    decodedJson: { taskId: "1" },
    blockNumber: 10n,
    blockHash: `0x${"c".repeat(64)}`,
    removed: false
  };
  const audit = {
    projectId: ids.project,
    taskId: ids.task,
    action: "chain.event_reconciled",
    metadataSafeJson: {}
  };
  const task = {
    id: ids.task,
    chainId: event.chainId,
    contractAddress: event.contractAddress
  };
  const replayDatabase = createFakeDatabase({ selects: [[task], [event]], returns: [[]] });
  assert.equal(
    await new DoneBondRepository(replayDatabase).appendContractEvent(event, audit),
    event
  );
  assert.equal(
    replayDatabase.calls.some((call) => call.table === auditEvents),
    false
  );

  const removed = { ...event, removed: true };
  const transitionDatabase = createFakeDatabase({
    selects: [[task], [event]],
    returns: [[], [removed]]
  });
  assert.equal(
    await new DoneBondRepository(transitionDatabase).appendContractEvent(removed, audit),
    removed
  );
  assert.deepEqual(
    transitionDatabase.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [contractEvents, auditEvents]
  );
  assert.equal(
    transitionDatabase.calls.some((call) => call.kind === "update"),
    true
  );
});

test("invalid chain state transition fails before querying", async () => {
  const database = createFakeDatabase();
  await assert.rejects(
    new DoneBondRepository(database).updateChainTransactionState(
      publicId,
      "confirmed",
      { status: "submitted" },
      { projectId: ids.project, action: "chain.transition", metadataSafeJson: {} }
    ),
    /transition is invalid/
  );
  assert.equal(database.transactions, 0);
});

test("chain registration cannot bypass replacement validation", async () => {
  const database = createFakeDatabase();
  await assert.rejects(
    new DoneBondRepository(database).registerChainTransaction(
      {
        publicId,
        userId: "00000000-0000-4000-8000-000000000010",
        projectId: ids.project,
        taskId: ids.task,
        intentType: "submit_receipt",
        idempotencyKey: "test-only-chain-registration-key",
        requestHash: hash,
        chainId: 10_143,
        fromAddress: `0x${"1".repeat(40)}`,
        toAddress: `0x${"2".repeat(40)}`,
        status: "replaced",
        replacedByTransactionId: "00000000-0000-4000-8000-000000000021"
      },
      {
        actorUserId: "00000000-0000-4000-8000-000000000010",
        projectId: ids.project,
        taskId: ids.task,
        action: "chain.transaction_registered",
        metadataSafeJson: {}
      }
    ),
    /not an initial state/
  );
  assert.equal(database.transactions, 0);
});

test("chain state transition locks expected state and writes its audit atomically", async () => {
  const existing = {
    id: "00000000-0000-4000-8000-000000000020",
    publicId,
    projectId: ids.project,
    taskId: ids.task,
    status: "submitted"
  };
  const updated = {
    ...existing,
    status: "confirmed",
    transactionHash: hash,
    blockNumber: 20n
  };
  const database = createFakeDatabase({ selects: [[existing]], returns: [[updated]] });
  const result = await new DoneBondRepository(database).updateChainTransactionState(
    publicId,
    "submitted",
    { status: "confirmed", transactionHash: hash, blockNumber: 20n },
    {
      projectId: ids.project,
      taskId: ids.task,
      action: "chain.transaction_confirmed",
      metadataSafeJson: {}
    }
  );
  assert.equal(result, updated);
  assert.deepEqual(
    database.calls
      .filter((call) => ["insert", "update"].includes(call.kind))
      .map((call) => call.table),
    [chainTransactions, auditEvents]
  );
});

test("replacement transition rejects cross-scope or nonce-poisoned transactions", async () => {
  const replacementId = "00000000-0000-4000-8000-000000000021";
  const existing = {
    id: "00000000-0000-4000-8000-000000000020",
    publicId,
    userId: "00000000-0000-4000-8000-000000000010",
    projectId: ids.project,
    taskId: ids.task,
    chainId: 10_143,
    intentType: "submit_receipt",
    fromAddress: `0x${"1".repeat(40)}`,
    toAddress: `0x${"2".repeat(40)}`,
    nonce: 7n,
    transactionHash: `0x${"b".repeat(64)}`,
    status: "submitted"
  };
  const poisonedReplacement = {
    ...existing,
    id: replacementId,
    userId: "00000000-0000-4000-8000-000000000099",
    nonce: 8n,
    transactionHash: `0x${"c".repeat(64)}`
  };
  const database = createFakeDatabase({ selects: [[existing], [poisonedReplacement]] });
  await assert.rejects(
    new DoneBondRepository(database).updateChainTransactionState(
      publicId,
      "submitted",
      { status: "replaced", replacedByTransactionId: replacementId },
      {
        projectId: ids.project,
        taskId: ids.task,
        action: "chain.transaction_replaced",
        metadataSafeJson: {}
      }
    ),
    /scope or nonce is invalid/
  );
  assert.equal(
    database.calls.some((call) => call.kind === "update"),
    false
  );
});

test("valid same-scope same-nonce replacement is audit-coupled", async () => {
  const replacementId = "00000000-0000-4000-8000-000000000021";
  const existing = {
    id: "00000000-0000-4000-8000-000000000020",
    publicId,
    userId: "00000000-0000-4000-8000-000000000010",
    projectId: ids.project,
    taskId: ids.task,
    chainId: 10_143,
    intentType: "submit_receipt",
    fromAddress: `0x${"1".repeat(40)}`,
    toAddress: `0x${"2".repeat(40)}`,
    nonce: 7n,
    transactionHash: `0x${"b".repeat(64)}`,
    status: "submitted"
  };
  const replacement = {
    ...existing,
    id: replacementId,
    transactionHash: `0x${"c".repeat(64)}`
  };
  const updated = { ...existing, status: "replaced", replacedByTransactionId: replacementId };
  const database = createFakeDatabase({
    selects: [[existing], [replacement]],
    returns: [[updated]]
  });
  assert.equal(
    await new DoneBondRepository(database).updateChainTransactionState(
      publicId,
      "submitted",
      { status: "replaced", replacedByTransactionId: replacementId },
      {
        projectId: ids.project,
        taskId: ids.task,
        action: "chain.transaction_replaced",
        metadataSafeJson: {}
      }
    ),
    updated
  );
  assert.equal(
    database.calls.some((call) => call.table === auditEvents),
    true
  );
});

test("project authorization returns explicit owner and member roles", async () => {
  const ownerUserId = "00000000-0000-4000-8000-000000000010";
  const memberUserId = "00000000-0000-4000-8000-000000000011";
  const ownerAuthorization = {
    projectId: ids.project,
    projectPublicId: publicId,
    ownerUserId,
    userId: ownerUserId,
    role: "owner"
  };
  const memberAuthorization = {
    ...ownerAuthorization,
    userId: memberUserId,
    role: "member"
  };
  const database = createFakeDatabase({ selects: [[ownerAuthorization], [memberAuthorization]] });
  const repository = new DoneBondRepository(database);
  assert.deepEqual(await repository.findProjectAccess(publicId, ownerUserId), {
    projectPublicId: publicId,
    role: "owner"
  });
  assert.deepEqual(await repository.findProjectAccess(publicId, memberUserId), {
    projectPublicId: publicId,
    role: "member"
  });
});

test("project authorization makes nonmember, cross-project, and missing reads indistinguishable", async () => {
  const actorUserId = "00000000-0000-4000-8000-000000000012";
  const database = createFakeDatabase({ selects: [[], [], []] });
  const repository = new DoneBondRepository(database);
  assert.equal(await repository.findProjectAccess(publicId, actorUserId), null);
  assert.equal(await repository.findProjectAccess("01arz3ndektsv4rrffq69g5fax", actorUserId), null);
  assert.equal(await repository.findProjectAccess("01arz3ndektsv4rrffq69g5fay", actorUserId), null);
  assert.equal(database.calls.filter((call) => call.kind === "select").length, 3);
});

test("project authorization fails closed on inconsistent owner membership", async () => {
  const actorUserId = "00000000-0000-4000-8000-000000000012";
  const database = createFakeDatabase({
    selects: [
      [
        {
          projectId: ids.project,
          projectPublicId: publicId,
          ownerUserId: "00000000-0000-4000-8000-000000000010",
          userId: actorUserId,
          role: "owner"
        }
      ]
    ]
  });
  await assert.rejects(
    new DoneBondRepository(database).findProjectAccess(publicId, actorUserId),
    (error) => error instanceof DatabaseServiceError && error.code === "DB_CONFLICT"
  );
});
