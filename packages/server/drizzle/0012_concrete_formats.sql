CREATE TEMPORARY TABLE "format_language" ON COMMIT DROP AS
WITH "instance_language" AS (
	SELECT
		coalesce((SELECT "value" #>> '{}' FROM "setting_values" WHERE "level" = 'instance' AND "key" = 'locale.language' AND "value" IS NOT NULL), 'en') AS "language",
		coalesce((SELECT "locked" FROM "setting_values" WHERE "level" = 'instance' AND "key" = 'locale.language'), false) AS "locked"
),
"organization_language" AS (
	SELECT o."id",
		CASE WHEN i."locked" THEN i."language" ELSE coalesce(v."value" #>> '{}', i."language") END AS "language",
		coalesce(v."locked", false) AS "locked"
	FROM "organizations" o
	CROSS JOIN "instance_language" i
	LEFT JOIN "setting_values" v ON v."level" = 'organization' AND v."scope_id" = o."id" AND v."key" = 'locale.language'
)
SELECT 'instance'::text AS "level", '00000000-0000-0000-0000-000000000000'::uuid AS "scope_id", NULL::uuid AS "parent_id", i."language"
FROM "instance_language" i
UNION ALL
SELECT 'organization', o."id", NULL, o."language" FROM "organization_language" o
UNION ALL
SELECT 'user', a."id", a."home_organization_id",
	CASE
		WHEN i."locked" THEN i."language"
		WHEN o."locked" THEN o."language"
		ELSE coalesce(v."value" #>> '{}', o."language", i."language")
	END
FROM "accounts" a
CROSS JOIN "instance_language" i
LEFT JOIN "organization_language" o ON o."id" = a."home_organization_id"
LEFT JOIN "setting_values" v ON v."level" = 'user' AND v."scope_id" = a."id" AND v."key" = 'locale.language';
--> statement-breakpoint
CREATE TEMPORARY TABLE "format_value" ON COMMIT DROP AS
SELECT k."key", l."level", l."scope_id", l."parent_id",
	CASE k."key"
		WHEN 'locale.dateFormat' THEN CASE l."language" WHEN 'de' THEN 'DD.MM.YYYY' ELSE 'MM/DD/YYYY' END
		WHEN 'locale.timeFormat' THEN CASE l."language" WHEN 'de' THEN '24h' ELSE '12h' END
		WHEN 'locale.numberFormat' THEN CASE l."language" WHEN 'de' THEN 'de-DE' ELSE 'en-US' END
		ELSE CASE l."language" WHEN 'de' THEN 'monday' ELSE 'sunday' END
	END AS "resolved",
	(SELECT v."value" #>> '{}' FROM "setting_values" v WHERE v."level"::text = l."level" AND v."scope_id" = l."scope_id" AND v."key" = k."key" AND v."value" IS NOT NULL) AS "own"
FROM "format_language" l
CROSS JOIN (VALUES ('locale.dateFormat'), ('locale.timeFormat'), ('locale.numberFormat'), ('locale.firstDayOfWeek')) AS k("key");
--> statement-breakpoint
CREATE TEMPORARY TABLE "format_before" ON COMMIT DROP AS
SELECT f."key", f."level", f."scope_id", f."resolved",
	CASE f."level"
		WHEN 'instance' THEN coalesce(f."own", 'auto')
		WHEN 'organization' THEN coalesce(f."own", i."own", 'auto')
		ELSE coalesce(f."own", o."own", i."own", 'auto')
	END AS "effective",
	f."own"
FROM "format_value" f
JOIN "format_value" i ON i."key" = f."key" AND i."level" = 'instance'
LEFT JOIN "format_value" o ON o."key" = f."key" AND o."level" = 'organization' AND o."scope_id" = f."parent_id";
--> statement-breakpoint
UPDATE "setting_values" v SET "value" = to_jsonb(b."resolved"), "updated_at" = now()
FROM "format_before" b
WHERE v."key" = b."key" AND v."level"::text = b."level" AND v."scope_id" = b."scope_id" AND b."own" = 'auto';
--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value")
SELECT gen_random_uuid(), 'instance'::setting_level, b."scope_id", b."key", to_jsonb(b."resolved")
FROM "format_before" b
WHERE b."level" = 'instance' AND b."own" IS NULL
ON CONFLICT ("level", "scope_id", "key") DO UPDATE SET "value" = excluded."value", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value")
SELECT gen_random_uuid(), 'organization'::setting_level, b."scope_id", b."key", to_jsonb(b."resolved")
FROM "format_before" b
JOIN "format_before" i ON i."key" = b."key" AND i."level" = 'instance'
WHERE b."level" = 'organization' AND b."own" IS NULL AND b."effective" = 'auto'
	AND b."resolved" <> i."resolved"
ON CONFLICT ("level", "scope_id", "key") DO UPDATE SET "value" = excluded."value", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value")
SELECT gen_random_uuid(), 'user'::setting_level, b."scope_id", b."key", to_jsonb(b."resolved")
FROM "format_before" b
JOIN "format_value" u ON u."key" = b."key" AND u."level" = 'user' AND u."scope_id" = b."scope_id"
WHERE b."level" = 'user' AND b."own" IS NULL AND b."effective" = 'auto'
	AND b."resolved" <> (
		SELECT v."value" #>> '{}' FROM "setting_values" v
		WHERE v."key" = b."key" AND v."value" IS NOT NULL AND (
			(v."level" = 'organization' AND v."scope_id" = u."parent_id")
			OR v."level" = 'instance'
		)
		ORDER BY CASE v."level" WHEN 'organization' THEN 0 ELSE 1 END
		LIMIT 1
	)
ON CONFLICT ("level", "scope_id", "key") DO UPDATE SET "value" = excluded."value", "updated_at" = now();
