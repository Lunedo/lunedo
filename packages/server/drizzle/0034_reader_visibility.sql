ALTER TABLE "tree_items" ADD COLUMN "reader_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
WITH RECURSIVE "walk"("id", "visible") AS (
  SELECT "t"."id", ("t"."kind" <> 'page' OR "t"."mode" = 'live' OR "t"."published_version_id" IS NOT NULL)
  FROM "tree_items" "t"
  WHERE "t"."parent_id" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "tree_items" "r" WHERE "r"."id" = "t"."restore_parent_id")
  UNION
  SELECT "c"."id", "w"."visible" AND ("c"."kind" <> 'page' OR "c"."mode" = 'live' OR "c"."published_version_id" IS NOT NULL)
  FROM "tree_items" "c" JOIN "walk" "w"
    ON "c"."parent_id" = "w"."id" OR ("c"."parent_id" IS NULL AND "c"."restore_parent_id" = "w"."id")
)
UPDATE "tree_items" "t" SET "reader_visible" = "w"."visible" FROM "walk" "w" WHERE "t"."id" = "w"."id" AND NOT "w"."visible";
