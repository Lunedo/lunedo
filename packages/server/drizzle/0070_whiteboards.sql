ALTER TYPE "public"."tree_item_kind" ADD VALUE 'whiteboard';--> statement-breakpoint
CREATE TABLE "whiteboard_documents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"scene" jsonb NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"versioned_revision" bigint DEFAULT 0 NOT NULL,
	"preview_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboard_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboard_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"scene" jsonb NOT NULL,
	"reason" "version_reason" NOT NULL,
	"restored_from" integer,
	"revision" bigint NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"preview_id" uuid,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_versions_number_positive" CHECK ("whiteboard_versions"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "element_id" text;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_preview_id_whiteboard_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."whiteboard_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_documents" ADD CONSTRAINT "whiteboard_documents_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_previews" ADD CONSTRAINT "whiteboard_previews_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_preview_id_whiteboard_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."whiteboard_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whiteboard_documents_preview_id_index" ON "whiteboard_documents" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX "whiteboard_documents_updated_by_index" ON "whiteboard_documents" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_item_id_revision_index" ON "whiteboard_previews" USING btree ("item_id","revision");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_file_id_index" ON "whiteboard_previews" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "whiteboard_previews_created_by_index" ON "whiteboard_previews" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "whiteboard_versions_number_unique" ON "whiteboard_versions" USING btree ("item_id","number");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_preview_id_index" ON "whiteboard_versions" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_created_by_index" ON "whiteboard_versions" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reply_has_no_element" CHECK ("comments"."parent_id" is null or "comments"."element_id" is null);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_element_length" CHECK (length("comments"."element_id") <= 128);--> statement-breakpoint
CREATE FUNCTION "whiteboard_previews_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id")
    AND NOT EXISTS (SELECT 1 FROM "whiteboard_previews" "p" WHERE "p"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "whiteboard_previews_release_file" AFTER DELETE ON "whiteboard_previews"
  FOR EACH ROW EXECUTE FUNCTION "whiteboard_previews_release_file"();--> statement-breakpoint
CREATE FUNCTION "search_whiteboard_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_mark_item"(NEW."item_id", interval '5 seconds');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_whiteboard_documents_changed" AFTER INSERT OR UPDATE OF "scene" ON "whiteboard_documents"
  FOR EACH ROW EXECUTE FUNCTION "search_whiteboard_changed"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_setting_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "changed" "setting_values";
BEGIN
  IF TG_OP = 'DELETE' THEN
    "changed" := OLD;
  ELSE
    "changed" := NEW;
  END IF;
  IF "changed"."key" NOT IN ('content.language', 'locale.language', 'pages.status') THEN
    RETURN NULL;
  END IF;
  INSERT INTO "search_pending_items" ("item_id")
  SELECT "t"."id" FROM "tree_items" "t" JOIN "spaces" "s" ON "s"."id" = "t"."space_id"
  WHERE "t"."kind"::text IN ('page', 'blogPost', 'meetingTopic', 'whiteboard') AND "t"."trash_entry_id" IS NULL AND (
    "changed"."level" = 'instance'
    OR ("changed"."level" = 'organization' AND "s"."organization_id" = "changed"."scope_id")
    OR ("changed"."level" = 'space' AND "s"."id" = "changed"."scope_id"))
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
  RETURN NULL;
END $$;
