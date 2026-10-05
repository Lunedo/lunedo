CREATE TABLE "audit_subject_keys" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "sealed" jsonb;--> statement-breakpoint
CREATE INDEX "audit_subject_keys_account_id_index" ON "audit_subject_keys" USING btree ("account_id");