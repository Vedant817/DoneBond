import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildEvidenceBundle,
  collectGitState,
  createBoundedOutput,
  parsePolicyFile,
  runChecksSequentially,
  writeEvidenceBundle,
  type CollectedGitState,
  type RunnerProgress
} from "@donebond/evidence";
import { TaskSchema, type CheckResult, type Task } from "@donebond/shared";

import { CliError, ExitCode } from "./errors.js";
import { discoverRepository } from "./git.js";
import {
  canonicalTaskHash,
  repositoryIdentity,
  requireSafeDonebondDirectory
} from "./task-command.js";
import { readVersion } from "./version.js";

const execFileAsync = promisify(execFile);

export interface VerifyTaskOptions {
  readonly startDirectory: string;
  readonly expectedCommit?: string;
  readonly outputPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly onProgress?: (event: RunnerProgress) => void;
}

export interface VerifyTaskResult {
  readonly passing: boolean;
  readonly diagnosticOnly: boolean;
  readonly outputPath: string;
  readonly task: Task;
  readonly git: CollectedGitState;
  readonly checks: readonly CheckResult[];
  readonly evidenceHash?: `0x${string}`;
  readonly failureCodes: readonly string[];
}

async function readTaskManifest(path: string): Promise<Task> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new CliError(
        "CONFIG_INVALID",
        "Local task manifest is missing; run donebond task pull.",
        ExitCode.Configuration
      );
    }
    throw error;
  });
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 128 * 1024) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "Local task manifest must be a bounded regular file.",
      ExitCode.Repository
    );
  }
  let unknownTask: unknown;
  try {
    unknownTask = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new CliError(
      "CONFIG_INVALID",
      "Local task manifest is malformed.",
      ExitCode.Configuration,
      {
        cause: error
      }
    );
  }
  const parsed = TaskSchema.safeParse(unknownTask);
  if (!parsed.success || canonicalTaskHash(parsed.data) !== parsed.data.taskHash) {
    throw new CliError(
      "CONFIG_INVALID",
      "Local task manifest commitment is invalid.",
      ExitCode.Configuration
    );
  }
  return parsed.data;
}

async function isAncestor(
  repositoryRoot: string,
  ancestor: string,
  commit: string
): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, commit], {
      cwd: repositoryRoot,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
        PATH: process.env.PATH
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function atomicDiagnosticWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function skippedChecks(
  policy: Awaited<ReturnType<typeof parsePolicyFile>>,
  onProgress?: (event: RunnerProgress) => void
): CheckResult[] {
  const now = new Date().toISOString();
  const empty = createBoundedOutput(new Uint8Array(), 1);
  return policy.policy.checks.map((check) => {
    onProgress?.({ type: "check-finished", key: check.key, status: "skipped" });
    return {
      key: check.key,
      label: check.label,
      required: check.required,
      status: "skipped",
      startedAt: now,
      durationMs: 0,
      exitCode: null,
      signal: null,
      stdout: {
        preview: empty.preview,
        digest: empty.digest,
        originalBytes: 0,
        truncated: false
      },
      stderr: {
        preview: empty.preview,
        digest: empty.digest,
        originalBytes: 0,
        truncated: false
      }
    };
  });
}

async function taskGitFailures(
  repositoryRoot: string,
  task: Task,
  git: CollectedGitState
): Promise<Set<string>> {
  const failures = new Set(git.constraintFailures);
  if (git.remote !== repositoryIdentity(task.repositoryUrl)) {
    failures.add("GIT_REMOTE_TASK_MISMATCH");
  }
  if (git.branch !== task.targetBranch) failures.add("GIT_TASK_BRANCH_MISMATCH");
  if (
    task.baseCommit !== null &&
    !(await isAncestor(repositoryRoot, task.baseCommit, git.objectId))
  ) {
    failures.add("GIT_TASK_BASE_COMMIT_MISMATCH");
  }
  return failures;
}

async function writeDiagnostic(
  outputPath: string,
  task: Task,
  policyHash: string,
  git: CollectedGitState,
  checks: readonly CheckResult[],
  failureCodes: readonly string[]
): Promise<void> {
  await atomicDiagnosticWrite(outputPath, {
    schemaVersion: 1,
    diagnosticOnly: true,
    task: { publicId: task.publicId, taskHash: task.taskHash },
    policyHash,
    git: {
      objectId: git.objectId,
      derivedCommitHash: git.derivedCommitHash,
      treeId: git.treeId,
      branch: git.branch,
      remote: git.remote,
      clean: git.clean,
      changedFiles: git.changedFiles.map((file) => file.path)
    },
    checks,
    failureCodes
  });
}

export async function verifyTask(options: VerifyTaskOptions): Promise<VerifyTaskResult> {
  const repositoryRoot = await discoverRepository(options.startDirectory);
  const donebondDirectory = await requireSafeDonebondDirectory(repositoryRoot);
  const task = await readTaskManifest(join(donebondDirectory, "task.json"));
  const policy = await parsePolicyFile(join(donebondDirectory, "policy.yml"), repositoryRoot);
  if (policy.policyHash !== task.policyHash) {
    throw new CliError(
      "POLICY_INVALID",
      "Local policy does not match the pulled task.",
      ExitCode.Configuration
    );
  }
  if (
    options.outputPath !== undefined &&
    (!/^[A-Za-z0-9._-]{1,128}\.evidence\.json$/u.test(options.outputPath) ||
      options.outputPath.includes(".."))
  ) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "Evidence output must be a simple .evidence.json filename inside .donebond.",
      ExitCode.Repository
    );
  }
  const outputPath = join(
    donebondDirectory,
    options.outputPath ?? `${task.publicId}.evidence.json`
  );
  const initialGit = await collectGitState({
    cwd: repositoryRoot,
    ...(options.expectedCommit === undefined ? {} : { expectedCommit: options.expectedCommit }),
    policy: policy.policy
  });
  const initialFailures = await taskGitFailures(repositoryRoot, task, initialGit);
  if (initialFailures.size > 0) {
    const checks = skippedChecks(policy, options.onProgress);
    const failures = [...initialFailures].sort();
    await writeDiagnostic(outputPath, task, policy.policyHash, initialGit, checks, failures);
    return {
      passing: false,
      diagnosticOnly: true,
      outputPath,
      task,
      git: initialGit,
      checks,
      failureCodes: failures
    };
  }
  const checks = await runChecksSequentially(policy.policy, {
    repositoryRoot,
    environment: options.environment ?? process.env,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress })
  });
  let finalGit: CollectedGitState;
  try {
    finalGit = await collectGitState({
      cwd: repositoryRoot,
      expectedCommit: initialGit.objectId,
      policy: policy.policy
    });
  } catch {
    const failures = ["GIT_STATE_CHANGED_DURING_VERIFICATION"];
    await requireSafeDonebondDirectory(repositoryRoot);
    await writeDiagnostic(outputPath, task, policy.policyHash, initialGit, checks, failures);
    return {
      passing: false,
      diagnosticOnly: true,
      outputPath,
      task,
      git: initialGit,
      checks,
      failureCodes: failures
    };
  }
  const git: CollectedGitState = {
    ...finalGit,
    constraintFailures: [
      ...new Set([...initialGit.constraintFailures, ...finalGit.constraintFailures])
    ]
  };
  const failureCodes = await taskGitFailures(repositoryRoot, task, git);
  if ((await requireSafeDonebondDirectory(repositoryRoot)) !== donebondDirectory) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "The .donebond directory changed during verification.",
      ExitCode.Repository
    );
  }
  if (failureCodes.size > 0 && [...failureCodes].some((code) => code !== "GIT_DIRTY")) {
    const failures = [...failureCodes].sort();
    await writeDiagnostic(outputPath, task, policy.policyHash, git, checks, failures);
    return {
      passing: false,
      diagnosticOnly: true,
      outputPath,
      task,
      git,
      checks,
      failureCodes: failures
    };
  }
  const built = buildEvidenceBundle({
    task: { publicId: task.publicId, taskHash: task.taskHash },
    policy,
    git,
    checks,
    tool: {
      name: "donebond-cli",
      version: await readVersion(),
      platform: process.platform,
      nodeVersion: process.version
    }
  });
  await writeEvidenceBundle(outputPath, built.bundle);
  return {
    passing: built.bundle.result.passing,
    diagnosticOnly: false,
    outputPath,
    task,
    git,
    checks,
    evidenceHash: built.evidenceHash,
    failureCodes: built.bundle.result.failureCodes
  };
}
