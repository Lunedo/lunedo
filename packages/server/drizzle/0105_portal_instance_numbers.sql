CREATE TABLE "article_titles" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_titles_item_id_space_id_title_pk" PRIMARY KEY("item_id","space_id","title")
);
--> statement-breakpoint
ALTER TABLE "article_titles" ADD CONSTRAINT "article_titles_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_titles" ADD CONSTRAINT "article_titles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_titles_space_id_index" ON "article_titles" USING btree ("space_id");--> statement-breakpoint
INSERT INTO "article_titles" ("item_id", "space_id", "title", "created_at")
SELECT "s"."item_id", "s"."space_id", "v"."title", min("s"."created_at")
FROM "article_slugs" "s"
JOIN "tree_items" "t" ON "t"."id" = "s"."item_id"
JOIN "page_versions" "v" ON "v"."item_id" = "s"."item_id"
	AND ("v"."reason" = 'published' OR "v"."id" = "t"."published_version_id")
	AND article_slug("v"."title") = "s"."slug"
GROUP BY "s"."item_id", "s"."space_id", "v"."title"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TRIGGER "tree_items_article_address_insert" ON "tree_items";--> statement-breakpoint
DROP TRIGGER "tree_items_article_address_update" ON "tree_items";--> statement-breakpoint
DROP FUNCTION "tree_items_article_address"();--> statement-breakpoint
CREATE FUNCTION "tree_items_article_titles"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."kind" <> 'page'
		OR NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	INSERT INTO "article_titles" ("item_id", "space_id", "title")
		SELECT NEW."id", NEW."space_id", "v"."title" FROM "page_versions" "v"
		WHERE "v"."id" = NEW."published_version_id"
		ON CONFLICT ("item_id", "space_id", "title") DO UPDATE SET "created_at" = now();
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_article_titles_insert" AFTER INSERT ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_article_titles"();--> statement-breakpoint
CREATE TRIGGER "tree_items_article_titles_update" AFTER UPDATE OF "space_id", "kind", "published_version_id" ON "tree_items"
	FOR EACH ROW WHEN (OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."kind" IS DISTINCT FROM NEW."kind"
		OR OLD."published_version_id" IS DISTINCT FROM NEW."published_version_id")
	EXECUTE FUNCTION "tree_items_article_titles"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tree_items_sync_article"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP <> 'INSERT' AND OLD."kind" = 'page' AND (TG_OP = 'DELETE' OR OLD."space_id" <> NEW."space_id") THEN
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'moved' END,
			"removed_restricted" = TG_OP = 'DELETE' OR article_view_restricted(OLD."path")
			WHERE "space_id" = OLD."space_id" AND "item_id" = OLD."id" AND "removed_at" IS NULL;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	IF NEW."kind" = 'folder' THEN
		IF TG_OP = 'UPDATE' AND (OLD."title" IS DISTINCT FROM NEW."title" OR OLD."path" IS DISTINCT FROM NEW."path") THEN
			UPDATE "article_sync" "a" SET "changed_at" = now() FROM "tree_items" "t"
				WHERE "a"."space_id" = NEW."space_id" AND "a"."item_id" = "t"."id" AND "a"."removed_at" IS NULL
					AND NEW."id" = ANY("t"."path") AND "t"."id" <> NEW."id";
		END IF;
		RETURN NEW;
	END IF;
	IF NEW."kind" <> 'page' THEN
		RETURN NEW;
	END IF;
	IF NEW."published_version_id" IS NOT NULL AND NEW."trash_entry_id" IS NULL AND NEW."archived_root_id" IS NULL
		AND NEW."reader_visible" THEN
		INSERT INTO "article_sync" ("space_id", "item_id", "number", "language", "changed_at")
		VALUES (NEW."space_id", NEW."id",
			(SELECT "number" FROM "tree_items" WHERE "id" = coalesce(NEW."translation_of", NEW."id")),
			article_sync_language(NEW."id", NEW."space_id", NEW."translation_of", NEW."content_language"), now())
		ON CONFLICT ("space_id", "item_id") DO UPDATE SET "changed_at" = now(), "removed_at" = NULL,
			"removed_reason" = NULL, "removed_restricted" = false, "number" = excluded."number", "language" = excluded."language";
	ELSE
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN NEW."trash_entry_id" IS NOT NULL THEN 'deleted' ELSE 'unpublished' END,
			"removed_restricted" = article_view_restricted(NEW."path")
			WHERE "space_id" = NEW."space_id" AND "item_id" = NEW."id" AND "removed_at" IS NULL;
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
ALTER TABLE "article_sync" ALTER COLUMN "number" SET DATA TYPE bigint;--> statement-breakpoint
UPDATE "article_sync" "a" SET "number" = (SELECT "o"."number" FROM "tree_items" "t"
	JOIN "tree_items" "o" ON "o"."id" = coalesce("t"."translation_of", "t"."id") WHERE "t"."id" = "a"."item_id");--> statement-breakpoint
DROP TABLE "article_numbers";--> statement-breakpoint
DROP TABLE "article_slugs";--> statement-breakpoint
DROP FUNCTION "article_slug"(text);--> statement-breakpoint
ALTER TABLE "knowledge_bases" DROP CONSTRAINT "knowledge_bases_next_number";--> statement-breakpoint
ALTER TABLE "knowledge_bases" DROP COLUMN "next_article_number";
