import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import { spaceRoles, spaceVisibilities } from "./schema.js";

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
  levels: ["instance", "organization"],
  lockable: true,
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

export const spaceSettings = [
  membersCreateSpacesSetting,
  defaultSpacePermissionsSetting,
  personalSpacesSetting,
];
