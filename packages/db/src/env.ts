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
    DATABASE_SSL: z.enum(["require", "verify-full", "disable"]).default("require"),
    DATABASE_CA_CERT: z.string().min(1).optional()
  })
  .superRefine((value, context) => {
    if (value.DATABASE_SSL === "verify-full" && !value.DATABASE_CA_CERT) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_CA_CERT"],
        message: "DATABASE_CA_CERT is required when DATABASE_SSL is verify-full"
      });
    }
    if (value.DATABASE_SSL === "disable" && !isLoopbackDatabase(value.DATABASE_URL)) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_SSL"],
        message: "DATABASE_SSL may be disabled only for a loopback database"
      });
    }
  });

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

export function isLoopbackDatabase(databaseUrl: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname);
}

export function parseDatabaseEnvironment(
  environment: Record<string, string | undefined>
): DatabaseEnvironment {
  return databaseEnvironmentSchema.parse(environment);
}
