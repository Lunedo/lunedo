ALTER TABLE "backup_state" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_state" ADD COLUMN "test_restore_cleanup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_test_restores" ADD COLUMN "job_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_state" ADD COLUMN "last_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_state" ADD COLUMN "last_ended_at" timestamp with time zone;