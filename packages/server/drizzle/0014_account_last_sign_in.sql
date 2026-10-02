ALTER TABLE "accounts" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
UPDATE "accounts" SET "last_sign_in_at" = signed_in."occurred_at" FROM (SELECT "target_id", max("occurred_at") AS "occurred_at" FROM "audit_events" WHERE "name" = 'auth.signedIn' GROUP BY "target_id") AS signed_in WHERE signed_in."target_id" = "accounts"."id"::text;
