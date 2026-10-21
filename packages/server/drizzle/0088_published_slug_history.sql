DELETE FROM "article_slugs" s USING "tree_items" t
WHERE t."id" = s."item_id" AND (
	t."published_version_id" IS NULL
	OR (s."slug" <> article_slug(t."title")
		AND (NOT EXISTS (SELECT 1 FROM "page_versions" v
				WHERE v."item_id" = t."id" AND v."reason" = 'published' AND article_slug(v."title") = s."slug")
			OR EXISTS (SELECT 1 FROM "article_numbers" n WHERE n."item_id" = t."id" AND n."space_id" <> t."space_id"))));--> statement-breakpoint
ALTER TABLE "article_slugs" ADD COLUMN "space_id" uuid;--> statement-breakpoint
UPDATE "article_slugs" s SET "space_id" = t."space_id" FROM "tree_items" t WHERE t."id" = s."item_id";--> statement-breakpoint
ALTER TABLE "article_slugs" ALTER COLUMN "space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "article_slugs" DROP CONSTRAINT "article_slugs_item_id_slug_pk";--> statement-breakpoint
ALTER TABLE "article_slugs" ADD CONSTRAINT "article_slugs_item_id_space_id_slug_pk" PRIMARY KEY("item_id","space_id","slug");--> statement-breakpoint
ALTER TABLE "article_slugs" ADD CONSTRAINT "article_slugs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_slugs_space_id_index" ON "article_slugs" USING btree ("space_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tree_items_article_address"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"assigned" integer;
BEGIN
	IF NEW."kind" <> 'page'
		OR NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	IF NEW."translation_of" IS NULL
		AND NOT EXISTS (SELECT 1 FROM "article_numbers" WHERE "item_id" = NEW."id" AND "space_id" = NEW."space_id") THEN
		INSERT INTO "knowledge_bases" ("space_id") VALUES (NEW."space_id") ON CONFLICT DO NOTHING;
		UPDATE "knowledge_bases" SET "next_article_number" = "next_article_number" + 1, "updated_at" = now()
			WHERE "space_id" = NEW."space_id" RETURNING "next_article_number" - 1 INTO "assigned";
		INSERT INTO "article_numbers" ("space_id", "number", "item_id") VALUES (NEW."space_id", "assigned", NEW."id");
	END IF;
	IF NEW."published_version_id" IS NOT NULL THEN
		INSERT INTO "article_slugs" ("item_id", "space_id", "slug") VALUES (NEW."id", NEW."space_id", article_slug(NEW."title"))
			ON CONFLICT ("item_id", "space_id", "slug") DO UPDATE SET "created_at" = now();
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER "tree_items_article_address_update" ON "tree_items";--> statement-breakpoint
CREATE TRIGGER "tree_items_article_address_update" AFTER UPDATE OF "space_id", "kind", "title", "translation_of", "published_version_id" ON "tree_items"
	FOR EACH ROW WHEN (OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."kind" IS DISTINCT FROM NEW."kind"
		OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."translation_of" IS DISTINCT FROM NEW."translation_of"
		OR (OLD."published_version_id" IS NULL AND NEW."published_version_id" IS NOT NULL))
	EXECUTE FUNCTION "tree_items_article_address"();
