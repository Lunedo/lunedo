ALTER TABLE "identities" ADD COLUMN "groups_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "groups_read_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "groups_withheld_notified_at" timestamp with time zone;