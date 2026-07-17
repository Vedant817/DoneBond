import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  CanonicalTaskV1Schema,
  CheckResultSchema,
  EvidenceBundleSchema,
  type CanonicalTaskV1,
  type CheckResult,
  type EvidenceBundle
} from "@donebond/shared";
import { keccak256, toBytes } from "viem";

import { canonicalJson, canonicalKeccak256, deriveCommitHash } from "./canonical.js";
import { EvidenceError } from "./errors.js";
import { toPublicGitEvidence, type CollectedGitState } from "./git.js";
import type { ParsedPolicy } from "./policy.js";
import { assertNoResidualSecrets } from "./redaction.js";
import { getCheckRedactionCounts } from "./runner.js";

export interface EvidenceToolMetadata {
  readonly name: "donebond-cli";
  readonly version: string;
  readonly platform: string;
  readonly nodeVersion: string;
}

export interface BuildEvidenceBundleInput {
  readonly task: { readonly publicId: string; readonly taskHash: string };
  readonly policy: ParsedPolicy;
  readonly git: CollectedGitState;
  readonly checks: readonly CheckResult[];
  readonly tool: EvidenceToolMetadata;
  readonly redactions?: Readonly<Record<string, number>>;
}

export interface BuiltEvidenceBundle {
  readonly bundle: EvidenceBundle;
  readonly canonicalJson: string;
  readonly evidenceHash: `0x${string}`;
}

export interface VerifyBundleExpectations {
  readonly policy: ParsedPolicy;
  readonly taskHash?: string;
  readonly policyHash?: string;
  readonly evidenceHash?: string;
  readonly commitHash?: string;
  readonly gitState?: CollectedGitState;
}

export interface VerifiedEvidenceBundle extends BuiltEvidenceBundle {
  readonly verified: true;
}

function mergeRedactions(
  supplied: Readonly<Record<string, number>>,
  checks: readonly CheckResult[]
): Record<string, number> {
  const merged: Record<string, number> = { ...supplied };
  for (const check of checks) {
    for (const [category, count] of Object.entries(getCheckRedactionCounts(check))) {
      merged[category] = (merged[category] ?? 0) + count;
    }
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}

function assertChecksMatchPolicy(checks: readonly CheckResult[], policy: ParsedPolicy): void {
  const resultKeys = checks.map((check) => check.key);
  if (new Set(resultKeys).size !== resultKeys.length) {
    throw new EvidenceError("BUNDLE_INVALID", "Evidence contains duplicate check keys");
  }
  const policyKeys = new Set(policy.policy.checks.map((check) => check.key));
  const unknown = resultKeys.find((key) => !policyKeys.has(key));
  if (unknown !== undefined) {
    throw new EvidenceError("BUNDLE_INVALID", `Evidence contains unknown check ${unknown}`);
  }
  const missing = policy.policy.checks.find((check) => !resultKeys.includes(check.key));
  if (missing !== undefined) {
    throw new EvidenceError(
      "BUNDLE_INVALID",
      `Evidence is missing ${missing.required ? "required" : "declared"} check ${missing.key}`
    );
  }
  for (const result of checks) {
    const declared = policy.policy.checks.find((check) => check.key === result.key);
    if (declared?.required !== result.required) {
      throw new EvidenceError(
        "BUNDLE_INVALID",
        `Evidence required flag does not match policy for check ${result.key}`
      );
    }
  }
}

function assertOutputDigests(checks: readonly CheckResult[]): void {
  for (const check of checks) {
    for (const [stream, output] of [
      ["stdout", check.stdout],
      ["stderr", check.stderr]
    ] as const) {
      if (!output.truncated && keccak256(toBytes(output.preview)) !== output.digest) {
        throw new EvidenceError(
          "BUNDLE_HASH_MISMATCH",
          `${check.key} ${stream} digest does not match its complete preview`
        );
      }
    }
  }
}

function branchMatches(pattern: string, branch: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "u").test(branch);
}

function staticGitPolicyFailures(
  git: Pick<CollectedGitState, "branch" | "clean" | "remote">,
  policy: ParsedPolicy
): string[] {
  const failures: string[] = [];
  if (policy.policy.repository.requireCleanWorkingTree && !git.clean) {
    failures.push("GIT_DIRTY");
  }
  if (
    !policy.policy.repository.allowedBranches.some((allowed) => branchMatches(allowed, git.branch))
  ) {
    failures.push("GIT_BRANCH_NOT_ALLOWED");
  }
  const expectedOwner = policy.policy.repository.expectedRemoteOwner?.toLowerCase();
  if (expectedOwner !== undefined && git.remote.split("/")[1]?.toLowerCase() !== expectedOwner) {
    failures.push("GIT_REMOTE_OWNER_MISMATCH");
  }
  return failures;
}

function deriveResult(checks: readonly CheckResult[], git: CollectedGitState) {
  const required = checks.filter((check) => check.required);
  const requiredPassed = required.filter(
    (check) => check.status === "passed" && check.exitCode === 0
  ).length;
  const failures = new Set<string>(git.constraintFailures);
  if (!git.clean || git.changedFiles.length > 0 || git.changedFilesTruncated) {
    failures.add("GIT_DIRTY");
  }
  for (const check of required) {
    if (check.status !== "passed" || check.exitCode !== 0) {
      failures.add(`CHECK_${check.status.toUpperCase()}:${check.key}`);
    }
  }
  const failureCodes = [...failures].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return {
    passing: required.length > 0 && requiredPassed === required.length && failureCodes.length === 0,
    requiredPassed,
    requiredTotal: required.length,
    failureCodes
  };
}

export function hashCanonicalTask(task: CanonicalTaskV1): `0x${string}` {
  return canonicalKeccak256(CanonicalTaskV1Schema.parse(task));
}

export function buildEvidenceBundle(input: BuildEvidenceBundleInput): BuiltEvidenceBundle {
  const checks = input.checks.map((check) => CheckResultSchema.parse(check));
  assertChecksMatchPolicy(checks, input.policy);
  assertOutputDigests(checks);
  const repositoryFailures = [
    ...input.git.constraintFailures,
    ...staticGitPolicyFailures(input.git, input.policy)
  ].filter((failure) => failure !== "GIT_DIRTY");
  if (repositoryFailures.length > 0) {
    throw new EvidenceError(
      "BUNDLE_INVALID",
      `Repository violates policy constraints: ${[...new Set(repositoryFailures)].join(", ")}`
    );
  }
  if (
    input.policy.policy.repository.baseCommit !== undefined &&
    input.git.baseCommitVerified !== true
  ) {
    throw new EvidenceError(
      "BUNDLE_INVALID",
      "Base commit ancestry was not verified in the collected repository context"
    );
  }
  const candidate = {
    schemaVersion: 1 as const,
    task: input.task,
    policy: {
      policyHash: input.policy.policyHash,
      sourcePath: input.policy.sourcePath
    },
    git: toPublicGitEvidence(input.git),
    checks,
    result: deriveResult(checks, input.git),
    tool: input.tool,
    redactions: mergeRedactions(input.redactions ?? {}, input.checks)
  };
  const bundle = EvidenceBundleSchema.parse(candidate);
  assertNoResidualSecrets(JSON.stringify(bundle));
  const serialized = canonicalJson(bundle);
  return { bundle, canonicalJson: serialized, evidenceHash: canonicalKeccak256(bundle) };
}

export function verifyBundle(
  unknownBundle: unknown,
  expectations: VerifyBundleExpectations
): VerifiedEvidenceBundle {
  let bundle: EvidenceBundle;
  try {
    bundle = EvidenceBundleSchema.parse(unknownBundle);
  } catch (cause) {
    throw new EvidenceError(
      "BUNDLE_INVALID",
      "Evidence bundle schema or derived state is invalid",
      {
        cause
      }
    );
  }
  assertChecksMatchPolicy(bundle.checks, expectations.policy);
  assertOutputDigests(bundle.checks);
  if (bundle.result.passing) {
    const policyFailures = staticGitPolicyFailures(bundle.git, expectations.policy);
    if (policyFailures.length > 0) {
      throw new EvidenceError(
        "BUNDLE_INVALID",
        `Passing evidence violates policy constraints: ${policyFailures.join(", ")}`
      );
    }
  }
  if (bundle.policy.policyHash !== expectations.policy.policyHash) {
    throw new EvidenceError("POLICY_HASH_MISMATCH", "Bundle policy hash does not match policy");
  }
  if (
    expectations.policyHash !== undefined &&
    bundle.policy.policyHash !== expectations.policyHash
  ) {
    throw new EvidenceError(
      "POLICY_HASH_MISMATCH",
      "Bundle policy hash does not match expectation"
    );
  }
  if (expectations.taskHash !== undefined && bundle.task.taskHash !== expectations.taskHash) {
    throw new EvidenceError("BUNDLE_HASH_MISMATCH", "Bundle task hash does not match expectation");
  }
  const derivedCommit = deriveCommitHash(bundle.git.objectId);
  if (derivedCommit !== bundle.git.derivedCommitHash) {
    throw new EvidenceError(
      "GIT_COMMIT_MISMATCH",
      "Bundle commit hash is not derived from object ID"
    );
  }
  if (expectations.commitHash !== undefined && derivedCommit !== expectations.commitHash) {
    throw new EvidenceError("GIT_COMMIT_MISMATCH", "Bundle commit hash does not match expectation");
  }
  if (expectations.policy.policy.repository.baseCommit !== undefined) {
    if (
      expectations.gitState === undefined ||
      expectations.gitState.objectId !== bundle.git.objectId ||
      expectations.gitState.baseCommitVerified !== true
    ) {
      throw new EvidenceError(
        "BUNDLE_INVALID",
        "Base commit ancestry requires matching independently collected repository context"
      );
    }
  }
  assertNoResidualSecrets(JSON.stringify(bundle));
  const serialized = canonicalJson(bundle);
  const evidenceHash = canonicalKeccak256(bundle);
  if (expectations.evidenceHash !== undefined && evidenceHash !== expectations.evidenceHash) {
    throw new EvidenceError(
      "BUNDLE_HASH_MISMATCH",
      "Bundle evidence hash does not match expectation"
    );
  }
  return { bundle, canonicalJson: serialized, evidenceHash, verified: true };
}

export async function writeEvidenceBundle(filePath: string, bundle: EvidenceBundle): Promise<void> {
  const validated = EvidenceBundleSchema.parse(bundle);
  assertNoResidualSecrets(JSON.stringify(validated));
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
