import {
  AcceptanceCriterionSchema,
  BranchNameSchema,
  DecimalWeiSchema,
  GitObjectIdSchema,
  NonZeroEthereumAddressSchema,
  SupportedChainIdSchema
} from "@donebond/shared";

import { HttpError } from "./http.ts";
import { ERROR_CODES } from "@donebond/shared";

const MAX_UINT96 = (1n << 96n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly targetBranch: string;
  readonly baseCommit: string | null;
  readonly acceptanceCriteria: readonly { readonly key: string; readonly description: string }[];
  readonly assigneeWallet: string;
  readonly deadline: Date | null;
  readonly deadlineUnixSeconds: string | null;
  readonly rewardWei: string;
  readonly chainId: 143 | 10_143;
}

function invalid(message: string, cause?: unknown): HttpError {
  return new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, message, 400, { cause });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
  const allowed = new Set([
    "title",
    "description",
    "targetBranch",
    "baseCommit",
    "acceptanceCriteria",
    "assigneeWallet",
    "deadline",
    "rewardWei",
    "chainId"
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalid("Request contains an unknown field");
  }
}

function normalizedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw invalid(`${field} must be a string`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0 || normalized.length > maximum || /\0/u.test(normalized)) {
    throw invalid(`${field} is invalid`);
  }
  return normalized;
}

function deadline(
  value: unknown,
  now: Date
): Pick<CreateTaskInput, "deadline" | "deadlineUnixSeconds"> {
  if (value === null) return { deadline: null, deadlineUnixSeconds: null };
  if (typeof value !== "string") throw invalid("deadline must be an ISO timestamp or null");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw invalid("deadline must be a canonical UTC ISO timestamp");
  }
  if (parsed.getMilliseconds() !== 0) throw invalid("deadline must use whole seconds");
  const seconds = BigInt(parsed.getTime() / 1000);
  if (seconds <= BigInt(Math.floor(now.getTime() / 1000))) {
    throw invalid("deadline must be in the future");
  }
  if (seconds > MAX_UINT64) throw invalid("deadline exceeds uint64");
  return { deadline: parsed, deadlineUnixSeconds: seconds.toString() };
}

export function parseCreateTaskInput(value: unknown, now: Date): CreateTaskInput {
  const input = object(value);
  exactKeys(input);
  let targetBranch: string;
  let baseCommit: string | null;
  let acceptanceCriteria: CreateTaskInput["acceptanceCriteria"];
  let assigneeWallet: string;
  let rewardWei: string;
  let chainId: CreateTaskInput["chainId"];
  try {
    targetBranch = BranchNameSchema.parse(input.targetBranch);
    baseCommit = input.baseCommit === null ? null : GitObjectIdSchema.parse(input.baseCommit);
    acceptanceCriteria = AcceptanceCriterionSchema.array()
      .min(1)
      .max(100)
      .parse(input.acceptanceCriteria);
    if (
      new Set(acceptanceCriteria.map((criterion) => criterion.key)).size !==
      acceptanceCriteria.length
    ) {
      throw new TypeError("Duplicate acceptance criterion key");
    }
    assigneeWallet = NonZeroEthereumAddressSchema.parse(input.assigneeWallet);
    rewardWei = DecimalWeiSchema.parse(input.rewardWei);
    if (BigInt(rewardWei) > MAX_UINT96) throw new TypeError("Reward exceeds uint96");
    chainId = SupportedChainIdSchema.parse(input.chainId);
  } catch (cause) {
    throw invalid("Task fields are invalid", cause);
  }
  return {
    title: normalizedText(input.title, "title", 200),
    description: normalizedText(input.description, "description", 20_000),
    targetBranch,
    baseCommit,
    acceptanceCriteria,
    assigneeWallet,
    ...deadline(input.deadline, now),
    rewardWei,
    chainId
  };
}
