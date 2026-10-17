CREATE TYPE "public"."copy_state" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."version_reason" ADD VALUE 'copied';--> statement-breakpoint
CREATE TABLE "item_copies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid,
	"source_item_id" uuid,
	"target_space_id" uuid,
	"target_parent_id" uuid,
	"placement" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"descendants" boolean NOT NULL,
	"title" text NOT NULL,
	"state" "copy_state" DEFAULT 'queued' NOT NULL,
	"access" text DEFAULT '' NOT NULL,
	"wider_access" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	"total" integer DEFAULT 0 NOT NULL,
	"copied" integer DEFAULT 0 NOT NULL,
	"hidden" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"root_copy_id" uuid,
	"error_code" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "copied_from_id" uuid;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "copied_from_title" text;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD COLUMN "copied_from_id" uuid;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD COLUMN "copied_from_title" text;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_source_item_id_tree_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_target_space_id_spaces_id_fk" FOREIGN KEY ("target_space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_target_parent_id_tree_items_id_fk" FOREIGN KEY ("target_parent_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_copies" ADD CONSTRAINT "item_copies_root_copy_id_tree_items_id_fk" FOREIGN KEY ("root_copy_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_copies_account_id_created_at_index" ON "item_copies" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "item_copies_finished_at_index" ON "item_copies" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "item_copies_organization_id_index" ON "item_copies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "item_copies_source_item_id_index" ON "item_copies" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "item_copies_target_space_id_index" ON "item_copies" USING btree ("target_space_id");--> statement-breakpoint
CREATE INDEX "item_copies_target_parent_id_index" ON "item_copies" USING btree ("target_parent_id");--> statement-breakpoint
CREATE INDEX "item_copies_root_copy_id_index" ON "item_copies" USING btree ("root_copy_id");--> statement-breakpoint
CREATE INDEX "item_copies_open_index" ON "item_copies" USING btree ("created_at") WHERE "item_copies"."state" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_copied_from_id_tree_items_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_copied_from_id_tree_items_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_versions_copied_from_id_index" ON "page_versions" USING btree ("copied_from_id");--> statement-breakpoint
CREATE INDEX "whiteboard_versions_copied_from_id_index" ON "whiteboard_versions" USING btree ("copied_from_id");