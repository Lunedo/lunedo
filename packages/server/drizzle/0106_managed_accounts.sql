CREATE TYPE "public"."managed_account_source" AS ENUM('identity', 'domain');--> statement-breakpoint
CREATE TABLE "managed_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"source" "managed_account_source" NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_accounts" ADD CONSTRAINT "managed_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_accounts" ADD CONSTRAINT "managed_accounts_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_accounts_provider_id_index" ON "managed_accounts" USING btree ("provider_id");--> statement-breakpoint
DELETE FROM "setting_values" WHERE "key" = 'auth.passwordSignIn';--> statement-breakpoint
INSERT INTO "managed_accounts" ("account_id", "provider_id", "source", "since")
SELECT "a"."id", coalesce("own"."provider_id", "dom"."provider_id"),
	(CASE WHEN "own"."provider_id" IS NOT NULL THEN 'identity' ELSE 'domain' END)::"managed_account_source",
	coalesce("own"."created_at", now())
FROM "accounts" "a"
LEFT JOIN LATERAL (
	SELECT "i"."provider_id", "i"."created_at" FROM "identities" "i"
	JOIN "identity_providers" "p" ON "p"."id" = "i"."provider_id"
	WHERE "i"."account_id" = "a"."id" AND "p"."setup_completed_at" IS NOT NULL
	ORDER BY "i"."created_at" DESC, "i"."id" DESC LIMIT 1
) "own" ON true
LEFT JOIN LATERAL (
	SELECT "d"."provider_id" FROM "identity_provider_domains" "d"
	JOIN "identity_providers" "p" ON "p"."id" = "d"."provider_id"
	WHERE "d"."domain" = lower(substring("a"."email" FROM '@([^@]+)$'))
		AND "p"."setup_completed_at" IS NOT NULL
) "dom" ON true
WHERE "a"."type" IN ('standard', 'guest')
	AND "a"."id" IS DISTINCT FROM (SELECT "owner_account_id" FROM "instance")
	AND ("own"."provider_id" IS NOT NULL OR "dom"."provider_id" IS NOT NULL);
