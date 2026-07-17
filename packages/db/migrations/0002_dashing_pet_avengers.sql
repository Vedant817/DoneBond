CREATE TABLE "auth_rate_limits" (
	"scope" varchar(64) NOT NULL,
	"key_digest" varchar(64) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	CONSTRAINT "auth_rate_limits_scope_key_pk" PRIMARY KEY("scope","key_digest"),
	CONSTRAINT "auth_rate_limits_scope_format" CHECK ("auth_rate_limits"."scope" ~ '^[a-z][a-z0-9_:-]{0,63}$'),
	CONSTRAINT "auth_rate_limits_key_digest_format" CHECK ("auth_rate_limits"."key_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_rate_limits_window_valid" CHECK ("auth_rate_limits"."window_expires_at" > "auth_rate_limits"."window_started_at"),
	CONSTRAINT "auth_rate_limits_count_positive" CHECK ("auth_rate_limits"."request_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_expiry_idx" ON "auth_rate_limits" USING btree ("window_expires_at");