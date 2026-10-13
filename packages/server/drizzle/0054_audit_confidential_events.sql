CREATE TABLE "audit_confidential_events" (
	"event_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	CONSTRAINT "audit_confidential_events_event_id_space_id_pk" PRIMARY KEY("event_id","space_id")
);
--> statement-breakpoint
ALTER TABLE "audit_confidential_events" ADD CONSTRAINT "audit_confidential_events_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_confidential_events_space_id_index" ON "audit_confidential_events" USING btree ("space_id");
--> statement-breakpoint
INSERT INTO "audit_confidential_events" ("event_id", "space_id")
SELECT DISTINCT candidates."event_id", confidential."id"
FROM (
	SELECT e."id" AS "event_id", reference."id"::uuid AS "reference"
	FROM "audit_events" e
	CROSS JOIN LATERAL (VALUES
		(CASE WHEN e."target_type" IN ('space', 'page') THEN e."target_id" END),
		(e."fields"->>'spaceId'),
		(e."fields"->>'itemId'),
		(e."fields"->>'pageId')
	) AS reference("id")
	WHERE reference."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) AS candidates
LEFT JOIN "tree_items" t ON t."id" = candidates."reference"
JOIN (
	SELECT "id" FROM "spaces" WHERE "confidential"
	UNION
	SELECT "target_id"::uuid FROM "audit_events"
	WHERE "name" = 'space.created' AND "fields"->>'confidential' = 'true'
		AND "target_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) AS confidential ON confidential."id" = candidates."reference" OR confidential."id" = t."space_id"
ON CONFLICT DO NOTHING;
