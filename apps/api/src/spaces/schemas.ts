import {
  builtInPageStatuses,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  MAX_TEMPLATE_TITLE_PATTERN,
  pageModes,
  pageStatusColors,
  pageWidths,
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_NAME_MAX_LENGTH,
  spaceRoles,
  spaceVisibilities,
  treeItemKinds,
} from "@pagehall/server";
import { contentLanguages } from "@pagehall/shared";
import { z } from "zod";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

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
    discoverable: z
      .boolean()
      .describe(
        "Whether members of the organization can find the space and ask for access without reading it.",
      ),
    confidential: z
      .boolean()
      .describe(
        "Whether the space is confidential: only its members can read it, and administrators cannot give themselves or others access. Chosen at creation.",
      ),
    oneOnOne: z.boolean().describe("Whether the space holds a one-on-one."),
    quarantined: z
      .boolean()
      .describe(
        "Whether the space holds an import that is not accepted yet. Only the importing administrator and the reviewers can read it.",
      ),
    organizationId: uuid("Organization the space belongs to, or null for a personal space.").nullable(),
    organizationName: z
      .string()
      .nullable()
      .describe("Name of the organization, or null for a personal space."),
    personal: z.boolean().describe("Whether this is a personal space."),
    ownerId: uuid("Owner of a personal space, or null.").nullable(),
    ownerName: z.string().nullable().describe("Name of the owner of a personal space, or null."),
    overviewItemId: uuid("The overview page of the space.").nullable(),
    archived: z.boolean().describe("Whether the space is archived. Archived spaces are read-only."),
    exportEnabled: z
      .boolean()
      .describe(
        "Whether pages and the space can be exported. Space administrators turn export off and on; it applies to everyone. Turning it off does not prevent copying content.",
      ),
    createdAt: timestamp("When the space was created."),
    updatedAt: timestamp("When the settings of the space last changed."),
  })
  .describe("A space.");

export const spaceWithRoleSchema = spaceSchema
  .extend({
    role: roleSchema.nullable().describe("The caller's role in the space, or null."),
    mayExport: z
      .boolean()
      .describe(
        "Whether the caller may export the whole space and pages with their subpages while export is turned on: space administrators, and organization administrators with access to the space outside confidential spaces. Every reader can export single pages.",
      ),
  })
  .describe("A space with the caller's role.");

export const exampleSpace = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  key: "ITOPS",
  name: "IT Operations",
  description: "Runbooks and how-tos of the IT team",
  visibility: "organization",
  discoverable: false,
  confidential: false,
  oneOnOne: false,
  quarantined: false,
  organizationId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a6b",
  organizationName: "Example Inc.",
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a11",
  archived: false,
  exportEnabled: true,
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
    confidential: z
      .boolean()
      .default(false)
      .describe(
        "Create a confidential space. It must be private, and only individual people can hold roles. This cannot be changed later.",
      ),
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

export const moveImpactSchema = impactSchema
  .extend({
    leavesConfidential: z
      .boolean()
      .describe("True when the content leaves a confidential space and loses its protection."),
    confirmation: z
      .string()
      .nullable()
      .describe(
        "Send this with the move to confirm exactly this change, or null when access does not change. Valid for one hour.",
      ),
  })
  .describe("Who gains, loses or changes access through the move.");

export const exampleMoveImpact = {
  ...exampleImpact,
  leavesConfidential: false,
  confirmation: "mbx2k1c0.Hq3l2bS8yq1m0e7pW9cJx4rT6uV5aZ2nD0gF1hK8sLw",
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
    inTrash: z
      .boolean()
      .describe("Whether the target is in the trash. Only true for callers who could read it before."),
    target: z
      .object({
        spaceId: uuid("Space of the target."),
        spaceKey: z.string().describe("Key of that space."),
        kind: extensibleEnum(treeItemKinds, "Kind of the target."),
        title: z.string().describe("Title of the target."),
      })
      .nullable()
      .describe("The linked page or folder, or null."),
  })
  .describe("Where a link in the page tree points.");

export const modeSchema = z
  .enum(pageModes)
  .describe(
    "Editing mode of a page: `publish` (readers see the last published version while editors work on a draft) or `live` (readers see every change at once). Folders and links are always `live`.",
  );

export const contentLanguageSchema = extensibleEnum(
  contentLanguages,
  "Content language as an ISO 639-1 code, or `other` for a language without its own word matching. Words are then matched as written.",
);

export const contentLanguageBodySchema = z
  .object({
    language: z
      .enum(contentLanguages)
      .nullable()
      .describe("The language, or null to use the language of the space."),
  })
  .strict()
  .describe("The content language of a page.");
export const pageStatusColorSchema = z
  .enum(pageStatusColors)
  .describe("Color of the status: `neutral`, `accent`, `info`, `success`, `warning` or `danger`.");

export const pageStatusSchema = z
  .object({
    id: uuid("ID of the status value."),
    builtIn: extensibleEnum(
      builtInPageStatuses,
      "Which default value this is, or null for a value a space admin added. Clients show the translated name of a default value unless `name` is set.",
    ).nullable(),
    name: z.string().nullable().describe("Name set by a space admin, or null to show the default name."),
    color: pageStatusColorSchema,
  })
  .describe("A page status.");

export const examplePageStatus = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60",
  builtIn: "verified",
  name: null,
  color: "success",
};

export const treeItemSchema = z
  .object({
    id: uuid("ID of the item."),
    spaceId: uuid("Space of the item."),
    parentId: uuid("Parent item, or null at the root of the tree.").nullable(),
    kind: extensibleEnum(
      treeItemKinds,
      "`page`, `folder`, `link`, `blogPost`, `meetingSeries`, `meetingTopic` or `whiteboard`. Blog posts and topics are not part of the tree; they appear in the blog and the meetings of their space.",
    ),
    title: z.string().describe("Title. Empty for a link to content the caller cannot read."),
    description: z.string().describe("Short description of a folder."),
    width: z.enum(pageWidths).describe("Page width: `fixed` or `full`."),
    mode: modeSchema,
    published: z
      .boolean()
      .describe(
        "Whether readers can see the page. False for a page in publish mode that was never published; only editors see it.",
      ),
    archived: z.boolean().describe("Whether the item is archived. Archived items are read-only."),
    position: z.string().describe("Sort key among the siblings. Items sort by it in binary order."),
    hasChildren: z.boolean().describe("Whether the item has children."),
    viewRestriction: z
      .enum(["none", "own", "inherited"])
      .describe(
        "Whether only an access list may view the item: set on the item itself, on a page above, or not at all.",
      ),
    editRestricted: z.boolean().describe("Whether only an access list may edit the item."),
    link: linkSchema.nullable().describe("Target of a link, or null for pages and folders."),
    creatorId: uuid("Account that created the item, or null.").nullable(),
    contentLanguage: contentLanguageSchema
      .nullable()
      .describe("Language of the page content for search, or null to use the language of the space."),
    ownerId: uuid(
      "Owner of the item, or null. The owner stays set when the person leaves; `owner.active` in the item details says whether the item has an active owner.",
    ).nullable(),
    status: pageStatusSchema
      .nullable()
      .describe("Status of a page, or null when it has none or page status is turned off in the space."),
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
  mode: "publish",
  published: true,
  archived: false,
  position: "a1",
  hasChildren: false,
  viewRestriction: "none",
  editRestricted: false,
  link: null,
  creatorId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  ownerId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  contentLanguage: null,
  status: examplePageStatus,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
};

export const itemDetailsSchema = treeItemSchema
  .extend({
    spaceKey: z
      .string()
      .describe("Key of the space. Empty when the caller sees the item only through a share or link."),
    spaceName: z
      .string()
      .describe("Name of the space. Empty when the caller sees the item only through a share or link."),
    spaceAccess: z
      .boolean()
      .describe(
        "Whether the caller has access to the space; false when the item is visible only through a share or link.",
      ),
    spaceContentLanguage: contentLanguageSchema.describe(
      "Content language of the space, which pages without a content language of their own use for search.",
    ),
    ancestors: z
      .array(
        z
          .object({
            id: uuid("ID of the ancestor."),
            kind: extensibleEnum(treeItemKinds, "Kind of the ancestor."),
            title: z.string().describe("Title of the ancestor."),
            published: z
              .boolean()
              .describe(
                "Whether the ancestor counts as published: a folder, a link, a page in live mode or a page with a published version. Readers see a page only when every ancestor is published.",
              ),
          })
          .describe("An ancestor."),
      )
      .describe("Ancestors from the root down to the parent."),
    owner: z
      .object({
        id: uuid("ID of the owner."),
        name: z
          .string()
          .nullable()
          .describe("Name of the owner, or null when the caller may not see the person."),
        email: z
          .string()
          .nullable()
          .describe("E-mail address of the owner, or null when the caller may not see it."),
        active: z
          .boolean()
          .describe(
            "Whether the owner can still act: false when the account is deactivated or its membership in the organization ended.",
          ),
      })
      .nullable()
      .describe("Owner of the item, or null when it has none."),
    ownershipTransferable: z.boolean().describe("Whether the caller may give the item a new owner."),
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
    kind: z
      .enum(["page", "folder", "link", "whiteboard"])
      .describe(
        "`page`, `folder`, `link` or `whiteboard`. Blog posts are created in the blog of a space, meeting series in its meetings.",
      ),
    title: z.string().max(ITEM_TITLE_MAX_LENGTH).describe("Title, 1 to 255 characters."),
    description: z
      .string()
      .max(ITEM_DESCRIPTION_MAX_LENGTH)
      .optional()
      .describe("Short description of a folder, up to 1000 characters."),
    ...placementShape,
    mode: modeSchema
      .optional()
      .describe("Editing mode of a new page. Without it, the default of the space applies."),
    template: z
      .object({
        id: z
          .string()
          .max(100)
          .describe("ID of the template, as listed by the template gallery of the space."),
        values: z
          .record(z.string().max(40), z.string().max(200))
          .default({})
          .describe(
            "Values of the template's input fields by key. Dates as `YYYY-MM-DD` (default today), people as account IDs, choices as one of the options.",
          ),
        titlePattern: z
          .string()
          .max(MAX_TEMPLATE_TITLE_PATTERN)
          .optional()
          .describe(
            "Title with `{key}` for input fields, used instead of the template's title, as a template button sets it. Unknown keys become empty.",
          ),
      })
      .strict()
      .optional()
      .describe(
        "Create the page from a template. The title may be left empty to use the title pattern or the template's title.",
      ),
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
    confirmation: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Confirmation from the preview of this move. Needed when the move changes who can access the content.",
      ),
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

export const pageReferencesSchema = z
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
            inTrash: z
              .boolean()
              .describe("Whether the page is in the trash. Then only the title is given, as `In trash`."),
          })
          .describe("A linked page."),
      )
      .describe("Linked pages by ID."),
    topics: z
      .record(
        z.string(),
        z
          .object({
            title: z.string().describe("Title of the running topic."),
            status: extensibleEnum(["open", "closed"], "Whether the topic is still open."),
          })
          .describe("A running topic."),
      )
      .describe(
        "Running topics that topic updates and decisions in the document refer to, by ID, as far as the caller may see them.",
      ),
  })
  .describe("What mentions and page links in the document point to, as far as the caller may see it.");

export const pageContentSchema = z
  .object({
    itemId: uuid("ID of the page."),
    title: z.string().describe("Title of the page as readers see it."),
    version: z
      .number()
      .int()
      .nullable()
      .describe("Number of the version readers see, or null when the page has no version yet."),
    document: documentSchema,
    schemaVersion: z.number().int().describe("Version of the editor schema the document follows."),
    revision: z.number().int().describe("Number of the stored state; it rises with every save."),
    updatedAt: timestamp("When the content was last stored."),
    updatedBy: uuid("Account that stored the content last, or null.").nullable(),
    references: pageReferencesSchema,
  })
  .describe("The stored content of a page.");

export const examplePageContent = {
  itemId: exampleItem.id,
  title: exampleItem.title,
  version: 7,
  document: exampleDocument,
  schemaVersion: 4,
  revision: 4,
  updatedAt: "2026-10-05T08:10:00.000Z",
  updatedBy: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  references: { people: {}, pages: {}, topics: {} },
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

const actorSchema = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().nullable().describe("Name of the person, or null when the account no longer exists."),
  })
  .describe("A person.");

export const trashEntrySchema = z
  .object({
    id: uuid("ID of the trash entry."),
    spaceId: uuid("Space of the entry."),
    spaceKey: z.string().describe("Key of the space."),
    spaceName: z.string().describe("Name of the space."),
    kind: z
      .enum(["items", "space"])
      .describe("`items` for deleted pages, folders or links, `space` for a deleted space."),
    itemId: uuid("The deleted item, or null for a space.").nullable(),
    itemKind: extensibleEnum(treeItemKinds, "Kind of the deleted item, or null for a space.").nullable(),
    title: z.string().describe("Title of the deleted item, or name of the space."),
    descendants: z.number().int().describe("Number of descendants deleted with the item."),
    stage: z
      .union([z.literal(1), z.literal(2)])
      .describe(
        "1 while the entry is in the space trash, 2 after that period or after the trash was emptied; then only organization administrators can restore it.",
      ),
    deletedAt: timestamp("When it was deleted."),
    deletedBy: actorSchema.nullable().describe("Who deleted it."),
    stageTwoAt: timestamp("When the entry reached stage 2, or null.").nullable(),
    removedAt: timestamp("When the entry will be deleted permanently, by the current retention settings."),
    formerParentEntryId: uuid(
      "The trash entry of the page or folder this item was below, when that one is in the same trash list; restoring with `withParents=true` restores both. Null otherwise.",
    ).nullable(),
  })
  .describe("An entry of the trash.");

export const exampleTrashEntry = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60",
  spaceId: exampleSpace.id,
  spaceKey: "ITOPS",
  spaceName: "IT Operations",
  kind: "items",
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a41",
  itemKind: "page",
  title: "Old VPN (OpenVPN) setup",
  descendants: 2,
  stage: 1,
  deletedAt: "2026-10-02T10:00:00.000Z",
  deletedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Lukas Hofer" },
  stageTwoAt: null,
  removedAt: "2027-02-14T10:00:00.000Z",
  formerParentEntryId: null,
};

export const archivedItemSchema = z
  .object({
    id: uuid("ID of the archived item."),
    kind: extensibleEnum(treeItemKinds, "Kind of the item."),
    title: z.string().describe("Title."),
    hasChildren: z.boolean().describe("Whether it has archived descendants."),
    archivedAt: timestamp("When it was archived.").nullable(),
    archivedBy: actorSchema.nullable().describe("Who archived it."),
  })
  .describe("An archived page or folder.");
