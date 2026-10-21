ALTER TABLE "article_sync" ADD COLUMN "removed_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE FUNCTION "article_view_restricted"("path" uuid[]) RETURNS boolean
	LANGUAGE sql STABLE AS $$
	SELECT EXISTS (SELECT 1 FROM "page_restrictions" WHERE "item_id" = ANY("path") AND "kind" = 'view')
$$;--> statement-breakpoint
UPDATE "article_sync" "a" SET "removed_restricted" = NOT EXISTS (SELECT 1 FROM "tree_items" "t" WHERE "t"."id" = "a"."item_id")
	OR EXISTS (SELECT 1 FROM "tree_items" "t" WHERE "t"."id" = "a"."item_id" AND article_view_restricted("t"."path"))
	WHERE "a"."removed_at" IS NOT NULL;--> statement-breakpoint
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
			(SELECT "number" FROM "article_numbers" WHERE "item_id" = coalesce(NEW."translation_of", NEW."id")
				AND "space_id" = NEW."space_id"),
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
END $$;
