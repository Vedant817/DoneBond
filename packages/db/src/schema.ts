import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow();

function policyIdColumn(): AnyPgColumn {
  return policies.id;
}

function policyProjectIdColumn(): AnyPgColumn {
  return policies.projectId;
}

function policyHashColumn(): AnyPgColumn {
  return policies.policyHash;
}

function taskIdColumn(): AnyPgColumn {
  return tasks.id;
}

function taskProjectIdColumn(): AnyPgColumn {
  return tasks.projectId;
}

function taskPolicyIdColumn(): AnyPgColumn {
  return tasks.policyId;
}

function tokenIdColumn(): AnyPgColumn {
  return cliTokens.id;
}

function tokenProjectIdColumn(): AnyPgColumn {
  return cliTokens.projectId;
}

function chainTransactionIdColumn(): AnyPgColumn {
  return chainTransactions.id;
}

function chainTransactionUserIdColumn(): AnyPgColumn {
  return chainTransactions.userId;
}

function chainTransactionProjectIdColumn(): AnyPgColumn {
  return chainTransactions.projectId;
}

function chainTransactionChainIdColumn(): AnyPgColumn {
  return chainTransactions.chainId;
}

function chainTransactionTaskIdColumn(): AnyPgColumn {
  return chainTransactions.taskId;
}

function evidenceBundleIdColumn(): AnyPgColumn {
  return evidenceBundles.id;
}

function evidenceBundleTaskIdColumn(): AnyPgColumn {
  return evidenceBundles.taskId;
}

export const projectVisibility = pgEnum("project_visibility", ["private", "public"]);
export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const projectRole = pgEnum("project_role", ["owner", "member"]);
export const taskOffchainStatus = pgEnum("task_offchain_status", [
  "draft",
  "awaiting_chain",
  "open",
  "receipt_submitted",
  "approved",
  "rejected",
  "cancelled",
  "expired"
]);
export const taskChainStatus = pgEnum("task_chain_status", [
  "none",
  "open",
  "receipt_submitted",
  "approved",
  "rejected",
  "cancelled",
  "expired"
]);
export const checkStatus = pgEnum("verification_check_status", [
  "passed",
  "failed",
  "timed_out",
  "skipped",
  "error"
]);
export const chainIntentType = pgEnum("chain_intent_type", [
  "create_task",
  "submit_receipt",
  "approve",
  "reject",
  "cancel",
  "withdraw"
]);
export const chainTransactionStatus = pgEnum("chain_transaction_status", [
  "prepared",
  "wallet_requested",
  "submitted",
  "confirmed",
  "rejected_by_user",
  "replaced",
  "reverted",
  "unknown_reconcile"
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    emailNormalized: varchar("email_normalized", { length: 320 }),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("users_email_normalized_unique")
      .on(table.emailNormalized)
      .where(sql`${table.emailNormalized} is not null`),
    check(
      "users_email_normalized_lowercase",
      sql`${table.emailNormalized} is null or ${table.emailNormalized} = lower(${table.emailNormalized})`
    )
  ]
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    addressNormalized: varchar("address_normalized", { length: 42 }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("wallets_chain_address_unique").on(table.chainId, table.addressNormalized),
    unique("wallets_id_user_unique").on(table.id, table.userId),
    index("wallets_user_idx").on(table.userId),
    check("wallets_chain_id_positive", sql`${table.chainId} > 0`),
    check(
      "wallets_address_normalized_format",
      sql`${table.addressNormalized} ~ '^0x[0-9a-f]{40}$'`
    ),
    check(
      "wallets_address_nonzero",
      sql`${table.addressNormalized} <> '0x0000000000000000000000000000000000000000'`
    )
  ]
);

export const walletAuthChallenges = pgTable(
  "wallet_auth_challenges",
  {
    id: uuid("id").primaryKey(),
    addressNormalized: varchar("address_normalized", { length: 42 }).notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    uri: text("uri").notNull(),
    nonceDigest: varchar("nonce_digest", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
  },
  (table) => [
    unique("wallet_auth_challenges_nonce_digest_unique").on(table.nonceDigest),
    index("wallet_auth_challenges_expiry_idx").on(table.expiresAt, table.consumedAt),
    index("wallet_auth_challenges_address_issued_idx").on(
      table.chainId,
      table.addressNormalized,
      table.issuedAt
    ),
    check(
      "wallet_auth_challenges_address_format",
      sql`${table.addressNormalized} ~ '^0x[0-9a-f]{40}$' and ${table.addressNormalized} <> '0x0000000000000000000000000000000000000000'`
    ),
    check("wallet_auth_challenges_supported_chain", sql`${table.chainId} in (143, 10143)`),
    check(
      "wallet_auth_challenges_nonce_digest_format",
      sql`${table.nonceDigest} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "wallet_auth_challenges_lifetime",
      sql`${table.expiresAt} > ${table.issuedAt} and (${table.consumedAt} is null or (${table.consumedAt} >= ${table.issuedAt} and ${table.consumedAt} < ${table.expiresAt}))`
    ),
    check(
      "wallet_auth_challenges_origin_binding",
      sql`${table.domain} !~ '[/@?#]' and (${table.uri} = 'https://' || ${table.domain} or (${table.domain} ~ '^(localhost|127\\.0\\.0\\.1)(?::[0-9]+)?$' and ${table.uri} = 'http://' || ${table.domain}))`
    )
  ]
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    scope: varchar("scope", { length: 64 }).notNull(),
    keyDigest: varchar("key_digest", { length: 64 }).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.scope, table.keyDigest],
      name: "auth_rate_limits_scope_key_pk"
    }),
    index("auth_rate_limits_expiry_idx").on(table.windowExpiresAt),
    check("auth_rate_limits_scope_format", sql`${table.scope} ~ '^[a-z][a-z0-9_:-]{0,63}$'`),
    check("auth_rate_limits_key_digest_format", sql`${table.keyDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "auth_rate_limits_window_valid",
      sql`${table.windowExpiresAt} > ${table.windowStartedAt}`
    ),
    check("auth_rate_limits_count_positive", sql`${table.requestCount} > 0`)
  ]
);

export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id").notNull(),
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    csrfDigest: varchar("csrf_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedFromSessionId: uuid("rotated_from_session_id").references(
      (): AnyPgColumn => browserSessions.id,
      { onDelete: "set null" }
    )
  },
  (table) => [
    unique("browser_sessions_token_digest_unique").on(table.tokenDigest),
    unique("browser_sessions_csrf_digest_unique").on(table.csrfDigest),
    foreignKey({
      columns: [table.walletId, table.userId],
      foreignColumns: [wallets.id, wallets.userId],
      name: "browser_sessions_wallet_user_fk"
    }).onDelete("cascade"),
    index("browser_sessions_user_active_idx").on(
      table.userId,
      table.revokedAt,
      table.idleExpiresAt
    ),
    index("browser_sessions_absolute_expiry_idx").on(table.absoluteExpiresAt),
    check("browser_sessions_token_digest_format", sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`),
    check("browser_sessions_csrf_digest_format", sql`${table.csrfDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "browser_sessions_lifetime",
      sql`${table.absoluteExpiresAt} > ${table.createdAt} and ${table.idleExpiresAt} > ${table.createdAt} and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt} and ${table.lastSeenAt} >= ${table.createdAt} and ${table.lastSeenAt} < ${table.absoluteExpiresAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})`
    )
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 63 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    repositoryUrl: text("repository_url").notNull(),
    defaultBranch: varchar("default_branch", { length: 255 }).notNull(),
    visibility: projectVisibility("visibility").notNull().default("private"),
    status: projectStatus("status").notNull().default("active"),
    activePolicyId: uuid("active_policy_id"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("projects_public_id_unique").on(table.publicId),
    unique("projects_owner_slug_unique").on(table.ownerUserId, table.slug),
    foreignKey({
      columns: [table.activePolicyId, table.id],
      foreignColumns: [policyIdColumn(), policyProjectIdColumn()],
      name: "projects_active_policy_same_project_fk"
    }),
    index("projects_owner_idx").on(table.ownerUserId),
    check("projects_public_id_format", sql`${table.publicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`),
    check("projects_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check(
      "projects_repository_url_no_credentials",
      sql`${table.repositoryUrl} !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/@]+@'`
    ),
    check(
      "projects_default_branch_not_option",
      sql`${table.defaultBranch} <> '' and ${table.defaultBranch} not like '-%' and ${table.defaultBranch} !~ '[[:cntrl:]]'`
    )
  ]
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId], name: "project_members_pk" }),
    index("project_members_user_idx").on(table.userId)
  ]
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    canonicalJson: jsonb("canonical_json").notNull(),
    policyHash: varchar("policy_hash", { length: 66 }).notNull(),
    sourcePath: text("source_path").notNull(),
    createdAt
  },
  (table) => [
    unique("policies_public_id_unique").on(table.publicId),
    unique("policies_project_hash_unique").on(table.projectId, table.policyHash),
    unique("policies_id_project_unique").on(table.id, table.projectId),
    unique("policies_id_project_hash_unique").on(table.id, table.projectId, table.policyHash),
    index("policies_project_created_idx").on(table.projectId, table.createdAt),
    check("policies_schema_version_positive", sql`${table.schemaVersion} > 0`),
    check("policies_hash_format", sql`${table.policyHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      "policies_source_relative",
      sql`${table.sourcePath} <> '' and ${table.sourcePath} not like '/%' and ${table.sourcePath} not like '%/' and ${table.sourcePath} not like '%//%' and ${table.sourcePath} <> '.' and ${table.sourcePath} not like './%' and ${table.sourcePath} not like '%/.' and ${table.sourcePath} not like '%/./%' and ${table.sourcePath} <> '..' and ${table.sourcePath} not like '../%' and ${table.sourcePath} not like '%/..' and ${table.sourcePath} not like '%/../%' and position(chr(92) in ${table.sourcePath}) = 0 and ${table.sourcePath} !~ '[[:cntrl:]]'`
    )
  ]
);

export const cliTokens = pgTable(
  "cli_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt
  },
  (table) => [
    unique("cli_tokens_public_id_unique").on(table.publicId),
    unique("cli_tokens_digest_unique").on(table.tokenDigest),
    unique("cli_tokens_id_project_unique").on(table.id, table.projectId),
    index("cli_tokens_project_active_idx").on(table.projectId, table.revokedAt),
    check("cli_tokens_public_id_format", sql`${table.publicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`),
    check("cli_tokens_digest_format", sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    policyId: uuid("policy_id").notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    chainTaskId: bigint("chain_task_id", { mode: "bigint" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    canonicalJson: jsonb("canonical_json").notNull(),
    targetBranch: varchar("target_branch", { length: 255 }).notNull(),
    baseCommit: varchar("base_commit", { length: 64 }),
    acceptanceCriteriaJson: jsonb("acceptance_criteria_json").notNull(),
    taskHash: varchar("task_hash", { length: 66 }).notNull(),
    policyHash: varchar("policy_hash", { length: 66 }).notNull(),
    creatorWallet: varchar("creator_wallet", { length: 42 }).notNull(),
    assigneeWallet: varchar("assignee_wallet", { length: 42 }).notNull(),
    rewardWei: bigint("reward_wei", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    deadline: timestamp("deadline", { withTimezone: true }),
    offchainStatus: taskOffchainStatus("offchain_status").notNull().default("draft"),
    chainStatus: taskChainStatus("chain_status").notNull().default("none"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("tasks_public_id_unique").on(table.publicId),
    unique("tasks_project_hash_unique").on(table.projectId, table.taskHash),
    unique("tasks_id_project_unique").on(table.id, table.projectId),
    unique("tasks_id_policy_project_unique").on(table.id, table.policyId, table.projectId),
    foreignKey({
      columns: [table.policyId, table.projectId, table.policyHash],
      foreignColumns: [policyIdColumn(), policyProjectIdColumn(), policyHashColumn()],
      name: "tasks_policy_same_project_hash_fk"
    }),
    unique("tasks_chain_identity_unique").on(
      table.chainId,
      table.contractAddress,
      table.chainTaskId
    ),
    index("tasks_project_created_idx").on(table.projectId, table.createdAt),
    index("tasks_assignee_status_idx").on(table.chainId, table.assigneeWallet, table.chainStatus),
    check("tasks_public_id_format", sql`${table.publicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`),
    check("tasks_chain_id_positive", sql`${table.chainId} > 0`),
    check("tasks_contract_address_format", sql`${table.contractAddress} ~ '^0x[0-9a-f]{40}$'`),
    check("tasks_creator_wallet_format", sql`${table.creatorWallet} ~ '^0x[0-9a-f]{40}$'`),
    check("tasks_assignee_wallet_format", sql`${table.assigneeWallet} ~ '^0x[0-9a-f]{40}$'`),
    check("tasks_reward_nonnegative", sql`${table.rewardWei} >= 0`),
    check(
      "tasks_target_branch_safe",
      sql`${table.targetBranch} <> '' and ${table.targetBranch} not like '-%' and ${table.targetBranch} not like '/%' and ${table.targetBranch} not like '%/' and ${table.targetBranch} not like '.%' and ${table.targetBranch} not like '%/.%' and ${table.targetBranch} not like '%.lock' and ${table.targetBranch} not like '%.lock/%' and ${table.targetBranch} not like '%..%' and ${table.targetBranch} not like '%@{%' and ${table.targetBranch} not like '%//%' and ${table.targetBranch} !~ '[[:cntrl:] ~^:?*]' and position(chr(92) in ${table.targetBranch}) = 0 and position('[' in ${table.targetBranch}) = 0`
    ),
    check(
      "tasks_base_commit_format",
      sql`${table.baseCommit} is null or ${table.baseCommit} ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'`
    ),
    check(
      "tasks_hashes_format",
      sql`${table.taskHash} ~ '^0x[0-9a-f]{64}$' and ${table.policyHash} ~ '^0x[0-9a-f]{64}$'`
    )
  ]
);

export const evidenceBundles = pgTable(
  "evidence_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    projectId: uuid("project_id").notNull(),
    policyId: uuid("policy_id").notNull(),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    objectLocation: text("object_location").notNull(),
    bundleJson: jsonb("bundle_json").$type<Record<string, unknown>>().notNull(),
    evidenceHash: varchar("evidence_hash", { length: 66 }).notNull(),
    commitHashDerived: varchar("commit_hash_derived", { length: 66 }).notNull(),
    gitObjectId: varchar("git_object_id", { length: 64 }).notNull(),
    passing: boolean("passing").notNull(),
    bundleSizeBytes: integer("bundle_size_bytes").notNull(),
    submittedByTokenId: uuid("submitted_by_token_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 66 }).notNull(),
    createdAt
  },
  (table) => [
    unique("evidence_public_id_unique").on(table.publicId),
    unique("evidence_task_hash_unique").on(table.taskId, table.evidenceHash),
    unique("evidence_id_task_unique").on(table.id, table.taskId),
    unique("evidence_token_idempotency_unique").on(table.submittedByTokenId, table.idempotencyKey),
    foreignKey({
      columns: [table.taskId, table.policyId, table.projectId],
      foreignColumns: [taskIdColumn(), taskPolicyIdColumn(), taskProjectIdColumn()],
      name: "evidence_task_policy_project_fk"
    }),
    foreignKey({
      columns: [table.submittedByTokenId, table.projectId],
      foreignColumns: [tokenIdColumn(), tokenProjectIdColumn()],
      name: "evidence_token_project_fk"
    }),
    index("evidence_task_created_idx").on(table.taskId, table.createdAt),
    check("evidence_public_id_format", sql`${table.publicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`),
    check("evidence_schema_version_positive", sql`${table.schemaVersion} > 0`),
    check(
      "evidence_hashes_format",
      sql`${table.evidenceHash} ~ '^0x[0-9a-f]{64}$' and ${table.commitHashDerived} ~ '^0x[0-9a-f]{64}$'`
    ),
    check(
      "evidence_git_object_id_format",
      sql`${table.gitObjectId} ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'`
    ),
    check("evidence_request_hash_format", sql`${table.requestHash} ~ '^0x[0-9a-f]{64}$'`),
    check("evidence_bundle_size_positive", sql`${table.bundleSizeBytes} > 0`)
  ]
);

export const verificationChecks = pgTable(
  "verification_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "cascade" }),
    checkKey: varchar("check_key", { length: 80 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    required: boolean("required").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    exitCode: integer("exit_code"),
    signal: varchar("signal", { length: 32 }),
    stdoutDigest: varchar("stdout_digest", { length: 66 }).notNull(),
    stderrDigest: varchar("stderr_digest", { length: 66 }).notNull(),
    stdoutPreview: text("stdout_preview").notNull(),
    stderrPreview: text("stderr_preview").notNull(),
    status: checkStatus("status").notNull()
  },
  (table) => [
    unique("verification_checks_bundle_key_unique").on(table.evidenceBundleId, table.checkKey),
    check("verification_checks_key_format", sql`${table.checkKey} ~ '^[a-zA-Z0-9._-]{1,64}$'`),
    check("verification_checks_duration_nonnegative", sql`${table.durationMs} >= 0`),
    check(
      "verification_checks_status_outcome_consistent",
      sql`(${table.status} = 'passed' and ${table.exitCode} = 0 and ${table.signal} is null) or (${table.status} = 'failed' and ((${table.exitCode} is not null and ${table.exitCode} <> 0) or ${table.signal} is not null)) or (${table.status} in ('timed_out', 'error') and ${table.exitCode} is null) or (${table.status} = 'skipped' and ${table.exitCode} is null and ${table.signal} is null)`
    ),
    check(
      "verification_checks_digests_format",
      sql`${table.stdoutDigest} ~ '^0x[0-9a-f]{64}$' and ${table.stderrDigest} ~ '^0x[0-9a-f]{64}$'`
    )
  ]
);

export const chainTransactions = pgTable(
  "chain_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 26 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id"),
    intentType: chainIntentType("intent_type").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 66 }).notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    fromAddress: varchar("from_address", { length: 42 }).notNull(),
    toAddress: varchar("to_address", { length: 42 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    nonce: bigint("nonce", { mode: "bigint" }),
    status: chainTransactionStatus("status").notNull().default("prepared"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    failureCode: varchar("failure_code", { length: 100 }),
    replacedByTransactionId: uuid("replaced_by_transaction_id"),
    responseSafeJson: jsonb("response_safe_json"),
    responseStatus: integer("response_status"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("chain_transactions_public_id_unique").on(table.publicId),
    unique("chain_transactions_id_task_unique").on(table.id, table.taskId),
    unique("chain_transactions_replacement_scope_unique").on(
      table.id,
      table.userId,
      table.projectId,
      table.chainId
    ),
    foreignKey({
      columns: [table.taskId, table.projectId],
      foreignColumns: [taskIdColumn(), taskProjectIdColumn()],
      name: "chain_transactions_task_project_fk"
    }),
    foreignKey({
      columns: [table.replacedByTransactionId, table.userId, table.projectId, table.chainId],
      foreignColumns: [
        chainTransactionIdColumn(),
        chainTransactionUserIdColumn(),
        chainTransactionProjectIdColumn(),
        chainTransactionChainIdColumn()
      ],
      name: "chain_transactions_replacement_scope_fk"
    }),
    unique("chain_transactions_user_intent_idempotency_unique").on(
      table.userId,
      table.intentType,
      table.idempotencyKey
    ),
    uniqueIndex("chain_transactions_hash_unique")
      .on(table.chainId, table.transactionHash)
      .where(sql`${table.transactionHash} is not null`),
    index("chain_transactions_status_updated_idx").on(table.status, table.updatedAt),
    index("chain_transactions_task_idx").on(table.taskId),
    check(
      "chain_transactions_public_id_format",
      sql`${table.publicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`
    ),
    check("chain_transactions_chain_id_positive", sql`${table.chainId} > 0`),
    check(
      "chain_transactions_addresses_format",
      sql`${table.fromAddress} ~ '^0x[0-9a-f]{40}$' and ${table.toAddress} ~ '^0x[0-9a-f]{40}$'`
    ),
    check("chain_transactions_request_hash_format", sql`${table.requestHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      "chain_transactions_hash_format",
      sql`${table.transactionHash} is null or ${table.transactionHash} ~ '^0x[0-9a-f]{64}$'`
    ),
    check(
      "chain_transactions_confirmation_fields",
      sql`(${table.status} <> 'confirmed') or (${table.transactionHash} is not null and ${table.blockNumber} is not null)`
    ),
    check(
      "chain_transactions_submitted_fields",
      sql`(${table.status} not in ('submitted', 'confirmed', 'replaced', 'reverted')) or (${table.transactionHash} is not null and ${table.nonce} is not null)`
    ),
    check(
      "chain_transactions_replacement_state_consistent",
      sql`(${table.status} = 'replaced' and ${table.replacedByTransactionId} is not null) or (${table.status} <> 'replaced' and ${table.replacedByTransactionId} is null)`
    ),
    check(
      "chain_transactions_response_complete",
      sql`(${table.responseSafeJson} is null and ${table.responseStatus} is null) or (${table.responseSafeJson} is not null and ${table.responseStatus} between 200 and 299)`
    )
  ]
);

export const receiptAttestations = pgTable(
  "receipt_attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainTransactionId: uuid("chain_transaction_id").notNull(),
    taskId: uuid("task_id").notNull(),
    evidenceBundleId: uuid("evidence_bundle_id").notNull(),
    evidenceHash: varchar("evidence_hash", { length: 66 }).notNull(),
    commitHash: varchar("commit_hash", { length: 66 }).notNull(),
    attestationExpiry: bigint("attestation_expiry", { mode: "bigint" }).notNull(),
    verifierAddress: varchar("verifier_address", { length: 42 }).notNull(),
    signature: varchar("signature", { length: 132 }).notNull(),
    typedDataDigest: varchar("typed_data_digest", { length: 66 }).notNull(),
    createdAt
  },
  (table) => [
    unique("receipt_attestations_chain_transaction_unique").on(table.chainTransactionId),
    unique("receipt_attestations_id_task_unique").on(table.id, table.taskId),
    foreignKey({
      columns: [table.chainTransactionId, table.taskId],
      foreignColumns: [chainTransactionIdColumn(), chainTransactionTaskIdColumn()],
      name: "receipt_attestations_chain_transaction_task_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.evidenceBundleId, table.taskId],
      foreignColumns: [evidenceBundleIdColumn(), evidenceBundleTaskIdColumn()],
      name: "receipt_attestations_evidence_bundle_task_fk"
    }),
    index("receipt_attestations_task_idx").on(table.taskId),
    check(
      "receipt_attestations_verifier_address_format",
      sql`${table.verifierAddress} ~ '^0x[0-9a-f]{40}$'`
    ),
    check("receipt_attestations_signature_format", sql`${table.signature} ~ '^0x[0-9a-f]{130}$'`),
    check(
      "receipt_attestations_hashes_format",
      sql`${table.evidenceHash} ~ '^0x[0-9a-f]{64}$' and ${table.commitHash} ~ '^0x[0-9a-f]{64}$' and ${table.typedDataDigest} ~ '^0x[0-9a-f]{64}$'`
    ),
    check("receipt_attestations_expiry_positive", sql`${table.attestationExpiry} > 0`)
  ]
);

export const contractEvents = pgTable(
  "contract_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    eventName: varchar("event_name", { length: 100 }).notNull(),
    decodedJson: jsonb("decoded_json").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    removed: boolean("removed").notNull().default(false),
    createdAt
  },
  (table) => [
    unique("contract_events_chain_tx_log_unique").on(
      table.chainId,
      table.transactionHash,
      table.logIndex
    ),
    index("contract_events_contract_block_idx").on(
      table.chainId,
      table.contractAddress,
      table.blockNumber
    ),
    check("contract_events_chain_id_positive", sql`${table.chainId} > 0`),
    check("contract_events_log_index_nonnegative", sql`${table.logIndex} >= 0`),
    check(
      "contract_events_addresses_hashes_format",
      sql`${table.contractAddress} ~ '^0x[0-9a-f]{40}$' and ${table.transactionHash} ~ '^0x[0-9a-f]{64}$' and ${table.blockHash} ~ '^0x[0-9a-f]{64}$'`
    )
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id"),
    action: varchar("action", { length: 120 }).notNull(),
    correlationId: varchar("correlation_id", { length: 100 }),
    metadataSafeJson: jsonb("metadata_safe_json").notNull(),
    createdAt
  },
  (table) => [
    index("audit_events_project_created_idx").on(table.projectId, table.createdAt),
    index("audit_events_task_created_idx").on(table.taskId, table.createdAt),
    foreignKey({
      columns: [table.taskId, table.projectId],
      foreignColumns: [taskIdColumn(), taskProjectIdColumn()],
      name: "audit_events_task_project_fk"
    }),
    check(
      "audit_events_task_requires_project",
      sql`${table.taskId} is null or ${table.projectId} is not null`
    ),
    check("audit_events_action_format", sql`${table.action} ~ '^[a-z][a-z0-9_.-]+$'`)
  ]
);

export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorScope: varchar("actor_scope", { length: 100 }).notNull(),
    operation: varchar("operation", { length: 100 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 66 }).notNull(),
    resourcePublicId: varchar("resource_public_id", { length: 26 }).notNull(),
    responseSafeJson: jsonb("response_safe_json"),
    responseStatus: integer("response_status"),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [
    unique("api_idempotency_scope_operation_key_unique").on(
      table.actorScope,
      table.operation,
      table.idempotencyKey
    ),
    index("api_idempotency_expiry_idx").on(table.expiresAt),
    check("api_idempotency_request_hash_format", sql`${table.requestHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      "api_idempotency_resource_public_id_format",
      sql`${table.resourcePublicId} ~ '^[0-9a-hjkmnp-tv-z]{26}$'`
    ),
    check(
      "api_idempotency_response_complete",
      sql`(${table.responseSafeJson} is null and ${table.responseStatus} is null) or (${table.responseSafeJson} is not null and ${table.responseStatus} between 200 and 299)`
    ),
    check("api_idempotency_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`)
  ]
);

export const databaseSchema = {
  apiIdempotencyKeys,
  authRateLimits,
  auditEvents,
  browserSessions,
  chainTransactions,
  cliTokens,
  contractEvents,
  evidenceBundles,
  policies,
  projectMembers,
  projects,
  receiptAttestations,
  tasks,
  users,
  verificationChecks,
  walletAuthChallenges,
  wallets
};
