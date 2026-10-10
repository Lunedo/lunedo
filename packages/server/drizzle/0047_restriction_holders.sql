CREATE TABLE "page_restriction_holders" (
	"item_id" uuid NOT NULL,
	"kind" "page_restriction_kind" NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_restriction_holders_item_id_kind_principal_kind_principal_id_pk" PRIMARY KEY("item_id","kind","principal_kind","principal_id"),
	CONSTRAINT "page_restriction_holders_principal" CHECK ("page_restriction_holders"."principal_kind" in ('account', 'group'))
);
--> statement-breakpoint
ALTER TABLE "page_restriction_holders" ADD CONSTRAINT "page_restriction_holders_item_id_kind_page_restrictions_item_id_kind_fk" FOREIGN KEY ("item_id","kind") REFERENCES "public"."page_restrictions"("item_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_restriction_holders_principal_kind_principal_id_index" ON "page_restriction_holders" USING btree ("principal_kind","principal_id");