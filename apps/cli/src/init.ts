import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ConnectionInput,
  normalizeConnection,
  storeConnection,
  validateConnection
} from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { discoverRepository } from "./git.js";
import { POLICY_TEMPLATE } from "./policy-template.js";

export interface InitOptions {
  startDirectory: string;
  force: boolean;
  connection?: ConnectionInput;
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
}

export interface InitResult {
  repositoryRoot: string;
  policyPath: string;
  policyCreated: boolean;
  connectionConfigured: boolean;
  configPath?: string;
}

const GITIGNORE_BLOCK = `# DoneBond local credentials and generated evidence
.donebond/config.json
.donebond/credentials.json
.donebond/*.evidence.json
`;

async function targetKind(path: string, label: string): Promise<"missing" | "file" | "directory"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw new CliError(
        "REPOSITORY_UNSAFE_PATH",
        `Refusing to write ${label} through an unsafe filesystem entry.`,
        ExitCode.Repository
      );
    }
    return stats.isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

async function writePolicy(path: string, force: boolean): Promise<boolean> {
  const kind = await targetKind(path, "the policy");
  if (kind === "directory") {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "The policy path exists but is not a regular file.",
      ExitCode.Repository
    );
  }
  if (kind === "file" && !force) {
    throw new CliError(
      "POLICY_EXISTS",
      "A DoneBond policy already exists. Use --force to replace it explicitly.",
      ExitCode.Conflict
    );
  }
  if (kind === "missing") {
    await writeFile(path, POLICY_TEMPLATE, { encoding: "utf8", flag: "wx", mode: 0o644 });
    return true;
  }
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, POLICY_TEMPLATE, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return false;
}

async function updateGitignore(repositoryRoot: string): Promise<void> {
  const path = join(repositoryRoot, ".gitignore");
  const kind = await targetKind(path, ".gitignore");
  if (kind === "directory") {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      ".gitignore exists but is not a regular file.",
      ExitCode.Repository
    );
  }
  const current = kind === "file" ? await readFile(path, "utf8") : "";
  const requiredLines = GITIGNORE_BLOCK.trim().split("\n").slice(1);
  if (requiredLines.every((line) => current.split(/\r?\n/).includes(line))) {
    return;
  }
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  const content = `${current}${separator}${current.length === 0 ? "" : "\n"}${GITIGNORE_BLOCK}`;
  if (kind === "missing") {
    await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    return;
  }
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function initializeRepository(options: InitOptions): Promise<InitResult> {
  const repositoryRoot = await discoverRepository(options.startDirectory);
  let normalizedConnection: ConnectionInput | undefined;
  if (options.connection !== undefined) {
    normalizedConnection = normalizeConnection(options.connection);
    await validateConnection(normalizedConnection, options.fetchImplementation);
  }

  const donebondDirectory = join(repositoryRoot, ".donebond");
  const directoryKind = await targetKind(donebondDirectory, ".donebond");
  if (directoryKind === "file") {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      ".donebond exists but is not a directory.",
      ExitCode.Repository
    );
  }
  if (directoryKind === "missing") {
    await mkdir(donebondDirectory, { mode: 0o755 });
  }

  const policyPath = join(donebondDirectory, "policy.yml");
  const policyCreated = await writePolicy(policyPath, options.force);
  await updateGitignore(repositoryRoot);

  if (normalizedConnection === undefined) {
    return { repositoryRoot, policyPath, policyCreated, connectionConfigured: false };
  }
  const stored = await storeConnection(repositoryRoot, normalizedConnection, options.environment);
  return {
    repositoryRoot,
    policyPath,
    policyCreated,
    connectionConfigured: true,
    configPath: stored.configPath
  };
}
