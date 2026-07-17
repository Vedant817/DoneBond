import assert from "node:assert/strict";
import { mkdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parsePolicyText, resolveExistingRepositoryPath } from "../dist/index.js";
import { temporaryDirectory, validPolicyYaml } from "./helpers.mjs";

test("strict policy parser returns a canonical stable hash", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  const first = parsePolicyText(validPolicyYaml(), {
    repositoryRoot: root,
    sourcePath: "policy.yml"
  });
  const reordered = parsePolicyText(
    `redaction:
  additionalPatterns: []
environment:
  allow: [PATH]
checks:
  - maxOutputBytes: 4096
    required: true
    timeoutSeconds: 10
    cwd: "."
    args: ["--version"]
    executable: node
    label: Test
    key: test
    environmentAllowlist: []
repository:
  expectedRemoteOwner: Vedant817
  allowedBranches: [main]
  requireCleanWorkingTree: true
schemaVersion: 1
`,
    { repositoryRoot: root, sourcePath: "policy.yml" }
  );
  assert.equal(first.policyHash, reordered.policyHash);
  assert.equal(first.canonicalJson, reordered.canonicalJson);
  assert.match(first.policyHash, /^0x[0-9a-f]{64}$/);
});

test("policy parser rejects malformed YAML, duplicate keys, unknown fields, and versions", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  const invalid = [
    "schemaVersion: [",
    validPolicyYaml("schemaVersion: 1\n"),
    validPolicyYaml("unknown: true\n"),
    validPolicyYaml().replace("schemaVersion: 1", "schemaVersion: 2")
  ];
  for (const text of invalid) {
    assert.throws(
      () => parsePolicyText(text, { repositoryRoot: root, sourcePath: "policy.yml" }),
      (error) => error.code === "POLICY_INVALID" && error.message.includes("policy.yml")
    );
  }
});

test("policy parser rejects traversal, shell wrappers, unsafe executable syntax, and NUL", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  const cases = [
    validPolicyYaml().replace('cwd: "."', 'cwd: "../outside"'),
    validPolicyYaml().replace("executable: node", "executable: bash"),
    validPolicyYaml().replace("executable: node", 'executable: "node;rm"'),
    validPolicyYaml().replace('args: ["--version"]', 'args: ["bad\\0arg"]')
  ];
  for (const text of cases) {
    assert.throws(
      () => parsePolicyText(text, { repositoryRoot: root }),
      (error) =>
        ["POLICY_PATH_OUTSIDE_REPOSITORY", "POLICY_UNSAFE_COMMAND", "POLICY_INVALID"].includes(
          error.code
        )
    );
  }
});

test("runtime cwd resolution rejects a symlink escaping the repository", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  const outside = await temporaryDirectory("donebond-outside-");
  await mkdir(path.join(root, "safe"));
  await symlink(outside, path.join(root, "escape"));
  await assert.rejects(() => resolveExistingRepositoryPath(root, "escape"), {
    code: "POLICY_PATH_OUTSIDE_REPOSITORY"
  });
  assert.equal(
    await resolveExistingRepositoryPath(root, "safe"),
    await realpath(path.join(root, "safe"))
  );
});

test("declared policy hash must match recomputation", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  const text = validPolicyYaml().replace(
    "redaction:",
    `policyHash: "0x${"0".repeat(64)}"\nredaction:`
  );
  assert.throws(() => parsePolicyText(text, { repositoryRoot: root }), {
    code: "POLICY_HASH_MISMATCH"
  });
});

test("project redaction patterns reject empty matches and risky grouped repetition", async () => {
  const root = await temporaryDirectory("donebond-policy-");
  for (const unsafe of ["a*", "(a+)+$"]) {
    const text = validPolicyYaml().replace(
      "additionalPatterns: []",
      `additionalPatterns: [${JSON.stringify(unsafe)}]`
    );
    assert.throws(() => parsePolicyText(text, { repositoryRoot: root }), {
      code: "POLICY_INVALID"
    });
  }
});
