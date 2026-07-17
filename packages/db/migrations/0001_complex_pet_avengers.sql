CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"csrf_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_from_session_id" uuid,
	CONSTRAINT "browser_sessions_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "browser_sessions_csrf_digest_unique" UNIQUE("csrf_digest"),
	CONSTRAINT "browser_sessions_token_digest_format" CHECK ("browser_sessions"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "browser_sessions_csrf_digest_format" CHECK ("browser_sessions"."csrf_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "browser_sessions_lifetime" CHECK ("browser_sessions"."absolute_expires_at" > "browser_sessions"."created_at" and "browser_sessions"."idle_expires_at" > "browser_sessions"."created_at" and "browser_sessions"."idle_expires_at" <= "browser_sessions"."absolute_expires_at" and "browser_sessions"."last_seen_at" >= "browser_sessions"."created_at" and "browser_sessions"."last_seen_at" < "browser_sessions"."absolute_expires_at" and ("browser_sessions"."revoked_at" is null or "browser_sessions"."revoked_at" >= "browser_sessions"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "wallet_auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"address_normalized" varchar(42) NOT NULL,
	"chain_id" bigint NOT NULL,
	"domain" varchar(255) NOT NULL,
	"uri" text NOT NULL,
	"nonce_digest" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "wallet_auth_challenges_nonce_digest_unique" UNIQUE("nonce_digest"),
	CONSTRAINT "wallet_auth_challenges_address_format" CHECK ("wallet_auth_challenges"."address_normalized" ~ '^0x[0-9a-f]{40}$' and "wallet_auth_challenges"."address_normalized" <> '0x0000000000000000000000000000000000000000'),
	CONSTRAINT "wallet_auth_challenges_supported_chain" CHECK ("wallet_auth_challenges"."chain_id" in (143, 10143)),
	CONSTRAINT "wallet_auth_challenges_nonce_digest_format" CHECK ("wallet_auth_challenges"."nonce_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wallet_auth_challenges_lifetime" CHECK ("wallet_auth_challenges"."expires_at" > "wallet_auth_challenges"."issued_at" and ("wallet_auth_challenges"."consumed_at" is null or ("wallet_auth_challenges"."consumed_at" >= "wallet_auth_challenges"."issued_at" and "wallet_auth_challenges"."consumed_at" < "wallet_auth_challenges"."expires_at"))),
	CONSTRAINT "wallet_auth_challenges_origin_binding" CHECK ("wallet_auth_challenges"."domain" !~ '[/@?#]' and ("wallet_auth_challenges"."uri" = 'https://' || "wallet_auth_challenges"."domain" or ("wallet_auth_challenges"."domain" ~ '^(localhost|127\.0\.0\.1)(?::[0-9]+)?$' and "wallet_auth_challenges"."uri" = 'http://' || "wallet_auth_challenges"."domain")))
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_rotated_from_session_id_browser_sessions_id_fk" FOREIGN KEY ("rotated_from_session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_wallet_user_fk" FOREIGN KEY ("wallet_id","user_id") REFERENCES "public"."wallets"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_sessions_user_active_idx" ON "browser_sessions" USING btree ("user_id","revoked_at","idle_expires_at");--> statement-breakpoint
CREATE INDEX "browser_sessions_absolute_expiry_idx" ON "browser_sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE INDEX "wallet_auth_challenges_expiry_idx" ON "wallet_auth_challenges" USING btree ("expires_at","consumed_at");--> statement-breakpoint
CREATE INDEX "wallet_auth_challenges_address_issued_idx" ON "wallet_auth_challenges" USING btree ("chain_id","address_normalized","issued_at");
