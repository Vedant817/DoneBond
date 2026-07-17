import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  createProjectPolicyHandlers,
  type PolicyRecord,
  type ProjectPolicyHandlerDependencies,
  type ProjectRecord
} from "./project-policy-handlers.ts";
import { parsePolicyUploadInput } from "./project-policy-input.ts";

const ORIGIN = "https://donebond.test";
const USER = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const PROJECT = "01arz3ndektsv4rrffq69g5fav";
const POLICY_ID = "01arz3ndektsv4rrffq69g5faw";
const SECRET = Buffer.alloc(32, 11).toString("base64url");
const NOW = new Date("2026-07-17T14:00:00.000Z");
const POLICY_YAML = `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches: [main]
checks:
  - key: test
    label: Tests
    executable: pnpm
    args: [test]
    cwd: .
    timeoutSeconds: 120
    required: true
    maxOutputBytes: 32768
    environmentAllowlist: []
environment:
  allow: []
redaction:
  additionalPatterns: []
`;
const PARSED_POLICY = parsePolicyUploadInput({
  sourcePath: ".donebond/policy.yml",
  yaml: POLICY_YAML,
  activate: true
}).parsed;

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie: "donebond_session=opaque",
      "x-csrf-token": "valid",
      "idempotency-key": "project-policy-test-key-01",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function fixture(role: "owner" | "member" = "owner") {
  const project: ProjectRecord = {
    schemaVersion: 1,
    publicId: PROJECT,
    slug: "donebond",
    name: "DoneBond",
    repositoryUrl: "https://github.com/vedant817/donebond",
    defaultBranch: "main",
    visibility: "private",
    status: "active",
    activePolicyHash: PARSED_POLICY.policyHash,
    createdAt: NOW,
    updatedAt: NOW
  };
  const policy: PolicyRecord = {
    publicId: POLICY_ID,
    schemaVersion: 1,
    policyHash: PARSED_POLICY.policyHash,
    sourcePath: ".donebond/policy.yml",
    canonicalPolicy: PARSED_POLICY.canonicalPolicy,
    active: true,
    createdAt: NOW
  };
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  const policyCreates: unknown[] = [];
  const activations: unknown[] = [];
  const rateCalls: unknown[][] = [];
  const session = {
    sessionId: "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e002",
    userId: USER,
    address: "0x1111111111111111111111111111111111111111",
    chainId: 10143,
    absoluteExpiresAt: new Date("2026-07-18T00:00:00.000Z")
  } as const;
  const dependencies: ProjectPolicyHandlerDependencies = {
    applicationOrigin: ORIGIN,
    resourceSecret: SECRET,
    auth: {
      async authenticate() {
        return session;
      },
      async requireCsrf(_cookie, csrf) {
        if (csrf !== "valid") throw new Error("invalid test CSRF");
        return session;
      }
    },
    accessStore: {
      async findProjectAccess() {
        return { projectPublicId: PROJECT, role };
      }
    },
    rateLimiter: {
      async consume(...input) {
        rateCalls.push(input);
        return true;
      }
    },
    store: {
      async createProject(input) {
        creates.push(input);
        return { ...project, publicId: input.publicId, activePolicyHash: null };
      },
      async listProjects() {
        return { items: [{ project, role }], nextCursor: null };
      },
      async getProject() {
        return project;
      },
      async updateProject(input) {
        updates.push(input);
        return { ...project, ...input.update };
      },
      async savePolicy(input) {
        policyCreates.push(input);
        return {
          ...policy,
          publicId: input.publicId,
          sourcePath: input.sourcePath,
          canonicalPolicy: input.canonicalPolicy,
          policyHash: input.policyHash,
          active: input.activate
        };
      },
      async listPolicies() {
        return { items: [policy], nextCursor: null };
      },
      async getPolicy() {
        return policy;
      },
      async activatePolicy(input) {
        activations.push(input);
        return policy;
      }
    },
    now: () => NOW
  };
  return {
    activations,
    creates,
    dependencies,
    handlers: createProjectPolicyHandlers(dependencies),
    policyCreates,
    project,
    rateCalls,
    updates
  };
}

test("project create is owner-bound, retry-stable, allowlisted, and globally rate-limited first", async () => {
  const { creates, handlers, rateCalls } = fixture();
  const body = {
    slug: "donebond",
    name: "DoneBond",
    repositoryUrl: "https://github.com/Vedant817/DoneBond.git",
    defaultBranch: "main",
    visibility: "private"
  };
  const first = await handlers.createProject(request("POST", "/api/v1/projects", body));
  const second = await handlers.createProject(request("POST", "/api/v1/projects", body));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const response = await first.json();
  assert.equal(response.role, "owner");
  assert.equal("ownerUserId" in response.project, false);
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[1], creates[0]);
  assert.equal(rateCalls[0]?.[1], null);
  assert.equal(rateCalls[1]?.[1], USER);
});

test("member reads project and policy history without internal IDs or raw YAML", async () => {
  const { handlers } = fixture("member");
  const project = await handlers.getProject(request("GET", `/api/v1/projects/${PROJECT}`), PROJECT);
  assert.equal(project.status, 200);
  assert.equal((await project.json()).role, "member");

  const policies = await handlers.listPolicies(
    request("GET", `/api/v1/projects/${PROJECT}/policies?limit=25`),
    PROJECT
  );
  const listBody = await policies.json();
  assert.equal(policies.status, 200);
  assert.equal(listBody.items.length, 1);
  assert.equal("canonicalPolicy" in listBody.items[0], false);
  assert.equal("canonicalJson" in listBody.items[0], false);

  const detail = await handlers.getPolicy(
    request("GET", `/api/v1/projects/${PROJECT}/policies/${POLICY_ID}`),
    PROJECT,
    POLICY_ID
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.policy.canonicalPolicy.kind, "donebond.policy");
  assert.equal("yaml" in detailBody.policy, false);
});

test("owner updates an allowlisted project subset with a canonical request hash", async () => {
  const { handlers, updates } = fixture();
  const response = await handlers.updateProject(
    request("PATCH", `/api/v1/projects/${PROJECT}`, {
      name: "DoneBond archived",
      status: "archived"
    }),
    PROJECT
  );
  assert.equal(response.status, 200);
  assert.equal(updates.length, 1);
  const update = updates[0] as { requestHash: string; update: unknown };
  assert.match(update.requestHash, /^0x[0-9a-f]{64}$/u);
  assert.deepEqual(update.update, { name: "DoneBond archived", status: "archived" });
});

test("policy upload is server-canonicalized, retry-stable, and can activate atomically", async () => {
  const { handlers, policyCreates } = fixture();
  const body = {
    sourcePath: ".donebond/policy.yml",
    yaml: POLICY_YAML,
    activate: true
  };
  const first = await handlers.savePolicy(
    request("POST", `/api/v1/projects/${PROJECT}/policies`, body),
    PROJECT
  );
  const second = await handlers.savePolicy(
    request("POST", `/api/v1/projects/${PROJECT}/policies`, body),
    PROJECT
  );
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(policyCreates[1], policyCreates[0]);
  const input = policyCreates[0] as {
    canonicalPolicy: { kind: string };
    policyHash: string;
    activate: boolean;
  };
  assert.equal(input.canonicalPolicy.kind, "donebond.policy");
  assert.match(input.policyHash, /^0x[0-9a-f]{64}$/u);
  assert.equal(input.activate, true);
  assert.equal(JSON.stringify(input).includes(POLICY_YAML), false);
});

test("policy activation requires an empty body and returns only safe summary fields", async () => {
  const { activations, handlers } = fixture();
  const response = await handlers.activatePolicy(
    request("POST", `/api/v1/projects/${PROJECT}/policies/${POLICY_ID}/activate`, {}),
    PROJECT,
    POLICY_ID
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.policy.active, true);
  assert.equal("canonicalPolicy" in body.policy, false);
  assert.equal(activations.length, 1);

  const extra = await handlers.activatePolicy(
    request("POST", `/api/v1/projects/${PROJECT}/policies/${POLICY_ID}/activate`, { force: true }),
    PROJECT,
    POLICY_ID
  );
  assert.equal(extra.status, 400);
  assert.equal(activations.length, 1);
});

test("members cannot mutate and malformed pagination fails closed", async () => {
  const member = fixture("member");
  const denied = await member.handlers.savePolicy(
    request("POST", `/api/v1/projects/${PROJECT}/policies`, {
      sourcePath: ".donebond/policy.yml",
      yaml: POLICY_YAML,
      activate: false
    }),
    PROJECT
  );
  assert.equal(denied.status, 403);
  assert.equal(member.policyCreates.length, 0);

  const malformed = await member.handlers.listProjects(
    request("GET", "/api/v1/projects?limit=0&secret=leak")
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);

  const unexpectedDetailQuery = await member.handlers.getProject(
    request("GET", `/api/v1/projects/${PROJECT}?include=internal`),
    PROJECT
  );
  assert.equal(unexpectedDetailQuery.status, 400);
});
