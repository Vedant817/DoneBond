import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import test from "node:test";

import { ExitCode, initializeRepository, runCli } from "../dist/index.js";
import { storeConnection, validateConnection } from "../dist/config.js";

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
