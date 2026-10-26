CREATE TABLE "category_responsibilities" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_responsible_groups" (
	"item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_responsible_groups_item_id_group_id_pk" PRIMARY KEY("item_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "category_responsibilities" ADD CONSTRAINT "category_responsibilities_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsibilities" ADD CONSTRAINT "category_responsibilities_set_by_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsible_groups" ADD CONSTRAINT "category_responsible_groups_item_id_category_responsibilities_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."category_responsibilities"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_responsible_groups" ADD CONSTRAINT "category_responsible_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_responsibilities_set_by_index" ON "category_responsibilities" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "category_responsible_groups_group_id_index" ON "category_responsible_groups" USING btree ("group_id");