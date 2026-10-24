CREATE TABLE "collaboration_editors" (
	"item_id" uuid NOT NULL,
	"node" text NOT NULL,
	"account_id" uuid NOT NULL,
	"connections" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_editors_item_id_node_account_id_pk" PRIMARY KEY("item_id","node","account_id")
);
--> statement-breakpoint
ALTER TABLE "collaboration_editors" ADD CONSTRAINT "collaboration_editors_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_editors" ADD CONSTRAINT "collaboration_editors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collaboration_editors_account_id_index" ON "collaboration_editors" USING btree ("account_id");