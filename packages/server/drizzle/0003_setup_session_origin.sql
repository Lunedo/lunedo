DELETE FROM "setup_sessions";--> statement-breakpoint
ALTER TABLE "setup_sessions" ADD COLUMN "origin" text NOT NULL;
