CREATE TABLE "storage_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	"active_level" smallint DEFAULT 0 NOT NULL,
	"reached_level" smallint DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_state_singleton" CHECK ("storage_state"."singleton"),
	CONSTRAINT "storage_state_levels" CHECK ("storage_state"."active_level" between 0 and 3 and "storage_state"."reached_level" between 0 and 3),
	CONSTRAINT "storage_state_used" CHECK ("storage_state"."used_bytes" >= 0)
);
