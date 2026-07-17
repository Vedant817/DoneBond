import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  parseCreateProjectInput,
  parsePolicyUploadInput,
  parseUpdateProjectInput
} from "./project-policy-input.ts";

const POLICY = `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches: [main]
checks:
  - key: test
    label: Tests
    executable: pnpm
    args: [test]
    cwd: .
    timeoutSeconds: 120
    required: true
    maxOutputBytes: 32768
    environmentAllowlist: []
environment:
  allow: []
redaction:
  additionalPatterns: []
`;

test("project creation normalizes safe GitHub metadata", () => {
  assert.deepEqual(
    parseCreateProjectInput({
      slug: "done-bond",
      name: " DoneBond ",
      repositoryUrl: "https://GitHub.com/Vedant817/DoneBond.git",
      defaultBranch: "feat/api",
      visibility: "private"
    }),
    {
      slug: "done-bond",
      name: "DoneBond",
      repositoryUrl: "https://github.com/vedant817/donebond",
      defaultBranch: "feat/api",
      visibility: "private"
    }
  );
});

test("project metadata rejects credentials, non-GitHub remotes, unsafe branches, and extras", () => {
  const base = {
    slug: "donebond",
    name: "DoneBond",
    repositoryUrl: "https://github.com/Vedant817/DoneBond",
    defaultBranch: "main",
    visibility: "public"
  };
  for (const changed of [
    { repositoryUrl: "https://token@github.com/Vedant817/DoneBond" },
    { repositoryUrl: "https://gitlab.com/Vedant817/DoneBond" },
    { defaultBranch: "../main" },
    { defaultBranch: "main.lock" },
    { slug: "Not-Normalized" },
    { unexpected: true }
  ]) {
    assert.throws(() => parseCreateProjectInput({ ...base, ...changed }), {
      code: ERROR_CODES.VALIDATION_INVALID_INPUT
    });
  }
});

test("project updates require a strict nonempty mutable field set", () => {
  assert.deepEqual(parseUpdateProjectInput({ status: "archived", name: "Archived project" }), {
    status: "archived",
    name: "Archived project"
  });
  for (const value of [{}, { slug: "new-slug" }, { status: "deleted" }]) {
    assert.throws(() => parseUpdateProjectInput(value), {
      code: ERROR_CODES.VALIDATION_INVALID_INPUT
    });
  }
});

test("policy uploads canonicalize safe YAML and reproduce its hash", () => {
  const result = parsePolicyUploadInput({
    sourcePath: ".donebond/policy.yml",
    yaml: POLICY,
    activate: true
  });
  assert.equal(
    result.parsed.policyHash,
    result.parsed.policy.policyHash ?? result.parsed.policyHash
  );
  assert.match(result.parsed.policyHash, /^0x[0-9a-f]{64}$/u);
  assert.equal(result.parsed.canonicalPolicy.kind, "donebond.policy");
  assert.equal(result.activate, true);
});

test("policy uploads reject traversal, unsafe commands, malformed YAML, and oversized text", () => {
  for (const sourcePath of ["../policy.yml", ".", "policy//v1.yml", "policy\nname.yml"]) {
    assert.throws(() => parsePolicyUploadInput({ sourcePath, yaml: POLICY, activate: false }), {
      code: ERROR_CODES.POLICY_PATH_OUTSIDE_REPOSITORY
    });
  }
  assert.throws(
    () =>
      parsePolicyUploadInput({
        sourcePath: "policy.yml",
        yaml: POLICY.replace("executable: pnpm", "executable: bash"),
        activate: false
      }),
    { code: ERROR_CODES.POLICY_UNSAFE_COMMAND }
  );
  assert.throws(
    () => parsePolicyUploadInput({ sourcePath: "policy.yml", yaml: "not: [yaml", activate: false }),
    { code: ERROR_CODES.POLICY_INVALID }
  );
  assert.throws(
    () =>
      parsePolicyUploadInput({
        sourcePath: "policy.yml",
        yaml: "x".repeat(131_073),
        activate: false
      }),
    { code: ERROR_CODES.VALIDATION_INVALID_INPUT }
  );
});
