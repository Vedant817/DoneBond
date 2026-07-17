import { TextDecoder } from "node:util";

import { keccak256, toBytes } from "viem";

import { EvidenceError } from "./errors.js";

interface SecretPattern {
  readonly category: string;
  readonly expression: RegExp;
}

const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    category: "github_token",
    expression: /\b(?:gh[pousr]_(?:\s*[A-Za-z0-9]){20,}|github_pat_(?:\s*[A-Za-z0-9_]){20,})\b/giu
  },
  {
    category: "bearer_token",
    expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu
  },
  {
    category: "aws_access_key",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu
  },
  {
    category: "database_url",
    expression: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/giu
  },
  {
    category: "private_key",
    expression: /\b(?:PRIVATE[_ -]?KEY|SECRET[_ -]?KEY)\s*[:=]\s*(?:0x)?[0-9a-f]{64}\b/giu
  },
  {
    category: "seed_phrase",
    expression: /\b(?:MNEMONIC|SEED[_ -]?PHRASE)\s*[:=]\s*(?:[a-z]{3,12}\s+){11,23}[a-z]{3,12}\b/giu
  }
];

export interface RedactionResult {
  readonly text: string;
  readonly counts: Readonly<Record<string, number>>;
}

export interface BoundedRedactedOutput {
  readonly preview: string;
  readonly digest: `0x${string}`;
  readonly originalBytes: number;
  readonly truncated: boolean;
  readonly redactions: Readonly<Record<string, number>>;
}

export function validateProjectRedactionPattern(pattern: string): void {
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, "gu");
  } catch (cause) {
    throw new EvidenceError("POLICY_INVALID", "Invalid project redaction regular expression", {
      cause
    });
  }
  if (pattern.includes("(") || pattern.includes(")") || /\\[1-9]/u.test(pattern)) {
    throw new EvidenceError(
      "POLICY_INVALID",
      "Project redaction patterns may not contain groups or backreferences"
    );
  }
  if (expression.test("")) {
    throw new EvidenceError("POLICY_INVALID", "Project redaction pattern may not match empty text");
  }
}

function compileProjectPatterns(patterns: readonly string[]): SecretPattern[] {
  return patterns.map((pattern, index) => {
    validateProjectRedactionPattern(pattern);
    return { category: `project_${index + 1}`, expression: new RegExp(pattern, "giu") };
  });
}

function addCount(counts: Record<string, number>, category: string, amount: number): void {
  if (amount > 0) {
    counts[category] = (counts[category] ?? 0) + amount;
  }
}

export function redactText(text: string, projectPatterns: readonly string[] = []): RedactionResult {
  let redacted = text.normalize("NFC");
  const counts: Record<string, number> = {};
  for (const pattern of [...DEFAULT_SECRET_PATTERNS, ...compileProjectPatterns(projectPatterns)]) {
    let matches = 0;
    redacted = redacted.replace(pattern.expression, () => {
      matches += 1;
      return `[REDACTED:${pattern.category}]`;
    });
    addCount(counts, pattern.category, matches);
  }
  return { text: redacted, counts };
}

export function decodeAndRedact(
  bytes: Uint8Array,
  projectPatterns: readonly string[] = []
): RedactionResult {
  let decoded: string;
  let malformed = false;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder("utf-8").decode(bytes);
    malformed = true;
  }
  const result = redactText(decoded, projectPatterns);
  if (!malformed) {
    return result;
  }
  const replacements = result.text.match(/\uFFFD/gu)?.length ?? 0;
  return {
    text: result.text.replace(/\uFFFD+/gu, "[REDACTED:binary]"),
    counts: { ...result.counts, binary: Math.max(1, replacements) }
  };
}

function utf8Prefix(text: string, maximumBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) {
    return text;
  }
  const bytes = Buffer.from(text, "utf8");
  let end = maximumBytes;
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) < 0xc0) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

export function createBoundedOutput(
  bytes: Uint8Array,
  maximumBytes: number,
  projectPatterns: readonly string[] = [],
  originalBytes = bytes.byteLength
): BoundedRedactedOutput {
  const redacted = decodeAndRedact(bytes, projectPatterns);
  const redactedBytes = Buffer.byteLength(redacted.text, "utf8");
  const truncated = redactedBytes > maximumBytes || originalBytes > bytes.byteLength;
  const marker = truncated ? `\n[TRUNCATED:original-bytes=${originalBytes}]` : "";
  const prefixBudget = Math.max(0, maximumBytes - Buffer.byteLength(marker, "utf8"));
  const preview = `${utf8Prefix(redacted.text, prefixBudget)}${marker}`;
  return {
    preview,
    digest: keccak256(toBytes(redacted.text)),
    originalBytes,
    truncated,
    redactions: redacted.counts
  };
}

export function findResidualSecrets(text: string): readonly string[] {
  const categories: string[] = [];
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(text)) {
      categories.push(pattern.category);
    }
  }
  return categories;
}

export function assertNoResidualSecrets(text: string): void {
  const categories = findResidualSecrets(text);
  if (categories.length > 0) {
    throw new EvidenceError(
      "RESIDUAL_SECRET",
      `Residual high-confidence secret categories: ${categories.join(", ")}`
    );
  }
}
