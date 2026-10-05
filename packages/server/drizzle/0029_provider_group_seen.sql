ALTER TABLE "provider_groups" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "provider_groups" SET "seen_at" = "updated_at" WHERE "name" IS NOT NULL OR EXISTS (SELECT 1 FROM "identity_groups" WHERE "identity_groups"."group_id" = "provider_groups"."id");
