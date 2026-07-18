import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseServiceError } from "@donebond/db";
import { ERROR_CODES } from "@donebond/shared";

import { HttpError } from "./http.ts";
import { translateReceiptDatabaseError } from "./receipt-runtime.ts";

test("receipt database errors map to stable API codes without message parsing", () => {
  const taskCases = [
    ["DB_IDEMPOTENCY_CONFLICT", ERROR_CODES.IDEMPOTENCY_CONFLICT, 409],
    ["DB_PROJECT_ARCHIVED", ERROR_CODES.INVALID_STATE, 409],
    ["DB_NOT_FOUND", ERROR_CODES.TASK_NOT_FOUND, 404],
    ["DB_CONFLICT", ERROR_CODES.INVALID_STATE, 409],
    ["DB_INVALID_INPUT", ERROR_CODES.VALIDATION_INVALID_INPUT, 400]
  ] as const;
  for (const [databaseCode, apiCode, status] of taskCases) {
    assert.throws(
      () => translateReceiptDatabaseError(new DatabaseServiceError(databaseCode, "detail"), "task"),
      (error) => error instanceof HttpError && error.code === apiCode && error.status === status
    );
  }
  assert.throws(
    () =>
      translateReceiptDatabaseError(
        new DatabaseServiceError("DB_NOT_FOUND", "detail"),
        "transaction"
      ),
    (error) =>
      error instanceof HttpError &&
      error.code === ERROR_CODES.CHAIN_TRANSACTION_NOT_FOUND &&
      error.status === 404
  );
  const unknown = new Error("boom");
  assert.throws(
    () => translateReceiptDatabaseError(unknown, "task"),
    (error) => error === unknown
  );
});
