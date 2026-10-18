CREATE TYPE "public"."display_version_state" AS ENUM('pending', 'done', 'none', 'failed');--> statement-breakpoint
CREATE TABLE "display_versions" (
	"source_file_id" uuid NOT NULL,
	"size" text NOT NULL,
	"file_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "display_versions_source_file_id_size_pk" PRIMARY KEY("source_file_id","size"),
	CONSTRAINT "display_versions_size" CHECK ("display_versions"."size" in ('display', 'preview'))
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "display_version_state" "display_version_state";--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "display_version_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "display_versions" ADD CONSTRAINT "display_versions_source_file_id_stored_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_versions" ADD CONSTRAINT "display_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "display_versions_file_unique" ON "display_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "stored_files_display_versions_pending" ON "stored_files" USING btree ("id") WHERE "stored_files"."display_version_state" = 'pending';--> statement-breakpoint
UPDATE "stored_files" f SET "display_version_state" = 'pending'
  WHERE f."state" = 'ready' AND f."content_type" IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
    AND (EXISTS (SELECT 1 FROM "attachment_versions" v WHERE v."file_id" = f."id")
      OR EXISTS (SELECT 1 FROM "template_files" t WHERE t."file_id" = f."id"));
