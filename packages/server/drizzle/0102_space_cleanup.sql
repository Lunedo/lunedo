ALTER TABLE "spaces" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
UPDATE "spaces" "s" SET "orphaned_at" = now()
WHERE ("s"."personal_of" IS NOT NULL OR "s"."confidential")
  AND "s"."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "space_permissions" "sp"
    JOIN "accounts" "a" ON ("sp"."principal_kind" = 'account' AND "a"."id" = "sp"."principal_id")
      OR ("sp"."principal_kind" = 'group' AND EXISTS (
        SELECT 1 FROM "group_members" "gm"
        WHERE "gm"."group_id" = "sp"."principal_id" AND "gm"."account_id" = "a"."id"
          AND ("gm"."expires_at" IS NULL OR "gm"."expires_at" > now())))
    WHERE "sp"."space_id" = "s"."id" AND "a"."state" = 'active'
      AND ("s"."organization_id" IS NULL OR EXISTS (
        SELECT 1 FROM "memberships" "m"
        WHERE "m"."organization_id" = "s"."organization_id" AND "m"."account_id" = "a"."id"
          AND ("m"."expires_at" IS NULL OR "m"."expires_at" > now())))
  );
