import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import { type PageMode, pageModes, spaceRoles, spaceVisibilities } from "./schema.js";

export const spaceGrantSchema = z
  .object({
    principalKind: z.enum(["account", "group", "organizationMembers", "instanceUsers"]),
    principalId: z.uuid().nullable(),
    role: z.enum(spaceRoles),
  })
  .strict()
  .refine(
    (grant) =>
      (grant.principalKind === "account" || grant.principalKind === "group") === (grant.principalId !== null),
    "Accounts and groups need an ID, the other holders none",
  );
export type SpaceGrant = z.infer<typeof spaceGrantSchema>;

export const defaultSpacePermissionsSchema = z
  .object({
    visibility: z.enum(spaceVisibilities),
    grants: z.array(spaceGrantSchema).max(50),
  })
  .strict();
export type DefaultSpacePermissions = z.infer<typeof defaultSpacePermissionsSchema>;

export const membersCreateSpacesSetting = defineSetting({
  key: "spaces.membersCreateSpaces",
  schema: z.boolean(),
  default: true,
  levels: ["organization"],
  lockable: true,
});

export const membersCreateConfidentialSpacesSetting = defineSetting({
  key: "spaces.membersCreateConfidentialSpaces",
  schema: z.boolean(),
  default: true,
  levels: ["organization"],
  lockable: true,
});

export const CLEANUP_GRACE_MINIMUM_DAYS = 7;

export const cleanupGraceDaysSetting = defineSetting({
  key: "spaces.cleanupGraceDays",
  schema: z.number().int().min(CLEANUP_GRACE_MINIMUM_DAYS).max(3650),
  default: 30,
  levels: ["organization"],
  lockable: false,
});

export const defaultSpacePermissionsSetting = defineSetting<DefaultSpacePermissions>({
  key: "spaces.defaultPermissions",
  schema: defaultSpacePermissionsSchema,
  default: {
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
  },
  levels: ["organization"],
  lockable: false,
});

export const personalSpacesSetting = defineSetting({
  key: "spaces.personalSpaces",
  schema: z.boolean(),
  default: true,
  levels: ["instance"],
  lockable: false,
});

export const defaultPageModeSetting = defineSetting<PageMode>({
  key: "pages.defaultMode",
  schema: z.enum(pageModes),
  default: "publish",
  levels: ["organization", "space"],
  lockable: true,
});

export const liveVersionIdleMinutesSetting = defineSetting({
  key: "pages.liveVersionIdleMinutes",
  schema: z.number().int().min(1).max(1440),
  default: 10,
  levels: ["organization", "space"],
  lockable: true,
});

export const pageStatusEnabledSetting = defineSetting({
  key: "pages.status",
  schema: z.boolean(),
  default: true,
  levels: ["space"],
  lockable: false,
});

export const exportEnabledSetting = defineSetting({
  key: "spaces.export",
  schema: z.boolean(),
  default: true,
  levels: ["space"],
  lockable: false,
});

const retentionDays = z.number().int().min(1).max(3650);

export const trashFirstStageMinimumSetting = defineSetting({
  key: "trash.firstStageMinimumDays",
  schema: retentionDays,
  default: 1,
  levels: ["instance"],
  lockable: false,
});

export const trashSecondStageMinimumSetting = defineSetting({
  key: "trash.secondStageMinimumDays",
  schema: retentionDays,
  default: 1,
  levels: ["instance"],
  lockable: false,
});

export const trashFirstStageDaysSetting = defineSetting({
  key: "trash.firstStageDays",
  schema: retentionDays,
  default: 90,
  levels: ["organization", "space"],
  lockable: true,
  minimum: trashFirstStageMinimumSetting,
});

export const trashSecondStageDaysSetting = defineSetting({
  key: "trash.secondStageDays",
  schema: retentionDays,
  default: 45,
  levels: ["organization", "space"],
  lockable: true,
  minimum: trashSecondStageMinimumSetting,
});

export const spaceSettings = [
  membersCreateSpacesSetting,
  membersCreateConfidentialSpacesSetting,
  cleanupGraceDaysSetting,
  defaultSpacePermissionsSetting,
  personalSpacesSetting,
  defaultPageModeSetting,
  liveVersionIdleMinutesSetting,
  pageStatusEnabledSetting,
  exportEnabledSetting,
  trashFirstStageMinimumSetting,
  trashSecondStageMinimumSetting,
  trashFirstStageDaysSetting,
  trashSecondStageDaysSetting,
];
