import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GitObjectIdSchema,
  RepositoryIdentitySchema,
  type EvidenceBundle,
  type VerificationPolicy
} from "@donebond/shared";
import { keccak256, toBytes } from "viem";

import { deriveCommitHash } from "./canonical.js";
import { EvidenceError } from "./errors.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_CHANGED_FILES = 5000;

export interface GitPerson {
  readonly name: string;
  readonly email: string;
}

export interface ChangedFileSummary {
  readonly path: string;
  readonly pathDigest: `0x${string}`;
}

export interface CollectedGitState {
  readonly repositoryRoot: string;
  readonly remote: string;
  readonly branch: string;
  readonly detached: boolean;
  readonly objectId: string;
  readonly treeId: string;
  readonly derivedCommitHash: `0x${string}`;
  readonly author: GitPerson;
  readonly committer: GitPerson;
  readonly committedAt: string;
  readonly staged: readonly ChangedFileSummary[];
  readonly unstaged: readonly ChangedFileSummary[];
  readonly untracked: readonly ChangedFileSummary[];
  readonly changedFiles: readonly ChangedFileSummary[];
  readonly changedFilesTruncated: boolean;
  readonly clean: boolean;
  readonly baseCommitVerified: boolean | null;
  readonly constraintFailures: readonly string[];
}

export interface CollectGitOptions {
  readonly cwd: string;
  readonly expectedCommit?: string;
  readonly policy?: VerificationPolicy;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        HOME: process.env.HOME,
        LC_ALL: "C",
        PATH: process.env.PATH
      },
      maxBuffer: MAX_GIT_OUTPUT,
      timeout: 10_000,
      windowsHide: true
    });
    return result.stdout;
  } catch (cause) {
    throw new EvidenceError("GIT_COMMAND_FAILED", `Git command failed: git ${args.join(" ")}`, {
      cause
    });
  }
}

function normalizeRemoteUrl(value: string): string {
  const trimmed = value.trim();
  let host: string;
  let pathname: string;
  try {
    if (/^[^@/:]+@[^:]+:.+$/u.test(trimmed)) {
      const separator = trimmed.indexOf(":");
      const at = trimmed.lastIndexOf("@", separator);
      host = trimmed.slice(at + 1, separator);
      pathname = trimmed.slice(separator + 1);
    } else {
      const url = new URL(trimmed);
      if (!new Set(["https:", "ssh:"]).has(url.protocol)) {
        throw new TypeError("Unsupported remote protocol");
      }
      host = url.hostname;
      pathname = url.pathname;
    }
  } catch (cause) {
    throw new EvidenceError("GIT_REMOTE_INVALID", "Git remote URL is unsupported", { cause });
  }
  const normalizedHost =
    host.toLowerCase() === "github-personal" ? "github.com" : host.toLowerCase();
  const identity = `${normalizedHost}/${pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "")}`;
  try {
    return RepositoryIdentitySchema.parse(identity);
  } catch (cause) {
    throw new EvidenceError(
      "GIT_REMOTE_INVALID",
      "Git remote must identify a GitHub host/owner/repository without credentials",
      { cause }
    );
  }
}

function safePathSummary(value: string): ChangedFileSummary {
  const normalized = value.normalize("NFC");
  const safe =
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !normalized.includes("\\") &&
    !normalized.includes("\0") &&
    !normalized.split("/").includes("..");
  const pathDigest = keccak256(toBytes(normalized));
  return {
    path: safe ? normalized : `unsafe-path-${pathDigest.slice(2, 18)}`,
    pathDigest
  };
}

function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

function deduplicateAndBound(paths: readonly string[]): {
  summaries: ChangedFileSummary[];
  truncated: boolean;
} {
  const unique = [...new Set(paths)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return {
    summaries: unique.slice(0, MAX_CHANGED_FILES).map(safePathSummary),
    truncated: unique.length > MAX_CHANGED_FILES
  };
}

function branchMatches(pattern: string, branch: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "u").test(branch);
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch (cause) {
    throw new EvidenceError(
      "GIT_NOT_REPOSITORY",
      "Current directory is not inside a Git repository",
      {
        cause
      }
    );
  }
}

export async function collectGitState(options: CollectGitOptions): Promise<CollectedGitState> {
  const repositoryRoot = await findRepositoryRoot(options.cwd);
  let metadata: string;
  try {
    metadata = await git(repositoryRoot, [
      "show",
      "-s",
      "--format=%H%x00%T%x00%an%x00%ae%x00%cn%x00%ce%x00%cI",
      "HEAD"
    ]);
  } catch (cause) {
    throw new EvidenceError("GIT_NO_COMMITS", "Repository has no HEAD commit", { cause });
  }
  const fields = metadata.trimEnd().split("\0");
  if (fields.length !== 7) {
    throw new EvidenceError("GIT_COMMAND_FAILED", "Git returned malformed commit metadata");
  }
  const [
    rawObjectId,
    rawTreeId,
    authorName,
    authorEmail,
    committerName,
    committerEmail,
    timestamp
  ] = fields as [string, string, string, string, string, string, string];
  const objectId = GitObjectIdSchema.parse(rawObjectId);
  const treeId = GitObjectIdSchema.parse(rawTreeId);
  const branchOutput = (
    await git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")
  ).trim();
  const detached = branchOutput.length === 0;
  const branch = detached ? "DETACHED" : branchOutput;
  let remoteValue: string;
  try {
    remoteValue = await git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  } catch (cause) {
    throw new EvidenceError("GIT_REMOTE_INVALID", "Repository has no origin remote", { cause });
  }
  const remote = normalizeRemoteUrl(remoteValue);
  const [stagedRaw, unstagedRaw, untrackedRaw] = await Promise.all([
    git(repositoryRoot, ["diff", "--cached", "--name-only", "-z", "--no-ext-diff"]),
    git(repositoryRoot, ["diff", "--name-only", "-z", "--no-ext-diff"]),
    git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
  ]);
  const stagedPaths = parseNullSeparated(stagedRaw);
  const unstagedPaths = parseNullSeparated(unstagedRaw);
  const untrackedPaths = parseNullSeparated(untrackedRaw);
  const staged = deduplicateAndBound(stagedPaths);
  const unstaged = deduplicateAndBound(unstagedPaths);
  const untracked = deduplicateAndBound(untrackedPaths);
  const changed = deduplicateAndBound([...stagedPaths, ...unstagedPaths, ...untrackedPaths]);
  const clean = changed.summaries.length === 0 && !changed.truncated;
  const constraintFailures: string[] = [];
  let baseCommitVerified: boolean | null = null;
  if (options.expectedCommit !== undefined) {
    const expected = GitObjectIdSchema.parse(options.expectedCommit);
    if (expected !== objectId) {
      throw new EvidenceError("GIT_COMMIT_MISMATCH", "HEAD does not match the expected commit");
    }
  }
  const policy = options.policy;
  if (policy !== undefined) {
    if (policy.repository.requireCleanWorkingTree && !clean) {
      constraintFailures.push("GIT_DIRTY");
    }
    if (!policy.repository.allowedBranches.some((allowed) => branchMatches(allowed, branch))) {
      constraintFailures.push("GIT_BRANCH_NOT_ALLOWED");
    }
    const expectedOwner = policy.repository.expectedRemoteOwner?.toLowerCase();
    if (expectedOwner !== undefined && remote.split("/")[1]?.toLowerCase() !== expectedOwner) {
      constraintFailures.push("GIT_REMOTE_OWNER_MISMATCH");
    }
    if (policy.repository.baseCommit !== undefined) {
      try {
        await git(repositoryRoot, [
          "merge-base",
          "--is-ancestor",
          policy.repository.baseCommit,
          objectId
        ]);
        baseCommitVerified = true;
      } catch {
        baseCommitVerified = false;
        constraintFailures.push("GIT_BASE_COMMIT_MISMATCH");
      }
    }
  }
  return {
    repositoryRoot,
    remote,
    branch,
    detached,
    objectId,
    treeId,
    derivedCommitHash: deriveCommitHash(objectId),
    author: { name: authorName, email: authorEmail },
    committer: { name: committerName, email: committerEmail },
    committedAt: new Date(timestamp).toISOString(),
    staged: staged.summaries,
    unstaged: unstaged.summaries,
    untracked: untracked.summaries,
    changedFiles: changed.summaries,
    changedFilesTruncated:
      staged.truncated || unstaged.truncated || untracked.truncated || changed.truncated,
    clean,
    baseCommitVerified,
    constraintFailures
  };
}

/** Privacy-minimized projection used by EvidenceBundleV1. Author identities and diff details stay local. */
export function toPublicGitEvidence(state: CollectedGitState): EvidenceBundle["git"] {
  return {
    objectId: state.objectId,
    derivedCommitHash: state.derivedCommitHash,
    treeId: state.treeId,
    branch: state.branch,
    remote: state.remote,
    clean: state.clean,
    changedFiles: state.changedFiles.map((file) => file.path)
  };
}
