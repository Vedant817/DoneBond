export type DatabaseErrorCode =
  | "DB_CONFLICT"
  | "DB_IDEMPOTENCY_CONFLICT"
  | "DB_INVALID_INPUT"
  | "DB_NOT_FOUND"
  | "DB_POLICY_HASH_CONFLICT"
  | "DB_PROJECT_ARCHIVED"
  | "DB_PROJECT_SLUG_CONFLICT"
  | "DB_REPOSITORY_IMMUTABLE"
  | "DB_TASK_HASH_CONFLICT";

export class DatabaseServiceError extends Error {
  public readonly code: DatabaseErrorCode;

  public constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseServiceError";
    this.code = code;
  }
}

type PostgreSqlError = Error & { code?: string; constraint?: string; constraint_name?: string };

export function translateDatabaseError(error: unknown): DatabaseServiceError {
  if (error instanceof DatabaseServiceError) return error;
  if (error instanceof Error && (error as PostgreSqlError).code === "23505") {
    const constraint =
      (error as PostgreSqlError).constraint_name ?? (error as PostgreSqlError).constraint;
    if (constraint === "projects_owner_slug_unique") {
      return new DatabaseServiceError(
        "DB_PROJECT_SLUG_CONFLICT",
        "A project with this owner and slug already exists",
        { cause: error }
      );
    }
    if (constraint === "policies_project_hash_unique") {
      return new DatabaseServiceError(
        "DB_POLICY_HASH_CONFLICT",
        "This policy hash already identifies an immutable project policy",
        { cause: error }
      );
    }
    if (constraint === "tasks_project_hash_unique") {
      return new DatabaseServiceError(
        "DB_TASK_HASH_CONFLICT",
        "This task hash already identifies a project task",
        { cause: error }
      );
    }
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
