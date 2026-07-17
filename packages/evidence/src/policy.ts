import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CanonicalPolicyV1Schema,
  VerificationPolicySchema,
  type CanonicalPolicyV1,
  type VerificationPolicy
} from "@donebond/shared";
import { parseDocument } from "yaml";

import { canonicalJson, canonicalKeccak256 } from "./canonical.js";
import { EvidenceError } from "./errors.js";
import { resolveRepositoryPath } from "./path-safety.js";
import { validateProjectRedactionPattern } from "./redaction.js";

const SAFE_EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,127}$/;
const SHELL_WRAPPERS = new Set([
  "ash",
  "bash",
  "cmd",
  "cmd.exe",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "powershell.exe",
  "pwsh",
  "sh",
  "zsh"
]);

export interface ParsedPolicy {
  readonly policy: VerificationPolicy;
  readonly canonicalPolicy: CanonicalPolicyV1;
  readonly canonicalJson: string;
  readonly policyHash: `0x${string}`;
  readonly sourcePath: string;
}

export interface ParsePolicyOptions {
  readonly repositoryRoot: string;
  readonly sourcePath?: string;
}

function fieldPath(pathParts: readonly PropertyKey[]): string {
  return pathParts.reduce<string>((result, part) => {
    return typeof part === "number" ? `${result}[${part}]` : `${result}.${String(part)}`;
  }, "$policy");
}

function validatePattern(pattern: string, index: number): void {
  try {
    validateProjectRedactionPattern(pattern);
  } catch (cause) {
    throw new EvidenceError("POLICY_INVALID", "Invalid or unsafe project redaction expression", {
      cause,
      fieldPath: `redaction.additionalPatterns[${index}]`
    });
  }
}

function validatePolicySafety(policy: VerificationPolicy, repositoryRoot: string): void {
  policy.redaction.additionalPatterns.forEach(validatePattern);
  policy.checks.forEach((check, index) => {
    const executable = check.executable.toLowerCase();
    if (!SAFE_EXECUTABLE.test(check.executable) || SHELL_WRAPPERS.has(executable)) {
      throw new EvidenceError(
        "POLICY_UNSAFE_COMMAND",
        `Check ${check.key} uses an unsafe executable definition`,
        { fieldPath: `checks[${index}].executable` }
      );
    }
    check.args.forEach((argument, argumentIndex) => {
      if (argument.includes("\0")) {
        throw new EvidenceError("POLICY_UNSAFE_COMMAND", "Command arguments may not contain NUL", {
          fieldPath: `checks[${index}].args[${argumentIndex}]`
        });
      }
    });
    try {
      resolveRepositoryPath(repositoryRoot, check.cwd);
    } catch (cause) {
      if (cause instanceof EvidenceError) {
        throw new EvidenceError(cause.code, cause.message, {
          cause,
          fieldPath: `checks[${index}].cwd`
        });
      }
      throw cause;
    }
  });
}

export function canonicalizePolicy(policy: VerificationPolicy): CanonicalPolicyV1 {
  const { policyHash: _discardedPolicyHash, ...withoutHash } = policy;
  return CanonicalPolicyV1Schema.parse({ kind: "donebond.policy", ...withoutHash });
}

export function parsePolicyText(text: string, options: ParsePolicyOptions): ParsedPolicy {
  const sourcePath = options.sourcePath ?? "donebond.policy.yml";
  let unknownPolicy: unknown;
  try {
    const document = parseDocument(text, {
      merge: false,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true
    });
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
    unknownPolicy = document.toJS({ maxAliasCount: 0 });
  } catch (cause) {
    throw new EvidenceError(
      "POLICY_INVALID",
      `${sourcePath}: malformed YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, fieldPath: sourcePath }
    );
  }

  const parsed = VerificationPolicySchema.safeParse(unknownPolicy);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const pathLabel = issue === undefined ? "$policy" : fieldPath(issue.path);
    throw new EvidenceError(
      "POLICY_INVALID",
      `${sourcePath}: ${pathLabel}: ${issue?.message ?? "Policy validation failed"}`,
      { cause: parsed.error, fieldPath: pathLabel }
    );
  }
  validatePolicySafety(parsed.data, options.repositoryRoot);
  const canonicalPolicy = canonicalizePolicy(parsed.data);
  const serialized = canonicalJson(canonicalPolicy);
  const policyHash = canonicalKeccak256(canonicalPolicy);
  if (parsed.data.policyHash !== undefined && parsed.data.policyHash !== policyHash) {
    throw new EvidenceError(
      "POLICY_HASH_MISMATCH",
      `${sourcePath}: declared policyHash is incorrect`,
      {
        fieldPath: "$policy.policyHash"
      }
    );
  }
  return {
    policy: parsed.data,
    canonicalPolicy,
    canonicalJson: serialized,
    policyHash,
    sourcePath
  };
}

export async function parsePolicyFile(
  policyPath: string,
  repositoryRoot: string
): Promise<ParsedPolicy> {
  const absolute = path.resolve(policyPath);
  const sourcePath = path.relative(repositoryRoot, absolute).split(path.sep).join("/");
  resolveRepositoryPath(repositoryRoot, sourcePath);
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new EvidenceError("POLICY_INVALID", `${sourcePath}: policy file cannot be read`, {
      cause,
      fieldPath: sourcePath
    });
  }
  return parsePolicyText(text, { repositoryRoot, sourcePath });
}
