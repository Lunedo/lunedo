CREATE TABLE "account_pictures" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "picture_ref" text;--> statement-breakpoint
ALTER TABLE "account_pictures" ADD CONSTRAINT "account_pictures_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_pictures" ADD CONSTRAINT "account_pictures_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_pictures_file_unique" ON "account_pictures" USING btree ("file_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_job_title_length" CHECK (char_length("accounts"."job_title") between 1 and 100);