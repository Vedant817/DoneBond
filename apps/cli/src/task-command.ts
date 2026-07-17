import { randomBytes } from "node:crypto";
import { lstat, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { hashCanonicalTask, parsePolicyFile } from "@donebond/evidence";
import {
  PublicIdentifierSchema,
  RepositoryIdentitySchema,
  TaskSchema,
  type Task
} from "@donebond/shared";

import { authenticatedGetJson, loadConnection } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { discoverRepository } from "./git.js";

export interface PullTaskOptions {
  readonly startDirectory: string;
  readonly taskId: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
}

export interface PulledTask {
  readonly repositoryRoot: string;
  readonly manifestPath: string;
  readonly task: Task;
}

function repositoryIdentity(repositoryUrl: string): string {
  const url = new URL(repositoryUrl);
  const pathname = url.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  return RepositoryIdentitySchema.parse(`${url.hostname.toLowerCase()}/${pathname}`);
}

function canonicalTaskHash(task: Task): `0x${string}` {
  const deadlineUnixSeconds =
    task.deadline === null ? null : Math.floor(new Date(task.deadline).getTime() / 1000).toString();
  return hashCanonicalTask({
    kind: "donebond.task",
    schemaVersion: 1,
    projectPublicId: task.projectPublicId,
    repositoryIdentity: repositoryIdentity(task.repositoryUrl),
    targetBranch: task.targetBranch,
    baseCommit: task.baseCommit,
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    assigneeWallet: task.assigneeWallet,
    deadlineUnixSeconds,
    rewardWei: task.rewardWei,
    policyHash: task.policyHash
  });
}

async function atomicManifestWrite(path: string, task: Task): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CliError(
        "REPOSITORY_UNSAFE_PATH",
        "Refusing to write the task manifest through an unsafe entry.",
        ExitCode.Repository
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function requireSafeDonebondDirectory(repositoryRoot: string): Promise<string> {
  const directory = join(repositoryRoot, ".donebond");
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        "REPOSITORY_UNSAFE_PATH",
        "The .donebond directory is missing; run donebond init.",
        ExitCode.Repository
      );
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory() || (await realpath(directory)) !== directory) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "The .donebond directory must be a real directory inside the repository.",
      ExitCode.Repository
    );
  }
  const policyPath = join(directory, "policy.yml");
  const policyStats = await lstat(policyPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new CliError(
        "REPOSITORY_UNSAFE_PATH",
        "The local policy is missing; run donebond init.",
        ExitCode.Repository
      );
    }
    throw error;
  });
  if (policyStats.isSymbolicLink() || !policyStats.isFile()) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "The local policy must be a regular file, not a symbolic link.",
      ExitCode.Repository
    );
  }
  return directory;
}

export async function pullTask(options: PullTaskOptions): Promise<PulledTask> {
  const taskIdResult = PublicIdentifierSchema.safeParse(options.taskId);
  if (!taskIdResult.success) {
    throw new CliError(
      "CONFIG_INVALID",
      "Task ID is not a normalized public identifier.",
      ExitCode.Configuration
    );
  }
  const taskId = taskIdResult.data;
  const repositoryRoot = await discoverRepository(options.startDirectory);
  const donebondDirectory = await requireSafeDonebondDirectory(repositoryRoot);
  const connection = await loadConnection(repositoryRoot, options.environment);
  const policy = await parsePolicyFile(join(donebondDirectory, "policy.yml"), repositoryRoot);
  const rawTask = await authenticatedGetJson(
    connection,
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    options.fetchImplementation
  );
  const taskResult = TaskSchema.safeParse(rawTask);
  if (!taskResult.success) {
    throw new CliError(
      "CONFIG_INVALID",
      "API returned an invalid task payload.",
      ExitCode.Configuration
    );
  }
  const task = taskResult.data;
  if (task.publicId !== taskId) {
    throw new CliError(
      "CONFIG_INVALID",
      "API response does not match the requested task.",
      ExitCode.Configuration
    );
  }
  if (task.projectPublicId !== connection.projectId) {
    throw new CliError(
      "CONFIG_INVALID",
      "Task belongs to a different project.",
      ExitCode.Configuration
    );
  }
  if (task.policyHash !== policy.policyHash) {
    throw new CliError(
      "POLICY_INVALID",
      "Task policy hash does not match the local policy.",
      ExitCode.Configuration
    );
  }
  if (canonicalTaskHash(task) !== task.taskHash) {
    throw new CliError(
      "CONFIG_INVALID",
      "Task commitment does not match its canonical content.",
      ExitCode.Configuration
    );
  }
  const manifestPath = join(donebondDirectory, "task.json");
  await atomicManifestWrite(manifestPath, task);
  return { repositoryRoot, manifestPath, task };
}
