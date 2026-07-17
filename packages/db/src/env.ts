import { z } from "zod";

const databaseEnvironmentSchema = z
  .object({
    DATABASE_URL: z
      .url()
      .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
        message: "DATABASE_URL must use the postgres or postgresql scheme"
      }),
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(20),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    DATABASE_SSL: z.enum(["require", "disable"]).default("require")
  })
  .superRefine((value, context) => {
    const hostname = new URL(value.DATABASE_URL).hostname;
    if (
      value.DATABASE_SSL === "disable" &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1"
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_SSL"],
        message: "DATABASE_SSL may be disabled only for a loopback database"
      });
    }
  });

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

export function parseDatabaseEnvironment(
  environment: Record<string, string | undefined>
): DatabaseEnvironment {
  return databaseEnvironmentSchema.parse(environment);
}
