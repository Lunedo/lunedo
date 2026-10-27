CREATE SEQUENCE "public"."tree_item_numbers" INCREMENT BY 1 MINVALUE 1000 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
ALTER TABLE "tree_items" ADD COLUMN "number" bigint;--> statement-breakpoint
UPDATE "tree_items" SET "number" = numbered.number
FROM (SELECT "id", 999 + row_number() OVER (ORDER BY "id") AS number FROM "tree_items") AS numbered
WHERE numbered."id" = "tree_items"."id";--> statement-breakpoint
SELECT setval('tree_item_numbers', coalesce((SELECT max("number") FROM "tree_items"), 999) + 1, false);--> statement-breakpoint
ALTER TABLE "tree_items" ALTER COLUMN "number" SET DEFAULT nextval('tree_item_numbers');--> statement-breakpoint
ALTER TABLE "tree_items" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tree_items_number_unique" ON "tree_items" USING btree ("number");
