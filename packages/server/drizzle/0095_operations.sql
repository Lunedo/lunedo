CREATE TABLE "maintenance_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"block_sign_in" boolean DEFAULT false NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	CONSTRAINT "maintenance_state_singleton" CHECK ("maintenance_state"."singleton"),
	CONSTRAINT "maintenance_state_message" CHECK (char_length("maintenance_state"."message") <= 500)
);
--> statement-breakpoint
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
CREATE TABLE "update_check_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"checked_at" timestamp with time zone,
	"succeeded" boolean DEFAULT false NOT NULL,
	"failure" text,
	"releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_version" text,
	CONSTRAINT "update_check_state_singleton" CHECK ("update_check_state"."singleton")
);
--> statement-breakpoint
ALTER TABLE "mail_delivery_status" ADD COLUMN "failed_attempts" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_delivery_status" ADD COLUMN "failed_messages" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_state" ADD CONSTRAINT "maintenance_state_changed_by_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;