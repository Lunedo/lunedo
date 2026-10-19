CREATE TABLE "article_renders" (
	"version_id" uuid NOT NULL,
	"language" text NOT NULL,
	"renderer" integer NOT NULL,
	"html" text NOT NULL,
	"headings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_renders_version_id_language_pk" PRIMARY KEY("version_id","language")
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_logos" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_paths" (
	"path" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_article_views" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portal_article_views_item_id_day_pk" PRIMARY KEY("item_id","day"),
	CONSTRAINT "portal_article_views_positive" CHECK ("portal_article_views"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portal_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_domains_domain" CHECK ("portal_domains"."domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$' and length("portal_domains"."domain") <= 253)
);
--> statement-breakpoint
CREATE TABLE "portal_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "portal_feedback_text" CHECK (length("portal_feedback"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "portal_handoffs" (
	"code_hash" "bytea" PRIMARY KEY NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"domain" text NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_ratings" (
	"item_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"helpful" integer DEFAULT 0 NOT NULL,
	"unhelpful" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portal_ratings_item_id_day_pk" PRIMARY KEY("item_id","day"),
	CONSTRAINT "portal_ratings_positive" CHECK ("portal_ratings"."helpful" >= 0 and "portal_ratings"."unhelpful" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portal_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"term" text NOT NULL,
	"results" integer NOT NULL,
	"category_id" uuid,
	"zero_results" boolean GENERATED ALWAYS AS (results = 0) STORED NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_searches_term" CHECK (length("portal_searches"."term") between 1 and 200),
	CONSTRAINT "portal_searches_results" CHECK ("portal_searches"."results" >= 0),
	CONSTRAINT "portal_searches_hour" CHECK ("portal_searches"."searched_at" = date_trunc('hour', "portal_searches"."searched_at"))
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"session_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "portal_path" text;--> statement-breakpoint
UPDATE "knowledge_bases" "kb" SET "portal_path" = "p"."path" FROM (
  SELECT "b"."space_id", CASE WHEN "b"."n" = 1 THEN "b"."base" ELSE "b"."base" || '-' || "b"."n" END AS "path"
  FROM (
    SELECT "k"."space_id", "c"."base",
      row_number() OVER (PARTITION BY "c"."base" ORDER BY "s"."created_at", "s"."id") AS "n"
    FROM "knowledge_bases" "k" JOIN "spaces" "s" ON "s"."id" = "k"."space_id"
    CROSS JOIN LATERAL (SELECT coalesce(nullif(trim(BOTH '-' FROM left(regexp_replace(lower("s"."key"), '[^a-z0-9]+', '-', 'g'), 50)), ''), 'help') AS "base") "c"
  ) "b"
) "p" WHERE "p"."space_id" = "kb"."space_id";--> statement-breakpoint
ALTER TABLE "knowledge_bases" ALTER COLUMN "portal_path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "portal_domain" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "brand_color" text DEFAULT 'petrol' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "brand_light" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "brand_dark" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "welcome_heading" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "welcome_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "top_bar_threshold" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "powered_by" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "feedback_retention_months" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "logo_ref" text;--> statement-breakpoint
ALTER TABLE "article_renders" ADD CONSTRAINT "article_renders_version_id_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."page_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_logos" ADD CONSTRAINT "knowledge_base_logos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_paths" ADD CONSTRAINT "knowledge_base_paths_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_article_views" ADD CONSTRAINT "portal_article_views_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_article_views" ADD CONSTRAINT "portal_article_views_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_domains" ADD CONSTRAINT "portal_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_domains" ADD CONSTRAINT "portal_domains_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_feedback" ADD CONSTRAINT "portal_feedback_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_feedback" ADD CONSTRAINT "portal_feedback_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_handoffs" ADD CONSTRAINT "portal_handoffs_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "portal_handoffs" ADD CONSTRAINT "portal_handoffs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ratings" ADD CONSTRAINT "portal_ratings_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ratings" ADD CONSTRAINT "portal_ratings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_searches" ADD CONSTRAINT "portal_searches_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_searches" ADD CONSTRAINT "portal_searches_category_id_tree_items_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_domain_portal_domains_domain_fk" FOREIGN KEY ("domain") REFERENCES "public"."portal_domains"("domain") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "knowledge_base_paths_space_id_index" ON "knowledge_base_paths" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "portal_article_views_space_id_day_index" ON "portal_article_views" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_domains_organization_id_index" ON "portal_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portal_domains_created_by_index" ON "portal_domains" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "portal_feedback_space_id_day_index" ON "portal_feedback" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_feedback_item_id_index" ON "portal_feedback" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "portal_handoffs_session_id_index" ON "portal_handoffs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "portal_handoffs_domain_index" ON "portal_handoffs" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "portal_handoffs_expires_at_index" ON "portal_handoffs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "portal_ratings_space_id_day_index" ON "portal_ratings" USING btree ("space_id","day");--> statement-breakpoint
CREATE INDEX "portal_searches_space_id_searched_at_index" ON "portal_searches" USING btree ("space_id","searched_at");--> statement-breakpoint
CREATE INDEX "portal_searches_category_id_index" ON "portal_searches" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_session_id_index" ON "portal_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_domain_index" ON "portal_sessions" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_portal_domain_portal_domains_domain_fk" FOREIGN KEY ("portal_domain") REFERENCES "public"."portal_domains"("domain") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_bases_portal_path_unique" ON "knowledge_bases" USING btree ("portal_path");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_bases_portal_domain_unique" ON "knowledge_bases" USING btree ("portal_domain");--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_portal_path" CHECK ("knowledge_bases"."portal_path" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("knowledge_bases"."portal_path") <= 60);--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_brand" CHECK (("knowledge_bases"."brand_color" = 'custom') = ("knowledge_bases"."brand_light" is not null and "knowledge_bases"."brand_dark" is not null)
        and ("knowledge_bases"."brand_light" is null or "knowledge_bases"."brand_light" ~ '^#[0-9A-F]{6}$')
        and ("knowledge_bases"."brand_dark" is null or "knowledge_bases"."brand_dark" ~ '^#[0-9A-F]{6}$'));--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_welcome_length" CHECK (length("knowledge_bases"."welcome_heading") <= 120 and length("knowledge_bases"."welcome_text") <= 400);--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_top_bar_threshold" CHECK ("knowledge_bases"."top_bar_threshold" between 1 and 100);--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_feedback_retention" CHECK ("knowledge_bases"."feedback_retention_months" between 1 and 60);--> statement-breakpoint
DROP TRIGGER "search_spaces_updated" ON "spaces";--> statement-breakpoint
CREATE TRIGGER "search_spaces_updated" AFTER UPDATE OF "visibility", "audience", "deleted_at", "archived_at", "quarantined" ON "spaces"
  FOR EACH ROW WHEN (OLD."visibility" IS DISTINCT FROM NEW."visibility" OR OLD."audience" IS DISTINCT FROM NEW."audience"
    OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at"
    OR OLD."quarantined" IS DISTINCT FROM NEW."quarantined")
  EXECUTE FUNCTION "search_space_changed"();--> statement-breakpoint
SELECT "search_mark_space"("space_id") FROM "knowledge_bases";
--> statement-breakpoint
CREATE FUNCTION "knowledge_base_default_path"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "base" text;
  "candidate" text;
  "n" integer := 1;
BEGIN
  IF NEW."portal_path" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pagehall.knowledge-base.paths', 0));
  SELECT coalesce(nullif(trim(BOTH '-' FROM left(regexp_replace(lower("key"), '[^a-z0-9]+', '-', 'g'), 50)), ''), 'help')
    INTO "base" FROM "spaces" WHERE "id" = NEW."space_id";
  "candidate" := "base";
  WHILE EXISTS (SELECT 1 FROM "knowledge_bases" WHERE "portal_path" = "candidate")
    OR EXISTS (SELECT 1 FROM "knowledge_base_paths" WHERE "path" = "candidate") LOOP
    "n" := "n" + 1;
    "candidate" := "base" || '-' || "n";
  END LOOP;
  NEW."portal_path" := "candidate";
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "knowledge_bases_default_path" BEFORE INSERT ON "knowledge_bases"
  FOR EACH ROW EXECUTE FUNCTION "knowledge_base_default_path"();
