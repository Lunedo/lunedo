CREATE TABLE "update_check_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"checked_at" timestamp with time zone,
	"succeeded" boolean DEFAULT false NOT NULL,
	"failure" text,
	"releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_version" text,
	CONSTRAINT "update_check_state_singleton" CHECK ("update_check_state"."singleton")
);
