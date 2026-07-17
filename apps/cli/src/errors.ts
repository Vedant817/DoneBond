export enum ExitCode {
  Success = 0,
  Usage = 2,
  Configuration = 3,
  Repository = 4,
  Network = 5,
  Conflict = 6,
  Internal = 70
}

export type CliErrorCode =
  | "CLI_USAGE"
  | "CONFIG_INVALID"
  | "CONFIG_UNSAFE_PATH"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_UNSAFE_PATH"
  | "POLICY_EXISTS"
  | "CONNECTION_FAILED"
  | "INTERNAL_ERROR";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: ExitCode;

  constructor(code: CliErrorCode, message: string, exitCode: ExitCode, options?: ErrorOptions) {
    super(message, options);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  return new CliError(
    "INTERNAL_ERROR",
    "DoneBond encountered an unexpected error. Re-run with valid inputs or report the failure.",
    ExitCode.Internal,
    { cause: error }
  );
}
