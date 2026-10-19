CREATE TYPE "public"."article_review_via" AS ENUM('marked', 'published');--> statement-breakpoint
CREATE TYPE "public"."review_recipients" AS ENUM('owner', 'ownerAndAdministrators');--> statement-breakpoint
CREATE TABLE "article_review_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_id" uuid,
	"via" "article_review_via" NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"previous_reviewed_by" uuid,
	"previous_state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_reviews" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"interval_months" smallint,
	"published_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"due_at" timestamp with time zone,
	"lead_reminded_at" timestamp with time zone,
	"due_reminded_at" timestamp with time zone,
	"reminders_queued_at" timestamp with time zone,
	"source_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reviews_interval" CHECK ("article_reviews"."interval_months" in (0, 3, 6, 12))
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"article_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"changed_at" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_sources_article_id_source_id_pk" PRIMARY KEY("article_id","source_id"),
	CONSTRAINT "article_sources_distinct" CHECK ("article_sources"."article_id" <> "article_sources"."source_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "review_interval_months" smallint;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "review_lead_days" smallint DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "review_recipients" "review_recipients" DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_review_events" ADD CONSTRAINT "article_review_events_previous_reviewed_by_accounts_id_fk" FOREIGN KEY ("previous_reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_article_id_tree_items_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_source_id_tree_items_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_review_events_item_id_reviewed_at_index" ON "article_review_events" USING btree ("item_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "article_review_events_actor_id_index" ON "article_review_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "article_review_events_previous_reviewed_by_index" ON "article_review_events" USING btree ("previous_reviewed_by");--> statement-breakpoint
CREATE INDEX "article_reviews_reviewed_by_index" ON "article_reviews" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "article_reviews_due_index" ON "article_reviews" USING btree ("due_at") WHERE "article_reviews"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "article_reviews_unqueued_index" ON "article_reviews" USING btree ("item_id") WHERE "article_reviews"."due_at" is not null and "article_reviews"."reminders_queued_at" is null;--> statement-breakpoint
CREATE INDEX "article_sources_source_id_index" ON "article_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "article_sources_added_by_index" ON "article_sources" USING btree ("added_by");--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_review_interval" CHECK ("knowledge_bases"."review_interval_months" in (3, 6, 12));--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_review_lead" CHECK ("knowledge_bases"."review_lead_days" in (0, 7, 14, 30));--> statement-breakpoint
CREATE FUNCTION "article_reviews_due"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	"months" smallint;
	"base" timestamptz;
	"due" timestamptz;
BEGIN
	SELECT coalesce(NEW."interval_months", kb."review_interval_months") INTO "months"
		FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id" AND s."type" = 'knowledgeBase'
		LEFT JOIN "knowledge_bases" kb ON kb."space_id" = s."id"
		WHERE t."id" = NEW."item_id" AND t."kind" = 'page';
	"base" := coalesce(NEW."reviewed_at", NEW."published_at");
	IF "months" IS NULL OR "months" = 0 OR "base" IS NULL THEN
		"due" := NULL;
	ELSE
		"due" := date_trunc('milliseconds', "base" + make_interval(months => "months"));
	END IF;
	IF TG_OP = 'INSERT' THEN
		NEW."due_at" := "due";
		NEW."lead_reminded_at" := NULL;
		NEW."due_reminded_at" := NULL;
		NEW."reminders_queued_at" := NULL;
	ELSIF "due" IS DISTINCT FROM OLD."due_at" THEN
		NEW."due_at" := "due";
		IF NEW."lead_reminded_at" IS NOT DISTINCT FROM OLD."lead_reminded_at" THEN
			NEW."lead_reminded_at" := NULL;
		END IF;
		IF NEW."due_reminded_at" IS NOT DISTINCT FROM OLD."due_reminded_at" THEN
			NEW."due_reminded_at" := NULL;
		END IF;
		NEW."reminders_queued_at" := NULL;
	END IF;
	IF NEW."due_at" IS NOT NULL AND NEW."reminders_queued_at" IS NULL THEN
		PERFORM pg_notify('pagehall_review_changes', '');
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "article_reviews_due" BEFORE INSERT OR UPDATE ON "article_reviews"
	FOR EACH ROW EXECUTE FUNCTION "article_reviews_due"();--> statement-breakpoint
CREATE FUNCTION "knowledge_bases_review_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND NEW."review_interval_months" IS NOT DISTINCT FROM OLD."review_interval_months"
		AND NEW."review_lead_days" IS NOT DISTINCT FROM OLD."review_lead_days" THEN
		RETURN NEW;
	END IF;
	UPDATE "article_reviews" ar SET "updated_at" = now(),
		"reminders_queued_at" = CASE WHEN TG_OP = 'UPDATE' AND NEW."review_lead_days" = OLD."review_lead_days"
			THEN ar."reminders_queued_at" END
		FROM "tree_items" t WHERE t."id" = ar."item_id" AND t."space_id" = NEW."space_id";
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "knowledge_bases_review_changed" AFTER INSERT OR UPDATE OF "review_interval_months", "review_lead_days"
	ON "knowledge_bases" FOR EACH ROW EXECUTE FUNCTION "knowledge_bases_review_changed"();--> statement-breakpoint
CREATE FUNCTION "tree_items_article_review"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."kind" = 'page'
		AND EXISTS (SELECT 1 FROM "spaces" WHERE "id" = NEW."space_id" AND "type" = 'knowledgeBase') THEN
		INSERT INTO "article_reviews" ("item_id", "published_at")
			VALUES (NEW."id", (SELECT min("created_at") FROM "page_versions" WHERE "item_id" = NEW."id"))
			ON CONFLICT ("item_id") DO UPDATE
				SET "published_at" = coalesce("article_reviews"."published_at", excluded."published_at"),
					"updated_at" = now();
	ELSIF TG_OP = 'UPDATE' THEN
		UPDATE "article_reviews" SET "updated_at" = now() WHERE "item_id" = NEW."id";
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "tree_items_article_review_insert" AFTER INSERT ON "tree_items"
	FOR EACH ROW EXECUTE FUNCTION "tree_items_article_review"();--> statement-breakpoint
CREATE TRIGGER "tree_items_article_review_update" AFTER UPDATE OF "space_id", "kind", "published_version_id" ON "tree_items"
	FOR EACH ROW WHEN (OLD."space_id" IS DISTINCT FROM NEW."space_id" OR OLD."kind" IS DISTINCT FROM NEW."kind"
		OR OLD."published_version_id" IS DISTINCT FROM NEW."published_version_id")
	EXECUTE FUNCTION "tree_items_article_review"();--> statement-breakpoint
INSERT INTO "article_reviews" ("item_id", "published_at")
	SELECT t."id", (SELECT min(v."created_at") FROM "page_versions" v WHERE v."item_id" = t."id")
	FROM "tree_items" t JOIN "spaces" s ON s."id" = t."space_id"
	WHERE s."type" = 'knowledgeBase' AND t."kind" = 'page'
	ON CONFLICT DO NOTHING;
