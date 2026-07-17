import { hashTypedData, keccak256, recoverAddress, toBytes, type Address, type Hex } from "viem";
import { z } from "zod";

import { PublicIdentifierSchema, ProjectSlugSchema } from "./identifiers.js";
import {
  Bytes32Schema,
  DecimalWeiSchema,
  GitHubRepositoryUrlSchema,
  GitObjectIdSchema,
  HexSignatureSchema,
  IsoDateTimeSchema,
  NonZeroEthereumAddressSchema,
  NormalizedTextSchema,
  RepositoryIdentitySchema,
  Uint64StringSchema
} from "./primitives.js";

export const DOMAIN_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_SCHEMA_VERSION = 1 as const;

export const SupportedChainIdSchema = z.union([z.literal(143), z.literal(10_143)]);
export const BranchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => {
    const components = value.split("/");
    return (
      value === value.trim() &&
      !value.startsWith("-") &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !/[\x00-\x20\x7f~^:?*[\\]/u.test(value) &&
      components.every(
        (component) =>
          component.length > 0 && !component.startsWith(".") && !component.endsWith(".lock")
      )
    );
  }, "Expected a safe Git branch name");
const normalizedText = (maximum: number) => NormalizedTextSchema.pipe(z.string().max(maximum));

function rejectDuplicateCriteria(
  value: { acceptanceCriteria: Array<{ key: string }> },
  context: z.RefinementCtx
): void {
  const keys = value.acceptanceCriteria.map((criterion) => criterion.key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Acceptance criterion keys must be unique" });
  }
}

export const ProjectVisibilitySchema = z.enum(["private", "public"]);
export const ProjectStatusSchema = z.enum(["active", "archived"]);

export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  publicId: PublicIdentifierSchema,
  slug: ProjectSlugSchema,
  name: normalizedText(120),
  repositoryUrl: GitHubRepositoryUrlSchema,
  defaultBranch: BranchNameSchema,
  visibility: ProjectVisibilitySchema,
  status: ProjectStatusSchema,
  activePolicyHash: Bytes32Schema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const TaskOffchainStatusSchema = z.enum([
  "draft",
  "awaiting_chain",
  "open",
  "receipt_submitted",
  "approved",
  "rejected",
  "cancelled",
  "expired"
]);

export const TaskChainStatusSchema = z.enum([
  "none",
  "open",
  "receipt_submitted",
  "approved",
  "rejected",
  "cancelled",
  "expired"
]);

export const AcceptanceCriterionSchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  description: normalizedText(2000)
});

const TaskObjectSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  publicId: PublicIdentifierSchema,
  projectPublicId: PublicIdentifierSchema,
  chainId: SupportedChainIdSchema,
  chainTaskId: DecimalWeiSchema.nullable(),
  title: normalizedText(200),
  description: normalizedText(20_000),
  repositoryUrl: GitHubRepositoryUrlSchema,
  targetBranch: BranchNameSchema,
  baseCommit: GitObjectIdSchema.nullable(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1).max(100),
  taskHash: Bytes32Schema,
  policyHash: Bytes32Schema,
  creatorWallet: NonZeroEthereumAddressSchema,
  assigneeWallet: NonZeroEthereumAddressSchema,
  rewardWei: DecimalWeiSchema,
  deadline: IsoDateTimeSchema.nullable(),
  offchainStatus: TaskOffchainStatusSchema,
  chainStatus: TaskChainStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const TaskSchema = TaskObjectSchema.superRefine(rejectDuplicateCriteria);

const CanonicalTaskV1ObjectSchema = z.strictObject({
  kind: z.literal("donebond.task"),
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  projectPublicId: PublicIdentifierSchema,
  repositoryIdentity: RepositoryIdentitySchema,
  targetBranch: BranchNameSchema,
  baseCommit: GitObjectIdSchema.nullable(),
  title: normalizedText(200),
  description: normalizedText(20_000),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1).max(100),
  assigneeWallet: NonZeroEthereumAddressSchema,
  deadlineUnixSeconds: Uint64StringSchema.nullable(),
  rewardWei: DecimalWeiSchema,
  policyHash: Bytes32Schema
});

export const CanonicalTaskV1Schema =
  CanonicalTaskV1ObjectSchema.superRefine(rejectDuplicateCriteria);

export const CheckStatusSchema = z.enum(["passed", "failed", "timed_out", "skipped", "error"]);

export const BoundedOutputSchema = z.strictObject({
  preview: z.string().max(262_144),
  digest: Bytes32Schema,
  originalBytes: z.number().int().nonnegative(),
  truncated: z.boolean()
});

const CheckResultObjectSchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  label: normalizedText(128),
  required: z.boolean(),
  status: CheckStatusSchema,
  startedAt: IsoDateTimeSchema,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(32).nullable().optional(),
  stdout: BoundedOutputSchema,
  stderr: BoundedOutputSchema
});

export const CheckResultSchema = CheckResultObjectSchema.superRefine((value, context) => {
  const hasSignal = value.signal !== null && value.signal !== undefined;
  const valid =
    (value.status === "passed" && value.exitCode === 0 && !hasSignal) ||
    (value.status === "failed" &&
      ((value.exitCode !== null && value.exitCode !== 0) || hasSignal)) ||
    (value.status === "timed_out" && value.exitCode === null) ||
    (value.status === "error" && value.exitCode === null) ||
    (value.status === "skipped" && value.exitCode === null && !hasSignal);
  if (!valid) {
    context.addIssue({ code: "custom", message: "Check status contradicts process outcome" });
  }
});

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").includes("..")
  );
}

export const GitEvidenceSchema = z.strictObject({
  objectId: GitObjectIdSchema,
  derivedCommitHash: Bytes32Schema,
  treeId: GitObjectIdSchema,
  branch: BranchNameSchema,
  remote: RepositoryIdentitySchema,
  clean: z.boolean(),
  changedFiles: z.array(z.string().max(1024).refine(isSafeRelativePath)).max(5000)
});

const EvidenceBundleObjectSchema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  task: z.strictObject({ publicId: PublicIdentifierSchema, taskHash: Bytes32Schema }),
  policy: z.strictObject({
    policyHash: Bytes32Schema,
    sourcePath: z.string().min(1).max(512).refine(isSafeRelativePath)
  }),
  git: GitEvidenceSchema,
  checks: z.array(CheckResultSchema).min(1).max(100),
  result: z.strictObject({
    passing: z.boolean(),
    requiredPassed: z.number().int().nonnegative(),
    requiredTotal: z.number().int().nonnegative(),
    failureCodes: z.array(z.string().max(128)).max(100)
  }),
  tool: z.strictObject({
    name: z.literal("donebond-cli"),
    version: z.string().min(1).max(64),
    platform: z.string().min(1).max(128),
    nodeVersion: z.string().min(1).max(64)
  }),
  redactions: z.record(z.string(), z.number().int().nonnegative())
});

export const EvidenceBundleSchema = EvidenceBundleObjectSchema.superRefine((value, context) => {
  const required = value.checks.filter((check) => check.required);
  const requiredPassed = required.filter(
    (check) => check.status === "passed" && check.exitCode === 0
  ).length;
  const passing =
    required.length > 0 &&
    value.git.clean &&
    value.git.changedFiles.length === 0 &&
    requiredPassed === required.length;
  const checkKeys = value.checks.map((check) => check.key);
  const changedFiles = value.git.changedFiles;
  if (new Set(checkKeys).size !== checkKeys.length) {
    context.addIssue({ code: "custom", message: "Check keys must be unique" });
  }
  if (new Set(changedFiles).size !== changedFiles.length) {
    context.addIssue({ code: "custom", message: "Changed file paths must be unique" });
  }
  if (value.git.clean && changedFiles.length > 0) {
    context.addIssue({ code: "custom", message: "A clean working tree cannot list changed files" });
  }
  if (value.result.requiredTotal !== required.length) {
    context.addIssue({ code: "custom", message: "Required check total is inconsistent" });
  }
  if (value.result.requiredPassed !== requiredPassed) {
    context.addIssue({ code: "custom", message: "Required passed count is inconsistent" });
  }
  if (value.result.passing !== passing) {
    context.addIssue({ code: "custom", message: "Passing result is inconsistent with evidence" });
  }
  if (value.result.passing === value.result.failureCodes.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Passing evidence must have no failure codes and failing evidence must have one"
    });
  }
});

export const ChainTransactionStatusSchema = z.enum([
  "prepared",
  "wallet_requested",
  "submitted",
  "confirmed",
  "rejected_by_user",
  "replaced",
  "reverted",
  "unknown_reconcile"
]);

export const EvidenceValidationStatusSchema = z.enum([
  "pending",
  "valid_passing",
  "valid_failing",
  "invalid"
]);

export const PayoutStatusSchema = z.enum([
  "unfunded",
  "locked",
  "credited",
  "withdrawn",
  "refunded"
]);

export const ChainTransactionSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  publicId: PublicIdentifierSchema,
  taskPublicId: PublicIdentifierSchema.nullable(),
  intentType: z.enum(["create_task", "submit_receipt", "approve", "reject", "cancel", "withdraw"]),
  idempotencyKey: z.string().min(16).max(255),
  chainId: SupportedChainIdSchema,
  fromAddress: NonZeroEthereumAddressSchema,
  toAddress: NonZeroEthereumAddressSchema,
  transactionHash: Bytes32Schema.nullable(),
  nonce: DecimalWeiSchema.nullable(),
  status: ChainTransactionStatusSchema,
  blockNumber: DecimalWeiSchema.nullable(),
  failureCode: z.string().max(128).nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const VERIFIER_ATTESTATION_DOMAIN_NAME = "DoneBondRegistry" as const;
export const VERIFIER_ATTESTATION_DOMAIN_VERSION = "1" as const;
export const VERIFIER_ATTESTATION_PRIMARY_TYPE = "PassingReceipt" as const;
export const PASSING_RECEIPT_SOLIDITY_TYPE =
  "PassingReceipt(uint256 taskId,bytes32 taskHash,bytes32 policyHash,address assignee,bytes32 evidenceHash,bytes32 commitHash,uint64 attestationExpiry)" as const;
export const PASSING_RECEIPT_TYPEHASH = keccak256(toBytes(PASSING_RECEIPT_SOLIDITY_TYPE));

const PassingReceiptTypes = {
  PassingReceipt: [
    { name: "taskId", type: "uint256" },
    { name: "taskHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "assignee", type: "address" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "commitHash", type: "bytes32" },
    { name: "attestationExpiry", type: "uint64" }
  ]
} as const;

export interface ReceiptAttestationDigestInput {
  readonly chainId: 143 | 10_143;
  readonly contractAddress: string;
  readonly taskId: string;
  readonly taskHash: string;
  readonly policyHash: string;
  readonly assignee: string;
  readonly evidenceHash: string;
  readonly commitHash: string;
  readonly attestationExpiry: string;
}

export function computeReceiptAttestationDigest(input: ReceiptAttestationDigestInput): Hex {
  return hashTypedData({
    domain: {
      name: VERIFIER_ATTESTATION_DOMAIN_NAME,
      version: VERIFIER_ATTESTATION_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: input.contractAddress as Address
    },
    types: PassingReceiptTypes,
    primaryType: VERIFIER_ATTESTATION_PRIMARY_TYPE,
    message: {
      taskId: BigInt(input.taskId),
      taskHash: input.taskHash as Hex,
      policyHash: input.policyHash as Hex,
      assignee: input.assignee as Address,
      evidenceHash: input.evidenceHash as Hex,
      commitHash: input.commitHash as Hex,
      attestationExpiry: BigInt(input.attestationExpiry)
    }
  });
}

export const VerifierAttestationSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  domainName: z.literal(VERIFIER_ATTESTATION_DOMAIN_NAME),
  domainVersion: z.literal(VERIFIER_ATTESTATION_DOMAIN_VERSION),
  primaryType: z.literal(VERIFIER_ATTESTATION_PRIMARY_TYPE),
  typeHash: z.literal(PASSING_RECEIPT_TYPEHASH),
  signatureEncoding: z.literal("rsv-65-byte-hex"),
  verifierAddress: NonZeroEthereumAddressSchema,
  expiryUnixSeconds: Uint64StringSchema,
  signature: HexSignatureSchema,
  typedDataDigest: Bytes32Schema
});

const ReceiptObjectSchema = z.strictObject({
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  publicId: PublicIdentifierSchema,
  task: TaskSchema,
  evidenceHash: Bytes32Schema,
  commitHash: Bytes32Schema,
  gitObjectId: GitObjectIdSchema,
  checks: z.array(CheckResultSchema).min(1).max(100),
  verifierAttestation: VerifierAttestationSchema,
  contractAddress: NonZeroEthereumAddressSchema,
  submissionTransactionHash: Bytes32Schema,
  approvalTransactionHash: Bytes32Schema.nullable(),
  payoutTransactionHash: Bytes32Schema.nullable(),
  payoutStatus: PayoutStatusSchema,
  integrityStatus: z.enum(["verified", "mismatch", "pending"]),
  createdAt: IsoDateTimeSchema
});

function validateReceiptSemantics(
  value: z.infer<typeof ReceiptObjectSchema>,
  context: z.RefinementCtx
): Hex | null {
  if (value.task.chainTaskId === null) {
    context.addIssue({ code: "custom", message: "A receipt requires an onchain task ID" });
    return null;
  }
  if (!["receipt_submitted", "approved", "rejected"].includes(value.task.chainStatus)) {
    context.addIssue({ code: "custom", message: "Task chain state cannot have a receipt" });
  }
  if (!["receipt_submitted", "approved", "rejected"].includes(value.task.offchainStatus)) {
    context.addIssue({ code: "custom", message: "Task application state cannot have a receipt" });
  }
  const allRequiredPassed = value.checks
    .filter((check) => check.required)
    .every((check) => check.status === "passed" && check.exitCode === 0);
  if (!value.checks.some((check) => check.required) || !allRequiredPassed) {
    context.addIssue({ code: "custom", message: "Onchain receipts require passing checks" });
  }
  return computeReceiptAttestationDigest({
    chainId: value.task.chainId,
    contractAddress: value.contractAddress,
    taskId: value.task.chainTaskId,
    taskHash: value.task.taskHash,
    policyHash: value.task.policyHash,
    assignee: value.task.assigneeWallet,
    evidenceHash: value.evidenceHash,
    commitHash: value.commitHash,
    attestationExpiry: value.verifierAttestation.expiryUnixSeconds
  });
}

/** Structural parsing cannot establish verified integrity without trusted deployment state. */
export const ReceiptSchema = ReceiptObjectSchema.superRefine((value, context) => {
  validateReceiptSemantics(value, context);
  if (value.integrityStatus === "verified") {
    context.addIssue({
      code: "custom",
      message: "Verified integrity requires a trusted configured verifier"
    });
  }
});

/** Builds an async schema that verifies a receipt against the contract's trusted verifier. */
export function createVerifiedReceiptSchema(expectedVerifierAddress: string) {
  const expectedVerifier = NonZeroEthereumAddressSchema.parse(expectedVerifierAddress);
  return ReceiptObjectSchema.superRefine(async (value, context) => {
    const expectedDigest = validateReceiptSemantics(value, context);
    if (expectedDigest === null) return;
    if (value.integrityStatus !== "verified") {
      context.addIssue({
        code: "custom",
        message: "Trusted receipt must declare verified integrity"
      });
    }
    if (value.verifierAttestation.verifierAddress !== expectedVerifier) {
      context.addIssue({
        code: "custom",
        message: "Receipt verifier does not match trusted contract configuration"
      });
      return;
    }
    if (expectedDigest !== value.verifierAttestation.typedDataDigest) {
      context.addIssue({
        code: "custom",
        message: "Verifier attestation digest does not match receipt"
      });
      return;
    }
    try {
      const recovered = await recoverAddress({
        hash: expectedDigest,
        signature: value.verifierAttestation.signature as Hex
      });
      if (recovered.toLowerCase() !== expectedVerifier) {
        context.addIssue({ code: "custom", message: "Verifier signature signer does not match" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "Verifier signature cannot be recovered" });
    }
  });
}

export type Project = z.infer<typeof ProjectSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type CanonicalTaskV1 = z.infer<typeof CanonicalTaskV1Schema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type ChainTransaction = z.infer<typeof ChainTransactionSchema>;
export type VerifierAttestation = z.infer<typeof VerifierAttestationSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
