import { join } from "node:path";

import { parsePolicyFile } from "@donebond/evidence";

import { CliError, ExitCode } from "./errors.js";
import { discoverRepository } from "./git.js";

export interface ValidatePolicyOptions {
  readonly startDirectory: string;
  readonly policyPath?: string;
}

export interface ValidatedPolicySummary {
  readonly repositoryRoot: string;
  readonly policyPath: string;
  readonly policyHash: `0x${string}`;
  readonly checks: readonly {
    readonly key: string;
    readonly label: string;
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly timeoutSeconds: number;
    readonly required: boolean;
  }[];
}

export async function validatePolicyCommand(
  options: ValidatePolicyOptions
): Promise<ValidatedPolicySummary> {
  const repositoryRoot = await discoverRepository(options.startDirectory);
  const policyPath = options.policyPath ?? join(repositoryRoot, ".donebond", "policy.yml");
  const parsed = await parsePolicyFile(policyPath, repositoryRoot);
  if (parsed.policy.checks.length === 0) {
    throw new CliError(
      "POLICY_INVALID",
      "The policy must contain at least one verification check.",
      ExitCode.Configuration
    );
  }
  return {
    repositoryRoot,
    policyPath,
    policyHash: parsed.policyHash,
    checks: parsed.policy.checks.map((check) => ({
      key: check.key,
      label: check.label,
      executable: check.executable,
      args: check.args,
      cwd: check.cwd,
      timeoutSeconds: check.timeoutSeconds,
      required: check.required
    }))
  };
}

export function renderPolicySummary(summary: ValidatedPolicySummary): string {
  const checks = summary.checks.map((check) => {
    const command = [check.executable, ...check.args]
      .map((value) => JSON.stringify(value))
      .join(" ");
    return `- ${check.key} (${check.required ? "required" : "optional"})\n  command: ${command}\n  cwd: ${check.cwd}\n  timeout: ${check.timeoutSeconds}s`;
  });
  return [`Policy valid: ${summary.policyHash}`, ...checks].join("\n");
}
