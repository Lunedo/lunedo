CREATE TYPE "public"."search_file_text_state" AS ENUM('extracted', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."search_source" ADD VALUE 'attachment';--> statement-breakpoint
ALTER TYPE "public"."search_source" ADD VALUE 'decision';--> statement-breakpoint
CREATE TABLE "search_file_texts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"extractor_version" integer NOT NULL,
	"state" "search_file_text_state" NOT NULL,
	"reason" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_file_texts_reason" CHECK (("search_file_texts"."state" = 'skipped') = ("search_file_texts"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "search_chunks" ADD COLUMN "context_item_id" uuid;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD COLUMN "context_readers" text[];--> statement-breakpoint
ALTER TABLE "search_chunks" ADD COLUMN "context_restrictions" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD COLUMN "attachment" jsonb;--> statement-breakpoint
ALTER TABLE "search_file_texts" ADD CONSTRAINT "search_file_texts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_context_item_id_tree_items_id_fk" FOREIGN KEY ("context_item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_chunks_context_item_id_index" ON "search_chunks" USING btree ("context_item_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search_tree_items_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_mark_item"(NEW."id", interval '0');
  IF TG_OP = 'UPDATE' THEN
    PERFORM "search_mark_item"("u"."topic_id", interval '0')
    FROM "meeting_topic_updates" "u" WHERE "u"."item_id" = NEW."id";
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."path" IS DISTINCT FROM NEW."path" OR OLD."space_id" <> NEW."space_id"
      OR OLD."trash_entry_id" IS DISTINCT FROM NEW."trash_entry_id" OR OLD."reader_visible" <> NEW."reader_visible") THEN
    PERFORM "search_mark_space"(OLD."space_id");
    IF OLD."space_id" <> NEW."space_id" THEN
      PERFORM "search_mark_space"(NEW."space_id");
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
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
  WHERE "t"."kind" IN ('page', 'blogPost', 'meetingTopic') AND "t"."trash_entry_id" IS NULL AND (
    "changed"."level" = 'instance'
    OR ("changed"."level" = 'organization' AND "s"."organization_id" = "changed"."scope_id")
    OR ("changed"."level" = 'space' AND "s"."id" = "changed"."scope_id"))
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_attachments_published" AFTER UPDATE OF "published_version_id", "item_id" ON "attachments"
  FOR EACH ROW WHEN (OLD."published_version_id" IS DISTINCT FROM NEW."published_version_id" OR OLD."item_id" <> NEW."item_id")
  EXECUTE FUNCTION "search_item_content_changed"();--> statement-breakpoint
CREATE TRIGGER "search_attachments_deleted" AFTER DELETE ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION "search_item_content_changed"();--> statement-breakpoint
CREATE TRIGGER "search_decisions_changed" AFTER INSERT OR UPDATE OF "published", "text", "topic_id", "item_id" OR DELETE ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION "search_item_content_changed"();--> statement-breakpoint
CREATE FUNCTION "search_topic_updates_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."topic_id") THEN
    PERFORM "search_mark_item"(OLD."topic_id", interval '0');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_item"(NEW."topic_id", interval '0');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_topic_updates_changed" AFTER INSERT OR UPDATE OR DELETE ON "meeting_topic_updates"
  FOR EACH ROW EXECUTE FUNCTION "search_topic_updates_changed"();--> statement-breakpoint
CREATE FUNCTION "search_meeting_state_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_mark_item"("u"."topic_id", interval '0')
  FROM "meeting_topic_updates" "u" WHERE "u"."item_id" = NEW."item_id";
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_meetings_state_changed" AFTER UPDATE OF "state" ON "meetings"
  FOR EACH ROW WHEN (OLD."state" IS DISTINCT FROM NEW."state")
  EXECUTE FUNCTION "search_meeting_state_changed"();--> statement-breakpoint
INSERT INTO "search_pending_items" ("item_id")
SELECT "t"."id" FROM "tree_items" "t"
WHERE "t"."trash_entry_id" IS NULL AND ("t"."kind"::text = 'meetingTopic'
  OR EXISTS (SELECT 1 FROM "attachments" "a" WHERE "a"."item_id" = "t"."id" AND "a"."published_version_id" IS NOT NULL)
  OR EXISTS (SELECT 1 FROM "decisions" "d" WHERE "d"."item_id" = "t"."id" AND "d"."published"))
ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1, "due_at" = now(),
  "attempts" = 0, "updated_at" = now();
