import {
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  pageWidths,
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_NAME_MAX_LENGTH,
  spaceRoles,
  spaceVisibilities,
  treeItemKinds,
} from "@pagehall/server";
import { z } from "zod";
import { timestamp, uuid } from "../http/schemas.js";

export const visibilitySchema = z
  .enum(spaceVisibilities)
  .describe(
    "Who can read the space besides its holders: `private` (only holders), `organization` (every member of the organization) or `instance` (every internal user of the instance).",
  );

export const roleSchema = z
  .enum(spaceRoles)
  .describe(
    "Space role: `reader` reads, `commenter` also comments, `editor` also creates, edits and moves content, `admin` also manages the space and its permissions.",
  );

export const holderKindSchema = z
  .enum(["account", "group", "organizationMembers", "instanceUsers"])
  .describe(
    "Holder of a role: an account (person or service account), a group, all members of the organization, or all internal users of the instance.",
  );

export const spaceSchema = z
  .object({
    id: uuid("ID of the space."),
    key: z.string().describe("Key of the space, 2 to 10 letters or digits. It appears in addresses."),
    name: z.string().describe("Name of the space. Empty for a personal space that has no name of its own."),
    description: z.string().describe("Short description, up to 1000 characters."),
    visibility: visibilitySchema,
    organizationId: uuid("Organization the space belongs to, or null for a personal space.").nullable(),
    organizationName: z
      .string()
      .nullable()
      .describe("Name of the organization, or null for a personal space."),
    personal: z.boolean().describe("Whether this is a personal space."),
    ownerId: uuid("Owner of a personal space, or null.").nullable(),
    ownerName: z.string().nullable().describe("Name of the owner of a personal space, or null."),
    overviewItemId: uuid("The overview page of the space.").nullable(),
    createdAt: timestamp("When the space was created."),
    updatedAt: timestamp("When the settings of the space last changed."),
  })
  .describe("A space.");

export const spaceWithRoleSchema = spaceSchema
  .extend({ role: roleSchema.nullable().describe("The caller's role in the space, or null.") })
  .describe("A space with the caller's role.");

export const exampleSpace = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  key: "ITOPS",
  name: "IT Operations",
  description: "Runbooks and how-tos of the IT team",
  visibility: "organization",
  organizationId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a6b",
  organizationName: "Example Inc.",
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a11",
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
};

export const spaceGrantSchema = z
  .object({
    principalKind: holderKindSchema,
    principalId: uuid("ID of the account or group; null for all members and all internal users.").nullable(),
    role: roleSchema,
  })
  .strict()
  .describe("A role for a holder.");

export const createSpaceSchema = z
  .object({
    name: z.string().max(SPACE_NAME_MAX_LENGTH).describe("Name, 1 to 100 characters."),
    key: z.string().max(20).describe("Key, 2 to 10 letters or digits; it is stored in capitals."),
    description: z
      .string()
      .max(SPACE_DESCRIPTION_MAX_LENGTH)
      .optional()
      .describe("Short description, up to 1000 characters."),
    visibility: visibilitySchema,
    grants: z
      .array(spaceGrantSchema)
      .max(100)
      .describe("Roles for holders. The creator always becomes space admin in addition."),
  })
  .strict()
  .describe("A new space.");

export const impactSchema = z
  .object({
    gaining: z.number().int().describe("Number of people who get access."),
    losing: z.number().int().describe("Number of people who lose access."),
    raised: z.number().int().describe("Number of people whose role rises."),
    lowered: z.number().int().describe("Number of people whose role drops."),
    unlisted: z
      .number()
      .int()
      .describe("Number of affected people the caller may not see; they are counted but not listed."),
    truncated: z.boolean().describe("Whether `changes` lists only the first 100 people."),
    changes: z
      .array(
        z
          .object({
            accountId: uuid("ID of the account."),
            name: z.string().describe("Name of the person."),
            before: roleSchema.nullable().describe("Role before the change, or null for no access."),
            after: roleSchema.nullable().describe("Role after the change, or null for no access."),
          })
          .describe("How the access of one person changes."),
      )
      .describe("People whose access changes, ordered by name."),
  })
  .describe("Who gains, loses or changes access.");

export const exampleImpact = {
  gaining: 1,
  losing: 0,
  raised: 0,
  lowered: 0,
  unlisted: 0,
  truncated: false,
  changes: [
    { accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger", before: null, after: "reader" },
  ],
};

export const permissionSchema = z
  .object({
    id: uuid("ID of the permission."),
    principalKind: holderKindSchema,
    principalId: uuid("ID of the account or group, or null.").nullable(),
    name: z.string().nullable().describe("Name of the account or group, or null for the other holders."),
    email: z.string().nullable().describe("E-mail address of an account, or null."),
    organizationName: z.string().nullable().describe("Organization of a group, or null."),
    role: roleSchema,
  })
  .describe("A role of a holder in a space.");

export const examplePermission = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a30",
  principalKind: "account",
  principalId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  name: "Anna Berger",
  email: "anna@example.org",
  organizationName: null,
  role: "admin",
};

export const permissionChangeSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("grant").describe("Give a holder a role."),
        principalKind: holderKindSchema,
        principalId: uuid(
          "ID of the account or group; null for all members and all internal users.",
        ).nullable(),
        role: roleSchema,
      })
      .strict()
      .describe("Give a role."),
    z
      .object({
        action: z.literal("change").describe("Change the role of a holder."),
        permissionId: uuid("ID of the permission."),
        role: roleSchema,
      })
      .strict()
      .describe("Change a role."),
    z
      .object({
        action: z.literal("remove").describe("Take the role of a holder away."),
        permissionId: uuid("ID of the permission."),
      })
      .strict()
      .describe("Remove a role."),
  ])
  .describe("A change to the permissions of a space.");

export const linkSchema = z
  .object({
    itemId: uuid(
      "Linked page or folder, or null for an address or when the caller cannot read it.",
    ).nullable(),
    url: z.string().nullable().describe("Linked `http` or `https` address, or null."),
    accessible: z.boolean().describe("Whether the caller can open the target. If not, the title is empty."),
    target: z
      .object({
        spaceId: uuid("Space of the target."),
        spaceKey: z.string().describe("Key of that space."),
        kind: z.enum(treeItemKinds).describe("Kind of the target."),
        title: z.string().describe("Title of the target."),
      })
      .nullable()
      .describe("The linked page or folder, or null."),
  })
  .describe("Where a link in the page tree points.");

export const treeItemSchema = z
  .object({
    id: uuid("ID of the item."),
    spaceId: uuid("Space of the item."),
    parentId: uuid("Parent item, or null at the root of the tree.").nullable(),
    kind: z.enum(treeItemKinds).describe("`page`, `folder` or `link`."),
    title: z.string().describe("Title. Empty for a link to content the caller cannot read."),
    description: z.string().describe("Short description of a folder."),
    width: z.enum(pageWidths).describe("Page width: `fixed` or `full`."),
    position: z.string().describe("Sort key among the siblings. Items sort by it in binary order."),
    hasChildren: z.boolean().describe("Whether the item has children."),
    link: linkSchema.nullable().describe("Target of a link, or null for pages and folders."),
    creatorId: uuid("Account that created the item, or null.").nullable(),
    ownerId: uuid("Account responsible for the item, or null.").nullable(),
    createdAt: timestamp("When the item was created."),
    updatedAt: timestamp("When the item last changed in the tree."),
    contentUpdatedAt: timestamp("When the content of the page last changed."),
  })
  .describe("An item of the page tree.");

export const exampleItem = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40",
  spaceId: exampleSpace.id,
  parentId: null,
  kind: "page",
  title: "VPN access for remote staff",
  description: "",
  width: "fixed",
  position: "a1",
  hasChildren: false,
  link: null,
  creatorId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  ownerId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
};

export const itemDetailsSchema = treeItemSchema
  .extend({
    spaceKey: z.string().describe("Key of the space."),
    spaceName: z.string().describe("Name of the space."),
    ancestors: z
      .array(
        z
          .object({
            id: uuid("ID of the ancestor."),
            kind: z.enum(treeItemKinds).describe("Kind of the ancestor."),
            title: z.string().describe("Title of the ancestor."),
          })
          .describe("An ancestor."),
      )
      .describe("Ancestors from the root down to the parent."),
  })
  .describe("An item with its place in the tree.");

export const placementShape = {
  parentId: uuid("Parent item, or null for the root of the tree.").nullable(),
  beforeId: uuid("Place the item directly before this sibling.").nullable().optional(),
  afterId: uuid("Place the item directly after this sibling. Without either, the item goes last.")
    .nullable()
    .optional(),
};

export const createItemSchema = z
  .object({
    kind: z.enum(treeItemKinds).describe("`page`, `folder` or `link`."),
    title: z.string().max(ITEM_TITLE_MAX_LENGTH).describe("Title, 1 to 255 characters."),
    description: z
      .string()
      .max(ITEM_DESCRIPTION_MAX_LENGTH)
      .optional()
      .describe("Short description of a folder, up to 1000 characters."),
    ...placementShape,
    link: z
      .object({
        itemId: uuid("Page or folder to link to, in any space the caller can read.").nullable().optional(),
        url: z.string().max(2048).nullable().optional().describe("`http` or `https` address to link to."),
      })
      .strict()
      .optional()
      .describe("Target of a link. Required for links, ignored otherwise."),
  })
  .strict()
  .describe("A new item of the page tree.");

export const updateItemSchema = z
  .object({
    title: z.string().max(ITEM_TITLE_MAX_LENGTH).optional().describe("New title, 1 to 255 characters."),
    description: z
      .string()
      .max(ITEM_DESCRIPTION_MAX_LENGTH)
      .optional()
      .describe("New description of a folder, up to 1000 characters."),
    width: z.enum(pageWidths).optional().describe("Page width: `fixed` or `full`."),
  })
  .strict()
  .describe("Fields to change.");

export const moveItemSchema = z
  .object({
    spaceId: uuid("Target space. Leave it out to stay in the space.").optional(),
    ...placementShape,
  })
  .strict()
  .describe("Where the item goes. Moving to another space needs edit permission in both spaces.");

export const documentSchema = z
  .json()
  .describe(
    'Page content as ProseMirror JSON, as defined by the editor schema: an object with `type: "doc"` and `content`.',
  );

export const exampleDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Connect through WireGuard." }] }],
};

export const pageContentSchema = z
  .object({
    itemId: uuid("ID of the page."),
    document: documentSchema,
    schemaVersion: z.number().int().describe("Version of the editor schema the document follows."),
    revision: z.number().int().describe("Number of the stored state; it rises with every save."),
    updatedAt: timestamp("When the content was last stored."),
    updatedBy: uuid("Account that stored the content last, or null.").nullable(),
    references: z
      .object({
        people: z
          .record(z.string(), z.string().describe("Name of the person."))
          .describe("Names of mentioned people the caller may see, by account ID."),
        pages: z
          .record(
            z.string(),
            z
              .object({
                title: z.string().describe("Title, or empty without access."),
                spaceKey: z.string().describe("Key of the page's space, or empty without access."),
                kind: z.string().describe("Kind of the item."),
                accessible: z.boolean().describe("Whether the caller can open the page."),
              })
              .describe("A linked page."),
          )
          .describe("Linked pages by ID."),
      })
      .describe("What mentions and page links in the document point to, as far as the caller may see it."),
  })
  .describe("The stored content of a page.");

export const examplePageContent = {
  itemId: exampleItem.id,
  document: exampleDocument,
  schemaVersion: 1,
  revision: 4,
  updatedAt: "2026-10-05T08:10:00.000Z",
  updatedBy: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  references: { people: {}, pages: {} },
};

export const labelsSchema = z
  .array(z.string().describe(`A label, lowercase, up to ${LABEL_MAX_LENGTH} characters.`))
  .describe("Labels, sorted.");

export const backlinkSchema = z
  .object({
    itemId: uuid("Page that links here."),
    title: z.string().describe("Title of that page."),
    spaceId: uuid("Space of that page."),
    spaceKey: z.string().describe("Key of that space."),
    spaceName: z.string().describe("Name of that space."),
  })
  .describe("A page that links to this page.");
