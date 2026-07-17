export type EvidenceErrorCode =
  | "BUNDLE_HASH_MISMATCH"
  | "BUNDLE_INVALID"
  | "GIT_COMMIT_MISMATCH"
  | "GIT_COMMAND_FAILED"
  | "GIT_NO_COMMITS"
  | "GIT_NOT_REPOSITORY"
  | "GIT_REMOTE_INVALID"
  | "POLICY_HASH_MISMATCH"
  | "POLICY_INVALID"
  | "POLICY_PATH_OUTSIDE_REPOSITORY"
  | "POLICY_UNSAFE_COMMAND"
  | "PROCESS_EXECUTION_FAILED"
  | "RESIDUAL_SECRET";

export interface EvidenceErrorOptions {
  readonly cause?: unknown;
  readonly fieldPath?: string;
}

export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;
  readonly fieldPath?: string;

  constructor(code: EvidenceErrorCode, message: string, options: EvidenceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EvidenceError";
    this.code = code;
    if (options.fieldPath !== undefined) {
      this.fieldPath = options.fieldPath;
    }
  }
}
