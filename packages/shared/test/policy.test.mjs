import assert from "node:assert/strict";
import test from "node:test";

import { VerificationPolicySchema } from "../dist/index.js";

const CHECK = {
  key: "tests",
  label: "Tests",
  executable: "pnpm",
  args: ["test"],
  cwd: ".",
  timeoutSeconds: 120,
  required: true,
  maxOutputBytes: 65_536,
  environmentAllowlist: []
};

const POLICY = {
  schemaVersion: 1,
  repository: { requireCleanWorkingTree: true, allowedBranches: ["main"] },
  checks: [CHECK],
  environment: { allow: ["CI"] },
  redaction: { additionalPatterns: [] }
};

test("accepts exact Git object IDs and rejects ambiguous lengths", () => {
  assert.equal(VerificationPolicySchema.safeParse(POLICY).success, true);
  assert.equal(
    VerificationPolicySchema.safeParse({
      ...POLICY,
      repository: { ...POLICY.repository, baseCommit: "a".repeat(41) }
    }).success,
    false
  );
});

test("rejects duplicate policy identifiers and allowlist entries", () => {
  assert.equal(
    VerificationPolicySchema.safeParse({ ...POLICY, checks: [CHECK, CHECK] }).success,
    false
  );
  assert.equal(
    VerificationPolicySchema.safeParse({
      ...POLICY,
      environment: { allow: ["CI", "CI"] }
    }).success,
    false
  );
  assert.equal(
    VerificationPolicySchema.safeParse({
      ...POLICY,
      checks: [{ ...CHECK, required: false }]
    }).success,
    false
  );
});
