CREATE TYPE "public"."discard_reason" AS ENUM('discarded', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."page_mode" AS ENUM('publish', 'live');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('meetings', 'decisions', 'projects', 'engineering', 'operations', 'knowledge', 'teams');--> statement-breakpoint
CREATE TYPE "public"."template_level" AS ENUM('instance', 'organization', 'space');--> statement-breakpoint
CREATE TYPE "public"."trash_entry_kind" AS ENUM('items', 'space');--> statement-breakpoint
CREATE TYPE "public"."version_reason" AS ENUM('published', 'session', 'restored', 'modeChanged');--> statement-breakpoint
CREATE TABLE "collaboration_presence" (
	"item_id" uuid NOT NULL,
	"node" text NOT NULL,
	"connections" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_presence_item_id_node_pk" PRIMARY KEY("item_id","node")
);
--> statement-breakpoint
CREATE TABLE "discarded_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"reason" "discard_reason" NOT NULL,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"discarded_by" uuid,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level" "template_level" NOT NULL,
	"organization_id" uuid,
	"space_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "template_category" NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_templates_scope" CHECK (("page_templates"."level" = 'instance' and "page_templates"."organization_id" is null and "page_templates"."space_id" is null)
        or ("page_templates"."level" = 'organization' and "page_templates"."organization_id" is not null and "page_templates"."space_id" is null)
        or ("page_templates"."level" = 'space' and "page_templates"."space_id" is not null and "page_templates"."organization_id" is null))
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reason" "version_reason" NOT NULL,
	"restored_from" integer,
	"revision" bigint NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_note_length" CHECK (length("page_versions"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "trash_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" "trash_entry_kind" NOT NULL,
	"root_item_id" uuid,
	"title" text NOT NULL,
	"item_kind" "tree_item_kind",
	"descendants" integer DEFAULT 0 NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"purging" boolean DEFAULT false NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_two_at" timestamp with time zone,
	CONSTRAINT "trash_entries_stage" CHECK ("trash_entries"."stage" in (1, 2)),
	CONSTRAINT "trash_entries_root" CHECK (("trash_entries"."kind" = 'items') = ("trash_entries"."root_item_id" is not null))
);
--> statement-breakpoint
DROP INDEX "tree_items_position_unique";--> statement-breakpoint
ALTER TABLE "page_documents" ADD COLUMN "draft_title" text;--> statement-breakpoint
ALTER TABLE "page_documents" ADD COLUMN "versioned_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "page_documents" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "mode" "page_mode" DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "trash_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "archived_root_id" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "restore_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "restore_position" text COLLATE "C";--> statement-breakpoint
ALTER TABLE "collaboration_presence" ADD CONSTRAINT "collaboration_presence_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discarded_drafts" ADD CONSTRAINT "discarded_drafts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discarded_drafts" ADD CONSTRAINT "discarded_drafts_discarded_by_accounts_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_deleted_by_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discarded_drafts_item_id_index" ON "discarded_drafts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "discarded_drafts_discarded_by_index" ON "discarded_drafts" USING btree ("discarded_by");--> statement-breakpoint
CREATE INDEX "discarded_drafts_expires_at_index" ON "discarded_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "page_templates_organization_id_index" ON "page_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "page_templates_space_id_index" ON "page_templates" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "page_templates_created_by_index" ON "page_templates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_templates_updated_by_index" ON "page_templates" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_number_unique" ON "page_versions" USING btree ("item_id","number");--> statement-breakpoint
CREATE INDEX "page_versions_created_by_index" ON "page_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "trash_entries_space_id_stage_index" ON "trash_entries" USING btree ("space_id","stage");--> statement-breakpoint
CREATE INDEX "trash_entries_deleted_by_index" ON "trash_entries" USING btree ("deleted_by");--> statement-breakpoint
CREATE UNIQUE INDEX "trash_entries_space_unique" ON "trash_entries" USING btree ("space_id") WHERE "trash_entries"."kind" = 'space';--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_published_version_id_page_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_trash_entry_id_trash_entries_id_fk" FOREIGN KEY ("trash_entry_id") REFERENCES "public"."trash_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_archived_root_id_tree_items_id_fk" FOREIGN KEY ("archived_root_id") REFERENCES "public"."tree_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_archived_by_accounts_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spaces_archived_by_index" ON "spaces" USING btree ("archived_by");--> statement-breakpoint
CREATE INDEX "tree_items_published_version_id_index" ON "tree_items" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "tree_items_trash_entry_id_index" ON "tree_items" USING btree ("trash_entry_id");--> statement-breakpoint
CREATE INDEX "tree_items_archived_root_id_index" ON "tree_items" USING btree ("archived_root_id");--> statement-breakpoint
CREATE INDEX "tree_items_archived_by_index" ON "tree_items" USING btree ("archived_by");--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_position_unique" ON "tree_items" USING btree ("space_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"position") WHERE "tree_items"."trash_entry_id" is null and "tree_items"."archived_root_id" is distinct from "tree_items"."id";--> statement-breakpoint
UPDATE "page_documents" SET "versioned_revision" = "revision";