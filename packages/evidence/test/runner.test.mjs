import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { getCheckRedactionCounts, runCheck, runChecksSequentially } from "../dist/index.js";
import { temporaryDirectory } from "./helpers.mjs";

function check(overrides = {}) {
  return {
    key: "runner",
    label: "Runner",
    executable: "node",
    args: ["--version"],
    cwd: ".",
    timeoutSeconds: 5,
    required: true,
    maxOutputBytes: 4096,
    environmentAllowlist: [],
    ...overrides
  };
}

function options(root, overrides = {}) {
  return {
    repositoryRoot: root,
    globalEnvironmentAllowlist: ["PATH"],
    environment: { PATH: process.env.PATH },
    ...overrides
  };
}

test("runner preserves spaces and shell metacharacters as literal argv", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const marker = path.join(root, "injected");
  const argument = `$(touch ${marker}); literal with spaces`;
  const result = await runCheck(
    check({ args: ["-e", "process.stdout.write(process.argv[1])", argument] }),
    options(root)
  );
  assert.equal(result.status, "passed");
  assert.match(result.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.stdout.preview, argument);
  await assert.rejects(() => access(marker));
});

test("runner captures nonzero exit and unavailable executables as failures", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const failed = await runCheck(
    check({ args: ["-e", "process.stderr.write('nope'); process.exit(7)"] }),
    options(root)
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.stderr.preview, "nope");
  const missing = await runCheck(
    check({ executable: "donebond-command-that-does-not-exist" }),
    options(root)
  );
  assert.equal(missing.status, "error");
  assert.equal(missing.exitCode, null);
  assert.match(missing.stderr.preview, /executable unavailable/);
});

test("runner enforces output bounds and reports original size", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const result = await runCheck(
    check({ args: ["-e", "process.stdout.write('x'.repeat(50000))"], maxOutputBytes: 1024 }),
    options(root)
  );
  assert.equal(result.status, "passed");
  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stdout.originalBytes, 50000);
  assert.ok(Buffer.byteLength(result.stdout.preview) <= 1024);
});

test("runner fails closed and terminates on absolute capture limit", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const result = await runCheck(
    check({ args: ["-e", "process.stdout.write('x'.repeat(2000000))"], maxOutputBytes: 1024 }),
    options(root)
  );
  assert.equal(result.status, "error");
  assert.equal(result.exitCode, null);
});

test("runner timeout kills the complete child process group", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const marker = path.join(root, "child-survived");
  const childCode = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad'), 1500)`;
  const parentCode = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'ignore'}); setInterval(() => {}, 1000)`;
  const result = await runCheck(
    check({ args: ["-e", parentCode], timeoutSeconds: 1 }),
    options(root)
  );
  assert.equal(result.status, "timed_out");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await assert.rejects(() => access(marker));
  await rm(marker, { force: true });
});

test("runner redacts output before returning and exposes only category counts", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const secret = `ghp_${"abcdefghijklmnopqrstuvwxyz"}${"1234567890"}`;
  const result = await runCheck(
    check({
      args: ["-e", `process.stdout.write(${JSON.stringify(secret)})`],
      timeoutSeconds: 30
    }),
    options(root)
  );
  assert.equal(result.stdout.preview.includes(secret), false);
  assert.match(result.stdout.preview, /REDACTED:github_token/);
  assert.equal(getCheckRedactionCounts(result).github_token, 1);
});

test("sequential runner preserves policy order and emits concise progress", async () => {
  const root = await temporaryDirectory("donebond-runner-");
  const events = [];
  const policy = {
    schemaVersion: 1,
    repository: { requireCleanWorkingTree: true, allowedBranches: ["main"] },
    checks: [check({ key: "first" }), check({ key: "second" })],
    environment: { allow: ["PATH"] },
    redaction: { additionalPatterns: [] }
  };
  const results = await runChecksSequentially(policy, {
    repositoryRoot: root,
    environment: { PATH: process.env.PATH },
    onProgress: (event) => events.push(`${event.type}:${event.key}`)
  });
  assert.deepEqual(
    results.map((result) => result.key),
    ["first", "second"]
  );
  assert.deepEqual(events, [
    "check-started:first",
    "check-finished:first",
    "check-started:second",
    "check-finished:second"
  ]);
});
