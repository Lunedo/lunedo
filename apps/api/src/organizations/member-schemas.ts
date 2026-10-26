import { z } from "zod";
import { exampleMember, memberSchema, timestamp, uuid } from "../http/schemas.js";
import { roleSchema } from "../spaces/schemas.js";

const providerSchema = z
  .object({
    providerId: uuid("ID of the identity provider."),
    providerName: z.string().describe("Name of the identity provider."),
  })
  .describe("An identity provider.");

export const memberDetailsSchema = memberSchema
  .extend({
    joinedAt: timestamp("When the person joined the organization."),
    invitedBy: z
      .object({ id: uuid("Account ID."), name: z.string().describe("Name.") })
      .nullable()
      .describe("Who added or invited the person, or null when unknown."),
    homeOrganization: z.boolean().describe("Whether this is the home organization of the account."),
    twoFactorRequired: z.boolean().describe("Whether the organization requires a second factor."),
    signIn: z
      .object({
        password: z.boolean().describe("Whether the account has a password."),
        providers: z.array(providerSchema).describe("Identity providers linked to the account."),
      })
      .describe("How the person signs in."),
    groupDetails: z
      .array(
        z
          .object({
            id: uuid("ID of the group."),
            name: z.string().describe("Name of the group."),
            managedBy: providerSchema
              .nullable()
              .describe(
                "The provider the whole group is synchronized from; its members cannot be changed here.",
              ),
            viaProvider: providerSchema
              .nullable()
              .describe(
                "The provider whose mapping rule adds the person to the group; the next synchronization adds them again after a removal.",
              ),
            spaces: z.number().int().min(0).describe("How many spaces give the group a role."),
          })
          .describe("A group the person belongs to."),
      )
      .describe("Groups of this organization the person belongs to, ordered by name."),
    spaces: z
      .array(
        z
          .object({
            id: uuid("ID of the space."),
            key: z.string().describe("Key of the space."),
            name: z.string().describe("Name of the space."),
            role: roleSchema,
            sources: z
              .array(
                z
                  .object({
                    kind: z
                      .enum(["direct", "group", "organizationMembers"])
                      .describe("A role of the person, of a group or of all members."),
                    groupId: uuid("The group, for `group`.").optional(),
                    groupName: z.string().optional().describe("Name of the group, for `group`."),
                  })
                  .describe("Where a role comes from."),
              )
              .describe("Where the roles come from; the highest is shown as `role`."),
          })
          .describe("A space the person has a role in."),
      )
      .nullable()
      .describe(
        "Spaces of the organization the person has a role in, without personal and confidential spaces. Null when the caller may not view the spaces of the organization.",
      ),
  })
  .describe("A member of an organization with groups, spaces and sign-in.");

export const exampleMemberDetails = {
  ...exampleMember,
  joinedAt: "2026-08-21T09:58:00.000Z",
  invitedBy: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b70", name: "Olivia Owner" },
  homeOrganization: true,
  twoFactorRequired: false,
  signIn: { password: true, providers: [] },
  groupDetails: [
    {
      id: "01929b1e-7a3b-7c2d-8e1f-0a9b8c7d6e5f",
      name: "Engineering",
      managedBy: null,
      viaProvider: null,
      spaces: 2,
    },
  ],
  spaces: [
    {
      id: "01929b1e-7a3b-7c2d-8e1f-0a9b8c7d6e60",
      key: "ITOPS",
      name: "IT Operations",
      role: "editor",
      sources: [{ kind: "group", groupId: "01929b1e-7a3b-7c2d-8e1f-0a9b8c7d6e5f", groupName: "Engineering" }],
    },
  ],
};

export const memberSpacesSchema = z
  .object({
    spaces: z
      .array(
        z
          .object({ spaceId: uuid("The space."), role: roleSchema })
          .strict()
          .describe("A space and the role the person gets there."),
      )
      .min(1)
      .max(50)
      .describe("1 to 50 different spaces."),
  })
  .strict()
  .describe("Spaces to add a person to.");
