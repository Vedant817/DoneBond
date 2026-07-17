export type DatabaseErrorCode =
  "DB_CONFLICT" | "DB_IDEMPOTENCY_CONFLICT" | "DB_INVALID_INPUT" | "DB_NOT_FOUND";

export class DatabaseServiceError extends Error {
  public readonly code: DatabaseErrorCode;

  public constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseServiceError";
    this.code = code;
  }
}

type PostgreSqlError = Error & { code?: string; constraint_name?: string };

export function translateDatabaseError(error: unknown): DatabaseServiceError {
  if (error instanceof DatabaseServiceError) return error;
  if (error instanceof Error && (error as PostgreSqlError).code === "23505") {
    return new DatabaseServiceError(
      "DB_CONFLICT",
      "A record with the same identity already exists",
      {
        cause: error
      }
    );
  }
  return new DatabaseServiceError("DB_INVALID_INPUT", "The database rejected the operation", {
    cause: error
  });
}
