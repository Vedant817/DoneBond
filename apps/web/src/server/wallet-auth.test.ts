import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  WalletAuthService,
  type BrowserSessionStore,
  type ChallengeStore,
  type StoredBrowserSession,
  type StoredWalletChallenge,
  type WalletAccountResolver
} from "./wallet-auth.ts";

const USER_ID = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";
const SECRET = Buffer.alloc(32, 7).toString("base64url");

class MemoryChallenges implements ChallengeStore {
  readonly records = new Map<string, StoredWalletChallenge>();
  readonly consumed = new Set<string>();

  async create(challenge: StoredWalletChallenge): Promise<void> {
    this.records.set(challenge.id, challenge);
  }

  async find(id: string): Promise<StoredWalletChallenge | null> {
    return this.records.get(id) ?? null;
  }

  async consume(id: string, nonceDigest: string, consumedAt: Date): Promise<boolean> {
    const record = this.records.get(id);
    if (
      record?.nonceDigest !== nonceDigest ||
      record.expiresAt.getTime() <= consumedAt.getTime() ||
      this.consumed.has(id)
    ) {
      return false;
    }
    this.consumed.add(id);
    return true;
  }
}

class MemorySessions implements BrowserSessionStore {
  readonly records = new Map<string, StoredBrowserSession>();

  async create(session: StoredBrowserSession): Promise<void> {
    this.records.set(session.tokenDigest, session);
  }

  async findActiveByTokenDigest(tokenDigest: string): Promise<StoredBrowserSession | null> {
    return this.records.get(tokenDigest) ?? null;
  }

  async revoke(tokenDigest: string): Promise<boolean> {
    return this.records.delete(tokenDigest);
  }
}

function fixture(now = new Date("2026-07-17T05:30:00.000Z")) {
  const challenges = new MemoryChallenges();
  const sessions = new MemorySessions();
  const account = privateKeyToAccount(generatePrivateKey());
  const accounts: WalletAccountResolver = {
    async findOrCreateVerifiedWallet(address, chainId) {
      return { userId: USER_ID, address, chainId };
    }
  };
  const service = new WalletAuthService({
    applicationOrigin: "https://donebond.test",
    sessionSecret: SECRET,
    challenges,
    accounts,
    sessions,
    now: () => now
  });
  return { service, challenges, sessions, account };
}

test("wallet challenge binds origin, chain, address, nonce, and expiry", async () => {
  const { service, challenges, account } = fixture();
  const challenge = await service.createChallenge(account.address, 10143);
  assert.match(challenge.message, /^donebond\.test wants you to sign in/u);
  assert.match(challenge.message, new RegExp(account.address, "iu"));
  assert.match(challenge.message, /URI: https:\/\/donebond\.test/u);
  assert.match(challenge.message, /Chain ID: 10143/u);
  assert.match(challenge.message, new RegExp(`Nonce: ${challenge.nonce}`, "u"));
  const stored = challenges.records.get(challenge.id);
  assert.ok(stored);
  assert.equal(JSON.stringify(stored).includes(challenge.nonce), false);
});

test("valid signature creates opaque persisted session and replay fails", async () => {
  const { service, challenges, sessions, account } = fixture();
  const challenge = await service.createChallenge(account.address, 10143);
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await service.verifyChallenge(challenge.id, challenge.nonce, signature);
  assert.equal(verified.account.address.toLowerCase(), account.address.toLowerCase());
  assert.match(verified.cookie, /HttpOnly; SameSite=Strict/u);
  assert.match(verified.cookie, /; Secure/u);
  assert.equal(verified.cookie.includes(USER_ID), false);
  assert.equal(sessions.records.size, 1);
  assert.equal(challenges.consumed.has(challenge.id), true);

  const authenticated = await service.authenticate(verified.cookie);
  assert.equal(authenticated.userId, USER_ID);
  await assert.rejects(service.requireCsrf(verified.cookie, "wrong-token"), {
    code: ERROR_CODES.AUTH_CSRF_INVALID
  });
  assert.equal((await service.requireCsrf(verified.cookie, verified.csrfToken)).userId, USER_ID);
  await assert.rejects(service.verifyChallenge(challenge.id, challenge.nonce, signature), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
});

test("concurrent verification creates exactly one session", async () => {
  const { service, sessions, account } = fixture();
  const challenge = await service.createChallenge(account.address, 10143);
  const signature = await account.signMessage({ message: challenge.message });
  const results = await Promise.allSettled([
    service.verifyChallenge(challenge.id, challenge.nonce, signature),
    service.verifyChallenge(challenge.id, challenge.nonce, signature)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(sessions.records.size, 1);
});

test("challenge crossing expiry during signature verification cannot be consumed", async () => {
  const base = new Date("2026-07-17T05:30:00.000Z");
  let clockReads = 0;
  const challenges = new MemoryChallenges();
  const sessions = new MemorySessions();
  const account = privateKeyToAccount(generatePrivateKey());
  const accounts: WalletAccountResolver = {
    async findOrCreateVerifiedWallet(address, chainId) {
      return { userId: USER_ID, address, chainId };
    }
  };
  const service = new WalletAuthService({
    applicationOrigin: "https://donebond.test",
    sessionSecret: SECRET,
    challenges,
    accounts,
    sessions,
    now: () => {
      clockReads += 1;
      return clockReads < 3 ? base : new Date(base.getTime() + 6 * 60 * 1000);
    }
  });
  const challenge = await service.createChallenge(account.address, 10143);
  const signature = await account.signMessage({ message: challenge.message });
  await assert.rejects(service.verifyChallenge(challenge.id, challenge.nonce, signature), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
  assert.equal(challenges.consumed.has(challenge.id), false);
  assert.equal(sessions.records.size, 0);
});

test("invalid signature does not consume challenge, while nonce tamper and expiry fail", async () => {
  const { service, challenges, account } = fixture();
  const attacker = privateKeyToAccount(generatePrivateKey());
  const challenge = await service.createChallenge(account.address, 10143);
  const attackerSignature = await attacker.signMessage({ message: challenge.message });
  await assert.rejects(service.verifyChallenge(challenge.id, challenge.nonce, attackerSignature), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
  assert.equal(challenges.consumed.has(challenge.id), false);
  const correctSignature = await account.signMessage({ message: challenge.message });
  await assert.rejects(
    service.verifyChallenge(challenge.id, `${challenge.nonce}x`, correctSignature),
    {
      code: ERROR_CODES.AUTH_REQUIRED
    }
  );

  const record = challenges.records.get(challenge.id);
  assert.ok(record);
  challenges.records.set(challenge.id, {
    ...record,
    expiresAt: new Date(record.issuedAt.getTime() - 1)
  });
  await assert.rejects(service.verifyChallenge(challenge.id, challenge.nonce, correctSignature), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
});

test("tampered, expired, and revoked opaque sessions are rejected", async () => {
  const { service, sessions, account } = fixture();
  const challenge = await service.createChallenge(account.address, 10143);
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await service.verifyChallenge(challenge.id, challenge.nonce, signature);
  const tamperedCookie = verified.cookie.replace("donebond_session=", "donebond_session=x");
  await assert.rejects(service.authenticate(tamperedCookie), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
  assert.equal(await service.revoke(verified.cookie), true);
  await assert.rejects(service.authenticate(verified.cookie), { code: ERROR_CODES.AUTH_REQUIRED });

  const next = await service.createChallenge(account.address, 10143);
  const nextSignature = await account.signMessage({ message: next.message });
  const nextVerified = await service.verifyChallenge(next.id, next.nonce, nextSignature);
  const stored = [...sessions.records.values()][0];
  assert.ok(stored);
  sessions.records.set(stored.tokenDigest, { ...stored, idleExpiresAt: new Date(0) });
  await assert.rejects(service.authenticate(nextVerified.cookie), {
    code: ERROR_CODES.AUTH_REQUIRED
  });
});

test("production origin and session secret configuration fail closed", () => {
  const challenges = new MemoryChallenges();
  const sessions = new MemorySessions();
  const accounts: WalletAccountResolver = {
    async findOrCreateVerifiedWallet(address, chainId) {
      return { userId: USER_ID, address, chainId };
    }
  };
  assert.throws(
    () =>
      new WalletAuthService({
        applicationOrigin: "http://donebond.test",
        sessionSecret: SECRET,
        challenges,
        accounts,
        sessions
      }),
    /HTTPS/u
  );
  assert.throws(
    () =>
      new WalletAuthService({
        applicationOrigin: "ftp://localhost",
        sessionSecret: SECRET,
        challenges,
        accounts,
        sessions
      }),
    /HTTPS/u
  );
  assert.throws(
    () =>
      new WalletAuthService({
        applicationOrigin: "https://donebond.test/path",
        sessionSecret: SECRET,
        challenges,
        accounts,
        sessions
      }),
    /path/u
  );
  assert.throws(
    () =>
      new WalletAuthService({
        applicationOrigin: "https://donebond.test",
        sessionSecret: "short",
        challenges,
        accounts,
        sessions
      }),
    /32 random bytes/u
  );
});
