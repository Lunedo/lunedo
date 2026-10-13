ALTER TYPE "public"."stored_file_state" ADD VALUE 'stored' BEFORE 'ready';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "attachment_versions_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "stored_files" WHERE "id" = OLD."file_id" FOR UPDATE;
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;
