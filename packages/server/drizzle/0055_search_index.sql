CREATE TYPE "public"."search_source" AS ENUM('item', 'comment');--> statement-breakpoint
CREATE TABLE "search_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source" "search_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content_type" text NOT NULL,
	"title" text NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"anchor" text,
	"body" text NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text,
	"language" text NOT NULL,
	"config" text NOT NULL,
	"author_id" uuid,
	"content_created_at" timestamp with time zone NOT NULL,
	"content_updated_at" timestamp with time zone NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"readers" text[] NOT NULL,
	"restrictions" uuid[] NOT NULL,
	"document" "tsvector" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_chunks_position" CHECK ("search_chunks"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "search_index_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"building_since" timestamp with time zone,
	"build_total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_index_state_single_row" CHECK ("search_index_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "search_pending_items" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_pending_spaces" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_terms" (
	"word" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "content_language" text;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunks" ADD CONSTRAINT "search_chunks_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_chunks_source_unique" ON "search_chunks" USING btree ("source","source_id","position");--> statement-breakpoint
CREATE INDEX "search_chunks_item_id_index" ON "search_chunks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "search_chunks_space_id_index" ON "search_chunks" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "search_chunks_author_id_index" ON "search_chunks" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "search_chunks_organization_config_index" ON "search_chunks" USING btree ("organization_id","config");--> statement-breakpoint
CREATE INDEX "search_chunks_organization_updated_index" ON "search_chunks" USING btree ("organization_id","content_updated_at");--> statement-breakpoint
CREATE INDEX "search_chunks_document_index" ON "search_chunks" USING gin ("document");--> statement-breakpoint
CREATE INDEX "search_chunks_readers_index" ON "search_chunks" USING gin ("readers");--> statement-breakpoint
CREATE INDEX "search_chunks_labels_index" ON "search_chunks" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "search_pending_items_due_at_index" ON "search_pending_items" USING btree ("due_at");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE INDEX "search_terms_word_trigram_index" ON "search_terms" USING gin ("word" gin_trgm_ops);--> statement-breakpoint
CREATE FUNCTION "search_mark_item"("item" uuid, "delay" interval) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "search_pending_items" ("item_id", "due_at") VALUES ("item", now() + "delay")
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "attempts" = 0, "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
END $$;--> statement-breakpoint
CREATE FUNCTION "search_mark_space"("space" uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF "space" IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "search_pending_spaces" ("space_id") VALUES ("space")
  ON CONFLICT ("space_id") DO UPDATE SET "generation" = "search_pending_spaces"."generation" + 1, "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
END $$;--> statement-breakpoint
CREATE FUNCTION "search_tree_items_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_mark_item"(NEW."id", interval '0');
  IF TG_OP = 'UPDATE' AND (OLD."path" IS DISTINCT FROM NEW."path" OR OLD."space_id" <> NEW."space_id"
      OR OLD."trash_entry_id" IS DISTINCT FROM NEW."trash_entry_id" OR OLD."reader_visible" <> NEW."reader_visible") THEN
    PERFORM "search_mark_space"(OLD."space_id");
    IF OLD."space_id" <> NEW."space_id" THEN
      PERFORM "search_mark_space"(NEW."space_id");
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_tree_items_inserted" AFTER INSERT ON "tree_items"
  FOR EACH ROW EXECUTE FUNCTION "search_tree_items_changed"();--> statement-breakpoint
CREATE TRIGGER "search_tree_items_updated" AFTER UPDATE OF "title", "kind", "mode", "published_version_id",
  "reader_visible", "path", "space_id", "trash_entry_id", "archived_root_id", "content_language", "creator_id" ON "tree_items"
  FOR EACH ROW WHEN (OLD."title" IS DISTINCT FROM NEW."title" OR OLD."kind" IS DISTINCT FROM NEW."kind"
    OR OLD."mode" IS DISTINCT FROM NEW."mode" OR OLD."published_version_id" IS DISTINCT FROM NEW."published_version_id"
    OR OLD."reader_visible" IS DISTINCT FROM NEW."reader_visible" OR OLD."path" IS DISTINCT FROM NEW."path"
    OR OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."trash_entry_id" IS DISTINCT FROM NEW."trash_entry_id"
    OR OLD."archived_root_id" IS DISTINCT FROM NEW."archived_root_id"
    OR OLD."content_language" IS DISTINCT FROM NEW."content_language" OR OLD."creator_id" IS DISTINCT FROM NEW."creator_id")
  EXECUTE FUNCTION "search_tree_items_changed"();--> statement-breakpoint
CREATE FUNCTION "search_space_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "search_mark_space"(NEW."id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_spaces_updated" AFTER UPDATE OF "visibility", "deleted_at", "archived_at", "quarantined" ON "spaces"
  FOR EACH ROW WHEN (OLD."visibility" IS DISTINCT FROM NEW."visibility" OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
    OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."quarantined" IS DISTINCT FROM NEW."quarantined")
  EXECUTE FUNCTION "search_space_changed"();--> statement-breakpoint
CREATE FUNCTION "search_space_permissions_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "search_mark_space"(OLD."space_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_space"(NEW."space_id");
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_space_permissions_changed" AFTER INSERT OR UPDATE OR DELETE ON "space_permissions"
  FOR EACH ROW EXECUTE FUNCTION "search_space_permissions_changed"();--> statement-breakpoint
CREATE FUNCTION "search_item_access_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = OLD."item_id"));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = NEW."item_id"));
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_page_shares_changed" AFTER INSERT OR UPDATE OR DELETE ON "page_shares"
  FOR EACH ROW EXECUTE FUNCTION "search_item_access_changed"();--> statement-breakpoint
CREATE TRIGGER "search_page_restrictions_changed" AFTER INSERT OR UPDATE OR DELETE ON "page_restrictions"
  FOR EACH ROW EXECUTE FUNCTION "search_item_access_changed"();--> statement-breakpoint
CREATE FUNCTION "search_item_content_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."item_id") THEN
    PERFORM "search_mark_item"(OLD."item_id", interval '0');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "search_mark_item"(NEW."item_id", interval '0');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_page_labels_changed" AFTER INSERT OR UPDATE OR DELETE ON "page_labels"
  FOR EACH ROW EXECUTE FUNCTION "search_item_content_changed"();--> statement-breakpoint
CREATE FUNCTION "search_comments_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = OLD."item_id") THEN
      PERFORM "search_mark_item"(OLD."item_id", interval '0');
      PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = OLD."item_id"));
    END IF;
    RETURN NULL;
  END IF;
  PERFORM "search_mark_item"(NEW."item_id", interval '0');
  IF TG_OP = 'UPDATE' AND (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."quote_public" <> NEW."quote_public"
      OR OLD."parent_id" IS DISTINCT FROM NEW."parent_id" OR OLD."item_id" <> NEW."item_id") THEN
    PERFORM "search_mark_space"((SELECT "space_id" FROM "tree_items" WHERE "id" = NEW."item_id"));
    IF OLD."item_id" <> NEW."item_id" THEN
      PERFORM "search_mark_item"(OLD."item_id", interval '0');
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_comments_changed" AFTER INSERT OR UPDATE OF "body", "deleted_at", "quote_public", "parent_id", "item_id", "author_id" OR DELETE ON "comments"
  FOR EACH ROW EXECUTE FUNCTION "search_comments_changed"();--> statement-breakpoint
CREATE FUNCTION "search_live_document_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = NEW."item_id" AND "mode" = 'live') THEN
    PERFORM "search_mark_item"(NEW."item_id", interval '5 seconds');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_page_documents_changed" AFTER INSERT OR UPDATE OF "snapshot" ON "page_documents"
  FOR EACH ROW EXECUTE FUNCTION "search_live_document_changed"();--> statement-breakpoint
CREATE FUNCTION "search_language_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "changed" "setting_values";
BEGIN
  IF TG_OP = 'DELETE' THEN
    "changed" := OLD;
  ELSE
    "changed" := NEW;
  END IF;
  IF "changed"."key" NOT IN ('content.language', 'locale.language') THEN
    RETURN NULL;
  END IF;
  INSERT INTO "search_pending_items" ("item_id")
  SELECT "t"."id" FROM "tree_items" "t" JOIN "spaces" "s" ON "s"."id" = "t"."space_id"
  WHERE "t"."kind" IN ('page', 'blogPost') AND "t"."trash_entry_id" IS NULL AND (
    "changed"."level" = 'instance'
    OR ("changed"."level" = 'organization' AND "s"."organization_id" = "changed"."scope_id")
    OR ("changed"."level" = 'space' AND "s"."id" = "changed"."scope_id"))
  ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
    "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
  PERFORM pg_notify('pagehall_search_changes', '');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "search_setting_values_changed" AFTER INSERT OR UPDATE OR DELETE ON "setting_values"
  FOR EACH ROW EXECUTE FUNCTION "search_language_changed"();--> statement-breakpoint
INSERT INTO "search_index_state" ("id", "building_since", "build_total")
SELECT 1, now(), count(*) FROM "tree_items" WHERE "kind"::text IN ('page', 'blogPost') AND "trash_entry_id" IS NULL;--> statement-breakpoint
INSERT INTO "search_pending_items" ("item_id")
SELECT "id" FROM "tree_items" WHERE "kind"::text IN ('page', 'blogPost') AND "trash_entry_id" IS NULL;
