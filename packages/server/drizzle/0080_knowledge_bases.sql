CREATE TYPE "public"."article_type" AS ENUM('howTo', 'troubleshooting');--> statement-breakpoint
CREATE TYPE "public"."knowledge_base_audience" AS ENUM('public', 'signedIn', 'groups', 'portal');--> statement-breakpoint
CREATE TYPE "public"."space_type" AS ENUM('standard', 'knowledgeBase');--> statement-breakpoint
CREATE TABLE "article_numbers" (
	"space_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_numbers_space_id_number_pk" PRIMARY KEY("space_id","number"),
	CONSTRAINT "article_numbers_item_unique" UNIQUE("item_id","space_id"),
	CONSTRAINT "article_numbers_positive" CHECK ("article_numbers"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "article_slugs" (
	"item_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_slugs_item_id_slug_pk" PRIMARY KEY("item_id","slug")
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_categories" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"icon" text,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_categories_icon" CHECK ("knowledge_base_categories"."icon" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("knowledge_base_categories"."icon") <= 60),
	CONSTRAINT "knowledge_base_categories_contact_length" CHECK (length("knowledge_base_categories"."contact_email") <= 254)
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"contact_email" text,
	"next_article_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_bases_contact_length" CHECK (length("knowledge_bases"."contact_email") <= 254),
	CONSTRAINT "knowledge_bases_next_number" CHECK ("knowledge_bases"."next_article_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_required_sections" (
	"space_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"section_key" text NOT NULL,
	"section_title" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_required_sections_space_id_template_id_section_key_pk" PRIMARY KEY("space_id","template_id","section_key"),
	CONSTRAINT "knowledge_base_required_sections_key" CHECK ("knowledge_base_required_sections"."section_key" ~ '^[a-z][a-zA-Z0-9]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "page_templates" ADD COLUMN "article_type" "article_type";--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "type" "space_type" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "audience" "knowledge_base_audience";--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "article_type" "article_type";--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "article_numbers" ADD CONSTRAINT "article_numbers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_numbers" ADD CONSTRAINT "article_numbers_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_slugs" ADD CONSTRAINT "article_slugs_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_categories" ADD CONSTRAINT "knowledge_base_categories_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_required_sections" ADD CONSTRAINT "knowledge_base_required_sections_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_required_sections" ADD CONSTRAINT "knowledge_base_required_sections_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_base_required_sections_created_by_index" ON "knowledge_base_required_sections" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_knowledge_base_audience" CHECK (("spaces"."type" = 'knowledgeBase') = ("spaces"."audience" is not null));--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_knowledge_base_visibility" CHECK ("spaces"."audience" is null or "spaces"."visibility" = (case when "spaces"."audience" in ('public', 'signedIn')
        then 'instance' else 'private' end)::space_visibility);--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_knowledge_base_shared" CHECK ("spaces"."type" = 'standard' or (not "spaces"."confidential" and "spaces"."personal_of" is null));--> statement-breakpoint
CREATE FUNCTION "spaces_keep_type"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."type" <> OLD."type" THEN
		RAISE EXCEPTION 'The type of a space is chosen when it is created'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'spaces_type_fixed';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "spaces_type_fixed" BEFORE UPDATE OF "type" ON "spaces"
	FOR EACH ROW EXECUTE FUNCTION "spaces_keep_type"();--> statement-breakpoint
CREATE FUNCTION "article_slug"("title" text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT trim(BOTH '-' FROM left(trim(BOTH '-' FROM regexp_replace(lower(translate(
		replace(replace(replace(replace(replace(replace(replace(replace("title",
			'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'), 'ẞ', 'SS'),
		'ÀÁÂÃÅĀĂĄÆÇĆČĎĐÈÉÊËĒĖĘĚÌÍÎÏĪĮŁÑŃŇÒÓÔÕØŌŐŔŘŚŠŞȘŤŢȚÙÚÛŮŪŰŲÝŸŹŻŽàáâãåāăąæçćčďđèéêëēėęěìíîïīįłñńňòóôõøōőŕřśšşșťţțùúûůūűųýÿźżž',
		'AAAAAAAAACCCDDEEEEEEEEIIIIIILNNNOOOOOOORRSSSSTTTUUUUUUUYYZZZaaaaaaaaacccddeeeeeeeeiiiiiilnnnooooooorrsssstttuuuuuuuyyzzz')),
		'[^a-z0-9]+', '-', 'g')), 80))
$$;--> statement-breakpoint
CREATE FUNCTION "tree_items_knowledge_base_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
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
	IF NEW."parent_id" IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM "tree_items" WHERE "id" = NEW."parent_id" AND "kind" = 'folder') THEN
		RAISE EXCEPTION 'Articles and categories are placed in categories'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_items_knowledge_base_parent';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_knowledge_base_rules" BEFORE INSERT OR UPDATE OF "space_id", "kind", "parent_id", "mode"
	ON "tree_items" FOR EACH ROW EXECUTE FUNCTION "tree_items_knowledge_base_rules"();--> statement-breakpoint
CREATE FUNCTION "tree_items_article_address"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"assigned" integer;
BEGIN
	IF NEW."kind" <> 'page'
		OR NOT EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		RETURN NEW;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM "article_numbers" WHERE "item_id" = NEW."id" AND "space_id" = NEW."space_id") THEN
		INSERT INTO "knowledge_bases" ("space_id") VALUES (NEW."space_id") ON CONFLICT DO NOTHING;
		UPDATE "knowledge_bases" SET "next_article_number" = "next_article_number" + 1, "updated_at" = now()
			WHERE "space_id" = NEW."space_id" RETURNING "next_article_number" - 1 INTO "assigned";
		INSERT INTO "article_numbers" ("space_id", "number", "item_id") VALUES (NEW."space_id", "assigned", NEW."id");
	END IF;
	INSERT INTO "article_slugs" ("item_id", "slug") VALUES (NEW."id", article_slug(NEW."title"))
		ON CONFLICT ("item_id", "slug") DO UPDATE SET "created_at" = now();
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_article_address_insert" AFTER INSERT ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_article_address"();--> statement-breakpoint
CREATE TRIGGER "tree_items_article_address_update" AFTER UPDATE OF "space_id", "kind", "title" ON "tree_items"
	FOR EACH ROW WHEN (OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."kind" IS DISTINCT FROM NEW."kind"
		OR OLD."title" IS DISTINCT FROM NEW."title")
	EXECUTE FUNCTION "tree_items_article_address"();
