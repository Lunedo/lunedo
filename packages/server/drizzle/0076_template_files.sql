CREATE TABLE "template_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_files_name_length" CHECK (length("template_files"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "template_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"level" "template_level" NOT NULL,
	"organization_id" uuid,
	"space_id" uuid,
	"file_name" text NOT NULL,
	"templates" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_templates" ADD COLUMN "files_adopted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_templates" ALTER COLUMN "files_adopted" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_template_id_page_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."page_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_files" ADD CONSTRAINT "template_files_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_imports" ADD CONSTRAINT "template_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_files_template_id_index" ON "template_files" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_files_file_id_index" ON "template_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "template_files_created_by_index" ON "template_files" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "template_imports_account_id_index" ON "template_imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "template_imports_organization_id_index" ON "template_imports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_imports_space_id_index" ON "template_imports" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "template_imports_created_at_index" ON "template_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "page_templates_files_pending_index" ON "page_templates" USING btree ("id") WHERE not "page_templates"."files_adopted";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "attachment_versions_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "whiteboard_previews_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION "template_files_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "template_files" "t" WHERE "t"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "template_files_release_file" AFTER DELETE ON "template_files"
  FOR EACH ROW EXECUTE FUNCTION "template_files_release_file"();
