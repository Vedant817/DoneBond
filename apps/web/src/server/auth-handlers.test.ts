import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import { createAuthHandlers, FixedWindowRateLimiter, type WalletAuthApi } from "./auth-handlers.ts";
import { HttpError } from "./http.ts";

const ORIGIN = "https://donebond.test";
const ID = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const ACCOUNT = {
  userId: ID,
  address: "0x1111111111111111111111111111111111111111" as const,
  chainId: 10143
};

class StubAuth implements WalletAuthApi {
  calls: string[] = [];

  async createChallenge() {
    this.calls.push("challenge");
    return {
      id: ID,
      nonce: "a".repeat(32),
      message: "Sign this exact message",
      expiresAt: "2026-07-17T12:00:00.000Z"
    };
  }

  async verifyChallenge() {
    this.calls.push("verify");
    return {
      account: ACCOUNT,
      cookie: "donebond_session=opaque; Path=/; HttpOnly; Secure; SameSite=Strict",
      csrfToken: "csrf"
    };
  }

  async authenticate() {
    this.calls.push("authenticate");
    return { sessionId: ID, ...ACCOUNT, absoluteExpiresAt: new Date("2026-07-17T18:00:00Z") };
  }

  async requireCsrf(_cookie: string | null, csrf: string | null) {
    this.calls.push("csrf");
    if (csrf !== "valid") {
      throw new HttpError(ERROR_CODES.AUTH_CSRF_INVALID, "CSRF validation failed", 403);
    }
    return { sessionId: ID, ...ACCOUNT, absoluteExpiresAt: new Date("2026-07-17T18:00:00Z") };
  }

  async revoke() {
    this.calls.push("revoke");
    return true;
  }

  clearSessionCookie() {
    return "donebond_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
  }
}

function request(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: ORIGIN,
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function fixture(maximumAttempts = 10) {
  const auth = new StubAuth();
  const handlers = createAuthHandlers({
    applicationOrigin: ORIGIN,
    auth,
    globalChallengeLimiter: new FixedWindowRateLimiter(100, 60_000),
    challengeLimiter: new FixedWindowRateLimiter(maximumAttempts, 60_000),
    globalVerificationLimiter: new FixedWindowRateLimiter(100, 60_000),
    verificationLimiter: new FixedWindowRateLimiter(maximumAttempts, 60_000),
    now: () => new Date("2026-07-17T11:00:00.000Z")
  });
  return { auth, handlers };
}

test("challenge route enforces origin, strict bounded JSON, and rate limits", async () => {
  const { auth, handlers } = fixture(1);
  const input = { address: ACCOUNT.address, chainId: ACCOUNT.chainId };
  const first = await handlers.challenge(request("/api/v1/auth/challenge", input));
  assert.equal(first.status, 201);
  assert.equal(auth.calls.length, 1);

  const limited = await handlers.challenge(request("/api/v1/auth/challenge", input));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  assert.equal((await limited.json()).error.code, ERROR_CODES.RATE_LIMITED);
  assert.equal(auth.calls.length, 1);

  const untrusted = await handlers.challenge(
    request("/api/v1/auth/challenge", input, { origin: "https://evil.test" })
  );
  assert.equal(untrusted.status, 403);
  const extra = await handlers.challenge(
    request("/api/v1/auth/challenge", { ...input, role: "owner" })
  );
  assert.equal(extra.status, 400);
  const invalidAddress = await handlers.challenge(
    request("/api/v1/auth/challenge", { address: "0x1234", chainId: 10143 })
  );
  assert.equal(invalidAddress.status, 400);
});

test("verify validates signature shape and sets only the opaque session cookie", async () => {
  const { auth, handlers } = fixture();
  const invalid = await handlers.verify(
    request("/api/v1/auth/verify", { id: ID, nonce: "a".repeat(32), signature: "0x01" })
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(auth.calls, []);

  const response = await handlers.verify(
    request("/api/v1/auth/verify", {
      id: ID,
      nonce: "a".repeat(32),
      signature: `0x${"11".repeat(65)}`
    })
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/u);
  const body = await response.json();
  assert.equal(body.csrfToken, "csrf");
  assert.deepEqual(body.account, { address: ACCOUNT.address, chainId: ACCOUNT.chainId });
  assert.equal(JSON.stringify(body).includes(ID), false);
  assert.deepEqual(auth.calls, ["verify"]);
});

test("session authenticates while logout requires CSRF before revocation", async () => {
  const { auth, handlers } = fixture();
  const session = await handlers.session(
    request("/api/v1/auth/session", undefined, { cookie: "donebond_session=opaque" })
  );
  assert.equal(session.status, 200);
  assert.equal((await session.text()).includes(ID), false);

  const rejected = await handlers.logout(
    request("/api/v1/auth/logout", {}, { cookie: "donebond_session=opaque" })
  );
  assert.equal(rejected.status, 403);
  assert.equal(auth.calls.includes("revoke"), false);

  const logout = await handlers.logout(
    request(
      "/api/v1/auth/logout",
      {},
      {
        cookie: "donebond_session=opaque",
        "x-csrf-token": "valid"
      }
    )
  );
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/u);
  assert.deepEqual(auth.calls, ["authenticate", "csrf", "csrf", "revoke"]);
});

test("rate limiter bounds memory keys and resets expired windows", async () => {
  const limiter = new FixedWindowRateLimiter(1, 1000, 1);
  assert.equal(await limiter.consume("first", new Date(0)), true);
  assert.equal(await limiter.consume("second", new Date(500)), false);
  assert.equal(await limiter.consume("second", new Date(1000)), true);
  assert.equal(await limiter.consume("second", new Date(1001)), false);
});

test("separate handler instances enforce a shared rate limiter", async () => {
  const sharedWalletLimiter = new FixedWindowRateLimiter(1, 60_000);
  const sharedGlobalLimiter = new FixedWindowRateLimiter(100, 60_000);
  const build = () =>
    createAuthHandlers({
      applicationOrigin: ORIGIN,
      auth: new StubAuth(),
      globalChallengeLimiter: sharedGlobalLimiter,
      challengeLimiter: sharedWalletLimiter,
      globalVerificationLimiter: new FixedWindowRateLimiter(100, 60_000),
      verificationLimiter: new FixedWindowRateLimiter(10, 60_000),
      now: () => new Date("2026-07-17T11:00:00.000Z")
    });
  const input = { address: ACCOUNT.address, chainId: ACCOUNT.chainId };
  assert.equal((await build().challenge(request("/api/v1/auth/challenge", input))).status, 201);
  assert.equal((await build().challenge(request("/api/v1/auth/challenge", input))).status, 429);
});

test("global rejection short-circuits high-cardinality subject limiters", async () => {
  let subjectCalls = 0;
  const handlers = createAuthHandlers({
    applicationOrigin: ORIGIN,
    auth: new StubAuth(),
    globalChallengeLimiter: {
      async consume() {
        return false;
      }
    },
    challengeLimiter: {
      async consume() {
        subjectCalls += 1;
        return true;
      }
    },
    globalVerificationLimiter: {
      async consume() {
        return false;
      }
    },
    verificationLimiter: {
      async consume() {
        subjectCalls += 1;
        return true;
      }
    }
  });
  const challenge = await handlers.challenge(
    request("/api/v1/auth/challenge", { address: ACCOUNT.address, chainId: ACCOUNT.chainId })
  );
  const verify = await handlers.verify(
    request("/api/v1/auth/verify", {
      id: ID,
      nonce: "a".repeat(32),
      signature: `0x${"11".repeat(65)}`
    })
  );
  assert.equal(challenge.status, 429);
  assert.equal(verify.status, 429);
  assert.equal(subjectCalls, 0);
});
