import { lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { collectGitState, parsePolicyFile, verifyBundle } from "@donebond/evidence";
import { EvidenceBundleSchema } from "@donebond/shared";

import { authenticatedPostJson, loadConnection } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { discoverRepository } from "./git.js";
import { requireSafeDonebondDirectory } from "./task-command.js";
import { readTaskManifest } from "./verify-command.js";

export interface SubmitEvidenceOptions {
  readonly startDirectory: string;
  readonly bundlePath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetchImplementation?: typeof fetch;
}

export interface SubmitEvidenceResult {
  readonly evidencePublicId: string;
  readonly taskPublicId: string;
  readonly evidenceHash: string;
  readonly commitHash: string;
  readonly publicEvidenceUrl: string;
  readonly taskUrl: string;
}

async function readBoundedBundle(path: string): Promise<unknown> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new CliError(
        "CONFIG_INVALID",
        "Evidence bundle is missing; run donebond verify first.",
        ExitCode.Configuration
      );
    }
    throw error;
  });
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 512 * 1024) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "Evidence bundle must be a bounded regular file.",
      ExitCode.Repository
    );
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new CliError("CONFIG_INVALID", "Evidence bundle is malformed.", ExitCode.Configuration, {
      cause: error
    });
  }
}

function parseUploadResponse(
  value: unknown,
  expected: {
    readonly taskPublicId: string;
    readonly projectPublicId: string;
    readonly evidenceHash: string;
    readonly commitHash: string;
  }
) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
  const evidence = (value as Record<string, unknown>).evidence;
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence))
    throw new TypeError();
  const record = evidence as Record<string, unknown>;
  if (
    typeof record.publicId !== "string" ||
    record.taskPublicId !== expected.taskPublicId ||
    record.projectPublicId !== expected.projectPublicId ||
    record.evidenceHash !== expected.evidenceHash ||
    record.commitHashDerived !== expected.commitHash ||
    record.passing !== true
  ) {
    throw new TypeError();
  }
  return { publicId: record.publicId };
}

export async function submitEvidence(
  options: SubmitEvidenceOptions
): Promise<SubmitEvidenceResult> {
  const repositoryRoot = await discoverRepository(options.startDirectory);
  const donebondDirectory = await requireSafeDonebondDirectory(repositoryRoot);
  const task = await readTaskManifest(join(donebondDirectory, "task.json"));
  const policy = await parsePolicyFile(join(donebondDirectory, "policy.yml"), repositoryRoot);
  const suppliedName = options.bundlePath ?? `${task.publicId}.evidence.json`;
  if (
    basename(suppliedName) !== suppliedName ||
    !/^[A-Za-z0-9._-]+\.evidence\.json$/u.test(suppliedName)
  ) {
    throw new CliError(
      "REPOSITORY_UNSAFE_PATH",
      "Evidence input must be a simple .evidence.json filename inside .donebond.",
      ExitCode.Repository
    );
  }
  const unknownBundle = await readBoundedBundle(join(donebondDirectory, suppliedName));
  const parsed = EvidenceBundleSchema.safeParse(unknownBundle);
  if (!parsed.success) {
    throw new CliError(
      "VERIFICATION_FAILED",
      "Evidence is diagnostic-only or does not match the canonical bundle schema.",
      ExitCode.Verification
    );
  }
  const gitState = await collectGitState({
    cwd: repositoryRoot,
    expectedCommit: parsed.data.git.objectId,
    policy: policy.policy
  });
  const verified = verifyBundle(parsed.data, {
    policy,
    taskHash: task.taskHash,
    policyHash: task.policyHash,
    commitHash: parsed.data.git.derivedCommitHash,
    gitState
  });
  if (!verified.bundle.result.passing) {
    throw new CliError(
      "VERIFICATION_FAILED",
      "Only passing evidence can be submitted.",
      ExitCode.Verification
    );
  }
  const connection = await loadConnection(repositoryRoot, options.environment);
  if (connection.projectId !== task.projectPublicId) {
    throw new CliError(
      "CONFIG_INVALID",
      "Configured project does not match the evidence task.",
      ExitCode.Configuration
    );
  }
  const idempotencyKey = `evidence-${verified.evidenceHash.slice(2, 34)}`;
  const raw = await authenticatedPostJson(
    connection,
    `/api/v1/projects/${encodeURIComponent(connection.projectId)}/evidence`,
    { evidence: verified.bundle },
    idempotencyKey,
    options.fetchImplementation
  );
  let response: { publicId: string };
  try {
    response = parseUploadResponse(raw, {
      taskPublicId: task.publicId,
      projectPublicId: task.projectPublicId,
      evidenceHash: verified.evidenceHash,
      commitHash: verified.bundle.git.derivedCommitHash
    });
  } catch (cause) {
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond API returned commitments that do not match the local evidence.",
      ExitCode.Network,
      { cause }
    );
  }
  return {
    evidencePublicId: response.publicId,
    taskPublicId: task.publicId,
    evidenceHash: verified.evidenceHash,
    commitHash: verified.bundle.git.derivedCommitHash,
    publicEvidenceUrl: `${connection.apiUrl}/api/v1/evidence/${response.publicId}`,
    taskUrl: `${connection.apiUrl}/tasks/${task.publicId}`
  };
}
