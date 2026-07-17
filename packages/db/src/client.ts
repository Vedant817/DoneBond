import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { parseDatabaseEnvironment, type DatabaseEnvironment } from "./env.js";
import { databaseSchema } from "./schema.js";

export interface DatabaseHandle {
  readonly db: PostgresJsDatabase<typeof databaseSchema>;
  readonly environment: DatabaseEnvironment;
  close(): Promise<void>;
}

export function createDatabase(
  environmentSource: Record<string, string | undefined> = process.env
): DatabaseHandle {
  const environment = parseDatabaseEnvironment(environmentSource);
  const sql: Sql = postgres(environment.DATABASE_URL, {
    connect_timeout: environment.DATABASE_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: environment.DATABASE_IDLE_TIMEOUT_SECONDS,
    max: environment.DATABASE_MAX_CONNECTIONS,
    prepare: true,
    ssl: environment.DATABASE_SSL === "require" ? "require" : false
  });
  return {
    db: drizzle(sql, { schema: databaseSchema }),
    environment,
    close: async () => sql.end({ timeout: 5 })
  };
}
