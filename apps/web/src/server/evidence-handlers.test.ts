import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  CliTokenAuthenticator,
  generateCliToken,
  generateOpaquePublicId,
  type CliTokenPrincipal,
  type CliTokenRateLimiter,
  type CliTokenUseStore
} from "./cli-token.ts";
import {
  createEvidenceHandlers,
  type EvidenceDetailRecord,
  type EvidenceHandlerServices,
  type EvidenceRecord,
  type EvidenceStore
} from "./evidence-handlers.ts";

const ORIGIN = "https://donebond.test";
const SECRET = Buffer.alloc(32, 7).toString("base64url");
const HASH = `0x${"ab".repeat(32)}`;
const NOW = "2026-07-17T00:00:00.000Z";

const PROJECT = generateOpaquePublicId();
const OTHER_PROJECT = generateOpaquePublicId();
const TASK = generateOpaquePublicId();
const TOKEN_ID = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const TOKEN_PUBLIC = generateOpaquePublicId();
const TOKEN_PLAINTEXT = generateCliToken(SECRET).plaintext;

function evidenceBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const output = { preview: "", digest: HASH, originalBytes: 0, truncated: false };
  return {
    schemaVersion: 1,
    task: { publicId: TASK, taskHash: HASH },
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
    redactions: {},
    ...overrides
  };
}

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
      authorization: `Bearer ${TOKEN_PLAINTEXT}`,
      "idempotency-key": "evidence-submit-test-key-01",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function allowLimiter(): CliTokenRateLimiter {
  return {
    async consume() {
      return true;
    }
  };
}

function fixture(options: { readonly boundProject?: string } = {}) {
  const boundProject = options.boundProject ?? PROJECT;
  const useStore: CliTokenUseStore = {
    async useActiveCliToken(
      _tokenDigest,
      expectedProjectPublicId
    ): Promise<CliTokenPrincipal | null> {
      if (expectedProjectPublicId !== boundProject) return null;
      return { tokenId: TOKEN_ID, tokenPublicId: TOKEN_PUBLIC, projectPublicId: boundProject };
    }
  };
  const authenticator = new CliTokenAuthenticator(
    SECRET,
    useStore,
    allowLimiter(),
    allowLimiter(),
    () => new Date(NOW)
  );

  const persisted: Array<Parameters<EvidenceStore["persistEvidence"]>[0]> = [];
  const records = new Map<string, EvidenceRecord>();
  const details = new Map<string, EvidenceDetailRecord>();

  const store: EvidenceStore = {
    async persistEvidence(input) {
      persisted.push(input);
      const record: EvidenceRecord = {
        publicId: input.publicId,
        taskPublicId: input.taskPublicId,
        projectPublicId: input.projectPublicId,
        evidenceHash: input.evidenceHash,
        commitHashDerived: input.commitHashDerived,
        gitObjectId: input.gitObjectId,
        passing: input.bundle.result.passing,
        bundleSizeBytes: input.bundleSizeBytes,
        schemaVersion: input.bundle.schemaVersion,
        createdAt: new Date(NOW)
      };
      records.set(record.publicId, record);
      details.set(record.publicId, { ...record, bundleJson: input.bundle, checks: [] });
      return record;
    },
    async listEvidence(taskPublicId, page) {
      const items = [...records.values()].filter((item) => item.taskPublicId === taskPublicId);
      if (page.limit < items.length) {
        return {
          items: items.slice(0, page.limit),
          nextCursor: { createdAt: new Date(NOW), publicId: items[page.limit]!.publicId }
        };
      }
      return { items, nextCursor: null };
    },
    async getEvidence(evidencePublicId) {
      return details.get(evidencePublicId) ?? null;
    }
  };

  const services: EvidenceHandlerServices = {
    applicationOrigin: ORIGIN,
    resourceSecret: SECRET,
    authenticator,
    store
  };

  return { handlers: createEvidenceHandlers(services), persisted, records, details };
}

test("submit persists a valid bundle bound to the authenticated token and project", async () => {
  const { handlers, persisted } = fixture();
  const response = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as { evidence: Record<string, unknown> };
  assert.equal(body.evidence.taskPublicId, TASK);
  assert.equal(body.evidence.projectPublicId, PROJECT);
  assert.equal(body.evidence.passing, true);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.submittedByTokenId, TOKEN_ID);
  assert.equal(persisted[0]?.projectPublicId, PROJECT);
  assert.notEqual(persisted[0]?.submittedByTokenId, TOKEN_PUBLIC);
});

test("submit accepts a bare bundle without the evidence wrapper", async () => {
  const { handlers } = fixture();
  const response = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, evidenceBundle()),
    PROJECT
  );
  assert.equal(response.status, 201);
});

test("submit rejects a malformed bundle before authentication or persistence", async () => {
  const { handlers, persisted } = fixture();
  const response = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, {
      evidence: evidenceBundle({
        result: { passing: true, requiredPassed: 0, requiredTotal: 1, failureCodes: [] }
      })
    }),
    PROJECT
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);
  assert.equal(persisted.length, 0);
});

test("submit rejects a missing or malformed idempotency key", async () => {
  const { handlers } = fixture();
  const response = await handlers.submit(
    request(
      "POST",
      `/api/v1/projects/${PROJECT}/evidence`,
      { evidence: evidenceBundle() },
      {
        "idempotency-key": ""
      }
    ),
    PROJECT
  );
  assert.equal(response.status, 400);
});

test("submit rejects an untrusted origin before any parsing", async () => {
  const { handlers, persisted } = fixture();
  const response = await handlers.submit(
    request(
      "POST",
      `/api/v1/projects/${PROJECT}/evidence`,
      { evidence: evidenceBundle() },
      {
        origin: "https://attacker.test"
      }
    ),
    PROJECT
  );
  assert.equal(response.status, 403);
  assert.equal(persisted.length, 0);
});

test("submit rejects query parameters and a token bound to a different project", async () => {
  const { handlers } = fixture({ boundProject: OTHER_PROJECT });
  const withQuery = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence?x=1`, { evidence: evidenceBundle() }),
    PROJECT
  );
  assert.equal(withQuery.status, 400);

  const wrongProject = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  assert.equal(wrongProject.status, 401);
});

test("submitting the same request twice derives the same public ID", async () => {
  const { handlers, persisted } = fixture();
  const first = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  const firstBody = (await first.json()) as { evidence: { publicId: string } };
  await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  assert.equal(persisted[0]?.publicId, persisted[1]?.publicId);
  assert.equal(persisted[0]?.publicId, firstBody.evidence.publicId);
});

test("listEvidence requires authentication and returns paginated evidence", async () => {
  const { handlers } = fixture();
  await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  const authed = await handlers.listEvidence(
    new Request(`${ORIGIN}/api/v1/projects/${PROJECT}/tasks/${TASK}/evidence`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN_PLAINTEXT}` }
    }),
    PROJECT,
    TASK
  );
  assert.equal(authed.status, 200);
  const body = (await authed.json()) as { items: unknown[]; nextCursor: string | null };
  assert.equal(body.items.length, 1);
  assert.equal(body.nextCursor, null);

  const unauthed = await handlers.listEvidence(
    new Request(`${ORIGIN}/api/v1/projects/${PROJECT}/tasks/${TASK}/evidence`, {
      headers: { origin: ORIGIN }
    }),
    PROJECT,
    TASK
  );
  assert.equal(unauthed.status, 401);
});

test("listEvidence rejects an unbounded limit and a malformed cursor", async () => {
  const { handlers } = fixture();
  const badLimit = await handlers.listEvidence(
    new Request(`${ORIGIN}/api/v1/projects/${PROJECT}/tasks/${TASK}/evidence?limit=0`, {
      headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN_PLAINTEXT}` }
    }),
    PROJECT,
    TASK
  );
  assert.equal(badLimit.status, 400);

  const badCursor = await handlers.listEvidence(
    new Request(
      `${ORIGIN}/api/v1/projects/${PROJECT}/tasks/${TASK}/evidence?cursor=not-base64url-json`,
      {
        headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN_PLAINTEXT}` }
      }
    ),
    PROJECT,
    TASK
  );
  assert.equal(badCursor.status, 400);
});

test("getEvidence is public, requires no query, and returns 404 for unknown IDs", async () => {
  const { handlers } = fixture();
  const submitted = await handlers.submit(
    request("POST", `/api/v1/projects/${PROJECT}/evidence`, { evidence: evidenceBundle() }),
    PROJECT
  );
  const submittedBody = (await submitted.json()) as { evidence: { publicId: string } };

  const found = await handlers.getEvidence(
    new Request(`${ORIGIN}/api/v1/evidence/${submittedBody.evidence.publicId}`),
    submittedBody.evidence.publicId
  );
  assert.equal(found.status, 200);
  const detail = (await found.json()) as { evidence: { checks: unknown[] } };
  assert.deepEqual(detail.evidence.checks, []);

  const missing = await handlers.getEvidence(
    new Request(`${ORIGIN}/api/v1/evidence/${generateOpaquePublicId()}`),
    generateOpaquePublicId()
  );
  assert.equal(missing.status, 404);
  const missingBody = (await missing.json()) as { error: { code: string; correlationId: string } };
  assert.equal(missingBody.error.code, ERROR_CODES.EVIDENCE_NOT_FOUND);
  assert.equal(typeof missingBody.error.correlationId, "string");

  const withQuery = await handlers.getEvidence(
    new Request(`${ORIGIN}/api/v1/evidence/${submittedBody.evidence.publicId}?x=1`),
    submittedBody.evidence.publicId
  );
  assert.equal(withQuery.status, 400);
});
