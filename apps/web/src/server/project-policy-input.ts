import { parsePolicyText, type ParsedPolicy } from "@donebond/evidence";
import {
  BranchNameSchema,
  ERROR_CODES,
  GitHubRepositoryUrlSchema,
  ProjectSlugSchema
} from "@donebond/shared";

import { HttpError } from "./http.ts";

const SOURCE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)[^\0-\x1f\x7f]{1,512}$/u;

export interface CreateProjectInput {
  readonly slug: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly defaultBranch: string;
  readonly visibility: "private" | "public";
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly repositoryUrl?: string;
  readonly defaultBranch?: string;
  readonly visibility?: "private" | "public";
  readonly status?: "active" | "archived";
}

export interface PolicyUploadInput {
  readonly sourcePath: string;
  readonly activate: boolean;
  readonly parsed: ParsedPolicy;
}

function invalid(message: string): HttpError {
  return new HttpError(ERROR_CODES.VALIDATION_INVALID_INPUT, message, 400);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw invalid("Request contains an unknown field");
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw invalid(`${field} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\x00-\x1f\x7f]/u.test(normalized)
  ) {
    throw invalid(`${field} is invalid`);
  }
  return normalized;
}

function visibility(value: unknown): "private" | "public" {
  if (value !== "private" && value !== "public") {
    throw invalid("visibility must be private or public");
  }
  return value;
}

function branch(value: unknown): string {
  try {
    return BranchNameSchema.parse(value);
  } catch (cause) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "defaultBranch is not a safe Git branch name",
      400,
      { cause }
    );
  }
}

function repositoryUrl(value: unknown): string {
  try {
    return GitHubRepositoryUrlSchema.parse(value);
  } catch (cause) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "repositoryUrl must identify a credential-free HTTPS GitHub repository",
      400,
      { cause }
    );
  }
}

export function parseCreateProjectInput(value: unknown): CreateProjectInput {
  const input = record(value);
  exactKeys(input, ["slug", "name", "repositoryUrl", "defaultBranch", "visibility"]);
  let slug: string;
  try {
    slug = ProjectSlugSchema.parse(input.slug);
  } catch (cause) {
    throw new HttpError(
      ERROR_CODES.VALIDATION_INVALID_INPUT,
      "slug must be normalized lowercase kebab-case",
      400,
      { cause }
    );
  }
  return {
    slug,
    name: text(input.name, "name", 120),
    repositoryUrl: repositoryUrl(input.repositoryUrl),
    defaultBranch: branch(input.defaultBranch),
    visibility: visibility(input.visibility)
  };
}

export function parseUpdateProjectInput(value: unknown): UpdateProjectInput {
  const input = record(value);
  exactKeys(input, ["name", "repositoryUrl", "defaultBranch", "visibility", "status"]);
  if (Object.keys(input).length === 0) throw invalid("At least one project field is required");
  return {
    ...(input.name === undefined ? {} : { name: text(input.name, "name", 120) }),
    ...(input.repositoryUrl === undefined
      ? {}
      : { repositoryUrl: repositoryUrl(input.repositoryUrl) }),
    ...(input.defaultBranch === undefined ? {} : { defaultBranch: branch(input.defaultBranch) }),
    ...(input.visibility === undefined ? {} : { visibility: visibility(input.visibility) }),
    ...(input.status === undefined
      ? {}
      : input.status === "active" || input.status === "archived"
        ? { status: input.status }
        : (() => {
            throw invalid("status must be active or archived");
          })())
  };
}

export function parsePolicyUploadInput(value: unknown): PolicyUploadInput {
  const input = record(value);
  exactKeys(input, ["sourcePath", "yaml", "activate"]);
  const sourcePath = input.sourcePath;
  if (
    typeof sourcePath !== "string" ||
    sourcePath !== sourcePath.normalize("NFC") ||
    !SOURCE_PATH.test(sourcePath)
  ) {
    throw new HttpError(
      ERROR_CODES.POLICY_PATH_OUTSIDE_REPOSITORY,
      "sourcePath must be a repository-relative POSIX path",
      400
    );
  }
  if (typeof input.yaml !== "string" || Buffer.byteLength(input.yaml, "utf8") > 131_072) {
    throw invalid("yaml must be a string no larger than 128 KiB");
  }
  if (typeof input.activate !== "boolean") throw invalid("activate must be a boolean");
  try {
    return {
      sourcePath,
      activate: input.activate,
      parsed: parsePolicyText(input.yaml, { repositoryRoot: "/", sourcePath })
    };
  } catch (cause) {
    const code =
      cause !== null && typeof cause === "object" && "code" in cause
        ? String((cause as { code: unknown }).code)
        : "";
    const stableCode =
      code === ERROR_CODES.POLICY_UNSAFE_COMMAND
        ? ERROR_CODES.POLICY_UNSAFE_COMMAND
        : code === ERROR_CODES.POLICY_PATH_OUTSIDE_REPOSITORY
          ? ERROR_CODES.POLICY_PATH_OUTSIDE_REPOSITORY
          : ERROR_CODES.POLICY_INVALID;
    throw new HttpError(stableCode, "Verification policy is invalid", 400, { cause });
  }
}
