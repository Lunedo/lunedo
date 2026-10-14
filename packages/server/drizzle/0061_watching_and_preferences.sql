CREATE TYPE "public"."watch_state" AS ENUM('watching', 'muted', 'notWatching');--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"space_id" uuid,
	"item_id" uuid,
	"state" "watch_state" NOT NULL,
	"keep_mentions" boolean DEFAULT true NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_one_target" CHECK (("watches"."space_id" is null) <> ("watches"."item_id" is null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "actor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assigned_by_id" uuid;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_item_id_tree_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tree_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_account_space_index" ON "watches" USING btree ("account_id","space_id") WHERE "watches"."item_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_account_item_index" ON "watches" USING btree ("account_id","item_id") WHERE "watches"."item_id" is not null;--> statement-breakpoint
CREATE INDEX "watches_space_id_state_index" ON "watches" USING btree ("space_id","state");--> statement-breakpoint
CREATE INDEX "watches_item_id_state_index" ON "watches" USING btree ("item_id","state");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_id_accounts_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value", "locked", "created_at", "updated_at")
SELECT gen_random_uuid(), "level", "scope_id", "key" || '.inApp',
  CASE WHEN "value" IS NULL THEN NULL ELSE to_jsonb(coalesce(("value"->>'inApp')::boolean, true)) END,
  "locked", "created_at", now()
FROM "setting_values"
WHERE "key" ~ '^notifications\.[a-zA-Z0-9]+$' AND "key" <> 'notifications.retentionDays'
  AND ("value" IS NULL OR jsonb_typeof("value") = 'object');--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value", "locked", "created_at", "updated_at")
SELECT gen_random_uuid(), "level", "scope_id", "key" || '.email',
  CASE WHEN "value" IS NULL THEN NULL
    WHEN coalesce(("value"->>'email')::boolean, true) THEN '"immediately"'::jsonb
    ELSE '"off"'::jsonb END,
  "locked", "created_at", now()
FROM "setting_values"
WHERE "key" ~ '^notifications\.[a-zA-Z0-9]+$' AND "key" <> 'notifications.retentionDays'
  AND ("value" IS NULL OR jsonb_typeof("value") = 'object');--> statement-breakpoint
DELETE FROM "setting_values"
WHERE "key" ~ '^notifications\.[a-zA-Z0-9]+$' AND "key" <> 'notifications.retentionDays'
  AND ("value" IS NULL OR jsonb_typeof("value") = 'object');
