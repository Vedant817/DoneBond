CREATE TYPE "public"."chain_intent_type" AS ENUM('create_task', 'submit_receipt', 'approve', 'reject', 'cancel', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."chain_transaction_status" AS ENUM('prepared', 'wallet_requested', 'submitted', 'confirmed', 'rejected_by_user', 'replaced', 'reverted', 'unknown_reconcile');--> statement-breakpoint
CREATE TYPE "public"."verification_check_status" AS ENUM('passed', 'failed', 'timed_out', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."task_chain_status" AS ENUM('none', 'open', 'receipt_submitted', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."task_offchain_status" AS ENUM('draft', 'awaiting_chain', 'open', 'receipt_submitted', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_scope" varchar(100) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(66) NOT NULL,
	"resource_public_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_idempotency_scope_operation_key_unique" UNIQUE("actor_scope","operation","idempotency_key"),
	CONSTRAINT "api_idempotency_request_hash_format" CHECK ("api_idempotency_keys"."request_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "api_idempotency_resource_public_id_format" CHECK ("api_idempotency_keys"."resource_public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "api_idempotency_expiry_after_creation" CHECK ("api_idempotency_keys"."expires_at" > "api_idempotency_keys"."created_at")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"action" varchar(120) NOT NULL,
	"correlation_id" varchar(100),
	"metadata_safe_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_task_requires_project" CHECK ("audit_events"."task_id" is null or "audit_events"."project_id" is not null),
	CONSTRAINT "audit_events_action_format" CHECK ("audit_events"."action" ~ '^[a-z][a-z0-9_.-]+$')
);
--> statement-breakpoint
CREATE TABLE "chain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"intent_type" "chain_intent_type" NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(66) NOT NULL,
	"chain_id" bigint NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"transaction_hash" varchar(66),
	"nonce" bigint,
	"status" "chain_transaction_status" DEFAULT 'prepared' NOT NULL,
	"block_number" bigint,
	"failure_code" varchar(100),
	"replaced_by_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_transactions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "chain_transactions_replacement_scope_unique" UNIQUE("id","user_id","project_id","chain_id"),
	CONSTRAINT "chain_transactions_user_intent_idempotency_unique" UNIQUE("user_id","intent_type","idempotency_key"),
	CONSTRAINT "chain_transactions_public_id_format" CHECK ("chain_transactions"."public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "chain_transactions_chain_id_positive" CHECK ("chain_transactions"."chain_id" > 0),
	CONSTRAINT "chain_transactions_addresses_format" CHECK ("chain_transactions"."from_address" ~ '^0x[0-9a-f]{40}$' and "chain_transactions"."to_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "chain_transactions_request_hash_format" CHECK ("chain_transactions"."request_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_transactions_hash_format" CHECK ("chain_transactions"."transaction_hash" is null or "chain_transactions"."transaction_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "chain_transactions_confirmation_fields" CHECK (("chain_transactions"."status" <> 'confirmed') or ("chain_transactions"."transaction_hash" is not null and "chain_transactions"."block_number" is not null)),
	CONSTRAINT "chain_transactions_submitted_fields" CHECK (("chain_transactions"."status" not in ('submitted', 'confirmed', 'replaced', 'reverted')) or ("chain_transactions"."transaction_hash" is not null and "chain_transactions"."nonce" is not null)),
	CONSTRAINT "chain_transactions_replacement_state_consistent" CHECK (("chain_transactions"."status" = 'replaced' and "chain_transactions"."replaced_by_transaction_id" is not null) or ("chain_transactions"."status" <> 'replaced' and "chain_transactions"."replaced_by_transaction_id" is null))
);
--> statement-breakpoint
CREATE TABLE "cli_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_tokens_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "cli_tokens_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "cli_tokens_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "cli_tokens_public_id_format" CHECK ("cli_tokens"."public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "cli_tokens_digest_format" CHECK ("cli_tokens"."token_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "contract_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"decoded_json" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_events_chain_tx_log_unique" UNIQUE("chain_id","transaction_hash","log_index"),
	CONSTRAINT "contract_events_chain_id_positive" CHECK ("contract_events"."chain_id" > 0),
	CONSTRAINT "contract_events_log_index_nonnegative" CHECK ("contract_events"."log_index" >= 0),
	CONSTRAINT "contract_events_addresses_hashes_format" CHECK ("contract_events"."contract_address" ~ '^0x[0-9a-f]{40}$' and "contract_events"."transaction_hash" ~ '^0x[0-9a-f]{64}$' and "contract_events"."block_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "evidence_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"schema_version" integer NOT NULL,
	"object_location" text NOT NULL,
	"evidence_hash" varchar(66) NOT NULL,
	"commit_hash_derived" varchar(66) NOT NULL,
	"git_object_id" varchar(64) NOT NULL,
	"passing" boolean NOT NULL,
	"bundle_size_bytes" integer NOT NULL,
	"submitted_by_token_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(66) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "evidence_task_hash_unique" UNIQUE("task_id","evidence_hash"),
	CONSTRAINT "evidence_token_idempotency_unique" UNIQUE("submitted_by_token_id","idempotency_key"),
	CONSTRAINT "evidence_public_id_format" CHECK ("evidence_bundles"."public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "evidence_schema_version_positive" CHECK ("evidence_bundles"."schema_version" > 0),
	CONSTRAINT "evidence_hashes_format" CHECK ("evidence_bundles"."evidence_hash" ~ '^0x[0-9a-f]{64}$' and "evidence_bundles"."commit_hash_derived" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "evidence_git_object_id_format" CHECK ("evidence_bundles"."git_object_id" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "evidence_request_hash_format" CHECK ("evidence_bundles"."request_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "evidence_bundle_size_positive" CHECK ("evidence_bundles"."bundle_size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"project_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"canonical_json" jsonb NOT NULL,
	"policy_hash" varchar(66) NOT NULL,
	"source_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "policies_project_hash_unique" UNIQUE("project_id","policy_hash"),
	CONSTRAINT "policies_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "policies_id_project_hash_unique" UNIQUE("id","project_id","policy_hash"),
	CONSTRAINT "policies_schema_version_positive" CHECK ("policies"."schema_version" > 0),
	CONSTRAINT "policies_hash_format" CHECK ("policies"."policy_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "policies_source_relative" CHECK ("policies"."source_path" not like '/%' and "policies"."source_path" <> '..' and "policies"."source_path" not like '../%' and "policies"."source_path" not like '%/..' and "policies"."source_path" not like '%/../%' and position(chr(92) in "policies"."source_path") = 0)
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(160) NOT NULL,
	"repository_url" text NOT NULL,
	"default_branch" varchar(255) NOT NULL,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"active_policy_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "projects_owner_slug_unique" UNIQUE("owner_user_id","slug"),
	CONSTRAINT "projects_public_id_format" CHECK ("projects"."public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "projects_slug_format" CHECK ("projects"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "projects_repository_url_no_credentials" CHECK ("projects"."repository_url" !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/@]+@')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"policy_id" uuid NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"chain_task_id" bigint,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"acceptance_criteria_json" jsonb NOT NULL,
	"task_hash" varchar(66) NOT NULL,
	"policy_hash" varchar(66) NOT NULL,
	"creator_wallet" varchar(42) NOT NULL,
	"assignee_wallet" varchar(42) NOT NULL,
	"reward_wei" bigint DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"offchain_status" "task_offchain_status" DEFAULT 'draft' NOT NULL,
	"chain_status" "task_chain_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "tasks_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "tasks_id_policy_project_unique" UNIQUE("id","policy_id","project_id"),
	CONSTRAINT "tasks_chain_identity_unique" UNIQUE("chain_id","contract_address","chain_task_id"),
	CONSTRAINT "tasks_public_id_format" CHECK ("tasks"."public_id" ~ '^[0-9a-hjkmnp-tv-z]{26}$'),
	CONSTRAINT "tasks_chain_id_positive" CHECK ("tasks"."chain_id" > 0),
	CONSTRAINT "tasks_contract_address_format" CHECK ("tasks"."contract_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "tasks_creator_wallet_format" CHECK ("tasks"."creator_wallet" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "tasks_assignee_wallet_format" CHECK ("tasks"."assignee_wallet" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "tasks_reward_nonnegative" CHECK ("tasks"."reward_wei" >= 0),
	CONSTRAINT "tasks_hashes_format" CHECK ("tasks"."task_hash" ~ '^0x[0-9a-f]{64}$' and "tasks"."policy_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"email_normalized" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized_lowercase" CHECK ("users"."email_normalized" is null or "users"."email_normalized" = lower("users"."email_normalized"))
);
--> statement-breakpoint
CREATE TABLE "verification_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"check_key" varchar(80) NOT NULL,
	"label" varchar(128) NOT NULL,
	"required" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"exit_code" integer,
	"signal" varchar(32),
	"stdout_digest" varchar(66) NOT NULL,
	"stderr_digest" varchar(66) NOT NULL,
	"stdout_preview" text NOT NULL,
	"stderr_preview" text NOT NULL,
	"status" "verification_check_status" NOT NULL,
	CONSTRAINT "verification_checks_bundle_key_unique" UNIQUE("evidence_bundle_id","check_key"),
	CONSTRAINT "verification_checks_key_format" CHECK ("verification_checks"."check_key" ~ '^[a-zA-Z0-9._-]{1,64}$'),
	CONSTRAINT "verification_checks_duration_nonnegative" CHECK ("verification_checks"."duration_ms" >= 0),
	CONSTRAINT "verification_checks_status_outcome_consistent" CHECK (("verification_checks"."status" = 'passed' and "verification_checks"."exit_code" = 0 and "verification_checks"."signal" is null) or ("verification_checks"."status" = 'failed' and (("verification_checks"."exit_code" is not null and "verification_checks"."exit_code" <> 0) or "verification_checks"."signal" is not null)) or ("verification_checks"."status" in ('timed_out', 'error') and "verification_checks"."exit_code" is null) or ("verification_checks"."status" = 'skipped' and "verification_checks"."exit_code" is null and "verification_checks"."signal" is null)),
	CONSTRAINT "verification_checks_digests_format" CHECK ("verification_checks"."stdout_digest" ~ '^0x[0-9a-f]{64}$' and "verification_checks"."stderr_digest" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" bigint NOT NULL,
	"address_normalized" varchar(42) NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_chain_address_unique" UNIQUE("chain_id","address_normalized"),
	CONSTRAINT "wallets_chain_id_positive" CHECK ("wallets"."chain_id" > 0),
	CONSTRAINT "wallets_address_normalized_format" CHECK ("wallets"."address_normalized" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "wallets_address_nonzero" CHECK ("wallets"."address_normalized" <> '0x0000000000000000000000000000000000000000')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_replacement_scope_fk" FOREIGN KEY ("replaced_by_transaction_id","user_id","project_id","chain_id") REFERENCES "public"."chain_transactions"("id","user_id","project_id","chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_task_policy_project_fk" FOREIGN KEY ("task_id","policy_id","project_id") REFERENCES "public"."tasks"("id","policy_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_token_project_fk" FOREIGN KEY ("submitted_by_token_id","project_id") REFERENCES "public"."cli_tokens"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_policy_same_project_fk" FOREIGN KEY ("active_policy_id","id") REFERENCES "public"."policies"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_policy_same_project_hash_fk" FOREIGN KEY ("policy_id","project_id","policy_hash") REFERENCES "public"."policies"("id","project_id","policy_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_evidence_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_expiry_idx" ON "api_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_events_project_created_idx" ON "audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_task_created_idx" ON "audit_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_transactions_hash_unique" ON "chain_transactions" USING btree ("chain_id","transaction_hash") WHERE "chain_transactions"."transaction_hash" is not null;--> statement-breakpoint
CREATE INDEX "chain_transactions_status_updated_idx" ON "chain_transactions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "chain_transactions_task_idx" ON "chain_transactions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "cli_tokens_project_active_idx" ON "cli_tokens" USING btree ("project_id","revoked_at");--> statement-breakpoint
CREATE INDEX "contract_events_contract_block_idx" ON "contract_events" USING btree ("chain_id","contract_address","block_number");--> statement-breakpoint
CREATE INDEX "evidence_task_created_idx" ON "evidence_bundles" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "policies_project_created_idx" ON "policies" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "tasks_project_created_idx" ON "tasks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("chain_id","assignee_wallet","chain_status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree ("email_normalized") WHERE "users"."email_normalized" is not null;--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");