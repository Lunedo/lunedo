CREATE TABLE "portal_path_reservations" (
	"path" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_path_reservations" ADD CONSTRAINT "portal_path_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_path_reservations_organization_id_index" ON "portal_path_reservations" USING btree ("organization_id");--> statement-breakpoint
CREATE FUNCTION "spaces_reserve_portal_paths"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."type" = 'knowledgeBase' AND OLD."organization_id" IS NOT NULL THEN
		INSERT INTO "portal_path_reservations" ("path", "organization_id")
		SELECT "kb"."portal_path", OLD."organization_id" FROM "knowledge_bases" "kb" WHERE "kb"."space_id" = OLD."id"
		UNION SELECT "p"."path", OLD."organization_id" FROM "knowledge_base_paths" "p" WHERE "p"."space_id" = OLD."id"
		ON CONFLICT ("path") DO NOTHING;
	END IF;
	RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "spaces_reserve_portal_paths" BEFORE DELETE ON "spaces"
	FOR EACH ROW EXECUTE FUNCTION "spaces_reserve_portal_paths"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "knowledge_base_default_path"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR EXISTS (SELECT 1 FROM "knowledge_base_paths" WHERE "path" = "candidate")
    OR EXISTS (SELECT 1 FROM "portal_path_reservations" WHERE "path" = "candidate") LOOP
    "n" := "n" + 1;
    "candidate" := "base" || '-' || "n";
  END LOOP;
  NEW."portal_path" := "candidate";
  RETURN NEW;
END $$;
