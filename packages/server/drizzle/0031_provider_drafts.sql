ALTER TABLE "identity_providers" ALTER COLUMN "config" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "identity_providers" SET "setup_completed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_config_or_draft" CHECK (("identity_providers"."config" is null) = ("identity_providers"."draft" is not null));