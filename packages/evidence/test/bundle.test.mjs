import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildEvidenceBundle,
  canonicalJson,
  deriveCommitHash,
  hashCanonicalTask,
  parsePolicyText,
  verifyBundle,
  writeEvidenceBundle
} from "../dist/index.js";
import { ONE_HASH, passingCheck, temporaryDirectory, validPolicyYaml } from "./helpers.mjs";

function gitState(overrides = {}) {
  const objectId = "a".repeat(40);
  return {
    repositoryRoot: "/private/local/repository",
    remote: "github.com/vedant817/sample",
    branch: "main",
    detached: false,
    objectId,
    treeId: "b".repeat(40),
    derivedCommitHash: deriveCommitHash(objectId),
    author: { name: "Private Author", email: "private@example.test" },
    committer: { name: "Private Committer", email: "private@example.test" },
    committedAt: "2026-07-17T00:00:00.000Z",
    staged: [],
    unstaged: [],
    untracked: [],
    changedFiles: [],
    changedFilesTruncated: false,
    clean: true,
    baseCommitVerified: null,
    constraintFailures: [],
    ...overrides
  };
}

async function fixture() {
  const root = await temporaryDirectory("donebond-bundle-");
  const policy = parsePolicyText(validPolicyYaml(), {
    repositoryRoot: root,
    sourcePath: "donebond.policy.yml"
  });
  const built = buildEvidenceBundle({
    task: { publicId: "task_vector", taskHash: ONE_HASH },
    policy,
    git: gitState(),
    checks: [passingCheck()],
    tool: {
      name: "donebond-cli",
      version: "1.0.0",
      platform: "test-platform",
      nodeVersion: "v24.14.0"
    }
  });
  return { root, policy, built };
}

test("RFC 8785 canonical JSON ignores key insertion order and rejects unsafe numbers", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, x: 3 } }),
    canonicalJson({ a: { x: 3, y: 2 }, z: 1 })
  );
  assert.throws(() => canonicalJson({ unsafe: Number.MAX_SAFE_INTEGER + 1 }), {
    code: "BUNDLE_INVALID"
  });
  assert.throws(() => canonicalJson({ missing: undefined }), { code: "BUNDLE_INVALID" });
});

test("task and Git commitments are domain-separated and stable", () => {
  const task = {
    kind: "donebond.task",
    schemaVersion: 1,
    projectPublicId: "project_vector",
    repositoryIdentity: "github.com/vedant817/sample",
    targetBranch: "main",
    baseCommit: null,
    title: "Canonical task",
    description: "Prove the exact result",
    acceptanceCriteria: [{ key: "tests", description: "All tests pass" }],
    assigneeWallet: "0x1111111111111111111111111111111111111111",
    deadlineUnixSeconds: "1784246400",
    rewardWei: "1000000000000000000",
    policyHash: ONE_HASH
  };
  assert.match(hashCanonicalTask(task), /^0x[0-9a-f]{64}$/);
  assert.notEqual(hashCanonicalTask(task), deriveCommitHash("a".repeat(40)));
});

test("bundle derives passing status and independent verification reproduces evidence hash", async () => {
  const { policy, built } = await fixture();
  assert.equal(built.bundle.result.passing, true);
  assert.equal(built.bundle.result.requiredPassed, 1);
  assert.equal(built.canonicalJson.includes("Private Author"), false);
  const verified = verifyBundle(built.bundle, {
    policy,
    taskHash: ONE_HASH,
    policyHash: policy.policyHash,
    evidenceHash: built.evidenceHash,
    commitHash: built.bundle.git.derivedCommitHash
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.evidenceHash, built.evidenceHash);
});

test("failed required check and dirty Git state can never produce passing evidence", async () => {
  const root = await temporaryDirectory("donebond-bundle-");
  const policy = parsePolicyText(validPolicyYaml(), { repositoryRoot: root });
  const failed = passingCheck({
    status: "failed",
    exitCode: 2,
    stdout: {
      ...passingCheck().stdout,
      preview: "",
      digest: passingCheck().stderr.digest,
      originalBytes: 0
    }
  });
  const built = buildEvidenceBundle({
    task: { publicId: "task_failed", taskHash: ONE_HASH },
    policy,
    git: gitState({
      clean: false,
      changedFiles: [{ path: "src/index.ts", pathDigest: ONE_HASH }],
      constraintFailures: ["GIT_DIRTY"]
    }),
    checks: [failed],
    tool: { name: "donebond-cli", version: "1", platform: "test", nodeVersion: "v24" }
  });
  assert.equal(built.bundle.result.passing, false);
  assert.deepEqual(built.bundle.result.failureCodes, ["CHECK_FAILED:test", "GIT_DIRTY"]);
});

test("builder and verifier reject missing, duplicate, unknown, and mismatched checks", async () => {
  const { policy, built } = await fixture();
  for (const checks of [[], [passingCheck(), passingCheck()], [passingCheck({ key: "unknown" })]]) {
    assert.throws(
      () =>
        buildEvidenceBundle({
          task: { publicId: "task_vector", taskHash: ONE_HASH },
          policy,
          git: gitState(),
          checks,
          tool: { name: "donebond-cli", version: "1", platform: "test", nodeVersion: "v24" }
        }),
      { code: "BUNDLE_INVALID" }
    );
  }
  const duplicate = structuredClone(built.bundle);
  duplicate.checks.push(structuredClone(duplicate.checks[0]));
  assert.throws(() => verifyBundle(duplicate, { policy }), { code: "BUNDLE_INVALID" });
});

test("verifier rejects schema, exit-code, output, task, commit, and evidence mutations", async () => {
  const { policy, built } = await fixture();
  const mutations = [
    (bundle) => {
      bundle.schemaVersion = 2;
    },
    (bundle) => {
      bundle.checks[0].exitCode = 7;
    },
    (bundle) => {
      bundle.checks[0].stdout.preview = "altered";
    },
    (bundle) => {
      bundle.git.derivedCommitHash = ONE_HASH;
    }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(built.bundle);
    mutate(changed);
    assert.throws(() => verifyBundle(changed, { policy, evidenceHash: built.evidenceHash }));
  }
  assert.throws(() => verifyBundle(built.bundle, { policy, taskHash: `0x${"2".repeat(64)}` }), {
    code: "BUNDLE_HASH_MISMATCH"
  });
  assert.throws(() => verifyBundle(built.bundle, { policy, evidenceHash: `0x${"3".repeat(64)}` }), {
    code: "BUNDLE_HASH_MISMATCH"
  });
});

test("pretty bundle writer is atomic, restrictive, and hash-neutral", async () => {
  const { root, policy, built } = await fixture();
  const output = path.join(root, "evidence", "bundle.json");
  await writeEvidenceBundle(output, built.bundle);
  const text = await readFile(output, "utf8");
  assert.match(text, /^\{\n  "schemaVersion"/);
  const mode = (await stat(output)).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(verifyBundle(JSON.parse(text), { policy }).evidenceHash, built.evidenceHash);
});

test("frozen v1 fixtures reproduce all four commitment vectors", async () => {
  const fixtureDirectory = path.join(import.meta.dirname, "fixtures");
  const vectors = JSON.parse(
    await readFile(path.join(fixtureDirectory, "commitment-vectors-v1.json"), "utf8")
  );
  const evidence = JSON.parse(
    await readFile(path.join(fixtureDirectory, "evidence-bundle-v1.json"), "utf8")
  );
  const root = await temporaryDirectory("donebond-vector-");
  const policy = parsePolicyText(validPolicyYaml(), {
    repositoryRoot: root,
    sourcePath: "donebond.policy.yml"
  });
  assert.equal(hashCanonicalTask(vectors.canonicalTask), vectors.taskHash);
  assert.equal(policy.policyHash, vectors.policyHash);
  assert.equal(deriveCommitHash(evidence.git.objectId), vectors.commitHash);
  assert.equal(
    verifyBundle(evidence, {
      policy,
      taskHash: evidence.task.taskHash,
      policyHash: vectors.policyHash,
      commitHash: vectors.commitHash,
      evidenceHash: vectors.evidenceHash
    }).evidenceHash,
    vectors.evidenceHash
  );
});

test("builder and verifier reject passing claims on a policy-disallowed branch", async () => {
  const { policy, built } = await fixture();
  assert.throws(
    () =>
      buildEvidenceBundle({
        task: { publicId: "task_vector", taskHash: ONE_HASH },
        policy,
        git: gitState({ branch: "untrusted" }),
        checks: [passingCheck()],
        tool: { name: "donebond-cli", version: "1", platform: "test", nodeVersion: "v24" }
      }),
    { code: "BUNDLE_INVALID" }
  );
  const forged = structuredClone(built.bundle);
  forged.git.branch = "untrusted";
  assert.throws(() => verifyBundle(forged, { policy }), { code: "BUNDLE_INVALID" });
});

test("base commit policy fails closed without independently collected ancestry context", async () => {
  const root = await temporaryDirectory("donebond-base-");
  const policy = parsePolicyText(
    validPolicyYaml().replace(
      "expectedRemoteOwner: Vedant817",
      `expectedRemoteOwner: Vedant817\n  baseCommit: ${"a".repeat(40)}`
    ),
    { repositoryRoot: root }
  );
  assert.throws(
    () =>
      buildEvidenceBundle({
        task: { publicId: "task_base", taskHash: ONE_HASH },
        policy,
        git: gitState(),
        checks: [passingCheck()],
        tool: { name: "donebond-cli", version: "1", platform: "test", nodeVersion: "v24" }
      }),
    { code: "BUNDLE_INVALID" }
  );
  const state = gitState({ baseCommitVerified: true });
  const built = buildEvidenceBundle({
    task: { publicId: "task_base", taskHash: ONE_HASH },
    policy,
    git: state,
    checks: [passingCheck()],
    tool: { name: "donebond-cli", version: "1", platform: "test", nodeVersion: "v24" }
  });
  assert.throws(() => verifyBundle(built.bundle, { policy }), { code: "BUNDLE_INVALID" });
  assert.equal(verifyBundle(built.bundle, { policy, gitState: state }).verified, true);
});
