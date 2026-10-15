CREATE TYPE "public"."notification_email_status" AS ENUM('immediate', 'digest', 'sent', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."mail_status" ADD VALUE 'sending' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "mail_delivery_status" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" text,
	"last_failure_response_code" integer,
	"last_failure_step" text,
	CONSTRAINT "mail_delivery_status_single_row" CHECK ("mail_delivery_status"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_status" "notification_email_status";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_pending_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_email_pending_index" ON "notifications" USING btree ("recipient_id","email_pending_since") WHERE "notifications"."email_status" in ('immediate', 'digest');