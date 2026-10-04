ALTER TYPE "public"."provider_sync_trigger" ADD VALUE 'scim';--> statement-breakpoint
ALTER TYPE "public"."provider_sync_trigger" ADD VALUE 'reconciliation';--> statement-breakpoint
CREATE TABLE "scim_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "scim_user_name" text;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_token_hash_index" ON "scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_tokens_provider_id_index" ON "scim_tokens" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_scim_user_name_unique" ON "identities" USING btree ("provider_id",lower("scim_user_name")) WHERE "identities"."scim_user_name" is not null;