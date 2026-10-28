CREATE TABLE "private_space_grant_removals" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grants" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "private_space_grant_removals" ("space_id", "organization_id", "name", "grants")
SELECT s."id", s."organization_id", s."name",
  jsonb_agg(jsonb_build_object('principalKind', sp."principal_kind"::text, 'role', sp."role"::text) ORDER BY sp."principal_kind"::text)
FROM "spaces" s JOIN "space_permissions" sp ON sp."space_id" = s."id"
WHERE s."visibility" = 'private' AND s."organization_id" IS NOT NULL
  AND sp."principal_kind" IN ('organizationMembers', 'instanceUsers')
GROUP BY s."id", s."organization_id", s."name";
--> statement-breakpoint
DELETE FROM "space_permissions" sp USING "spaces" s
WHERE sp."space_id" = s."id" AND s."visibility" = 'private' AND s."organization_id" IS NOT NULL
  AND sp."principal_kind" IN ('organizationMembers', 'instanceUsers');
