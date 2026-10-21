CREATE TABLE "operations_error_events" (
	"hour" timestamp with time zone NOT NULL,
	"service" text NOT NULL,
	"type" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"count" integer NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operations_error_events_hour_service_type_code_pk" PRIMARY KEY("hour","service","type","code"),
	CONSTRAINT "operations_error_events_count" CHECK ("operations_error_events"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_delivery_status" ADD COLUMN "failed_attempts" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_delivery_status" ADD COLUMN "failed_messages" bigint DEFAULT 0 NOT NULL;