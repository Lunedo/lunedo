CREATE TYPE "public"."account_state" AS ENUM('invited', 'active', 'deactivated', 'anonymized', 'placeholder');--> statement-breakpoint
CREATE TYPE "public"."account_token_purpose" AS ENUM('passwordReset', 'emailChange');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('standard', 'guest', 'portal', 'service');--> statement-breakpoint
CREATE TYPE "public"."audit_scope_type" AS ENUM('instance', 'organization');--> statement-breakpoint
CREATE TYPE "public"."challenge_purpose" AS ENUM('secondFactor', 'passkeySignIn', 'passkeyRegistration', 'reauthentication');--> statement-breakpoint
CREATE TYPE "public"."mail_status" AS ENUM('pending', 'failed');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('account', 'anonymous', 'system');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('full', 'secondFactorSetup');--> statement-breakpoint
CREATE TYPE "public"."setup_completed_through" AS ENUM('assistant', 'configuration');--> statement-breakpoint
CREATE TYPE "public"."sign_in_method" AS ENUM('password', 'totp', 'passkey', 'recoveryCode');--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"new_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "account_type" NOT NULL,
	"state" "account_state" NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_chains" (
	"scope_type" "audit_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_hash" "bytea",
	"anchor_sequence" bigint,
	"anchor_hash" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chains_scope_type_scope_id_pk" PRIMARY KEY("scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" "audit_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"name" text NOT NULL,
	"actor_type" "principal_type" NOT NULL,
	"actor_id" uuid,
	"target_type" text NOT NULL,
	"target_id" text,
	"fields" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_id" text,
	"client_ip" text,
	"user_agent" text,
	"previous_hash" "bytea" NOT NULL,
	"hash" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "challenge_purpose" NOT NULL,
	"token_hash" "bytea",
	"account_id" uuid,
	"session_id" uuid,
	"challenge" text,
	"methods" "sign_in_method"[] DEFAULT '{}' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"device_hash" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_account_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"setup_completed_through" "setup_completed_through",
	"setup_code_hash" "bytea",
	"setup_code_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_single_row" CHECK ("instance"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "instance_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"message" "bytea",
	"status" "mail_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"kind" "session_kind" NOT NULL,
	"device_hash" "bytea",
	"methods" "sign_in_method"[] NOT NULL,
	"client_ip" text,
	"browser" text,
	"operating_system" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauthenticated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "setup_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "setup_steps" (
	"step" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_failures" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"lockouts" integer DEFAULT 0 NOT NULL,
	"last_lockout_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"secret" "bytea" NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint NOT NULL,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance" ADD CONSTRAINT "instance_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_token_hash_index" ON "account_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_tokens_account_id_purpose_index" ON "account_tokens" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_unique" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_scope_type_scope_id_sequence_index" ON "audit_events" USING btree ("scope_type","scope_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_index" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_index" ON "audit_events" USING btree ("actor_id") WHERE "audit_events"."actor_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_events_target_type_target_id_index" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_token_hash_index" ON "auth_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_at_index" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenges_session_id_index" ON "auth_challenges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "instance_owner_account_id_index" ON "instance" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "mail_outbox_status_created_at_index" ON "mail_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_index" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_account_id_code_hash_index" ON "recovery_codes" USING btree ("account_id","code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_index" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_id_last_used_at_index" ON "sessions" USING btree ("account_id","last_used_at");--> statement-breakpoint
CREATE INDEX "sessions_device_hash_index" ON "sessions" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "sign_in_failures_updated_at_index" ON "sign_in_failures" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_credentials_account_id_index" ON "totp_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_index" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_account_id_index" ON "webauthn_credentials" USING btree ("account_id");