ALTER TABLE "announcements" ADD COLUMN "start_signaled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "announcements" SET "start_signaled" = false WHERE "starts_at" > now();
