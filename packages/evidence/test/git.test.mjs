import assert from "node:assert/strict";
import { appendFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  collectGitState,
  deriveCommitHash,
  findRepositoryRoot,
  toPublicGitEvidence
} from "../dist/index.js";
import { createGitRepository, git, temporaryDirectory } from "./helpers.mjs";

test("collector captures a clean exact commit and strips remote credentials", async () => {
  const root = await createGitRepository();
  const state = await collectGitState({
    cwd: path.join(root),
    policy: {
      schemaVersion: 1,
      repository: {
        requireCleanWorkingTree: true,
        allowedBranches: ["main", "feat/*"],
        expectedRemoteOwner: "Vedant817"
      },
      checks: [],
      environment: { allow: [] },
      redaction: { additionalPatterns: [] }
    }
  });
  assert.equal(state.repositoryRoot, await realpath(root));
  assert.equal(state.remote, "github.com/vedant817/sample");
  assert.equal(state.clean, true);
  assert.equal(state.detached, false);
  assert.equal(state.objectId.length, 40);
  assert.equal(state.treeId.length, 40);
  assert.equal(state.derivedCommitHash, deriveCommitHash(state.objectId));
  assert.equal(state.author.name, "Evidence Test");
  assert.equal(state.committer.email, "evidence@example.test");
  assert.match(state.committedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(state.constraintFailures, []);
  assert.equal(state.baseCommitVerified, null);
  const publicState = toPublicGitEvidence(state);
  assert.equal("author" in publicState, false);
  assert.equal(JSON.stringify(publicState).includes("evidence@example.test"), false);
});

test("collector distinguishes staged, unstaged, and untracked files", async () => {
  const root = await createGitRepository();
  await appendFile(path.join(root, "README.md"), "staged\n");
  await git(root, "add", "README.md");
  await appendFile(path.join(root, "README.md"), "unstaged\n");
  await writeFile(path.join(root, "new file.txt"), "untracked\n");
  const state = await collectGitState({ cwd: root });
  assert.equal(state.clean, false);
  assert.deepEqual(
    state.staged.map((file) => file.path),
    ["README.md"]
  );
  assert.deepEqual(
    state.unstaged.map((file) => file.path),
    ["README.md"]
  );
  assert.deepEqual(
    state.untracked.map((file) => file.path),
    ["new file.txt"]
  );
  assert.deepEqual(
    state.changedFiles.map((file) => file.path),
    ["README.md", "new file.txt"]
  );
});

test("collector handles detached HEAD and validates the expected commit", async () => {
  const root = await createGitRepository();
  const state = await collectGitState({ cwd: root });
  await git(root, "checkout", "--detach", state.objectId);
  const detached = await collectGitState({ cwd: root, expectedCommit: state.objectId });
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, "DETACHED");
  await assert.rejects(() => collectGitState({ cwd: root, expectedCommit: "f".repeat(40) }), {
    code: "GIT_COMMIT_MISMATCH"
  });
});

test("collector rejects repositories with no commits or no supported remote", async () => {
  const empty = await temporaryDirectory("donebond-empty-git-");
  await git(empty, "init", "-b", "main");
  await assert.rejects(() => collectGitState({ cwd: empty }), { code: "GIT_NO_COMMITS" });
  const root = await createGitRepository();
  await git(root, "remote", "remove", "origin");
  await assert.rejects(() => collectGitState({ cwd: root }), { code: "GIT_REMOTE_INVALID" });
  const outside = await temporaryDirectory("donebond-not-git-");
  await assert.rejects(() => findRepositoryRoot(outside), { code: "GIT_NOT_REPOSITORY" });
});

test("collector supports SHA-256 repositories when local Git supports the format", async (t) => {
  let root;
  try {
    root = await createGitRepository({ objectFormat: "sha256" });
  } catch {
    t.skip("installed Git lacks SHA-256 repository support");
    return;
  }
  const state = await collectGitState({ cwd: root });
  assert.equal(state.objectId.length, 64);
  assert.equal(state.treeId.length, 64);
  assert.match(state.derivedCommitHash, /^0x[0-9a-f]{64}$/);
});

test("collector recognizes the repository-approved personal SSH host alias", async () => {
  const root = await createGitRepository();
  await git(root, "remote", "set-url", "origin", "git@github-personal:Vedant817/sample.git");
  assert.equal((await collectGitState({ cwd: root })).remote, "github.com/vedant817/sample");
});

test("collector verifies configured base-commit ancestry in repository context", async () => {
  const root = await createGitRepository();
  const initial = await collectGitState({ cwd: root });
  const basePolicy = {
    schemaVersion: 1,
    repository: {
      requireCleanWorkingTree: true,
      allowedBranches: ["main"],
      baseCommit: initial.objectId
    },
    checks: [],
    environment: { allow: [] },
    redaction: { additionalPatterns: [] }
  };
  assert.equal((await collectGitState({ cwd: root, policy: basePolicy })).baseCommitVerified, true);
  const wrongPolicy = {
    ...basePolicy,
    repository: { ...basePolicy.repository, baseCommit: "f".repeat(40) }
  };
  const wrong = await collectGitState({ cwd: root, policy: wrongPolicy });
  assert.equal(wrong.baseCommitVerified, false);
  assert.deepEqual(wrong.constraintFailures, ["GIT_BASE_COMMIT_MISMATCH"]);
});
