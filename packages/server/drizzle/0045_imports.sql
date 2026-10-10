CREATE TYPE "public"."import_state" AS ENUM('draft', 'analyzing', 'ready', 'running', 'held', 'stopping', 'review', 'accepting', 'accepted', 'discarding', 'discarded', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "account_external_ids" (
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_external_ids_organization_id_source_external_id_pk" PRIMARY KEY("organization_id","source","external_id"),
	CONSTRAINT "account_external_ids_length" CHECK (length("account_external_ids"."external_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_import_id_kind_source_id_pk" PRIMARY KEY("import_id","kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "import_problems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"category" text NOT NULL,
	"code" text NOT NULL,
	"key" text NOT NULL,
	"source_kind" text,
	"source_id" text,
	"item_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"ref" text,
	"parent_id" text,
	"sort" text,
	"ordinal" integer,
	"data" jsonb NOT NULL,
	CONSTRAINT "import_records_import_id_kind_source_id_pk" PRIMARY KEY("import_id","kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "import_reviewers" (
	"import_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_reviewers_import_id_account_id_pk" PRIMARY KEY("import_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "import_upload_parts" (
	"upload_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_upload_parts_upload_id_number_pk" PRIMARY KEY("upload_id","number")
);
--> statement-breakpoint
CREATE TABLE "import_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_uploads_size" CHECK ("import_uploads"."size" > 0),
	CONSTRAINT "import_uploads_name" CHECK (length("import_uploads"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"importer_id" uuid NOT NULL,
	"source" text NOT NULL,
	"state" "import_state" DEFAULT 'draft' NOT NULL,
	"draft_step" smallint DEFAULT 0 NOT NULL,
	"file_kind" text,
	"upload_id" uuid,
	"folder_file" text,
	"space_name" text,
	"space_key" text,
	"archived" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"phase" text,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"found" jsonb,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quarantine_space_id" uuid,
	"error_code" text,
	"stop_requested_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"file_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_file_kind" CHECK ("imports"."file_kind" is null or "imports"."file_kind" in ('upload', 'folder')),
	CONSTRAINT "imports_draft_step" CHECK ("imports"."draft_step" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "quarantined" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_external_ids" ADD CONSTRAINT "account_external_ids_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_external_ids" ADD CONSTRAINT "account_external_ids_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_problems" ADD CONSTRAINT "import_problems_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_problems" ADD CONSTRAINT "import_problems_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reviewers" ADD CONSTRAINT "import_reviewers_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_upload_parts" ADD CONSTRAINT "import_upload_parts_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_upload_parts" ADD CONSTRAINT "import_upload_parts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_importer_id_accounts_id_fk" FOREIGN KEY ("importer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_upload_id_import_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."import_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_quarantine_space_id_spaces_id_fk" FOREIGN KEY ("quarantine_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_external_ids_account_id_index" ON "account_external_ids" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_items_target_id_index" ON "import_items" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_problems_key_unique" ON "import_problems" USING btree ("import_id","key");--> statement-breakpoint
CREATE INDEX "import_problems_import_id_category_code_index" ON "import_problems" USING btree ("import_id","category","code");--> statement-breakpoint
CREATE INDEX "import_problems_item_id_index" ON "import_problems" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "import_records_import_id_kind_ref_index" ON "import_records" USING btree ("import_id","kind","ref");--> statement-breakpoint
CREATE INDEX "import_records_import_id_kind_ordinal_index" ON "import_records" USING btree ("import_id","kind","ordinal");--> statement-breakpoint
CREATE INDEX "import_reviewers_account_id_index" ON "import_reviewers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_reviewers_created_by_index" ON "import_reviewers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_upload_parts_file_id_index" ON "import_upload_parts" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "import_uploads_organization_id_index" ON "import_uploads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_uploads_created_by_index" ON "import_uploads" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_uploads_expires_at_index" ON "import_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "imports_organization_id_created_at_index" ON "imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "imports_importer_id_index" ON "imports" USING btree ("importer_id");--> statement-breakpoint
CREATE INDEX "imports_upload_id_index" ON "imports" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "imports_decided_by_index" ON "imports" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "imports_file_expires_at_index" ON "imports" USING btree ("file_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_quarantine_space_unique" ON "imports" USING btree ("quarantine_space_id");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_quarantine_private" CHECK (not "spaces"."quarantined" or ("spaces"."visibility" = 'private' and not "spaces"."discoverable" and "spaces"."personal_of" is null and not "spaces"."confidential"));--> statement-breakpoint
CREATE FUNCTION "import_upload_parts_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready';
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "import_upload_parts_release_file" AFTER DELETE ON "import_upload_parts"
  FOR EACH ROW EXECUTE FUNCTION "import_upload_parts_release_file"();
--> statement-breakpoint
CREATE FUNCTION "space_permissions_quarantine_holder"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "spaces" "s" WHERE "s"."id" = NEW."space_id" AND "s"."quarantined")
    AND (NEW."principal_kind" <> 'account' OR NEW."role" <> 'reader') THEN
    RAISE EXCEPTION 'A quarantine space can only be read by individual people' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "space_permissions_quarantine_holder" BEFORE INSERT OR UPDATE ON "space_permissions"
  FOR EACH ROW EXECUTE FUNCTION "space_permissions_quarantine_holder"();
