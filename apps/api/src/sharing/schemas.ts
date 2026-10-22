import { shareLinkScopes, shareRoles } from "@lunedo/server";
import { z } from "zod";
import { extensibleEnum, inputTimestamp, timestamp, uuid } from "../http/schemas.js";
import { exampleImpact, impactSchema } from "../spaces/schemas.js";

const person = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().nullable().describe("Name, or null when hidden."),
  })
  .describe("A person.");

const spaceRoleValues = ["reader", "commenter", "editor", "admin"] as const;

export const shareRoleSchema = z
  .enum(shareRoles)
  .describe("`reader` reads, `commenter` also comments, `editor` also edits, moves and deletes.");

const holderKind = z.enum(["account", "group"]).describe("`account` for a person, `group` for a group.");

export const holderSchema = z
  .object({
    kind: holderKind,
    id: uuid("ID of the account or group."),
    name: z.string().nullable().describe("Name of the person or group, or null when hidden."),
    email: z.string().nullable().describe("E-mail address, when the caller may see it."),
    members: z.number().int().nullable().describe("Active members of a group; null for people."),
    active: z.boolean().describe("Whether the account is active or the group still exists."),
  })
  .describe("A person or group with access to a page.");

const restrictionInfo = z
  .object({ setBy: person.nullable().describe("Who set it."), setAt: timestamp("When it was set.") })
  .describe("A restriction of the page itself.");

export const pageAccessSchema = z
  .object({
    itemId: uuid("ID of the page."),
    title: z.string().describe("Title of the page."),
    shares: z
      .array(
        z
          .object({
            id: uuid("ID of the access entry."),
            holder: holderSchema,
            role: shareRoleSchema,
            includeDescendants: z.boolean().describe("Whether the entry also covers the pages below."),
            spaceRole: z
              .enum(spaceRoleValues)
              .nullable()
              .describe("Role of the person in the space, or null when the entry is their only access."),
            sharedBy: person.nullable().describe("Who added the entry."),
            createdAt: timestamp("When it was added."),
          })
          .describe("An entry of the access list."),
      )
      .describe(
        "The access list: people and groups the page is shared with. Restrictions limit access to it.",
      ),
    restrictions: z
      .object({
        view: restrictionInfo
          .nullable()
          .describe("Set when only the access list may view the page and the pages below."),
        edit: restrictionInfo.nullable().describe("Set when only entries with `editor` may edit the page."),
        inherited: z
          .array(
            z
              .object({
                itemId: uuid("Restricted page above."),
                title: z.string().nullable().describe("Its title, or null when the caller cannot see it."),
              })
              .describe("A restricted page above this one."),
          )
          .describe("View restrictions of pages above, which apply to this page as well."),
        holders: z
          .array(
            z
              .object({
                kind: z.enum(["view", "edit"]).describe("The restriction the entry is named in."),
                holder: holderSchema,
              })
              .describe("A person or group named in a restriction."),
          )
          .describe(
            "People and groups named in a restriction without an entry in the access list, such as from an import. They pass the restriction but get no access from it: they still need a role in the space.",
          ),
      })
      .describe("Restrictions of the page."),
    linkVisitors: z
      .array(
        z
          .object({
            accountId: uuid("ID of the account."),
            name: z.string().nullable().describe("Name, or null when hidden."),
            linkId: uuid("The share link they opened."),
            lastOpenedAt: timestamp("When they last opened it."),
          })
          .describe("A signed-in person with access through a share link."),
      )
      .describe("People with access only through share links, marked as via link in the interface."),
    canInviteGuests: z.boolean().describe("Whether the caller may invite a guest by e-mail to this page."),
  })
  .describe("Who has access to a page beyond the roles of its space.");

export const accessChangeSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("share").describe("Add a person or group to the access list."),
        holderKind,
        holderId: uuid("ID of the account or group."),
        role: shareRoleSchema,
        includeDescendants: z
          .boolean()
          .default(false)
          .describe("Also give access to the pages below. Default false."),
      })
      .strict()
      .describe("Shares the page."),
    z
      .object({
        action: z.literal("changeShare").describe("Change an entry of the access list."),
        shareId: uuid("ID of the access entry."),
        role: shareRoleSchema.optional(),
        includeDescendants: z.boolean().optional().describe("Also give access to the pages below."),
      })
      .strict()
      .describe("Changes an entry."),
    z
      .object({
        action: z.literal("removeShare").describe("Remove an entry of the access list."),
        shareId: uuid("ID of the access entry."),
      })
      .strict()
      .describe("Removes an entry."),
    z
      .object({
        action: z.literal("restrict").describe("Restrict the page."),
        kind: z
          .enum(["view", "edit"])
          .describe("`view` restricts viewing of the page and the pages below, `edit` editing of the page."),
      })
      .strict()
      .describe("Restricts the page. The caller is added to the access list with `editor`."),
    z
      .object({
        action: z.literal("unrestrict").describe("Remove a restriction."),
        kind: z.enum(["view", "edit"]).describe("Which restriction."),
      })
      .strict()
      .describe("Removes a restriction."),
  ])
  .describe("A change of the access to a page.");

export const accessChangesSchema = z
  .object({
    changes: z.array(accessChangeSchema).min(1).max(50).describe("Changes, applied together and in order."),
  })
  .strict()
  .describe("Changes of the access to a page.");

export const pageImpactSchema = z
  .object({
    read: impactSchema.describe("Who gains or loses the right to read."),
    edit: impactSchema.describe("Who gains or loses the right to edit."),
  })
  .describe("How access to the page would change.");

export const examplePageImpact = { read: exampleImpact, edit: { ...exampleImpact, gaining: 0, changes: [] } };

export const examplePageAccess = {
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  title: "VPN access for remote staff",
  shares: [
    {
      id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a50",
      holder: {
        kind: "account",
        id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
        name: "Anna Berger",
        email: "anna.berger@example.org",
        members: null,
        active: true,
      },
      role: "editor",
      includeDescendants: false,
      spaceRole: null,
      sharedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21", name: "Lukas Hofer" },
      createdAt: "2026-10-01T09:30:00.000Z",
    },
  ],
  restrictions: { view: null, edit: null, inherited: [], holders: [] },
  linkVisitors: [],
  canInviteGuests: false,
};

export const restrictedPageSchema = z
  .object({
    itemId: uuid("ID of the page."),
    title: z.string().describe("Title of the page."),
    kind: z.string().describe("Kind of the item."),
    view: restrictionInfo.nullable().describe("The view restriction, if any."),
    edit: restrictionInfo.nullable().describe("The edit restriction, if any."),
    orphaned: z.boolean().describe("Whether nobody on the access list has an active account anymore."),
  })
  .describe("A restricted page, listed for space admins without its content.");

export const shareLinkSchema = z
  .object({
    id: uuid("ID of the link."),
    token: z
      .string()
      .nullable()
      .describe(
        "Secret part of the address: the instance URL followed by `/s/` and the token. Shown to people who may share the page.",
      ),
    itemId: uuid("The page the link opens."),
    scope: extensibleEnum(shareLinkScopes, "Who can open the link."),
    expiresAt: timestamp("When the link stops working.").nullable(),
    hasPassword: z.boolean().describe("Whether the link asks for a password."),
    people: z
      .array(
        z
          .object({
            kind: holderKind,
            id: uuid("ID of the account or group."),
            name: z.string().nullable().describe("Name."),
          })
          .describe("A person or group the link is for."),
      )
      .describe("For the scope `people`: who can open the link."),
    createdBy: person.nullable().describe("Who created the link."),
    createdAt: timestamp("When the link was created."),
    visitors: z.number().int().describe("Signed-in people who opened the link."),
  })
  .describe("A share link of a page.");

export const shareLinkInputSchema = z
  .object({
    scope: z.enum(shareLinkScopes).describe("Who can open the link."),
    expiresAt: inputTimestamp("When the link stops working.").nullable().optional(),
    password: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Password the link asks for. Leave it out for none."),
    people: z
      .array(
        z
          .object({ kind: holderKind, id: uuid("ID of the account or group.") })
          .strict()
          .describe("A person or group."),
      )
      .max(100)
      .optional()
      .describe("For the scope `people`: who can open the link."),
  })
  .strict()
  .describe("A new share link.");

export const shareLinkUpdateSchema = shareLinkInputSchema.partial().describe("Changes of a share link.");

export const exampleShareLink = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60",
  token: "Yk3mR0vQx8LfJ2aB7cT9wE4nU6pH1sD5gK0zV3iM8oA2qX7r",
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  scope: "organization",
  expiresAt: "2026-11-30T00:00:00.000Z",
  hasPassword: false,
  people: [],
  createdBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21", name: "Lukas Hofer" },
  createdAt: "2026-10-01T09:30:00.000Z",
  visitors: 3,
};

export const accessRequestSchema = z
  .object({
    id: uuid("ID of the request."),
    requester: z
      .object({
        id: uuid("ID of the account."),
        name: z.string().nullable().describe("Name, or null when hidden."),
        email: z.string().nullable().describe("E-mail address, when the caller may see it."),
      })
      .describe("Who asks."),
    spaceId: uuid("The space."),
    spaceName: z.string().describe("Name of the space; empty when the requester cannot see it."),
    itemId: uuid("The page, or null for the whole space.").nullable(),
    itemTitle: z.string().nullable().describe("Title of the page, when the caller may see it."),
    message: z.string().describe("Message of the requester."),
    status: extensibleEnum(
      ["open", "approved", "declined", "withdrawn", "satisfied"],
      "`satisfied` means the person got access another way.",
    ),
    role: z.enum(spaceRoleValues).nullable().describe("The role given when approved."),
    decidedBy: person.nullable().describe("Who decided."),
    decidedAt: timestamp("When it was decided.").nullable(),
    createdAt: timestamp("When it was sent."),
  })
  .describe("A request for access to a space or page.");

export const exampleAccessRequest = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
  requester: {
    id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a22",
    name: "Mia Kranz",
    email: "mia.kranz@example.org",
  },
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a00",
  spaceName: "IT Operations",
  itemId: null,
  itemTitle: null,
  message: "I take over the on-call duty next month.",
  status: "open",
  role: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-10-01T09:30:00.000Z",
};

const spaceVia = z
  .object({
    type: extensibleEnum(
      ["account", "group", "organizationMembers", "instanceUsers", "visibility"],
      "How the role is held.",
    ),
    groupId: uuid("The group.").optional(),
    name: z.string().optional().describe("Name of the group."),
    visibility: z.string().optional().describe("Visibility of the space that grants the role."),
  })
  .describe("How a role in the space is held.");

export const accessReasonSchema = z
  .object({
    type: extensibleEnum(["spaceRole", "share", "link"], "Kind of reason."),
    role: z.enum(spaceRoleValues).optional().describe("Role that the reason grants."),
    via: spaceVia.optional(),
    itemId: uuid("Page that was shared.").optional(),
    itemTitle: z.string().nullable().optional().describe("Its title, or null when the caller cannot see it."),
    inherited: z.boolean().optional().describe("Whether the share comes from a page above."),
    linkId: uuid("The share link.").optional(),
    scope: z.string().optional().describe("Scope of the share link."),
    inactive: extensibleEnum(
      ["membershipEnded"],
      "Set when the entry is stored but grants nothing: `membershipEnded` means the person is no longer a member of the organization the space belongs to. It applies again if they become a member again.",
    ).optional(),
  })
  .describe("Why a person has access, or an entry that has no effect.");

export const accessExplanationSchema = z
  .object({
    accountId: uuid("The person."),
    name: z.string().nullable().describe("Name, or null when hidden."),
    role: z.enum(spaceRoleValues).nullable().describe("What the person may do, or null for no access."),
    reasons: z.array(accessReasonSchema).describe("Why: roles, shares and links."),
    denial: z
      .string()
      .nullable()
      .describe(
        "Why access is missing or narrower: `restricted`, `editRestricted`, `unpublished`, `inTrash`, `accountInactive` or `noAccess`.",
      ),
    restrictions: z
      .array(
        z
          .object({
            itemId: uuid("Restricted page."),
            title: z.string().nullable().describe("Its title, or null when hidden."),
            listed: z.boolean().describe("Whether the person is on its access list."),
          })
          .describe("A view restriction that applies."),
      )
      .describe("View restrictions on the page and above."),
    editRestricted: z
      .object({ listed: z.boolean().describe("Whether the person may edit by the access list.") })
      .nullable()
      .describe("The edit restriction of the page, if any."),
    published: z.boolean().describe("Whether readers can see the page yet."),
  })
  .describe("Why a person has or lacks access.");

export const exampleExplanation = {
  accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a22",
  name: "Lukas Hofer",
  role: "reader",
  reasons: [
    {
      type: "spaceRole",
      role: "reader",
      via: { type: "group", groupId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a30", name: "IT Operations" },
    },
  ],
  denial: null,
  restrictions: [],
  editRestricted: null,
  published: true,
};

export const personAccessSchema = z
  .object({
    accountId: uuid("The person."),
    name: z.string().nullable().describe("Name, or null when hidden."),
    email: z.string().nullable().describe("E-mail address, when the caller may see it."),
    entries: z
      .array(
        z
          .object({
            kind: extensibleEnum(
              ["space", "share", "link", "restrictedPages"],
              "`restrictedPages` counts shared pages the caller cannot read, without titles.",
            ),
            spaceId: uuid("The space."),
            spaceName: z.string().describe("Name of the space."),
            spaceKey: z.string().describe("Key of the space."),
            itemId: uuid("The page, for shares and links.").nullable(),
            itemTitle: z.string().nullable().describe("Title of the page."),
            role: z.enum(spaceRoleValues).nullable().describe("What the person may do."),
            count: z
              .number()
              .int()
              .describe(
                "Number of pages for `restrictedPages`; otherwise 1, or 2 for a share with the pages below.",
              ),
            reasons: z.array(accessReasonSchema).describe("Why."),
            inactive: extensibleEnum(
              ["membershipEnded"],
              "Set when the entry grants nothing; `role` is then the role it would grant.",
            ).nullable(),
          })
          .describe("An access of the person."),
      )
      .describe("All access of the person in the organization."),
    confidentialSpaceCount: z
      .number()
      .int()
      .describe(
        "Number of confidential spaces the person belongs to and the caller does not. They are not listed in `entries`, and their names and keys stay hidden.",
      ),
  })
  .describe("What a person can do.");

export const givePreviewSchema = z
  .object({
    holderKind,
    holderId: uuid("ID of the account or group."),
    level: z
      .enum(spaceRoleValues)
      .describe("`reader`, `commenter`, `editor`, or `admin` to manage the space."),
    scope: z
      .enum(["space", "page", "pageAndChildren"])
      .describe("Where: the whole space, this page, or this page with its pages."),
  })
  .strict()
  .describe("Access to give.");

export const giveEffectSchema = z
  .object({
    pages: z.number().int().describe("Pages in the chosen place."),
    readable: z.number().int().describe("Pages the holder could then read."),
    editable: z.number().int().describe("Pages the holder could then edit."),
    restricted: z.number().int().describe("Restricted pages the holder would still not see."),
    alreadyHas: z.enum(spaceRoleValues).nullable().describe("Role the person already has in the space."),
    impact: z
      .union([impactSchema, pageImpactSchema])
      .describe("Who gains or loses access: for the space, or for read and edit of the page."),
  })
  .describe("The effect of giving access.");

export const sharedWithMeSchema = z
  .object({
    itemId: uuid("ID of the page."),
    title: z.string().describe("Title of the page."),
    kind: extensibleEnum(["page", "blogPost"], "Kind of the item."),
    role: shareRoleSchema,
    includeDescendants: z.boolean().describe("Whether the pages below are shared as well."),
    sharedBy: person.nullable().describe("Who shared the page."),
    sharedAt: timestamp("When the page was shared."),
    spaceKey: z.string().describe("Key of the space; empty when the caller has no access to the space."),
    spaceName: z.string().describe("Name of the space; empty when the caller has no access to the space."),
  })
  .describe("A page shared with the caller or one of their groups.");

export const exampleSharedWithMe = {
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  title: "VPN access for remote staff",
  kind: "page",
  role: "reader",
  includeDescendants: false,
  sharedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21", name: "Lukas Hofer" },
  sharedAt: "2026-10-01T09:30:00.000Z",
  spaceKey: "",
  spaceName: "",
};
