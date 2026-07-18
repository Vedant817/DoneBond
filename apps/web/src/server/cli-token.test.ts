import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  bearerCliToken,
  CliTokenAuthenticator,
  cliTokenDigest,
  deriveOpaquePublicId,
  generateCliToken,
  generateOpaquePublicId,
  safeRequestHeaders,
  type CliTokenRateLimiter,
  type CliTokenUseStore
} from "./cli-token.ts";

const SECRET = Buffer.alloc(32, 9).toString("base64url");

test("CLI tokens are random, prefixed, and deterministically keyed", () => {
  const first = generateCliToken(SECRET);
  const second = generateCliToken(SECRET);
  assert.match(first.plaintext, /^dbt_[A-Za-z0-9_-]{43}$/u);
  assert.equal(first.prefix, first.plaintext.slice(0, 12));
  assert.match(first.digest, /^[0-9a-f]{64}$/u);
  assert.equal(cliTokenDigest(first.plaintext, SECRET), first.digest);
  assert.notEqual(first.plaintext, second.plaintext);
  assert.notEqual(first.digest, second.digest);
  assert.equal(first.digest.includes(first.plaintext), false);
});

test("bearer parsing is exact and malformed tokens fail with stable auth errors", () => {
  const token = generateCliToken(SECRET).plaintext;
  assert.equal(bearerCliToken(`Bearer ${token}`), token);
  for (const header of [null, token, `bearer ${token}`, `Bearer ${token} extra`, "Bearer short"]) {
    assert.throws(() => bearerCliToken(header), {
      code: ERROR_CODES.AUTH_REQUIRED,
      status: 401
    });
  }
  for (const invalidSecret of ["short", `${SECRET}=`, `${SECRET}!`]) {
    assert.throws(() => generateCliToken(invalidSecret), /CLI_TOKEN_SECRET/u);
  }
});

test("opaque public IDs match persisted constraints without collisions in a sample", () => {
  const identifiers = new Set(Array.from({ length: 1000 }, generateOpaquePublicId));
  assert.equal(identifiers.size, 1000);
  for (const identifier of identifiers) {
    assert.match(identifier, /^[0-9a-hjkmnp-tv-z]{26}$/u);
    assert.match(identifier[0] ?? "", /^[0-7]$/u);
  }
});

test("keyed public IDs are retry-stable and domain-separated", () => {
  const components = ["user-id", "project_create", "idempotency-key"];
  const first = deriveOpaquePublicId(SECRET, "project", components);
  assert.equal(deriveOpaquePublicId(SECRET, "project", components), first);
  assert.notEqual(deriveOpaquePublicId(SECRET, "policy", components), first);
  assert.notEqual(deriveOpaquePublicId(SECRET, "project", [...components, "changed"]), first);
  assert.match(first, /^[0-9a-hjkmnp-tv-z]{26}$/u);
});

test("safe request headers redact credentials and omit attacker-controlled headers", () => {
  const token = generateCliToken(SECRET).plaintext;
  const safe = safeRequestHeaders(
    new Headers({
      accept: "application/json",
      authorization: `Bearer ${token}`,
      cookie: "donebond_session=secret",
      "x-csrf-token": "secret",
      "x-forwarded-for": "attacker-controlled"
    })
  );
  assert.deepEqual(safe, {
    accept: "application/json",
    authorization: "[REDACTED:authorization]",
    cookie: "[REDACTED:cookie]",
    "x-csrf-token": "[REDACTED:x-csrf-token]"
  });
  assert.equal(JSON.stringify(safe).includes(token), false);
});

test("CLI authentication is project-bound, rate-limited, and updates use through the store", async () => {
  const generated = generateCliToken(SECRET);
  const projectPublicId = generateOpaquePublicId();
  const calls: Array<{ tokenDigest: string; expectedProject: string; usedAt: Date }> = [];
  const store: CliTokenUseStore = {
    async useActiveCliToken(tokenDigest, expectedProject, usedAt) {
      calls.push({ tokenDigest, expectedProject, usedAt });
      return {
        tokenId: generateOpaquePublicId(),
        tokenPublicId: generateOpaquePublicId(),
        projectPublicId
      };
    }
  };
  const allow: CliTokenRateLimiter = {
    async consume() {
      return true;
    }
  };
  const authenticator = new CliTokenAuthenticator(
    SECRET,
    store,
    allow,
    allow,
    () => new Date("2026-07-17T07:30:00.000Z")
  );
  const principal = await authenticator.authenticate(
    `Bearer ${generated.plaintext}`,
    projectPublicId
  );
  assert.equal(principal.projectPublicId, projectPublicId);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.tokenDigest, generated.digest);
  assert.equal(call.expectedProject, projectPublicId);
  assert.equal(call.usedAt.toISOString(), "2026-07-17T07:30:00.000Z");

  await assert.rejects(
    authenticator.authenticate(`Bearer ${generated.plaintext}`, generateOpaquePublicId()),
    { code: ERROR_CODES.AUTH_REQUIRED, status: 401 }
  );
});

test("global CLI auth rejection short-circuits token-cardinality storage", async () => {
  let tokenLimitCalls = 0;
  let storeCalls = 0;
  const authenticator = new CliTokenAuthenticator(
    SECRET,
    {
      async useActiveCliToken() {
        storeCalls += 1;
        return null;
      }
    },
    {
      async consume() {
        return false;
      }
    },
    {
      async consume() {
        tokenLimitCalls += 1;
        return true;
      }
    }
  );
  const token = generateCliToken(SECRET).plaintext;
  await assert.rejects(authenticator.authenticate(`Bearer ${token}`, generateOpaquePublicId()), {
    code: ERROR_CODES.RATE_LIMITED,
    status: 429
  });
  assert.equal(tokenLimitCalls, 0);
  assert.equal(storeCalls, 0);
});

test("global CLI rate limiting covers malformed bearer credentials", async () => {
  let globalCalls = 0;
  let tokenCalls = 0;
  const authenticator = new CliTokenAuthenticator(
    SECRET,
    {
      async useActiveCliToken() {
        assert.fail("malformed credentials must not reach storage");
      }
    },
    {
      async consume() {
        globalCalls += 1;
        return true;
      }
    },
    {
      async consume() {
        tokenCalls += 1;
        return true;
      }
    }
  );
  await assert.rejects(authenticator.authenticate("Bearer malformed", generateOpaquePublicId()), {
    code: ERROR_CODES.AUTH_REQUIRED,
    status: 401
  });
  assert.equal(globalCalls, 1);
  assert.equal(tokenCalls, 0);
});
