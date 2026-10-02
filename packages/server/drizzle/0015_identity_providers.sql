CREATE TYPE "public"."identity_credential_kind" AS ENUM('clientSecret', 'certificate');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_preset" AS ENUM('entraId', 'google', 'generic');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_type" AS ENUM('oidc');--> statement-breakpoint
CREATE TYPE "public"."provider_flow_purpose" AS ENUM('signIn', 'reauthentication', 'test');--> statement-breakpoint
CREATE TYPE "public"."sign_in_refusal_reason" AS ENUM('accountCreationDisabled', 'domainNotAllowed', 'emailNotVerified', 'groupRequired', 'accountInactive', 'linkDeclined', 'linkUnavailable', 'invalidResponse');--> statement-breakpoint
ALTER TYPE "public"."challenge_purpose" ADD VALUE 'identityLink';--> statement-breakpoint
ALTER TYPE "public"."sign_in_method" ADD VALUE 'identityProvider';--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"sign_in_name" text,
	"display_name" text,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"kind" "identity_credential_kind" NOT NULL,
	"secret" "bytea" NOT NULL,
	"certificate" text,
	"key_id" text,
	"expires_at" timestamp with time zone,
	"notified_thirty_days_at" timestamp with time zone,
	"notified_seven_days_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_logos" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "identity_provider_type" NOT NULL,
	"preset" "identity_provider_preset" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "provider_flow_purpose" NOT NULL,
	"provider_id" uuid NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"browser_hash" "bytea" NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"session_id" uuid,
	"return_to" text,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_logout_tokens" (
	"provider_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_logout_tokens_provider_id_token_id_pk" PRIMARY KEY("provider_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "sign_in_refusals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"provider_id" uuid,
	"reason" "sign_in_refusal_reason" NOT NULL,
	"subject" text,
	"email" text,
	"display_name" text,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "provider_session_id" text;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_credentials" ADD CONSTRAINT "identity_provider_credentials_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_logos" ADD CONSTRAINT "identity_provider_logos_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_flows" ADD CONSTRAINT "provider_flows_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_logout_tokens" ADD CONSTRAINT "provider_logout_tokens_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_refusals" ADD CONSTRAINT "sign_in_refusals_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_refusals" ADD CONSTRAINT "sign_in_refusals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_id_subject_index" ON "identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "identities_account_id_index" ON "identities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "identity_provider_credentials_provider_id_index" ON "identity_provider_credentials" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "identity_provider_credentials_expires_at_index" ON "identity_provider_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identity_provider_domains_provider_id_index" ON "identity_provider_domains" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_flows_state_hash_index" ON "provider_flows" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "provider_flows_expires_at_index" ON "provider_flows" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_logout_tokens_expires_at_index" ON "provider_logout_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_refusals_reference_index" ON "sign_in_refusals" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "sign_in_refusals_created_at_index" ON "sign_in_refusals" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_identity_id_index" ON "sessions" USING btree ("identity_id");