CREATE TABLE "page_excerpts" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_properties" (
	"item_id" uuid NOT NULL,
	"block" integer NOT NULL,
	"position" integer NOT NULL,
	"set_id" text,
	"key" text NOT NULL,
	"key_normalized" text NOT NULL,
	"value" jsonb NOT NULL,
	"text" text NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	CONSTRAINT "page_properties_item_id_block_position_pk" PRIMARY KEY("item_id","block","position"),
	CONSTRAINT "page_properties_key" CHECK (length("page_properties"."key") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "page_excerpts" ADD CONSTRAINT "page_excerpts_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_properties" ADD CONSTRAINT "page_properties_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_properties_key_normalized_item_id_index" ON "page_properties" USING btree ("key_normalized","item_id");