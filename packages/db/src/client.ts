import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";

import { parseDatabaseEnvironment, type DatabaseEnvironment } from "./env.js";
import { databaseSchema } from "./schema.js";

export interface DatabaseHandle {
  readonly db: PostgresJsDatabase<typeof databaseSchema>;
  readonly environment: DatabaseEnvironment;
  close(): Promise<void>;
}

export function buildPostgresOptions(
  environment: DatabaseEnvironment
): postgres.Options<Record<never, never>> {
  return {
    connect_timeout: environment.DATABASE_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: environment.DATABASE_IDLE_TIMEOUT_SECONDS,
    max: environment.DATABASE_MAX_CONNECTIONS,
    // Supavisor transaction pooling (the recommended Vercel connection mode)
    // cannot retain session-scoped prepared statements between requests.
    prepare: false,
    ssl:
      environment.DATABASE_SSL === "require"
        ? {
            rejectUnauthorized: true,
            ...(environment.DATABASE_CA_CERT ? { ca: environment.DATABASE_CA_CERT } : {})
          }
        : false
  };
}

export function createDatabase(
  environmentSource: Record<string, string | undefined> = process.env
): DatabaseHandle {
  const environment = parseDatabaseEnvironment(environmentSource);
  const sql: Sql = postgres(environment.DATABASE_URL, buildPostgresOptions(environment));
  return {
    db: drizzle(sql, { schema: databaseSchema }),
    environment,
    close: async () => sql.end({ timeout: 5 })
  };
}

export async function checkDatabaseHealth(
  environmentSource: Record<string, string | undefined> = process.env
): Promise<boolean> {
  const database = createDatabase(environmentSource);
  try {
    await database.db.execute(drizzleSql`select 1`);
    return true;
  } finally {
    await database.close();
  }
}
