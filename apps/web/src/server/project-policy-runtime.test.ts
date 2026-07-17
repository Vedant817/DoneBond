import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseServiceError } from "@donebond/db";
import { ERROR_CODES } from "@donebond/shared";

import { HttpError } from "./http.ts";
import { translateProjectPolicyDatabaseError } from "./project-policy-runtime.ts";

test("project and policy database errors map without message parsing", () => {
  const cases = [
    ["DB_IDEMPOTENCY_CONFLICT", ERROR_CODES.IDEMPOTENCY_CONFLICT, 409],
    ["DB_PROJECT_SLUG_CONFLICT", ERROR_CODES.PROJECT_SLUG_CONFLICT, 409],
    ["DB_POLICY_HASH_CONFLICT", ERROR_CODES.POLICY_ALREADY_EXISTS, 409],
    ["DB_PROJECT_ARCHIVED", ERROR_CODES.INVALID_STATE, 409],
    ["DB_REPOSITORY_IMMUTABLE", ERROR_CODES.INVALID_STATE, 409]
  ] as const;
  for (const [databaseCode, apiCode, status] of cases) {
    assert.throws(
      () =>
        translateProjectPolicyDatabaseError(
          new DatabaseServiceError(databaseCode, "sensitive database detail"),
          "project"
        ),
      (error) => error instanceof HttpError && error.code === apiCode && error.status === status
    );
  }
  assert.throws(
    () =>
      translateProjectPolicyDatabaseError(
        new DatabaseServiceError("DB_NOT_FOUND", "detail"),
        "policy"
      ),
    { code: ERROR_CODES.POLICY_NOT_FOUND, status: 404 }
  );
});
