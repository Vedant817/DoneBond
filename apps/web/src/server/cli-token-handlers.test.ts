import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  createCliTokenHandlers,
  type CliTokenCreation,
  type CliTokenHandlerDependencies
} from "./cli-token-handlers.ts";
import { generateOpaquePublicId } from "./cli-token.ts";
import { HttpError } from "./http.ts";

const ORIGIN = "https://donebond.test";
const PROJECT = "01arz3ndektsv4rrffq69g5fav";
const USER = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const SECRET = Buffer.alloc(32, 5).toString("base64url");

function request(method: string, body?: unknown, csrf = "valid"): Request {
  return new Request(`${ORIGIN}/api/v1/projects/${PROJECT}/cli-tokens`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie: "donebond_session=opaque",
      "idempotency-key": "test-idempotency-key-0001",
      "x-csrf-token": csrf,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function fixture(
  role: "owner" | "member" = "owner",
  limits: { readonly globalAllowed?: boolean; readonly subjectAllowed?: boolean } = {}
) {
  const created: CliTokenCreation[] = [];
  const revoked: unknown[][] = [];
  let globalLimitCalls = 0;
  let subjectLimitCalls = 0;
  const dependencies: CliTokenHandlerDependencies = {
    applicationOrigin: ORIGIN,
    tokenSecret: SECRET,
    auth: {
      async requireCsrf(_cookie, csrf) {
        if (csrf !== "valid") {
          throw new HttpError(ERROR_CODES.AUTH_CSRF_INVALID, "CSRF validation failed", 403);
        }
        return {
          sessionId: generateOpaquePublicId(),
          userId: USER,
          address: "0x1111111111111111111111111111111111111111",
          chainId: 10143,
          absoluteExpiresAt: new Date("2026-07-18T00:00:00Z")
        };
      }
    },
    accessStore: {
      async findProjectAccess() {
        return { projectPublicId: PROJECT, role };
      }
    },
    tokenStore: {
      async createCliToken(input) {
        created.push(input);
        return { createdAt: new Date("2026-07-17T07:30:00.000Z") };
      },
      async revokeCliToken(...input) {
        revoked.push(input);
        return true;
      }
    },
    createGlobalLimiter: {
      async consume() {
        globalLimitCalls += 1;
        return limits.globalAllowed ?? true;
      }
    },
    createSubjectLimiter: {
      async consume() {
        subjectLimitCalls += 1;
        return limits.subjectAllowed ?? true;
      }
    },
    revokeGlobalLimiter: {
      async consume() {
        globalLimitCalls += 1;
        return limits.globalAllowed ?? true;
      }
    },
    revokeSubjectLimiter: {
      async consume() {
        subjectLimitCalls += 1;
        return limits.subjectAllowed ?? true;
      }
    },
    now: () => new Date("2026-07-17T07:30:00.000Z")
  };
  return {
    created,
    dependencies,
    globalLimitCalls: () => globalLimitCalls,
    handlers: createCliTokenHandlers(dependencies),
    revoked,
    subjectLimitCalls: () => subjectLimitCalls
  };
}

test("owner creates a copy-once token while persistence receives only its digest", async () => {
  const { created, globalLimitCalls, handlers, subjectLimitCalls } = fixture();
  const response = await handlers.create(request("POST", {}), PROJECT);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.token.plaintext, /^dbt_[A-Za-z0-9_-]{43}$/u);
  assert.match(body.token.publicId, /^[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.equal(created.length, 1);
  const persisted = created[0];
  assert.ok(persisted);
  assert.match(persisted.tokenDigest, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(persisted).includes(body.token.plaintext), false);
  assert.equal(persisted.createdByUserId, USER);
  assert.equal(persisted.projectPublicId, PROJECT);
  assert.equal(globalLimitCalls(), 1);
  assert.equal(subjectLimitCalls(), 1);
});

test("creation retries derive the same credential without persisting plaintext", async () => {
  const { created, handlers } = fixture();
  const first = await handlers.create(request("POST", {}), PROJECT);
  const second = await handlers.create(request("POST", {}), PROJECT);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.deepEqual(secondBody.token, firstBody.token);
  assert.equal(created.length, 2);
  assert.deepEqual(created[1], created[0]);
  assert.equal(JSON.stringify(created).includes(firstBody.token.plaintext), false);
});

test("member, invalid CSRF, untrusted origin, and extra creation fields fail before persistence", async () => {
  const member = fixture("member");
  assert.equal((await member.handlers.create(request("POST", {}), PROJECT)).status, 403);
  assert.equal(
    (await fixture().handlers.create(request("POST", {}, "wrong"), PROJECT)).status,
    403
  );
  const untrusted = request("POST", {});
  untrusted.headers.set("origin", "https://evil.test");
  assert.equal((await fixture().handlers.create(untrusted, PROJECT)).status, 403);
  const extra = fixture();
  assert.equal(
    (await extra.handlers.create(request("POST", { role: "owner" }), PROJECT)).status,
    400
  );
  assert.equal(member.created.length + extra.created.length, 0);
});

test("owner revokes a project-bound token and malformed IDs never reach storage", async () => {
  const tokenPublicId = generateOpaquePublicId();
  const { handlers, revoked } = fixture();
  const response = await handlers.revoke(request("DELETE"), PROJECT, tokenPublicId);
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, [[PROJECT, tokenPublicId, USER, new Date("2026-07-17T07:30:00.000Z")]]);
  const malformed = await handlers.revoke(request("DELETE"), PROJECT, "not-a-token");
  assert.equal(malformed.status, 404);
  assert.equal((await malformed.json()).error.code, ERROR_CODES.TOKEN_REVOKED);
  assert.equal(revoked.length, 1);
});

test("durable global and subject limits fail closed before token writes", async () => {
  const global = fixture("owner", { globalAllowed: false });
  const globallyLimited = await global.handlers.create(request("POST", {}), PROJECT);
  assert.equal(globallyLimited.status, 429);
  assert.equal(global.created.length, 0);

  const subject = fixture("owner", { subjectAllowed: false });
  const subjectLimited = await subject.handlers.revoke(
    request("DELETE"),
    PROJECT,
    generateOpaquePublicId()
  );
  assert.equal(subjectLimited.status, 429);
  assert.equal(subject.revoked.length, 0);
});
