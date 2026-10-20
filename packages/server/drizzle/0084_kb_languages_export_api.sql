ALTER TYPE "public"."export_format" ADD VALUE 'site';--> statement-breakpoint
CREATE TABLE "article_sync" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"number" integer,
	"language" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	CONSTRAINT "article_sync_space_id_item_id_pk" PRIMARY KEY("space_id","item_id"),
	CONSTRAINT "article_sync_removed" CHECK (("article_sync"."removed_at" is null) = ("article_sync"."removed_reason" is null)
        and ("article_sync"."removed_reason" is null or "article_sync"."removed_reason" in ('deleted', 'unpublished', 'moved')))
);
--> statement-breakpoint
CREATE TABLE "portal_invitations" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "content_level" text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "knowledge_base_ids" uuid[];--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "default_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "languages" text[] DEFAULT '{en}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "page_documents" ADD COLUMN "draft_note" text;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "translation_of" uuid;--> statement-breakpoint
ALTER TABLE "article_sync" ADD CONSTRAINT "article_sync_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_sync_item_id_index" ON "article_sync" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "article_sync_space_id_changed_at_item_id_index" ON "article_sync" USING btree ("space_id","changed_at","item_id");--> statement-breakpoint
CREATE INDEX "article_sync_removed_index" ON "article_sync" USING btree ("removed_at") WHERE "article_sync"."removed_at" is not null;--> statement-breakpoint
CREATE INDEX "portal_invitations_space_id_index" ON "portal_invitations" USING btree ("space_id");--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_translation_of_tree_items_id_fk" FOREIGN KEY ("translation_of") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tree_items_translation_of_index" ON "tree_items" USING btree ("translation_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_translation_unique" ON "tree_items" USING btree ("translation_of","content_language") WHERE "tree_items"."translation_of" is not null;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_content_level" CHECK ("api_tokens"."content_level" in ('read', 'draft', 'publish'));--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_knowledge_bases" CHECK ("api_tokens"."knowledge_base_ids" is null or cardinality("api_tokens"."knowledge_base_ids") between 1 and 100);--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_languages" CHECK ("knowledge_bases"."default_language" = any("knowledge_bases"."languages") and cardinality("knowledge_bases"."languages") between 1 and 30
        and "knowledge_bases"."default_language" ~ '^[a-z]{2}$');--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_translation" CHECK ("tree_items"."translation_of" is null or ("tree_items"."kind" = 'page' and "tree_items"."content_language" is not null));--> statement-breakpoint
UPDATE "knowledge_bases" "kb" SET "default_language" = "found"."language", "languages" = ARRAY["found"."language"]
FROM (
	SELECT "s"."id",
		coalesce(
			(SELECT "v"."value" #>> '{}' FROM "setting_values" "v" WHERE "v"."level" = 'space' AND "v"."key" = 'content.language'
				AND "v"."scope_id" = "s"."id" AND "v"."value" IS NOT NULL AND ("v"."value" #>> '{}') ~ '^[a-z]{2}$' LIMIT 1),
			(SELECT "v"."value" #>> '{}' FROM "setting_values" "v" WHERE "v"."level" = 'organization' AND "v"."key" = 'locale.language'
				AND "v"."scope_id" = "s"."organization_id" AND "v"."value" IS NOT NULL LIMIT 1),
			(SELECT "v"."value" #>> '{}' FROM "setting_values" "v" WHERE "v"."level" = 'instance' AND "v"."key" = 'locale.language'
				AND "v"."value" IS NOT NULL LIMIT 1),
			'en') AS "language"
	FROM "spaces" "s" WHERE "s"."type" = 'knowledgeBase'
) "found"
WHERE "kb"."space_id" = "found"."id" AND "found"."language" ~ '^[a-z]{2}$';--> statement-breakpoint
UPDATE "tree_items" "t" SET "content_language" = NULL
FROM "spaces" "s" WHERE "s"."id" = "t"."space_id" AND "s"."type" = 'knowledgeBase' AND "t"."content_language" IS NOT NULL;--> statement-breakpoint
UPDATE "api_tokens" SET "content_level" = 'publish' WHERE "scopes" #>> '{organization,spaces}' = 'manage';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tree_items_knowledge_base_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"knowledge_base" boolean;
BEGIN
	"knowledge_base" := EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase');
	IF NEW."translation_of" IS NOT NULL AND (NOT "knowledge_base"
		OR coalesce(NEW."parent_id", NEW."restore_parent_id") IS DISTINCT FROM NEW."translation_of") THEN
		IF "knowledge_base" AND EXISTS (SELECT 1 FROM "tree_items" "s"
			WHERE "s"."id" = NEW."translation_of" AND "s"."trash_entry_id" IS NULL) THEN
			RAISE EXCEPTION 'A translation stays with the article it translates'
				USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_translation_placement';
		END IF;
		NEW."translation_of" := NULL;
	END IF;
	IF NEW."translation_of" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."translation_of" IS DISTINCT FROM NEW."translation_of")
		AND NOT EXISTS (SELECT 1 FROM "tree_items" "s" WHERE "s"."id" = NEW."translation_of" AND "s"."kind" = 'page'
			AND "s"."translation_of" IS NULL AND "s"."space_id" = NEW."space_id") THEN
		RAISE EXCEPTION 'Only articles of the same knowledge base are translated'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_translation_source';
	END IF;
	IF NOT "knowledge_base" THEN
		RETURN NEW;
	END IF;
	IF NEW."kind" NOT IN ('page', 'folder') THEN
		RAISE EXCEPTION 'Knowledge bases contain only articles and categories'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_kind';
	END IF;
	IF NEW."kind" = 'page' AND NEW."mode" <> 'publish' THEN
		RAISE EXCEPTION 'Articles are always published with versions'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_mode';
	END IF;
	IF NEW."parent_id" IS NOT NULL AND NEW."parent_id" IS DISTINCT FROM NEW."translation_of"
		AND NOT EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = NEW."parent_id" AND "kind" = 'folder') THEN
		RAISE EXCEPTION 'Articles and categories are placed in categories'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_parent';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER "tree_items_knowledge_base_rules" ON "tree_items";--> statement-breakpoint
CREATE TRIGGER "tree_items_knowledge_base_rules" BEFORE INSERT OR UPDATE OF "space_id", "kind", "parent_id", "mode", "translation_of", "restore_parent_id"
	ON "tree_items" FOR EACH ROW EXECUTE FUNCTION "tree_items_knowledge_base_rules"();--> statement-breakpoint
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
	INSERT INTO "article_slugs" ("item_id", "slug") VALUES (NEW."id", article_slug(NEW."title"))
		ON CONFLICT ("item_id", "slug") DO UPDATE SET "created_at" = now();
	RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER "tree_items_article_address_update" ON "tree_items";--> statement-breakpoint
CREATE TRIGGER "tree_items_article_address_update" AFTER UPDATE OF "space_id", "kind", "title", "translation_of" ON "tree_items"
	FOR EACH ROW WHEN (OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."kind" IS DISTINCT FROM NEW."kind"
		OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."translation_of" IS DISTINCT FROM NEW."translation_of")
	EXECUTE FUNCTION "tree_items_article_address"();--> statement-breakpoint
CREATE FUNCTION "article_sync_language"("item" uuid, "space" uuid, "translation" uuid, "language" text) RETURNS text
	LANGUAGE sql STABLE AS $$
	SELECT CASE WHEN "translation" IS NOT NULL THEN "language"
		ELSE (SELECT "default_language" FROM "knowledge_bases" WHERE "space_id" = "space") END
$$;--> statement-breakpoint
CREATE FUNCTION "tree_items_sync_article"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP <> 'INSERT' AND OLD."kind" = 'page' AND (TG_OP = 'DELETE' OR OLD."space_id" <> NEW."space_id") THEN
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'moved' END
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
			"removed_reason" = NULL, "number" = excluded."number", "language" = excluded."language";
	ELSE
		UPDATE "article_sync" SET "removed_at" = now(), "changed_at" = now(),
			"removed_reason" = CASE WHEN NEW."trash_entry_id" IS NOT NULL THEN 'deleted' ELSE 'unpublished' END
			WHERE "space_id" = NEW."space_id" AND "item_id" = NEW."id" AND "removed_at" IS NULL;
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_sync_article_insert" AFTER INSERT ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_sync_article"();--> statement-breakpoint
CREATE TRIGGER "tree_items_sync_article_update" AFTER UPDATE OF "title", "description", "path", "space_id",
	"published_version_id", "article_type", "trash_entry_id", "archived_root_id", "reader_visible", "translation_of",
	"content_language" ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_sync_article"();--> statement-breakpoint
CREATE TRIGGER "tree_items_sync_article_delete" AFTER DELETE ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_sync_article"();--> statement-breakpoint
CREATE FUNCTION "page_restrictions_sync_articles"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"changed" uuid;
BEGIN
	"changed" := CASE WHEN TG_OP = 'DELETE' THEN OLD."item_id" ELSE NEW."item_id" END;
	UPDATE "article_sync" "a" SET "changed_at" = now() FROM "tree_items" "t"
		WHERE "a"."item_id" = "t"."id" AND "a"."space_id" = "t"."space_id" AND "a"."removed_at" IS NULL
			AND "t"."space_id" = (SELECT "space_id" FROM "tree_items" WHERE "id" = "changed") AND "changed" = ANY("t"."path");
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "page_restrictions_sync_articles" AFTER INSERT OR UPDATE OR DELETE ON "page_restrictions"
	FOR EACH ROW EXECUTE FUNCTION "page_restrictions_sync_articles"();--> statement-breakpoint
CREATE FUNCTION "article_reviews_sync_article"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "article_sync" SET "changed_at" = now() WHERE "item_id" = NEW."item_id" AND "removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "article_reviews_sync_article" AFTER UPDATE OF "reviewed_at", "interval_months" ON "article_reviews"
	FOR EACH ROW WHEN (OLD."reviewed_at" IS DISTINCT FROM NEW."reviewed_at"
		OR OLD."interval_months" IS DISTINCT FROM NEW."interval_months")
	EXECUTE FUNCTION "article_reviews_sync_article"();--> statement-breakpoint
CREATE FUNCTION "spaces_sync_articles"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "article_sync" SET "changed_at" = now() WHERE "space_id" = NEW."id" AND "removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "spaces_sync_articles" AFTER UPDATE OF "audience", "key" ON "spaces"
	FOR EACH ROW WHEN (OLD."audience" IS DISTINCT FROM NEW."audience" OR OLD."key" IS DISTINCT FROM NEW."key")
	EXECUTE FUNCTION "spaces_sync_articles"();--> statement-breakpoint
CREATE FUNCTION "knowledge_bases_sync_articles"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "article_sync" "a" SET "changed_at" = now(),
		"language" = article_sync_language("t"."id", "t"."space_id", "t"."translation_of", "t"."content_language")
		FROM "tree_items" "t"
		WHERE "a"."space_id" = NEW."space_id" AND "a"."item_id" = "t"."id" AND "a"."removed_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "knowledge_bases_sync_articles" AFTER UPDATE OF "default_language", "portal_path", "portal_domain"
	ON "knowledge_bases" FOR EACH ROW WHEN (OLD."default_language" IS DISTINCT FROM NEW."default_language"
		OR OLD."portal_path" IS DISTINCT FROM NEW."portal_path" OR OLD."portal_domain" IS DISTINCT FROM NEW."portal_domain")
	EXECUTE FUNCTION "knowledge_bases_sync_articles"();--> statement-breakpoint
INSERT INTO "article_sync" ("space_id", "item_id", "number", "language", "changed_at")
SELECT "t"."space_id", "t"."id", "n"."number", "kb"."default_language", "v"."created_at"
FROM "tree_items" "t"
JOIN "spaces" "s" ON "s"."id" = "t"."space_id" AND "s"."type" = 'knowledgeBase'
JOIN "knowledge_bases" "kb" ON "kb"."space_id" = "t"."space_id"
JOIN "page_versions" "v" ON "v"."id" = "t"."published_version_id"
LEFT JOIN "article_numbers" "n" ON "n"."item_id" = "t"."id" AND "n"."space_id" = "t"."space_id"
WHERE "t"."kind" = 'page' AND "t"."trash_entry_id" IS NULL AND "t"."archived_root_id" IS NULL AND "t"."reader_visible";
