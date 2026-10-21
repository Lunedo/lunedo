DELETE FROM "article_renders";
--> statement-breakpoint
INSERT INTO "search_pending_items" ("item_id")
SELECT "id" FROM "tree_items"
WHERE "kind"::text IN ('page', 'blogPost', 'meetingTopic', 'whiteboard') AND "trash_entry_id" IS NULL
ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
  "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
