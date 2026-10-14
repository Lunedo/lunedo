CREATE TYPE "public"."page_status_color" AS ENUM('neutral', 'accent', 'info', 'success', 'warning', 'danger');--> statement-breakpoint
CREATE TABLE "item_ownership_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"previous_owner_id" uuid,
	"owner_id" uuid,
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_status_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"status_id" uuid,
	"built_in" text,
	"name" text,
	"color" "page_status_color",
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_status_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"built_in" text,
	"name" text,
	"color" "page_status_color" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_status_values_named" CHECK ("page_status_values"."built_in" is not null or "page_status_values"."name" is not null),
	CONSTRAINT "page_status_values_built_in" CHECK ("page_status_values"."built_in" is null or "page_status_values"."built_in" in ('roughDraft', 'inProgress', 'readyForReview', 'verified')),
	CONSTRAINT "page_status_values_name_length" CHECK ("page_status_values"."name" is null or length("page_status_values"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_previous_owner_id_accounts_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ownership_changes" ADD CONSTRAINT "item_ownership_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_status_id_page_status_values_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."page_status_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_changes" ADD CONSTRAINT "page_status_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_status_values" ADD CONSTRAINT "page_status_values_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_ownership_changes_item_id_changed_at_index" ON "item_ownership_changes" USING btree ("item_id","changed_at");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_previous_owner_id_index" ON "item_ownership_changes" USING btree ("previous_owner_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_owner_id_index" ON "item_ownership_changes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_actor_id_index" ON "item_ownership_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "item_ownership_changes_changed_at_index" ON "item_ownership_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "page_status_changes_item_id_changed_at_index" ON "page_status_changes" USING btree ("item_id","changed_at");--> statement-breakpoint
CREATE INDEX "page_status_changes_status_id_index" ON "page_status_changes" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "page_status_changes_actor_id_index" ON "page_status_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "page_status_changes_changed_at_index" ON "page_status_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "page_status_values_space_id_position_index" ON "page_status_values" USING btree ("space_id","position");--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_status_id_page_status_values_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."page_status_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_status_changed_by_accounts_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tree_items_status_id_index" ON "tree_items" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "tree_items_status_changed_by_index" ON "tree_items" USING btree ("status_changed_by");--> statement-breakpoint
INSERT INTO "page_status_values" ("id", "space_id", "built_in", "color", "position")
SELECT gen_random_uuid(), s."id", d."built_in", d."color"::"page_status_color", d."position"
FROM "spaces" s
CROSS JOIN (VALUES
	('roughDraft', 'neutral', 0),
	('inProgress', 'info', 1),
	('readyForReview', 'warning', 2),
	('verified', 'success', 3)
) AS d("built_in", "color", "position");
