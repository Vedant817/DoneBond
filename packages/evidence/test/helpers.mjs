import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { keccak256, toBytes } from "viem";

const execFileAsync = promisify(execFile);

export const ZERO_HASH = `0x${"0".repeat(64)}`;
export const ONE_HASH = `0x${"1".repeat(64)}`;

export async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, encoding: "utf8" });
}

export async function createGitRepository({ objectFormat } = {}) {
  const root = await temporaryDirectory("donebond-git-");
  const initArgs = ["init", "-b", "main"];
  if (objectFormat) initArgs.push(`--object-format=${objectFormat}`);
  await git(root, ...initArgs);
  await git(root, "config", "user.name", "Evidence Test");
  await git(root, "config", "user.email", "evidence@example.test");
  await git(root, "remote", "add", "origin", "https://user:secret@github.com/Vedant817/sample.git");
  await writeFile(path.join(root, "README.md"), "original\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-m", "test fixture");
  return root;
}

export function validPolicyYaml(overrides = "") {
  return `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches: [main]
  expectedRemoteOwner: Vedant817
checks:
  - key: test
    label: Test
    executable: node
    args: ["--version"]
    cwd: "."
    timeoutSeconds: 10
    required: true
    maxOutputBytes: 4096
    environmentAllowlist: []
environment:
  allow: [PATH]
redaction:
  additionalPatterns: []
${overrides}`;
}

export function passingCheck(overrides = {}) {
  return {
    key: "test",
    label: "Test",
    required: true,
    status: "passed",
    startedAt: "2026-07-17T00:00:00.000Z",
    durationMs: 10,
    exitCode: 0,
    signal: null,
    stdout: {
      preview: "ok\n",
      digest: keccak256(toBytes("ok\n")),
      originalBytes: 3,
      truncated: false
    },
    stderr: {
      preview: "",
      digest: keccak256(toBytes("")),
      originalBytes: 0,
      truncated: false
    },
    ...overrides
  };
}
