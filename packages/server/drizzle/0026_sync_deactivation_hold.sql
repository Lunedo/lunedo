ALTER TABLE "provider_sync_runs" ADD COLUMN "held_deactivations" integer;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "confirmed_run_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_confirmed_by_accounts_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;