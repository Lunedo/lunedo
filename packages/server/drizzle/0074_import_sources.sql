CREATE TABLE "import_files" (
	"import_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_files_import_id_upload_id_pk" PRIMARY KEY("import_id","upload_id")
);
--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_file_kind";--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_people_source";--> statement-breakpoint
ALTER TABLE "import_credentials" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD COLUMN "kind" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD COLUMN "base_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD COLUMN "ca_certificates" text;--> statement-breakpoint
ALTER TABLE "import_credentials" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "staged_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "throttled_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_files_position_unique" ON "import_files" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "import_files_upload_id_index" ON "import_files" USING btree ("upload_id");--> statement-breakpoint
ALTER TABLE "import_credentials" ADD CONSTRAINT "import_credentials_kind" CHECK ("import_credentials"."kind" in ('cloud', 'dataCenter'));--> statement-breakpoint
ALTER TABLE "import_credentials" ADD CONSTRAINT "import_credentials_email" CHECK ("import_credentials"."kind" = 'dataCenter' or "import_credentials"."email" is not null);--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_file_kind" CHECK ("imports"."file_kind" is null or "imports"."file_kind" in ('upload', 'folder', 'uploads', 'connection'));--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_people_source" CHECK ("imports"."people_source" is null or "imports"."people_source" in ('token', 'list', 'skip', 'source'));