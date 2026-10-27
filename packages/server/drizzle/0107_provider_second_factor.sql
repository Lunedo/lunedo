ALTER TYPE "public"."sign_in_refusal_reason" ADD VALUE 'secondFactorMissing';--> statement-breakpoint
UPDATE "identity_providers"
SET "config" = jsonb_set("config", '{secondFactor,mode}', '"provider"')
WHERE "type"::text IN ('oidc', 'saml') AND "config" -> 'secondFactor' ->> 'mode' = 'lunedo';--> statement-breakpoint
UPDATE "identity_providers"
SET "draft" = jsonb_set("draft", '{secondFactor,mode}', '"provider"')
WHERE "type"::text IN ('oidc', 'saml') AND "draft" -> 'secondFactor' ->> 'mode' = 'lunedo';
