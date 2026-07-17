import assert from "node:assert/strict";
import test from "node:test";

import {
  apiIdempotencyKeys,
  auditEvents,
  DatabaseServiceError,
  DrizzleProjectPolicyRepository,
  policies,
  projectMembers,
  projects,
  tasks
} from "../dist/index.js";

function createFakeDatabase({ selects = [], returns = [] } = {}) {
  const calls = [];
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
      where(condition) {
        call.where = condition;
        return builder;
      },
      onConflictDoNothing(config) {
        call.conflict = config;
        return builder;
      },
      returning() {
        if (kind === "update" && table === apiIdempotencyKeys) {
          return Promise.resolve([{ id: "idem" }]);
        }
        return Promise.resolve(returns.shift() ?? []);
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      }
    };
    return builder;
  };
  const executor = {
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
        innerJoin(table, condition) {
          (call.joins ??= []).push({ kind: "inner", table, condition });
          return builder;
        },
        leftJoin(table, condition) {
          (call.joins ??= []).push({ kind: "left", table, condition });
          return builder;
        },
        where(condition) {
          call.where = condition;
          return builder;
        },
        for(lock) {
          call.lock = lock;
          return builder;
        },
        limit(limit) {
          call.limit = limit;
          return Promise.resolve(selects.shift() ?? []);
        },
        orderBy(...order) {
          call.order = order;
          return builder;
        }
      };
      return builder;
    }
  };
  return {
    ...executor,
    calls,
    transaction: async (callback) => callback(executor)
  };
}

const ownerUserId = "00000000-0000-4000-8000-000000000601";
const memberUserId = "00000000-0000-4000-8000-000000000602";
const projectId = "00000000-0000-4000-8000-000000000603";
const policyId = "00000000-0000-4000-8000-000000000604";
const projectPublicId = "01arz3ndektsv4rrffq69g5fav";
const policyPublicId = "01arz3ndektsv4rrffq69g5fab";
const policyHash = `0x${"a".repeat(64)}`;
const createdAt = new Date("2026-07-17T08:00:00.000Z");
const updatedAt = new Date("2026-07-17T08:01:00.000Z");

const projectInput = {
  actorUserId: ownerUserId,
  publicId: projectPublicId,
  slug: "donebond",
  name: "DoneBond",
  repositoryUrl: "https://github.com/Vedant817/donebond.git",
  defaultBranch: "main",
  visibility: "private"
};
const storedProject = {
  id: projectId,
  publicId: projectPublicId,
  ownerUserId,
  slug: projectInput.slug,
  name: projectInput.name,
  repositoryUrl: projectInput.repositoryUrl,
  defaultBranch: projectInput.defaultBranch,
  visibility: "private",
  status: "active",
  activePolicyId: null,
  createdAt,
  updatedAt: createdAt
};
const ownerAuthorization = {
  id: projectId,
  activePolicyId: null,
  ownerUserId,
  userId: ownerUserId,
  role: "owner",
  repositoryUrl: projectInput.repositoryUrl,
  status: "active"
};
const memberAuthorization = {
  ...ownerAuthorization,
  userId: memberUserId,
  role: "member"
};
const canonicalJson = {
  kind: "donebond.policy",
  schemaVersion: 1,
  checks: [{ key: "test", required: true }]
};
const policyInput = {
  actorUserId: ownerUserId,
  projectPublicId,
  policyPublicId,
  schemaVersion: 1,
  canonicalJson,
  policyHash,
  sourcePath: ".donebond/policy.yml"
};
const storedPolicy = {
  id: policyId,
  publicId: policyPublicId,
  projectId,
  schemaVersion: 1,
  canonicalJson,
  policyHash,
  sourcePath: policyInput.sourcePath,
  createdAt
};

function idempotency(operation, key = `${operation}-key`, requestHash = `0x${"b".repeat(64)}`) {
  return {
    actorScope: `user:${ownerUserId}`,
    operation,
    idempotencyKey: key,
    requestHash,
    expiresAt: new Date("2030-01-01T00:00:00.000Z")
  };
}

function projectReplay(overrides = {}) {
  const view = {
    publicId: projectPublicId,
    slug: projectInput.slug,
    name: projectInput.name,
    repositoryUrl: projectInput.repositoryUrl,
    defaultBranch: projectInput.defaultBranch,
    visibility: "private",
    status: "active",
    activePolicyHash: null,
    role: "owner",
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    ...overrides
  };
  return {
    actorScope: `user:${ownerUserId}`,
    operation: "project_create",
    idempotencyKey: "project_create-key",
    requestHash: `0x${"b".repeat(64)}`,
    resourcePublicId: projectPublicId,
    responseStatus: 201,
    responseSafeJson: { kind: "project", ...view }
  };
}

function policyReplay(operation, overrides = {}) {
  return {
    actorScope: `user:${ownerUserId}`,
    operation,
    idempotencyKey: `${operation}-key`,
    requestHash: `0x${"b".repeat(64)}`,
    resourcePublicId: policyPublicId,
    responseStatus: operation === "policy_create" ? 201 : 200,
    responseSafeJson: {
      kind: "policy",
      publicId: policyPublicId,
      projectPublicId,
      schemaVersion: 1,
      policyHash,
      sourcePath: policyInput.sourcePath,
      active: true,
      createdAt: createdAt.toISOString(),
      ...overrides
    }
  };
}

test("project create returns a public DTO and atomically binds owner, idempotency, and audit", async () => {
  const database = createFakeDatabase({
    returns: [[{ id: "idem" }], [storedProject]]
  });
  const result = await new DrizzleProjectPolicyRepository(database).createProject(
    projectInput,
    idempotency("project_create")
  );
  assert.deepEqual(result, {
    publicId: projectPublicId,
    slug: "donebond",
    name: "DoneBond",
    repositoryUrl: projectInput.repositoryUrl,
    defaultBranch: "main",
    visibility: "private",
    status: "active",
    activePolicyHash: null,
    role: "owner",
    createdAt,
    updatedAt: createdAt
  });
  assert.equal("id" in result, false);
  assert.deepEqual(
    database.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [apiIdempotencyKeys, projects, projectMembers, auditEvents]
  );
});

test("project create replay returns its original snapshot after a later update", async () => {
  const replay = projectReplay();
  const exactDatabase = createFakeDatabase({
    selects: [[{ ...ownerAuthorization, status: "archived", activePolicyId: policyId }], [replay]],
    returns: [[]]
  });
  assert.deepEqual(
    await new DrizzleProjectPolicyRepository(exactDatabase).createProject(
      projectInput,
      idempotency("project_create")
    ),
    {
      publicId: projectPublicId,
      slug: projectInput.slug,
      name: projectInput.name,
      repositoryUrl: projectInput.repositoryUrl,
      defaultBranch: projectInput.defaultBranch,
      visibility: "private",
      status: "active",
      activePolicyHash: null,
      role: "owner",
      createdAt,
      updatedAt: createdAt
    }
  );
  assert.equal(
    exactDatabase.calls.some((call) => call.table === auditEvents),
    false
  );

  const conflictDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], [{ ...replay, requestHash: `0x${"c".repeat(64)}` }]],
    returns: [[]]
  });
  await assert.rejects(
    new DrizzleProjectPolicyRepository(conflictDatabase).createProject(
      projectInput,
      idempotency("project_create")
    ),
    (error) => error instanceof DatabaseServiceError && error.code === "DB_IDEMPOTENCY_CONFLICT"
  );
});

test("project read and list are member-scoped, keyset-bounded, and omit internal identifiers", async () => {
  const projected = {
    publicId: projectPublicId,
    slug: "donebond",
    name: "DoneBond",
    repositoryUrl: projectInput.repositoryUrl,
    defaultBranch: "main",
    visibility: "private",
    status: "active",
    activePolicyHash: policyHash,
    role: "member",
    createdAt,
    updatedAt
  };
  const older = {
    ...projected,
    publicId: "01arz3ndektsv4rrffq69g5fac",
    createdAt: new Date("2026-07-17T07:00:00.000Z")
  };
  const database = createFakeDatabase({ selects: [[projected], [projected, older]] });
  const repository = new DrizzleProjectPolicyRepository(database);
  assert.deepEqual(await repository.findProject(projectPublicId, memberUserId), projected);
  const listed = await repository.listProjects(memberUserId, { limit: 1 });
  assert.deepEqual(listed.rows, [projected]);
  assert.deepEqual(listed.nextCursor, { createdAt, publicId: projectPublicId });
  assert.equal("id" in listed.rows[0], false);
  const listCall = database.calls.find((call) => call.order);
  assert.equal(listCall.order.length, 2);
  assert.equal(listCall.limit, 2);
});

test("project metadata validation rejects credential, query, and unsafe branch input before DB", async () => {
  for (const overrides of [
    { repositoryUrl: "https://token@example.test/repository.git" },
    { repositoryUrl: "https://example.test/repository.git?token=test-only" },
    { defaultBranch: "main..poison" }
  ]) {
    const database = createFakeDatabase();
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).createProject(
        { ...projectInput, ...overrides },
        idempotency("project_create")
      ),
      /Repository URL|branch/
    );
    assert.equal(database.calls.length, 0);
  }
});

test("owner update is audited while member update and post-task repository mutation fail", async () => {
  const updated = { ...storedProject, name: "DoneBond Verified", updatedAt };
  const ownerDatabase = createFakeDatabase({
    selects: [[ownerAuthorization]],
    returns: [[{ id: "idem" }], [updated]]
  });
  const result = await new DrizzleProjectPolicyRepository(ownerDatabase).updateProject(
    {
      actorUserId: ownerUserId,
      projectPublicId,
      changedAt: updatedAt,
      name: "DoneBond Verified"
    },
    idempotency("project_update")
  );
  assert.equal(result.name, "DoneBond Verified");
  assert(ownerDatabase.calls.some((call) => call.table === auditEvents));

  const memberDatabase = createFakeDatabase({ selects: [[memberAuthorization]] });
  await assert.rejects(
    new DrizzleProjectPolicyRepository(memberDatabase).updateProject(
      {
        actorUserId: memberUserId,
        projectPublicId,
        changedAt: updatedAt,
        name: "Forbidden"
      },
      { ...idempotency("project_update"), actorScope: `user:${memberUserId}` }
    ),
    (error) => error.code === "DB_NOT_FOUND"
  );

  const taskBoundDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], [{ id: "task" }]],
    returns: [[{ id: "idem" }]]
  });
  await assert.rejects(
    new DrizzleProjectPolicyRepository(taskBoundDatabase).updateProject(
      {
        actorUserId: ownerUserId,
        projectPublicId,
        changedAt: updatedAt,
        repositoryUrl: "https://github.com/Vedant817/renamed.git"
      },
      idempotency("project_update", "repo-change")
    ),
    (error) => error.code === "DB_REPOSITORY_IMMUTABLE"
  );
  assert.equal(
    taskBoundDatabase.calls.some((call) => call.kind === "update"),
    false
  );
  assert(taskBoundDatabase.calls.some((call) => call.table === tasks));
});

test("project update replay returns update A after update B changes current state", async () => {
  const original = projectReplay({
    name: "Update A",
    updatedAt: updatedAt.toISOString()
  });
  original.operation = "project_update";
  original.idempotencyKey = "project_update-key";
  original.responseStatus = 200;
  const database = createFakeDatabase({
    selects: [[{ ...ownerAuthorization, status: "archived" }], [original]],
    returns: [[]]
  });
  const replayed = await new DrizzleProjectPolicyRepository(database).updateProject(
    {
      actorUserId: ownerUserId,
      projectPublicId,
      changedAt: updatedAt,
      name: "Update A"
    },
    idempotency("project_update")
  );
  assert.equal(replayed.name, "Update A");
  assert.equal(replayed.status, "active");
  assert.equal(
    database.calls.some((call) => call.table === auditEvents),
    false
  );
});

test("owner creates immutable policy; exact same hash under a new key returns existing", async () => {
  const createDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], []],
    returns: [[{ id: "idem" }], [storedPolicy]]
  });
  const created = await new DrizzleProjectPolicyRepository(createDatabase).createPolicyVersion(
    policyInput,
    idempotency("policy_create")
  );
  assert.equal(created.publicId, policyPublicId);
  assert.equal(created.active, false);
  assert.equal("id" in created, false);
  const storedSnapshot = createDatabase.calls.find(
    (call) => call.kind === "update" && call.table === apiIdempotencyKeys
  );
  assert.equal(storedSnapshot.set.responseStatus, 201);
  assert.equal("canonicalJson" in storedSnapshot.set.responseSafeJson, false);
  assert.equal("id" in storedSnapshot.set.responseSafeJson, false);
  assert.deepEqual(
    createDatabase.calls.filter((call) => call.kind === "insert").map((call) => call.table),
    [apiIdempotencyKeys, policies, auditEvents]
  );

  const existingDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], [storedPolicy]],
    returns: [[{ id: "new-idem" }]]
  });
  assert.equal(
    (
      await new DrizzleProjectPolicyRepository(existingDatabase).createPolicyVersion(
        policyInput,
        idempotency("policy_create", "new-key")
      )
    ).publicId,
    policyPublicId
  );
  assert.equal(
    existingDatabase.calls.some((call) => call.table === auditEvents),
    false
  );
});

test("create-and-activate replay survives another activation and project archive", async () => {
  const database = createFakeDatabase({
    selects: [
      [
        {
          ...ownerAuthorization,
          activePolicyId: "00000000-0000-4000-8000-000000000699",
          status: "archived"
        }
      ],
      [policyReplay("policy_create")],
      [storedPolicy]
    ],
    returns: [[]]
  });
  const replayed = await new DrizzleProjectPolicyRepository(database).createPolicyVersion(
    { ...policyInput, activate: true, activatedAt: updatedAt },
    idempotency("policy_create")
  );
  assert.equal(replayed.active, true);
  assert.deepEqual(replayed.canonicalJson, canonicalJson);
  assert.equal(
    database.calls.some((call) => call.table === auditEvents),
    false
  );
});

test("policy upload can create, activate, and write both audits in one transaction", async () => {
  const database = createFakeDatabase({
    selects: [[ownerAuthorization], []],
    returns: [[{ id: "idem" }], [storedPolicy], [{ id: projectId }]]
  });
  const result = await new DrizzleProjectPolicyRepository(database).createPolicyVersion(
    { ...policyInput, activate: true, activatedAt: updatedAt },
    idempotency("policy_create", "create-and-activate")
  );
  assert.equal(result.active, true);
  assert.equal(
    database.calls.filter((call) => call.kind === "update" && call.table === projects).length,
    1
  );
  assert.deepEqual(
    database.calls
      .filter((call) => call.kind === "insert" && call.table === auditEvents)
      .map((call) => call.values.action),
    ["policy.created", "policy.activated"]
  );
  const projectLock = database.calls.find(
    (call) => call.kind === "select" && call.table === projects
  );
  assert.equal(projectLock.lock, "update");
});

test("policy hash collision, uppercase hash, member upload, and archived project fail closed", async () => {
  const collisionDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], [{ ...storedPolicy, publicId: "01arz3ndektsv4rrffq69g5fac" }]],
    returns: [[{ id: "idem" }]]
  });
  await assert.rejects(
    new DrizzleProjectPolicyRepository(collisionDatabase).createPolicyVersion(
      policyInput,
      idempotency("policy_create")
    ),
    (error) => error.code === "DB_POLICY_HASH_CONFLICT"
  );

  const malformedDatabase = createFakeDatabase();
  await assert.rejects(
    new DrizzleProjectPolicyRepository(malformedDatabase).createPolicyVersion(
      { ...policyInput, policyHash: `0x${"A".repeat(64)}` },
      idempotency("policy_create")
    ),
    /lowercase bytes32/
  );
  assert.equal(malformedDatabase.calls.length, 0);

  for (const [authorization, expectedCode, returns] of [
    [memberAuthorization, "DB_NOT_FOUND", []],
    [{ ...ownerAuthorization, status: "archived" }, "DB_PROJECT_ARCHIVED", [[{ id: "idem" }]]]
  ]) {
    const database = createFakeDatabase({ selects: [[authorization]], returns });
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).createPolicyVersion(
        policyInput,
        idempotency("policy_create")
      ),
      (error) => error.code === expectedCode
    );
    assert.equal(
      database.calls.some(
        (call) => call.kind === "insert" && [policies, auditEvents].includes(call.table)
      ),
      false
    );
  }
});

test("source paths and leading-dash branches fail before database access", async () => {
  for (const sourcePath of [
    "./policy.json",
    "policy/./check.json",
    "policy/../check.json",
    "policy//check.json",
    "policy\\check.json",
    "policy/\u0001check.json"
  ]) {
    const database = createFakeDatabase();
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).createPolicyVersion(
        { ...policyInput, sourcePath },
        idempotency("policy_create")
      ),
      /source path/
    );
    assert.equal(database.calls.length, 0);
  }
  const database = createFakeDatabase();
  await assert.rejects(
    new DrizzleProjectPolicyRepository(database).createProject(
      { ...projectInput, defaultBranch: "-main" },
      idempotency("project_create")
    ),
    /branch/
  );
  assert.equal(database.calls.length, 0);
});

test("pagination rejects unbounded limits and malformed cursors before querying", async () => {
  for (const pagination of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 10, cursor: { createdAt: new Date("invalid"), publicId: projectPublicId } },
    { limit: 10, cursor: { createdAt, publicId: "not-a-public-id" } }
  ]) {
    const database = createFakeDatabase();
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).listProjects(ownerUserId, pagination),
      (error) => error.code === "DB_INVALID_INPUT"
    );
    assert.equal(database.calls.length, 0);
  }
});

test("policy history uses bounded creation/public ID keysets and marks only active identity", async () => {
  const older = { ...storedPolicy, id: "00000000-0000-4000-8000-000000000605" };
  const project = { ...ownerAuthorization, activePolicyId: policyId };
  const database = createFakeDatabase({ selects: [[project], [storedPolicy, older]] });
  const history = await new DrizzleProjectPolicyRepository(database).listPolicyVersions(
    projectPublicId,
    ownerUserId,
    { limit: 1 }
  );
  assert.deepEqual(
    history?.rows.map((item) => item.active),
    [true]
  );
  assert.deepEqual(history?.nextCursor, { createdAt, publicId: policyPublicId });
  const historyCall = database.calls.find((call) => call.table === policies && call.order);
  assert.equal(historyCall.order.length, 2);
  assert.equal(historyCall.limit, 2);
});

test("member policy detail is project-scoped and includes canonical content", async () => {
  const project = { ...memberAuthorization, activePolicyId: policyId };
  const database = createFakeDatabase({ selects: [[project], [storedPolicy], [project], []] });
  const repository = new DrizzleProjectPolicyRepository(database);
  const detail = await repository.findPolicyVersion(projectPublicId, policyPublicId, memberUserId);
  assert.deepEqual(detail?.canonicalJson, canonicalJson);
  assert.equal(detail?.active, true);
  assert.equal("id" in detail, false);
  assert.equal(
    await repository.findPolicyVersion(projectPublicId, "01arz3ndektsv4rrffq69g5fac", memberUserId),
    null
  );
});

test("activation is owner/project-bound, project-locked, idempotent, and audit-coupled", async () => {
  const database = createFakeDatabase({
    selects: [[ownerAuthorization], [storedPolicy]],
    returns: [[{ id: "idem" }], [{ id: projectId }]]
  });
  const result = await new DrizzleProjectPolicyRepository(database).activatePolicy(
    {
      actorUserId: ownerUserId,
      projectPublicId,
      policyPublicId,
      activatedAt: updatedAt
    },
    idempotency("policy_activate")
  );
  assert.equal(result.active, true);
  const projectLock = database.calls.find(
    (call) => call.kind === "select" && call.table === projects
  );
  assert.equal(projectLock.lock, "update");
  assert.deepEqual(
    database.calls
      .filter((call) => ["update", "insert"].includes(call.kind))
      .map((call) => call.table),
    [apiIdempotencyKeys, projects, auditEvents, apiIdempotencyKeys]
  );

  const replayDatabase = createFakeDatabase({
    selects: [
      [{ ...ownerAuthorization, activePolicyId: null }],
      [policyReplay("policy_activate")],
      [storedPolicy]
    ],
    returns: [[]]
  });
  assert.equal(
    (
      await new DrizzleProjectPolicyRepository(replayDatabase).activatePolicy(
        {
          actorUserId: ownerUserId,
          projectPublicId,
          policyPublicId,
          activatedAt: updatedAt
        },
        idempotency("policy_activate")
      )
    ).active,
    true
  );
  assert.equal(
    replayDatabase.calls.some((call) => call.table === auditEvents),
    false
  );
});

test("member, archived, missing, and cross-project policy activation cannot mutate", async () => {
  const cases = [
    { selects: [[memberAuthorization]], returns: [], expected: "DB_NOT_FOUND" },
    {
      selects: [[{ ...ownerAuthorization, status: "archived" }]],
      returns: [[{ id: "idem" }]],
      expected: "DB_PROJECT_ARCHIVED"
    },
    { selects: [[ownerAuthorization], []], returns: [[{ id: "idem" }]], expected: "DB_NOT_FOUND" }
  ];
  for (const item of cases) {
    const database = createFakeDatabase({ selects: item.selects, returns: item.returns });
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).activatePolicy(
        {
          actorUserId: item.selects[0][0]?.userId ?? ownerUserId,
          projectPublicId,
          policyPublicId,
          activatedAt: updatedAt
        },
        {
          ...idempotency("policy_activate"),
          actorScope: `user:${item.selects[0][0]?.userId ?? ownerUserId}`
        }
      ),
      (error) => error.code === item.expected
    );
    assert.equal(
      database.calls.some((call) => call.kind === "update"),
      false
    );
  }
});

test("idempotency snapshot parsing rejects internal fields, canonical payloads, and null snapshots", async () => {
  const malformedProject = projectReplay();
  malformedProject.responseSafeJson.internalId = projectId;
  for (const responseSafeJson of [malformedProject.responseSafeJson, null]) {
    const database = createFakeDatabase({
      selects: [[ownerAuthorization], [{ ...malformedProject, responseSafeJson }]],
      returns: [[]]
    });
    await assert.rejects(
      new DrizzleProjectPolicyRepository(database).createProject(
        projectInput,
        idempotency("project_create")
      ),
      (error) => error.code === "DB_CONFLICT"
    );
  }

  const malformedPolicy = policyReplay("policy_activate");
  malformedPolicy.responseSafeJson.canonicalJson = canonicalJson;
  const policyDatabase = createFakeDatabase({
    selects: [[ownerAuthorization], [malformedPolicy]],
    returns: [[]]
  });
  await assert.rejects(
    new DrizzleProjectPolicyRepository(policyDatabase).activatePolicy(
      { actorUserId: ownerUserId, projectPublicId, policyPublicId, activatedAt: updatedAt },
      idempotency("policy_activate")
    ),
    (error) => error.code === "DB_CONFLICT"
  );
});
