import { z } from "zod";

import { Bytes32Schema, GitObjectIdSchema, NormalizedTextSchema } from "./primitives.js";

export const POLICY_SCHEMA_VERSION = 1 as const;

export const PolicyCheckSchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  label: NormalizedTextSchema.pipe(z.string().max(128)),
  executable: z.string().min(1).max(512),
  args: z.array(z.string().max(4096)).max(100),
  cwd: z.string().min(1).max(512),
  timeoutSeconds: z.number().int().min(1).max(3600),
  required: z.boolean(),
  maxOutputBytes: z.number().int().min(1024).max(1_048_576),
  environmentAllowlist: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(100)
});

const VerificationPolicyObjectSchema = z.strictObject({
  schemaVersion: z.literal(POLICY_SCHEMA_VERSION),
  repository: z.strictObject({
    requireCleanWorkingTree: z.boolean(),
    allowedBranches: z.array(z.string().min(1).max(255)).min(1).max(100),
    expectedRemoteOwner: z.string().min(1).max(255).optional(),
    baseCommit: GitObjectIdSchema.optional()
  }),
  checks: z.array(PolicyCheckSchema).min(1).max(100),
  environment: z.strictObject({
    allow: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(100)
  }),
  redaction: z.strictObject({
    additionalPatterns: z.array(z.string().min(1).max(1024)).max(50)
  }),
  policyHash: Bytes32Schema.optional()
});

function rejectDuplicates(
  value: z.infer<typeof VerificationPolicyObjectSchema>,
  context: z.RefinementCtx
): void {
  if (!value.checks.some((check) => check.required)) {
    context.addIssue({ code: "custom", message: "At least one required check is mandatory" });
  }
  const duplicateSets: Array<[string, string[]]> = [
    ["check keys", value.checks.map((check) => check.key)],
    ["allowed branches", value.repository.allowedBranches],
    ["environment variables", value.environment.allow]
  ];
  for (const check of value.checks) {
    duplicateSets.push([`environment variables for ${check.key}`, check.environmentAllowlist]);
    for (const variable of check.environmentAllowlist) {
      if (!value.environment.allow.includes(variable)) {
        context.addIssue({
          code: "custom",
          message: `${variable} is not present in the global environment allowlist`
        });
      }
    }
  }
  for (const [label, values] of duplicateSets) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `Duplicate ${label} are not allowed` });
    }
  }
}

export const VerificationPolicySchema =
  VerificationPolicyObjectSchema.superRefine(rejectDuplicates);

const CanonicalPolicyObjectSchema = VerificationPolicyObjectSchema.omit({
  policyHash: true
}).extend({
  kind: z.literal("donebond.policy"),
  schemaVersion: z.literal(POLICY_SCHEMA_VERSION)
});

export const CanonicalPolicyV1Schema = CanonicalPolicyObjectSchema.superRefine((value, context) =>
  rejectDuplicates(value, context)
);

export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;
export type CanonicalPolicyV1 = z.infer<typeof CanonicalPolicyV1Schema>;
