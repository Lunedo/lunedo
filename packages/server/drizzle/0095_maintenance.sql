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
ALTER TABLE "maintenance_state" ADD CONSTRAINT "maintenance_state_changed_by_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;