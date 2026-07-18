import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseServiceError } from "@donebond/db";
import { ERROR_CODES } from "@donebond/shared";

import { HttpError } from "./http.ts";
import {
  assertEvidenceMatchesBinding,
  assertNoResidualSecretsInChecks,
  translateEvidenceDatabaseError
} from "./evidence-runtime.ts";

const HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;

test("evidence database errors map without message parsing", () => {
  const cases = [
    ["DB_IDEMPOTENCY_CONFLICT", ERROR_CODES.EVIDENCE_UPLOAD_CONFLICT, 409],
    ["DB_NOT_FOUND", ERROR_CODES.EVIDENCE_NOT_FOUND, 404],
    ["DB_INVALID_INPUT", ERROR_CODES.VALIDATION_INVALID_INPUT, 400]
  ] as const;
  for (const [databaseCode, apiCode, status] of cases) {
    assert.throws(
      () => translateEvidenceDatabaseError(new DatabaseServiceError(databaseCode, "detail")),
      (error) => error instanceof HttpError && error.code === apiCode && error.status === status
    );
  }
  const unknown = new Error("boom");
  assert.throws(
    () => translateEvidenceDatabaseError(unknown),
    (error) => error === unknown
  );
});

test("evidence hash mismatch is rejected against the current task and policy record", () => {
  const binding = { taskHash: HASH, policyHash: HASH };
  assertEvidenceMatchesBinding(
    { task: { publicId: "task", taskHash: HASH }, policy: { policyHash: HASH, sourcePath: "p" } },
    binding
  );
  assert.throws(
    () =>
      assertEvidenceMatchesBinding(
        {
          task: { publicId: "task", taskHash: OTHER_HASH },
          policy: { policyHash: HASH, sourcePath: "p" }
        },
        binding
      ),
    (error) => error instanceof HttpError && error.code === ERROR_CODES.EVIDENCE_HASH_MISMATCH
  );
  assert.throws(
    () =>
      assertEvidenceMatchesBinding(
        {
          task: { publicId: "task", taskHash: HASH },
          policy: { policyHash: OTHER_HASH, sourcePath: "p" }
        },
        binding
      ),
    (error) => error instanceof HttpError && error.code === ERROR_CODES.EVIDENCE_HASH_MISMATCH
  );
});

function check(overrides: { stdout?: string; stderr?: string } = {}) {
  const output = (preview: string) => ({
    preview,
    digest: HASH,
    originalBytes: preview.length,
    truncated: false
  });
  return {
    key: "tests",
    label: "Tests",
    required: true,
    status: "passed" as const,
    startedAt: "2026-07-17T00:00:00.000Z",
    durationMs: 1,
    exitCode: 0,
    stdout: output(overrides.stdout ?? ""),
    stderr: output(overrides.stderr ?? "")
  };
}

test("residual secrets in check output fail closed", () => {
  assertNoResidualSecretsInChecks([check()]);
  assert.throws(
    () => assertNoResidualSecretsInChecks([check({ stdout: "AKIAABCDEFGHIJKLMNOP" })]),
    (error) => error instanceof HttpError && error.code === ERROR_CODES.EVIDENCE_RESIDUAL_SECRET
  );
  assert.throws(
    () => assertNoResidualSecretsInChecks([check({ stderr: "Bearer abcdefghijklmnopqrstuvwx" })]),
    (error) => error instanceof HttpError && error.code === ERROR_CODES.EVIDENCE_RESIDUAL_SECRET
  );
});
