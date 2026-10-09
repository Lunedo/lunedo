CREATE TABLE "deleted_space_administrators" (
	"trash_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "deleted_space_administrators_trash_entry_id_account_id_pk" PRIMARY KEY("trash_entry_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "deleted_space_administrators" ADD CONSTRAINT "deleted_space_administrators_trash_entry_id_trash_entries_id_fk" FOREIGN KEY ("trash_entry_id") REFERENCES "public"."trash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_space_administrators" ADD CONSTRAINT "deleted_space_administrators_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_space_administrators_account_id_index" ON "deleted_space_administrators" USING btree ("account_id");--> statement-breakpoint
INSERT INTO "deleted_space_administrators" ("trash_entry_id", "account_id")
SELECT e."id", a."id" FROM "trash_entries" e
JOIN "spaces" s ON s."id" = e."space_id"
JOIN "accounts" a ON s."personal_of" = a."id" OR EXISTS (
	SELECT 1 FROM "space_permissions" g WHERE g."space_id" = s."id" AND g."role" = 'admin' AND (
		(g."principal_kind" = 'account' AND g."principal_id" = a."id")
		OR (g."principal_kind" = 'group' AND EXISTS (SELECT 1 FROM "group_members" gm
			WHERE gm."group_id" = g."principal_id" AND gm."account_id" = a."id"
				AND (gm."expires_at" IS NULL OR gm."expires_at" > now())))
		OR (g."principal_kind" = 'organizationMembers' AND EXISTS (SELECT 1 FROM "memberships" m
			WHERE m."organization_id" = s."organization_id" AND m."account_id" = a."id" AND m."kind" = 'member'
				AND (m."expires_at" IS NULL OR m."expires_at" > now())))
		OR (g."principal_kind" = 'instanceUsers' AND a."type" = 'standard')))
WHERE e."kind" = 'space' AND NOT e."purging"
ON CONFLICT DO NOTHING;
