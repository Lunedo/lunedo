ALTER TABLE "tree_items" DROP CONSTRAINT "tree_items_archived_root_id_tree_items_id_fk";
--> statement-breakpoint
ALTER TABLE "tree_items" ADD CONSTRAINT "tree_items_archived_root_id_tree_items_id_fk" FOREIGN KEY ("archived_root_id") REFERENCES "public"."tree_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
WITH RECURSIVE "up"("id", "ancestor", "depth") AS (
  SELECT "t"."id", "t"."id", 0 FROM "tree_items" "t" WHERE "t"."archived_root_id" IS NOT NULL
  UNION ALL
  SELECT "up"."id", "p"."parent_id", "up"."depth" + 1 FROM "up" JOIN "tree_items" "p" ON "p"."id" = "up"."ancestor"
  WHERE "p"."parent_id" IS NOT NULL AND "up"."depth" < 1000
)
UPDATE "tree_items" "t" SET "archived_root_id" = NULL, "archived_at" = NULL
WHERE "t"."archived_root_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "up" WHERE "up"."id" = "t"."id" AND "up"."ancestor" = "t"."archived_root_id"
);
