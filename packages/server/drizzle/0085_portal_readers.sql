CREATE TABLE "portal_readers" (
	"space_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_readers_space_id_account_id_pk" PRIMARY KEY("space_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "portal_readers" ADD CONSTRAINT "portal_readers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_readers" ADD CONSTRAINT "portal_readers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_readers_account_id_index" ON "portal_readers" USING btree ("account_id");--> statement-breakpoint
INSERT INTO "portal_readers" ("space_id", "account_id")
SELECT DISTINCT pi.space_id, a.id
FROM "portal_invitations" pi
JOIN "invitations" i ON i.id = pi.invitation_id AND i.accepted_at IS NOT NULL
JOIN "accounts" a ON lower(a.email) = lower(i.email) AND a.type = 'portal'
JOIN "memberships" m ON m.account_id = a.id AND m.organization_id = i.organization_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "search_pending_items" ("item_id")
SELECT "t"."id" FROM "tree_items" "t" JOIN "spaces" "s" ON "s"."id" = "t"."space_id"
WHERE "s"."type" = 'knowledgeBase' AND "s"."audience" = 'portal' AND "t"."trash_entry_id" IS NULL
  AND "t"."kind"::text IN ('page', 'blogPost', 'meetingTopic', 'whiteboard')
ON CONFLICT ("item_id") DO UPDATE SET "generation" = "search_pending_items"."generation" + 1,
  "due_at" = least("search_pending_items"."due_at", EXCLUDED."due_at"), "updated_at" = now();
