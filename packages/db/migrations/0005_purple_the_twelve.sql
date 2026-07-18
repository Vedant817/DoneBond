CREATE TABLE "receipt_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_transaction_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"evidence_hash" varchar(66) NOT NULL,
	"commit_hash" varchar(66) NOT NULL,
	"attestation_expiry" bigint NOT NULL,
	"verifier_address" varchar(42) NOT NULL,
	"signature" varchar(132) NOT NULL,
	"typed_data_digest" varchar(66) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_attestations_chain_transaction_unique" UNIQUE("chain_transaction_id"),
	CONSTRAINT "receipt_attestations_id_task_unique" UNIQUE("id","task_id"),
	CONSTRAINT "receipt_attestations_verifier_address_format" CHECK ("receipt_attestations"."verifier_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "receipt_attestations_signature_format" CHECK ("receipt_attestations"."signature" ~ '^0x[0-9a-f]{130}$'),
	CONSTRAINT "receipt_attestations_hashes_format" CHECK ("receipt_attestations"."evidence_hash" ~ '^0x[0-9a-f]{64}$' and "receipt_attestations"."commit_hash" ~ '^0x[0-9a-f]{64}$' and "receipt_attestations"."typed_data_digest" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "receipt_attestations_expiry_positive" CHECK ("receipt_attestations"."attestation_expiry" > 0)
);
--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD COLUMN "response_safe_json" jsonb;--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "canonical_json" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "target_branch" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "base_commit" varchar(64);--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_id_task_unique" UNIQUE("id","task_id");--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_id_task_unique" UNIQUE("id","task_id");--> statement-breakpoint
ALTER TABLE "receipt_attestations" ADD CONSTRAINT "receipt_attestations_chain_transaction_task_fk" FOREIGN KEY ("chain_transaction_id","task_id") REFERENCES "public"."chain_transactions"("id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_attestations" ADD CONSTRAINT "receipt_attestations_evidence_bundle_task_fk" FOREIGN KEY ("evidence_bundle_id","task_id") REFERENCES "public"."evidence_bundles"("id","task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_attestations_task_idx" ON "receipt_attestations" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_hash_unique" UNIQUE("project_id","task_hash");--> statement-breakpoint
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_response_complete" CHECK (("chain_transactions"."response_safe_json" is null and "chain_transactions"."response_status" is null) or ("chain_transactions"."response_safe_json" is not null and "chain_transactions"."response_status" between 200 and 299));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_target_branch_safe" CHECK ("tasks"."target_branch" <> '' and "tasks"."target_branch" not like '-%' and "tasks"."target_branch" not like '/%' and "tasks"."target_branch" not like '%/' and "tasks"."target_branch" not like '.%' and "tasks"."target_branch" not like '%/.%' and "tasks"."target_branch" not like '%.lock' and "tasks"."target_branch" not like '%.lock/%' and "tasks"."target_branch" not like '%..%' and "tasks"."target_branch" not like '%@{%' and "tasks"."target_branch" not like '%//%' and "tasks"."target_branch" !~ '[[:cntrl:] ~^:?*]' and position(chr(92) in "tasks"."target_branch") = 0 and position('[' in "tasks"."target_branch") = 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_base_commit_format" CHECK ("tasks"."base_commit" is null or "tasks"."base_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');
