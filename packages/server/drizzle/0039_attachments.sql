CREATE TYPE "public"."stored_file_state" AS ENUM('pending', 'ready', 'orphaned');--> statement-breakpoint
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attachment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"restored_from" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_name_length" CHECK (length("attachments"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"sha256" "bytea",
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"master_key_version" integer,
	"state" "stored_file_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "cover_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "cover_focus_x" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "cover_focus_y" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_uploaded_by_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_current_version_id_attachment_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."attachment_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_versions_number_unique" ON "attachment_versions" USING btree ("attachment_id","number");--> statement-breakpoint
CREATE INDEX "attachment_versions_file_id_index" ON "attachment_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "attachment_versions_uploaded_by_index" ON "attachment_versions" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_name_unique" ON "attachments" USING btree ("item_id","name_key") WHERE "attachments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "attachments_item_id_index" ON "attachments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "attachments_current_version_id_index" ON "attachments" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "attachments_created_by_index" ON "attachments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "attachments_deleted_by_index" ON "attachments" USING btree ("deleted_by");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_storage_key_unique" ON "stored_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stored_files_state_updated_at_index" ON "stored_files" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "stored_files_master_key_version_index" ON "stored_files" USING btree ("master_key_version");--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_attachment_id_attachments_id_fk" FOREIGN KEY ("cover_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_posts_cover_attachment_id_index" ON "blog_posts" USING btree ("cover_attachment_id");--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_focus" CHECK ("blog_posts"."cover_focus_x" between 0 and 1 and "blog_posts"."cover_focus_y" between 0 and 1);--> statement-breakpoint
CREATE FUNCTION "attachment_versions_release_file"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "stored_files" "f" SET "state" = 'orphaned', "updated_at" = now()
  WHERE "f"."id" = OLD."file_id" AND "f"."state" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "attachment_versions" "v" WHERE "v"."file_id" = OLD."file_id");
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "attachment_versions_release_file" AFTER DELETE ON "attachment_versions"
  FOR EACH ROW EXECUTE FUNCTION "attachment_versions_release_file"();
