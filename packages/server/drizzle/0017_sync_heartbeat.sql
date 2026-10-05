ALTER TYPE "public"."provider_sync_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;