INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value", "locked", "created_at", "updated_at")
SELECT gen_random_uuid(), 'organization', "o"."id", "v"."key", "v"."value", "v"."locked", now(), now()
FROM "setting_values" "v"
CROSS JOIN "organizations" "o"
WHERE "v"."level" = 'instance'
  AND (
    "v"."key" IN (
      'locale.dateFormat', 'locale.timeFormat', 'locale.numberFormat', 'locale.firstDayOfWeek',
      'organizations.membersCreateGroups', 'organizations.selfRegistration',
      'organizations.guestExpiryReminderDays', 'organizations.guestInactivityDays',
      'organizations.expiryReminderDays',
      'notifications.digestEnabled', 'notifications.digestTime',
      'pages.liveVersionIdleMinutes', 'trash.firstStageDays', 'trash.secondStageDays',
      'files.keepVersions', 'sharing.shareLinks', 'sharing.membersInviteGuests',
      'spaces.membersCreateSpaces', 'spaces.membersCreateConfidentialSpaces'
    )
    OR "v"."key" ~ '^notifications\.[a-zA-Z0-9]+\.(inApp|email|push)$'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "setting_values" "own"
    WHERE "own"."level" = 'organization' AND "own"."scope_id" = "o"."id" AND "own"."key" = "v"."key"
  );--> statement-breakpoint
DELETE FROM "setting_values"
WHERE "level" = 'instance'
  AND (
    "key" IN (
      'locale.dateFormat', 'locale.timeFormat', 'locale.numberFormat', 'locale.firstDayOfWeek',
      'organizations.membersCreateGroups', 'organizations.selfRegistration',
      'organizations.guestExpiryReminderDays', 'organizations.guestInactivityDays',
      'organizations.expiryReminderDays',
      'notifications.digestEnabled', 'notifications.digestTime',
      'pages.liveVersionIdleMinutes', 'trash.firstStageDays', 'trash.secondStageDays',
      'files.keepVersions', 'sharing.shareLinks', 'sharing.membersInviteGuests',
      'spaces.membersCreateSpaces', 'spaces.membersCreateConfidentialSpaces'
    )
    OR "key" ~ '^notifications\.[a-zA-Z0-9]+\.(inApp|email|push)$'
  );--> statement-breakpoint
INSERT INTO "setting_values" ("id", "level", "scope_id", "key", "value", "locked", "created_at", "updated_at")
SELECT gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'branding.accentColor', "v"."value", false, now(), now()
FROM "setting_values" "v"
WHERE "v"."level" = 'organization' AND "v"."key" = 'branding.accentColor' AND "v"."value" IS NOT NULL
  AND (SELECT count(*) FROM "organizations") = 1
ON CONFLICT ("level", "scope_id", "key") DO UPDATE SET "value" = excluded."value", "updated_at" = now();--> statement-breakpoint
DELETE FROM "setting_values" WHERE "level" = 'organization' AND "key" = 'branding.accentColor';
