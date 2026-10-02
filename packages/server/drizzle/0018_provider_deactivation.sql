ALTER TABLE "groups" ADD COLUMN "former_provider" text;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "deactivated_at" timestamp with time zone;