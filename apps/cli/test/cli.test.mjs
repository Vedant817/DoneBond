import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import test from "node:test";

import { hashCanonicalTask, parsePolicyFile } from "@donebond/evidence";

import { ExitCode, initializeRepository, runCli } from "../dist/index.js";
import { loadConnection, storeConnection, validateConnection } from "../dist/config.js";

const execFile = promisify(execFileCallback);

async function temporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function gitRepository() {
  const root = await temporaryDirectory("donebond-cli-git-");
  await execFile("git", ["init", "--quiet", root]);
  return root;
}

function captureStream() {
  let value = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      value += chunk.toString();
      callback();
    }
  });
  return { stream, value: () => value };
}

async function withApiServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function taskFixture(policyHash, overrides = {}) {
  const task = {
    schemaVersion: 1,
    publicId: "task_123",
    projectPublicId: "project_123",
    chainId: 10143,
    chainTaskId: null,
    title: "Verify the implementation",
    description: "Run the deterministic DoneBond policy.",
    repositoryUrl: "https://github.com/Vedant817/example.git",
    targetBranch: "main",
    baseCommit: null,
    acceptanceCriteria: [{ key: "tests", description: "All required checks pass." }],
    policyHash,
    creatorWallet: "0x1111111111111111111111111111111111111111",
    assigneeWallet: "0x2222222222222222222222222222222222222222",
    rewardWei: "0",
    deadline: null,
    offchainStatus: "open",
    chainStatus: "open",
    createdAt: "2026-07-17T05:30:00.000Z",
    updatedAt: "2026-07-17T05:30:00.000Z",
    ...overrides
  };
  const taskHash = Object.hasOwn(overrides, "taskHash")
    ? overrides.taskHash
    : hashCanonicalTask({
        kind: "donebond.task",
        schemaVersion: 1,
        projectPublicId: task.projectPublicId,
        repositoryIdentity: `${new URL(task.repositoryUrl).hostname}/${new URL(task.repositoryUrl).pathname.replace(/^\/+|\.git$/gu, "")}`,
        targetBranch: task.targetBranch,
        baseCommit: task.baseCommit,
        title: task.title,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        assigneeWallet: task.assigneeWallet,
        deadlineUnixSeconds: null,
        rewardWei: task.rewardWei,
        policyHash: task.policyHash
      });
  return { ...task, taskHash };
}

async function verificationFixture(exitCode = 0, taskOverrides = {}, script) {
  const root = await gitRepository();
  await execFile("git", ["-C", root, "branch", "-M", "main"]);
  await initializeRepository({ startDirectory: root, force: false });
  const policyText = `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches: [main]
  expectedRemoteOwner: Vedant817
checks:
  - key: test
    label: Test
    executable: node
    args: ["-e", ${JSON.stringify(script ?? `process.exit(${exitCode})`)}]
    cwd: .
    timeoutSeconds: 10
    required: true
    maxOutputBytes: 4096
    environmentAllowlist: [PATH]
environment:
  allow: [PATH]
redaction:
  additionalPatterns: []
`;
  await writeFile(join(root, ".donebond", "policy.yml"), policyText, "utf8");
  await writeFile(join(root, "implementation.txt"), "verified content\n", "utf8");
  await execFile("git", ["-C", root, "config", "user.name", "DoneBond Test"]);
  await execFile("git", ["-C", root, "config", "user.email", "donebond-test@example.invalid"]);
  await execFile("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "git@github.com:Vedant817/example.git"
  ]);
  await execFile("git", ["-C", root, "add", "."]);
  await execFile("git", ["-C", root, "commit", "--quiet", "-m", "test fixture"]);
  const commit = (await execFile("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  const policy = await parsePolicyFile(join(root, ".donebond", "policy.yml"), root);
  const task = taskFixture(policy.policyHash, taskOverrides);
  await writeFile(join(root, ".donebond", "task.json"), `${JSON.stringify(task, null, 2)}\n`, {
    mode: 0o600
  });
  return { root, commit, task };
}

test("help, version, JSON errors, and stable exit codes contain no secret input", async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.bin.donebond, "./dist/index.js");
  const stdout = captureStream();
  const stderr = captureStream();
  assert.equal(
    await runCli(["--help"], { stdout: stdout.stream, stderr: stderr.stream }),
    ExitCode.Success
  );
  assert.match(stdout.value(), /Usage:/);
  assert.match(stdout.value(), /Exit codes:/);

  const version = captureStream();
  assert.equal(
    await runCli(["--version"], { stdout: version.stream, stderr: stderr.stream }),
    ExitCode.Success
  );
  assert.equal(version.value().trim(), "0.0.0");

  const jsonError = captureStream();
  const dummySecret = "dbt_dummy_test_only_value_that_must_not_leak";
  const code = await runCli([dummySecret, "--json"], {
    stdout: captureStream().stream,
    stderr: jsonError.stream
  });
  assert.equal(code, ExitCode.Usage);
  const parsed = JSON.parse(jsonError.value());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "CLI_USAGE");
  assert.equal(jsonError.value().includes(dummySecret), false);

  const executable = await execFile(process.execPath, [
    join(process.cwd(), "dist", "index.js"),
    "--help"
  ]);
  assert.match(executable.stdout, /DoneBond CLI/);
});

test("offline init discovers a nested Git repository and creates a legitimate policy", async () => {
  const root = await gitRepository();
  const nested = join(root, "src", "nested");
  await mkdir(nested, { recursive: true });
  const result = await initializeRepository({ startDirectory: nested, force: false });
  assert.equal(result.repositoryRoot, await realpath(root));
  assert.equal(result.connectionConfigured, false);
  const policy = await readFile(join(root, ".donebond", "policy.yml"), "utf8");
  assert.match(policy, /^schemaVersion: 1/m);
  assert.match(policy, /executable: pnpm/);
  assert.match(policy, /requireCleanWorkingTree: true/);
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\.donebond\/credentials\.json$/m);
  assert.equal(ignore.includes(".donebond/policy.yml"), false);
});

test("policy validate explains exact commands and returns a stable hash", async () => {
  const root = await gitRepository();
  await initializeRepository({ startDirectory: root, force: false });
  const stdout = captureStream();
  const stderr = captureStream();
  assert.equal(
    await runCli(["policy", "validate", "--repo", root], {
      stdout: stdout.stream,
      stderr: stderr.stream
    }),
    ExitCode.Success
  );
  assert.match(stdout.value(), /Policy valid: 0x[0-9a-f]{64}/u);
  assert.match(stdout.value(), /command: "pnpm" "test"/u);
  assert.match(stdout.value(), /cwd: \./u);
  assert.match(stdout.value(), /timeout: 600s/u);

  const json = captureStream();
  assert.equal(
    await runCli(["policy", "validate", "--repo", root, "--json"], {
      stdout: json.stream,
      stderr: stderr.stream
    }),
    ExitCode.Success
  );
  const result = JSON.parse(json.value());
  assert.match(result.policyHash, /^0x[0-9a-f]{64}$/u);
  assert.equal(result.checks[0].executable, "pnpm");
  assert.deepEqual(result.checks[0].args, ["test"]);
});

test("policy validate rejects unsafe commands and paths outside the repository", async () => {
  const root = await gitRepository();
  await initializeRepository({ startDirectory: root, force: false });
  const policyPath = join(root, ".donebond", "policy.yml");
  const validPolicy = await readFile(policyPath, "utf8");
  await writeFile(policyPath, validPolicy.replace("executable: pnpm", "executable: sh"), "utf8");
  const unsafeError = captureStream();
  assert.equal(
    await runCli(["policy", "validate", "--repo", root], {
      stdout: captureStream().stream,
      stderr: unsafeError.stream
    }),
    ExitCode.Configuration
  );
  assert.match(unsafeError.value(), /POLICY_INVALID/u);

  const external = join(await temporaryDirectory("donebond-policy-outside-"), "policy.yml");
  await writeFile(external, validPolicy, "utf8");
  const pathError = captureStream();
  assert.equal(
    await runCli(["policy", "validate", "--repo", root, "--policy", external], {
      stdout: captureStream().stream,
      stderr: pathError.stream
    }),
    ExitCode.Repository
  );
  assert.match(pathError.value(), /REPOSITORY_INVALID/u);
});

test("task pull authenticates and verifies project, policy, and canonical task commitments", async (context) => {
  const root = await gitRepository();
  const configHome = await temporaryDirectory("donebond-task-config-");
  await initializeRepository({ startDirectory: root, force: false });
  const policy = await parsePolicyFile(join(root, ".donebond", "policy.yml"), root);
  const task = taskFixture(policy.policyHash);
  const api = await withApiServer((request, response) => {
    assert.match(request.headers.authorization ?? "", /^Bearer dbt_dummy_/u);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(request.url?.includes("/tasks/") ? task : { publicId: "project_123" })
    );
  });
  context.after(() => api.close());
  const token = "dbt_dummy_task_pull_test_only_token_abcdefghijklmnopqrstuvwxyz";
  await initializeRepository({
    startDirectory: root,
    force: true,
    connection: { apiUrl: api.url, projectId: "project_123", token },
    environment: { XDG_CONFIG_HOME: configHome }
  });
  const stdout = captureStream();
  assert.equal(
    await runCli(["task", "pull", "task_123", "--repo", root, "--json"], {
      stdout: stdout.stream,
      stderr: captureStream().stream,
      environment: { XDG_CONFIG_HOME: configHome }
    }),
    ExitCode.Success
  );
  const result = JSON.parse(stdout.value());
  assert.equal(result.taskHash, task.taskHash);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".donebond", "task.json"), "utf8")), {
    ...task,
    repositoryUrl: "https://github.com/vedant817/example"
  });
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\.donebond\/task\.json$/mu);
});

test("task pull rejects mismatched and oversized payloads without writing a manifest", async (context) => {
  const root = await gitRepository();
  const configHome = await temporaryDirectory("donebond-task-reject-config-");
  await initializeRepository({ startDirectory: root, force: false });
  const policy = await parsePolicyFile(join(root, ".donebond", "policy.yml"), root);
  let payload = taskFixture(policy.policyHash);
  const api = await withApiServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(request.url?.includes("/tasks/") ? payload : { publicId: "project_123" })
    );
  });
  context.after(() => api.close());
  await initializeRepository({
    startDirectory: root,
    force: true,
    connection: {
      apiUrl: api.url,
      projectId: "project_123",
      token: "dbt_dummy_task_reject_test_only_token_abcdefghijklmnopqrstuvwxyz"
    },
    environment: { XDG_CONFIG_HOME: configHome }
  });
  const cases = [
    {
      value: taskFixture(policy.policyHash, { taskHash: `0x${"f".repeat(64)}` }),
      exit: ExitCode.Configuration
    },
    {
      value: taskFixture(policy.policyHash, { publicId: "task_other" }),
      exit: ExitCode.Configuration
    },
    {
      value: taskFixture(policy.policyHash, { projectPublicId: "project_other" }),
      exit: ExitCode.Configuration
    },
    {
      value: taskFixture(policy.policyHash, { policyHash: `0x${"e".repeat(64)}` }),
      exit: ExitCode.Configuration
    },
    { value: {}, exit: ExitCode.Configuration },
    { value: { padding: "x".repeat(70_000) }, exit: ExitCode.Network }
  ];
  for (const testCase of cases) {
    payload = testCase.value;
    assert.equal(
      await runCli(["task", "pull", "task_123", "--repo", root], {
        stdout: captureStream().stream,
        stderr: captureStream().stream,
        environment: { XDG_CONFIG_HOME: configHome }
      }),
      testCase.exit
    );
    await assert.rejects(readFile(join(root, ".donebond", "task.json")), { code: "ENOENT" });
  }
});

test("task pull rejects a symlinked .donebond parent without touching source", async (context) => {
  const root = await gitRepository();
  const configHome = await temporaryDirectory("donebond-task-parent-config-");
  await initializeRepository({ startDirectory: root, force: false });
  const policyText = await readFile(join(root, ".donebond", "policy.yml"), "utf8");
  const policy = await parsePolicyFile(join(root, ".donebond", "policy.yml"), root);
  const task = taskFixture(policy.policyHash);
  const api = await withApiServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(request.url?.includes("/tasks/") ? task : { publicId: "project_123" })
    );
  });
  context.after(() => api.close());
  await initializeRepository({
    startDirectory: root,
    force: true,
    connection: {
      apiUrl: api.url,
      projectId: "project_123",
      token: "dbt_dummy_parent_test_only_token_abcdefghijklmnopqrstuvwxyz"
    },
    environment: { XDG_CONFIG_HOME: configHome }
  });
  await rm(join(root, ".donebond"), { recursive: true });
  const sourceDirectory = join(root, "src");
  await mkdir(sourceDirectory);
  await writeFile(join(sourceDirectory, "policy.yml"), policyText, "utf8");
  await writeFile(join(sourceDirectory, "task.json"), "source sentinel\n", "utf8");
  await symlink(sourceDirectory, join(root, ".donebond"));
  assert.equal(
    await runCli(["task", "pull", "task_123", "--repo", root], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { XDG_CONFIG_HOME: configHome }
    }),
    ExitCode.Repository
  );
  assert.equal(await readFile(join(sourceDirectory, "task.json"), "utf8"), "source sentinel\n");
});

test("verify executes real checks and writes independently hashable passing evidence", async () => {
  const { root, commit, task } = await verificationFixture(0);
  const stdout = captureStream();
  const stderr = captureStream();
  assert.equal(
    await runCli(["verify", "--repo", root, "--commit", commit, "--json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Success
  );
  const result = JSON.parse(stdout.value());
  assert.equal(result.passing, true);
  assert.equal(result.diagnosticOnly, false);
  assert.match(result.evidenceHash, /^0x[0-9a-f]{64}$/u);
  assert.match(stderr.value(), /check-started/u);
  const evidence = JSON.parse(
    await readFile(join(root, ".donebond", `${task.publicId}.evidence.json`), "utf8")
  );
  assert.equal(evidence.result.passing, true);
  assert.equal(evidence.git.objectId, commit);
  assert.equal(evidence.task.taskHash, task.taskHash);
});

test("verify returns nonzero and still writes evidence for failed checks and dirty Git", async () => {
  const failed = await verificationFixture(2);
  assert.equal(
    await runCli(["verify", "--repo", failed.root], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Verification
  );
  const failedEvidence = JSON.parse(
    await readFile(join(failed.root, ".donebond", `${failed.task.publicId}.evidence.json`), "utf8")
  );
  assert.equal(failedEvidence.result.passing, false);
  assert.equal(failedEvidence.checks[0].status, "failed");

  const dirty = await verificationFixture(0);
  await writeFile(join(dirty.root, "implementation.txt"), "dirty content\n", "utf8");
  assert.equal(
    await runCli(["verify", "--repo", dirty.root], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Verification
  );
  const dirtyEvidence = JSON.parse(
    await readFile(join(dirty.root, ".donebond", `${dirty.task.publicId}.evidence.json`), "utf8")
  );
  assert.equal(dirtyEvidence.diagnosticOnly, true);
  assert.equal(dirtyEvidence.checks[0].status, "skipped");
  assert.ok(dirtyEvidence.failureCodes.includes("GIT_DIRTY"));
});

test("verify preflight rejects wrong task branch and remote without executing checks", async () => {
  const markerScript = 'require("node:fs").writeFileSync("executed.marker", "executed")';
  for (const overrides of [
    { targetBranch: "release" },
    { repositoryUrl: "https://github.com/Vedant817/other.git" }
  ]) {
    const fixture = await verificationFixture(0, overrides, markerScript);
    assert.equal(
      await runCli(["verify", "--repo", fixture.root], {
        stdout: captureStream().stream,
        stderr: captureStream().stream,
        environment: { PATH: process.env.PATH }
      }),
      ExitCode.Verification
    );
    await assert.rejects(readFile(join(fixture.root, "executed.marker")), { code: "ENOENT" });
    const diagnostic = JSON.parse(
      await readFile(
        join(fixture.root, ".donebond", `${fixture.task.publicId}.evidence.json`),
        "utf8"
      )
    );
    assert.equal(diagnostic.diagnosticOnly, true);
    assert.equal(diagnostic.checks[0].status, "skipped");
  }
});

test("verify writes diagnostics if a check changes HEAD", async () => {
  const script =
    'require("node:child_process").execFileSync("git", ["commit", "--allow-empty", "-m", "changed head"])';
  const fixture = await verificationFixture(0, {}, script);
  assert.equal(
    await runCli(["verify", "--repo", fixture.root], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Verification
  );
  const diagnostic = JSON.parse(
    await readFile(
      join(fixture.root, ".donebond", `${fixture.task.publicId}.evidence.json`),
      "utf8"
    )
  );
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.deepEqual(diagnostic.failureCodes, ["GIT_STATE_CHANGED_DURING_VERIFICATION"]);
});

test("verify human output shows exact command before execution and a final result table", async () => {
  const fixture = await verificationFixture(0);
  const stdout = captureStream();
  const stderr = captureStream();
  assert.equal(
    await runCli(["verify", "--repo", fixture.root], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Success
  );
  assert.match(stderr.value(), /executable: "node"/u);
  assert.match(stderr.value(), /args: \["-e","process\.exit\(0\)"\]/u);
  assert.match(stderr.value(), /cwd: \./u);
  assert.match(stderr.value(), /timeout: 10s/u);
  assert.match(stdout.value(), /Commit hash: 0x[0-9a-f]{64}/u);
  assert.match(stdout.value(), /Evidence: 0x[0-9a-f]{64}/u);
  assert.match(stdout.value(), /Checks:/u);
  assert.match(stdout.value(), /test\s+passed/u);
});

test("verify rejects an incorrect commit and unsafe output before execution", async () => {
  const { root } = await verificationFixture(0);
  assert.equal(
    await runCli(["verify", "--repo", root, "--commit", "0".repeat(40)], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Repository
  );
  assert.equal(
    await runCli(["verify", "--repo", root, "--output", "../escape.evidence.json"], {
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      environment: { PATH: process.env.PATH }
    }),
    ExitCode.Repository
  );
});

test("init refuses overwrite unless forced and updates gitignore idempotently", async () => {
  const root = await gitRepository();
  await initializeRepository({ startDirectory: root, force: false });
  const policyPath = join(root, ".donebond", "policy.yml");
  await writeFile(policyPath, "custom: true\n", "utf8");
  await assert.rejects(
    initializeRepository({ startDirectory: root, force: false }),
    (error) => error.code === "POLICY_EXISTS" && error.exitCode === ExitCode.Conflict
  );
  assert.equal(await readFile(policyPath, "utf8"), "custom: true\n");
  await initializeRepository({ startDirectory: root, force: true });
  assert.match(await readFile(policyPath, "utf8"), /^schemaVersion: 1/m);
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.equal(ignore.match(/\.donebond\/credentials\.json/g)?.length, 1);
});

test("init rejects a non-Git directory with a repository exit code", async () => {
  const root = await temporaryDirectory("donebond-cli-no-git-");
  await assert.rejects(
    initializeRepository({ startDirectory: root, force: false }),
    (error) => error.code === "REPOSITORY_NOT_FOUND" && error.exitCode === ExitCode.Repository
  );
});

test("init validates a real API connection and stores token only outside the repository", async (context) => {
  const root = await gitRepository();
  const configHome = await temporaryDirectory("donebond-cli-config-");
  const token = "dbt_dummy_test_only_token_abcdefghijklmnopqrstuvwxyz";
  let requestSeen = false;
  const api = await withApiServer((request, response) => {
    requestSeen = true;
    assert.equal(request.url, "/api/v1/projects/project_123");
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"publicId":"project_123"}');
  });
  context.after(api.close);

  const result = await initializeRepository({
    startDirectory: root,
    force: false,
    connection: { apiUrl: api.url, projectId: "project_123", token },
    environment: { XDG_CONFIG_HOME: configHome }
  });
  assert.equal(requestSeen, true);
  assert.equal(result.connectionConfigured, true);
  assert.equal(result.configPath.startsWith(root), false);
  assert.equal(relative(root, result.configPath).startsWith(".."), true);
  const config = await readFile(result.configPath, "utf8");
  assert.equal(config.includes(token), false);
  const credentialsPath = join(result.configPath, "..", "credentials.json");
  assert.equal((await readFile(credentialsPath, "utf8")).includes(token), true);
  if (process.platform !== "win32") {
    assert.equal((await lstat(result.configPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(credentialsPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(result.configPath, ".."))).mode & 0o777, 0o700);
  }
  const repositoryFiles = `${await readFile(join(root, ".donebond", "policy.yml"), "utf8")}${await readFile(join(root, ".gitignore"), "utf8")}`;
  assert.equal(repositoryFiles.includes(token), false);
});

test("failed API validation does not persist configuration or expose the token", async (context) => {
  const root = await gitRepository();
  const configHome = await temporaryDirectory("donebond-cli-config-failed-");
  const token = "dbt_dummy_failed_test_only_token_abcdefghijklmnopqrstuvwxyz";
  const api = await withApiServer((_request, response) => {
    response.writeHead(401);
    response.end("rejected");
  });
  context.after(api.close);
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(
    ["init", "--repo", root, "--api-url", api.url, "--project-id", "project_123", "--token-stdin"],
    {
      stdin: Readable.from(`${token}\n`),
      stdout: stdout.stream,
      stderr: stderr.stream,
      environment: { XDG_CONFIG_HOME: configHome }
    }
  );
  assert.equal(code, ExitCode.Network);
  assert.equal(stderr.value().includes(token), false);
  assert.equal(stdout.value().includes(token), false);
  await assert.rejects(readFile(join(root, ".donebond", "policy.yml"), "utf8"), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, ".donebond")), { code: "ENOENT" });
  await assert.rejects(lstat(join(configHome, "donebond")), { code: "ENOENT" });
});

test("connection validation requires bounded JSON for the requested normalized project", async () => {
  const input = {
    apiUrl: "https://api.example.test",
    projectId: "project_123",
    token: "dbt_dummy_connection_test_only_token_abcdefghijklmnopqrstuvwxyz"
  };
  await assert.rejects(
    validateConnection(
      input,
      async () =>
        new Response("<html>not the API</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    ),
    (error) => error.code === "CONNECTION_FAILED" && error.exitCode === ExitCode.Network
  );
  await assert.rejects(
    validateConnection(input, async () =>
      Response.json({ publicId: "different_project" }, { status: 200 })
    ),
    (error) => error.code === "CONNECTION_FAILED"
  );
  await assert.rejects(
    validateConnection(
      input,
      async () =>
        new Response(JSON.stringify({ publicId: "project_123", padding: "x".repeat(70_000) }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    ),
    (error) => error.code === "CONNECTION_FAILED"
  );
  await assert.rejects(
    initializeRepository({
      startDirectory: await gitRepository(),
      force: false,
      connection: { ...input, projectId: "INVALID_PROJECT" }
    }),
    (error) => error.code === "CONFIG_INVALID" && error.exitCode === ExitCode.Configuration
  );
});

test("configuration storage rejects a symlinked XDG_CONFIG_HOME", async () => {
  const parent = await temporaryDirectory("donebond-cli-config-parent-");
  const external = await temporaryDirectory("donebond-cli-config-external-");
  const configHome = join(parent, "xdg-config");
  await symlink(external, configHome);
  await assert.rejects(
    storeConnection(
      "/test/repository",
      {
        apiUrl: "https://api.example.test",
        projectId: "project_123",
        token: "dbt_dummy_symlink_test_only_token_abcdefghijklmnopqrstuvwxyz"
      },
      { XDG_CONFIG_HOME: configHome }
    ),
    (error) => error.code === "CONFIG_UNSAFE_PATH" && error.exitCode === ExitCode.Configuration
  );
  await assert.rejects(lstat(join(external, "donebond")), { code: "ENOENT" });
});

test("configuration loading rejects an XDG root replaced by a symlink", async () => {
  const parent = await temporaryDirectory("donebond-cli-load-config-");
  const configHome = join(parent, "config");
  await mkdir(configHome, { mode: 0o700 });
  const repository = "/test/repository";
  await storeConnection(
    repository,
    {
      apiUrl: "https://api.example.test",
      projectId: "project_123",
      token: "dbt_dummy_load_test_only_token_abcdefghijklmnopqrstuvwxyz"
    },
    { XDG_CONFIG_HOME: configHome }
  );
  const moved = join(parent, "moved-config");
  await rename(configHome, moved);
  await symlink(moved, configHome);
  await assert.rejects(loadConnection(repository, { XDG_CONFIG_HOME: configHome }), (error) => {
    return error.code === "CONFIG_UNSAFE_PATH";
  });
});

test("path safety rejects symbolic-link policy and gitignore targets", async () => {
  const root = await gitRepository();
  const external = await temporaryDirectory("donebond-cli-external-");
  await mkdir(join(root, ".donebond"));
  await writeFile(join(external, "policy.yml"), "external: unchanged\n", "utf8");
  await symlink(join(external, "policy.yml"), join(root, ".donebond", "policy.yml"));
  await assert.rejects(
    initializeRepository({ startDirectory: root, force: true }),
    (error) => error.code === "REPOSITORY_UNSAFE_PATH"
  );
  assert.equal(await readFile(join(external, "policy.yml"), "utf8"), "external: unchanged\n");

  const secondRoot = await gitRepository();
  await writeFile(join(external, "ignore"), "external-ignore\n", "utf8");
  await symlink(join(external, "ignore"), join(secondRoot, ".gitignore"));
  await assert.rejects(
    initializeRepository({ startDirectory: secondRoot, force: false }),
    (error) => error.code === "REPOSITORY_UNSAFE_PATH"
  );
  assert.equal(await readFile(join(external, "ignore"), "utf8"), "external-ignore\n");
});

test("CLI init parses offline mode and rejects unsafe option combinations", async () => {
  const root = await gitRepository();
  const stdout = captureStream();
  const stderr = captureStream();
  assert.equal(
    await runCli(["init", "--offline", "--repo", root], {
      stdout: stdout.stream,
      stderr: stderr.stream
    }),
    ExitCode.Success
  );
  assert.match(stdout.value(), /initialized/);
  const invalid = captureStream();
  assert.equal(
    await runCli(["init", "--offline", "--api-url", "https://example.com"], {
      stdout: captureStream().stream,
      stderr: invalid.stream
    }),
    ExitCode.Usage
  );
  assert.match(invalid.value(), /cannot be combined/);
});
