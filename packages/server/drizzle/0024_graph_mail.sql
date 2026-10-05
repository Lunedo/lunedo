CREATE TYPE "public"."mail_credential_kind" AS ENUM('clientSecret', 'certificate');--> statement-breakpoint
CREATE TABLE "mail_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "mail_credential_kind" NOT NULL,
	"secret" "bytea" NOT NULL,
	"certificate" text,
	"key_id" text,
	"expires_at" timestamp with time zone,
	"notified_thirty_days_at" timestamp with time zone,
	"notified_seven_days_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_credentials_expires_at_index" ON "mail_credentials" USING btree ("expires_at");