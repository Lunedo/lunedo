UPDATE "tree_items" "t" SET "trash_entry_id" = (
  SELECT "a"."trash_entry_id" FROM "tree_items" "a"
  WHERE "a"."id" = ANY("t"."path") AND "a"."id" <> "t"."id" AND "a"."trash_entry_id" IS NOT NULL
  ORDER BY array_position("t"."path", "a"."id") DESC LIMIT 1
)
WHERE "t"."trash_entry_id" IS NULL AND EXISTS (
  SELECT 1 FROM "tree_items" "a"
  WHERE "a"."id" = ANY("t"."path") AND "a"."id" <> "t"."id" AND "a"."trash_entry_id" IS NOT NULL
);--> statement-breakpoint
UPDATE "trash_entries" "e" SET "descendants" = "c"."items" - 1
FROM (SELECT "trash_entry_id", count(*)::int AS "items" FROM "tree_items" WHERE "trash_entry_id" IS NOT NULL GROUP BY "trash_entry_id") "c"
WHERE "c"."trash_entry_id" = "e"."id" AND "e"."kind" = 'items' AND "e"."descendants" <> "c"."items" - 1;
