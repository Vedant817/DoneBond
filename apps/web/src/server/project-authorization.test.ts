import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import { HttpError } from "./http.ts";
import {
  requireProjectAccess,
  type ProjectAccessStore,
  type SessionAuthenticator
} from "./project-authorization.ts";

const PROJECT = "01arz3ndektsv4rrffq69g5fav";
const USER = "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e001";

function authenticator(authenticated = true): SessionAuthenticator {
  return {
    async authenticate() {
      if (!authenticated) {
        throw new HttpError(ERROR_CODES.AUTH_REQUIRED, "A valid session is required", 401);
      }
      return {
        sessionId: "018f4f6c-5b5a-4b4f-8a8b-7d3d6f95e002",
        userId: USER,
        address: "0x1111111111111111111111111111111111111111",
        chainId: 10143,
        absoluteExpiresAt: new Date("2026-07-18T00:00:00Z")
      };
    }
  };
}

function store(role: "owner" | "member" | null): ProjectAccessStore {
  return {
    async findProjectAccess(projectPublicId, userId) {
      assert.equal(projectPublicId, PROJECT);
      assert.equal(userId, USER);
      return role === null ? null : { projectPublicId, role };
    }
  };
}

test("owner and member authorization matrix is explicit", async () => {
  assert.equal(
    (await requireProjectAccess(authenticator(), store("owner"), null, PROJECT)).access.role,
    "owner"
  );
  assert.equal(
    (await requireProjectAccess(authenticator(), store("member"), null, PROJECT)).access.role,
    "member"
  );
  assert.equal(
    (await requireProjectAccess(authenticator(), store("owner"), null, PROJECT, "owner")).access
      .role,
    "owner"
  );
  await assert.rejects(
    requireProjectAccess(authenticator(), store("member"), null, PROJECT, "owner"),
    {
      code: ERROR_CODES.AUTH_FORBIDDEN,
      status: 403
    }
  );
});

test("nonmembers, missing projects, and malformed IDs share a not-found boundary", async () => {
  await assert.rejects(requireProjectAccess(authenticator(), store(null), null, PROJECT), {
    code: ERROR_CODES.PROJECT_NOT_FOUND,
    status: 404
  });
  await assert.rejects(requireProjectAccess(authenticator(), store(null), null, "Not A Project"), {
    code: ERROR_CODES.PROJECT_NOT_FOUND,
    status: 404
  });
  await assert.rejects(requireProjectAccess(authenticator(), store(null), null, "abc"), {
    code: ERROR_CODES.PROJECT_NOT_FOUND,
    status: 404
  });
});

test("authentication is required before project lookup", async () => {
  let queried = false;
  const accessStore: ProjectAccessStore = {
    async findProjectAccess() {
      queried = true;
      return null;
    }
  };
  await assert.rejects(requireProjectAccess(authenticator(false), accessStore, null, PROJECT), {
    code: ERROR_CODES.AUTH_REQUIRED,
    status: 401
  });
  await assert.rejects(
    requireProjectAccess(authenticator(false), accessStore, null, "Not A Project"),
    { code: ERROR_CODES.AUTH_REQUIRED, status: 401 }
  );
  assert.equal(queried, false);
});

test("unknown roles and mismatched adapter results fail closed", async () => {
  await assert.rejects(
    requireProjectAccess(
      authenticator(),
      store("member"),
      null,
      PROJECT,
      "administrator" as "owner"
    ),
    { code: ERROR_CODES.AUTH_FORBIDDEN, status: 403 }
  );
  const mismatched: ProjectAccessStore = {
    async findProjectAccess() {
      return { projectPublicId: "01arz3ndektsv4rrffq69g5fay", role: "owner" };
    }
  };
  await assert.rejects(requireProjectAccess(authenticator(), mismatched, null, PROJECT), {
    code: ERROR_CODES.PROJECT_NOT_FOUND,
    status: 404
  });
});
