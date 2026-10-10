import {
  importSources,
  importStates,
  MAX_MAPPINGS,
  MAX_REVIEWERS,
  pipelinePhases,
  problemCodes,
  reportCategoryNames,
} from "@pagehall/server";
import { z } from "zod";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";
import { spaceGrantSchema, visibilitySchema } from "../spaces/schemas.js";

const ID = (n: number) => `01929b1e-7c3a-7d2e-9f4b-3c2d1e0f${String(n).padStart(4, "0")}`;

export const sourceSchema = extensibleEnum(
  importSources,
  "Format of the export: `confluence-xml` for the XML space export of Confluence Cloud or Data Center, `confluence-csv` for the CSV space export of Confluence Cloud.",
);

const stateSchema = extensibleEnum(
  importStates,
  "State of the import. `draft` while the wizard is filled in, `analyzing` while the export is read, `ready` when it can be started, `running` while it imports, `held` when the importing administrator lost the permission and another administrator has to take over, `stopping` and `discarding` while the quarantine space is deleted, `review` when the quarantine space waits for a decision, `accepted`, `discarded`, `stopped` and `failed` at the end.",
);

const phaseSchema = extensibleEnum(
  ["read", ...pipelinePhases, "done"] as const,
  "Step the import is in: `read` reads the export, then `space`, `people`, `pages`, `attachments`, `content`, `comments`, `reactions`, `permissions` and `finish`; `done` after the last step.",
);

const personSchema = z
  .object({ id: uuid("ID of the account."), name: z.string().describe("Name of the person.") })
  .describe("A person.");

export const importSchema = z
  .object({
    id: uuid("ID of the import."),
    organizationId: uuid("Organization the import belongs to."),
    importer: personSchema.describe("The administrator who imports."),
    source: sourceSchema,
    state: stateSchema,
    draftStep: z.number().int().describe("Step of the wizard the importer was on, for continuing a draft."),
    file: z
      .object({
        kind: extensibleEnum(["upload", "folder"], "Where the export comes from."),
        name: z.string().describe("Name of the file."),
        size: z.number().int().nullable().describe("Size in bytes, or null when not known yet."),
        uploadId: uuid("ID of the upload, or null for a file in the import folder.").nullable(),
        complete: z.boolean().describe("Whether the file is complete and can be read."),
      })
      .nullable()
      .describe("The export file, or null when none is chosen yet."),
    spaceName: z.string().nullable().describe("Name of the new space."),
    spaceKey: z.string().nullable().describe("Key of the new space."),
    archived: z.boolean().describe("Whether the space becomes archived when the import is accepted."),
    history: z
      .boolean()
      .describe(
        "Whether every Confluence version becomes a Pagehall version, or only the current state is imported.",
      ),
    peopleSource: z
      .object({
        kind: extensibleEnum(
          ["token", "list", "skip"],
          "How people are recognized: `token` reads names and e-mail addresses with a read-only Atlassian API token, `list` uses a user list exported from the Atlassian administration, `skip` keeps every author as a placeholder.",
        ),
        site: z.string().nullable().describe("Confluence site the token is used with, or null."),
        email: z.string().nullable().describe("Atlassian e-mail address the token belongs to, or null."),
        people: z
          .number()
          .int()
          .nullable()
          .describe(
            "People of the export the token could read, or people in the user list; null when unknown.",
          ),
        withEmail: z.number().int().nullable().describe("Of these, people with a visible e-mail address."),
      })
      .nullable()
      .describe("How people are recognized. The token itself is never returned."),
    tokenDeletedAt: timestamp(
      "When the API token was deleted: when the import was accepted, discarded, stopped or failed.",
    ).nullable(),
    sourceUrl: z
      .string()
      .nullable()
      .describe("Address of the Confluence site. Links to pages outside the export point there."),
    reviewers: z.array(personSchema).describe("People who can read the quarantine space and the report."),
    phase: phaseSchema.nullable(),
    progress: z
      .object({
        done: z.number().int().describe("Units done in the current step."),
        total: z.number().int().describe("Units of the current step, or 0 when not known."),
      })
      .describe("Progress of the current step."),
    found: z
      .object({
        pages: z.number().int().describe("Pages in the export."),
        blogPosts: z.number().int().describe("Blog posts in the export."),
        versions: z.number().int().describe("Earlier versions of pages and blog posts."),
        comments: z.number().int().describe("Comments, including inline comments and replies."),
        likes: z.number().int().describe("Likes on pages, blog posts and comments."),
        watchers: z
          .number()
          .int()
          .describe("Watchers of pages and the space. They are counted, not imported."),
        attachments: z.number().int().describe("Attachments of these pages."),
        attachmentBytes: z.number().int().describe("Size of the current attachment versions in bytes."),
        people: z.number().int().describe("People named in the export."),
        macroKinds: z.number().int().describe("Different macros used on the pages."),
        spaceKey: z.string().describe("Key of the space in Confluence."),
        spaceName: z.string().describe("Name of the space in Confluence."),
      })
      .nullable()
      .describe("What the export contains, once it was read."),
    counts: z
      .record(z.string(), z.number().int())
      .describe(
        "What was imported, by kind: `pages`, `blogPosts`, `versions`, `attachments`, `attachmentVersions`, `comments`, `inlineAnchored`, `inlineMoved`, `likes`, `watchers`, `people`, `peopleMatched`, `restrictions`, `groupsMissing` and `problems`.",
      ),
    errorCode: z
      .string()
      .nullable()
      .describe(
        "Why the export could not be read or the import failed, such as `notAnArchive`, `wrongFormat`, `archiveTooLarge`, `unsafeEntryName`, `xmlDeclaration` or `internalError`.",
      ),
    quarantineSpace: z
      .object({ id: uuid("ID of the space."), key: z.string().describe("Key of the space.") })
      .nullable()
      .describe("The space the import writes into."),
    canManage: z
      .boolean()
      .describe("Whether the caller can change, start, stop, accept or discard the import."),
    canResolve: z
      .boolean()
      .describe("Whether the caller can map people and groups of the import or apply a user list."),
    canTakeOver: z.boolean().describe("Whether the caller can take over a held import."),
    startedAt: timestamp("When the import started.").nullable(),
    finishedAt: timestamp("When the import finished or failed.").nullable(),
    decidedAt: timestamp("When the import was accepted, discarded or stopped.").nullable(),
    fileExpiresAt: timestamp("When an uploaded file is deleted.").nullable(),
    createdAt: timestamp("When the import was created."),
    updatedAt: timestamp("When the import last changed."),
  })
  .describe("An import of a Confluence space.");

export const exampleImport = {
  id: ID(1),
  organizationId: ID(2),
  importer: { id: ID(3), name: "Alex Admin" },
  source: "confluence-xml",
  state: "review",
  draftStep: 3,
  file: { kind: "upload", name: "export.zip", size: 1048576, uploadId: ID(4), complete: true },
  spaceName: "IT Operations",
  spaceKey: "ITOPS",
  archived: false,
  sourceUrl: "https://example.atlassian.net/wiki",
  reviewers: [{ id: ID(5), name: "Robin Reviewer" }],
  phase: null,
  progress: { done: 0, total: 0 },
  found: {
    pages: 120,
    blogPosts: 6,
    versions: 340,
    comments: 85,
    likes: 30,
    watchers: 44,
    attachments: 40,
    attachmentBytes: 2048000,
    people: 12,
    macroKinds: 6,
    spaceKey: "ITOPS",
    spaceName: "IT Operations",
  },
  history: false,
  peopleSource: {
    kind: "token",
    site: "example.atlassian.net",
    email: "alex@example.com",
    people: 12,
    withEmail: 10,
  },
  tokenDeletedAt: null,
  counts: {
    pages: 120,
    blogPosts: 6,
    attachments: 40,
    attachmentVersions: 52,
    comments: 85,
    people: 12,
    problems: 7,
  },
  errorCode: null,
  quarantineSpace: { id: ID(6), key: "ITOPS" },
  canManage: true,
  canResolve: true,
  canTakeOver: false,
  startedAt: "2026-10-10T08:00:00.000Z",
  finishedAt: "2026-10-10T08:05:00.000Z",
  decidedAt: null,
  fileExpiresAt: null,
  createdAt: "2026-10-10T07:50:00.000Z",
  updatedAt: "2026-10-10T08:05:00.000Z",
};

export const importListSchema = z.array(importSchema).describe("Imports, newest first.");

export const createImportSchema = z.object({ source: sourceSchema }).strict().describe("A new import draft.");

export const updateImportSchema = z
  .object({
    source: sourceSchema.optional(),
    draftStep: z.number().int().min(0).max(10).optional().describe("Step of the wizard to continue on."),
    file: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("upload").describe("A file uploaded in parts."),
            uploadId: uuid("ID of an upload of the caller. Reading starts once the upload is complete."),
          })
          .strict(),
        z
          .object({
            kind: z.literal("folder").describe("A file in the import folder of the server."),
            name: z
              .string()
              .min(1)
              .max(255)
              .describe("Name of a file directly inside this organization's subfolder of the import folder."),
          })
          .strict(),
      ])
      .nullable()
      .optional()
      .describe("The export file. Choosing a file starts reading it."),
    spaceName: z.string().max(200).optional().describe("Name of the new space, 1 to 100 characters."),
    spaceKey: z.string().max(20).optional().describe("Key of the new space, 2 to 10 letters or digits."),
    archived: z.boolean().optional().describe("Whether the space becomes archived when accepted."),
    history: z
      .boolean()
      .optional()
      .describe("Whether every Confluence version becomes a Pagehall version. Takes noticeably longer."),
    sourceUrl: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe("Address of the Confluence site, such as `https://example.atlassian.net/wiki`."),
  })
  .strict()
  .describe("Changes to an import that has not started yet.");

export const reviewersSchema = z
  .object({
    accountIds: z
      .array(uuid("ID of a member of the organization."))
      .max(MAX_REVIEWERS)
      .describe("All reviewers. People who are left out lose access to the quarantine space at once."),
  })
  .strict()
  .describe("The reviewers of an import.");

export const confirmationSchema = z
  .object({
    confirmation: z.string().max(20).describe("The key of the space, typed by the person to confirm."),
  })
  .strict()
  .describe("Confirmation of an action that cannot be undone.");

export const acceptSchema = z
  .object({
    visibility: visibilitySchema,
    grants: z
      .array(spaceGrantSchema)
      .max(100)
      .describe("Roles in the space. The importing administrator always becomes space admin in addition."),
  })
  .strict()
  .describe("Who gets access when the import is accepted.");

export const reportSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            category: extensibleEnum(
              reportCategoryNames as [string, ...string[]],
              "Area of the problem: `macros`, `attachments`, `links`, `content`, `comments` or `archive`.",
            ),
            code: extensibleEnum(problemCodes as [string, ...string[]], "Kind of problem."),
            count: z.number().int().describe("Number of entries."),
          })
          .describe("Entries of one kind."),
      )
      .describe("Entries per kind."),
    total: z.number().int().describe("Number of all entries."),
    placeholders: z.number().int().describe("People who are still placeholders."),
    mapped: z.number().int().describe("Placeholders mapped to accounts."),
    permissionsToCheck: z
      .number()
      .int()
      .describe("Permission entries that did not map exactly or wait for a person or group."),
    groupsMissing: z.number().int().describe("Confluence groups without a group in Pagehall."),
  })
  .describe("Summary of the report of an import.");

export const reportEntriesSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid("ID of the entry."),
            category: z.string().describe("Area of the problem."),
            code: z.string().describe("Kind of problem."),
            item: z
              .object({ id: uuid("ID of the page."), title: z.string().describe("Title of the page.") })
              .nullable()
              .describe(
                "The affected page, or null when the problem concerns the export as a whole or a page the caller cannot read.",
              ),
            restricted: z
              .boolean()
              .describe("True when the problem concerns a page the caller cannot read; `item` is then null."),
            details: z
              .record(z.string(), z.unknown())
              .describe("Facts of the problem, such as `name` of a macro or `fileName` of an attachment."),
          })
          .describe("A report entry."),
      )
      .describe("Entries in the order they were found."),
    nextCursor: z.string().nullable().describe("Cursor of the next page, or null on the last page."),
  })
  .describe("A page of report entries.");

export const macrosSchema = z
  .array(
    z
      .object({
        name: z.string().describe("Name of the macro in Confluence."),
        pages: z.number().int().describe("Number of pages that use it."),
        occurrences: z.number().int().describe("Number of uses."),
      })
      .describe("A macro that is not converted yet."),
  )
  .describe("Macros kept with their original data, most used first.");

export const folderSchema = z
  .object({
    enabled: z.boolean().describe("Whether the instance allows imports from the import folder."),
    path: z
      .string()
      .describe(
        "Folder on the server for this organization's exports: the subfolder named after the organization's slug inside the import folder. It changes when the slug changes.",
      ),
    files: z
      .array(
        z
          .object({
            name: z.string().describe("Name of the file."),
            size: z.number().int().describe("Size in bytes."),
            modifiedAt: timestamp("When the file last changed."),
          })
          .describe("A file in the import folder."),
      )
      .describe("Regular files directly inside this organization's subfolder of the import folder."),
    maxUploadBytes: z
      .number()
      .int()
      .describe(
        "Largest file that can be uploaded from the browser; instance administrators can raise it, or larger exports go through the import folder.",
      ),
  })
  .describe("Files in this organization's subfolder of the import folder.");

export const uploadSchema = z
  .object({
    id: uuid("ID of the upload."),
    name: z.string().describe("Name of the file."),
    size: z.number().int().describe("Size of the whole file in bytes."),
    partSize: z.number().int().describe("Size of every part but the last in bytes."),
    partCount: z.number().int().describe("Number of parts."),
    parts: z
      .array(
        z
          .object({
            number: z.number().int().describe("Number of the part."),
            size: z.number().int().describe("Size in bytes."),
          })
          .describe("A part the server stored."),
      )
      .describe("Parts already stored, for continuing an interrupted upload."),
    complete: z.boolean().describe("Whether all parts arrived and the checksum matched."),
    expiresAt: timestamp("When the upload is deleted unless an import uses it."),
  })
  .describe("An upload of an export in parts.");

export const createUploadSchema = z
  .object({
    name: z.string().min(1).max(1000).describe("Name of the file."),
    size: z.number().int().min(1).describe("Size of the file in bytes."),
  })
  .strict()
  .describe("A new upload.");

export const completeUploadSchema = z
  .object({
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe(
        "SHA-256 over the hexadecimal SHA-256 values of all parts, joined in order. The server reads every stored part again and compares.",
      ),
  })
  .strict()
  .describe("Completion of an upload.");

export const exampleUpload = {
  id: ID(4),
  name: "export.zip",
  size: 20971520,
  partSize: 16777216,
  partCount: 2,
  parts: [{ number: 1, size: 16777216 }],
  complete: false,
  expiresAt: "2026-10-17T08:00:00.000Z",
};

export const candidatesSchema = z.array(personSchema).describe("Members who can review imports.");

export const peopleSourceSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z
          .literal("token")
          .describe("Read names and e-mail addresses with a read-only Atlassian API token."),
        site: z
          .string()
          .max(300)
          .describe(
            "Confluence Cloud site, such as `example.atlassian.net`. Other hosts work only when the instance administrator allowed them.",
          ),
        email: z.string().max(320).describe("E-mail address of the Atlassian account the token belongs to."),
        token: z
          .string()
          .max(1000)
          .describe(
            "The API token. It is checked at once, stored encrypted and deleted when the import ends.",
          ),
      })
      .strict(),
    z
      .object({
        kind: z.literal("skip").describe("Keep every author as a placeholder named by an Atlassian ID."),
        confirmed: z
          .boolean()
          .describe("Must be true: the administrator confirms that authors become placeholders."),
      })
      .strict(),
  ])
  .describe("How the import recognizes people. A user list is sent to its own endpoint.");

export const userListResultSchema = z
  .object({
    matched: z.number().int().describe("Placeholders mapped by e-mail address."),
    named: z.number().int().describe("Placeholders that got a name from the list."),
    remaining: z.number().int().describe("Placeholders that remain."),
  })
  .describe("What a user list resolved.");

const roleSchema = extensibleEnum(
  ["reader", "commenter", "editor", "admin"],
  "Role in the space: `reader`, `commenter`, `editor` or `admin` (space admin).",
);

export const placeholdersSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid("ID of the placeholder account."),
            name: z.string().describe("Best name known, or the Atlassian ID when no name is known."),
            externalId: z.string().describe("Atlassian account ID or Confluence user key."),
            email: z.string().nullable().describe("E-mail address known from the user source, or null."),
            named: z.boolean().describe("Whether a name is known."),
            items: z.number().int().describe("Pages and blog posts the person created in this import."),
            comments: z.number().int().describe("Comments the person wrote in this import."),
            restrictedPages: z.number().int().describe("Restricted pages the person may open."),
            spaceRole: roleSchema
              .nullable()
              .describe("Role the person had in the Confluence space, or null."),
            mappedTo: personSchema.nullable().describe("The account the placeholder was mapped to, or null."),
            candidates: z
              .array(personSchema)
              .describe("Members with a similar name, offered for confirmation. Never mapped automatically."),
          })
          .describe("A person of the export without an account."),
      )
      .describe("Placeholders, those still open first."),
    total: z.number().int().describe("Number of all placeholders of the import."),
    mapped: z.number().int().describe("Number of placeholders mapped to accounts."),
    nextCursor: z.string().nullable().describe("Cursor of the next page, or null on the last page."),
  })
  .describe("People of an import that became placeholders.");

export const mappingsSchema = z
  .object({
    mappings: z
      .array(
        z
          .object({
            placeholderId: uuid("ID of the placeholder."),
            accountId: uuid("ID of an active member of the organization."),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_MAPPINGS)
      .describe("Placeholders and the accounts they become. All are applied together or none."),
  })
  .strict()
  .describe("Mappings of placeholders to accounts.");

export const importGroupSchema = z
  .object({
    key: z.string().describe("Lower-case name of the group in Confluence, used in the address."),
    name: z.string().describe("Name of the group in Confluence."),
    group: z
      .object({ id: uuid("ID of the group."), name: z.string().describe("Name of the group.") })
      .nullable()
      .describe("The group of the organization it is mapped to, or null."),
    spaceRole: roleSchema.nullable().describe("Role the group had in the Confluence space, or null."),
    restrictedPages: z.number().int().describe("Restricted pages the group may open."),
  })
  .describe("A group named in the export.");

export const importGroupsSchema = z
  .array(importGroupSchema)
  .describe("Groups named in the export, unmapped first.");

export const mapGroupSchema = z
  .union([
    z.object({ groupId: uuid("ID of an existing group of the organization.") }).strict(),
    z
      .object({ create: z.literal(true).describe("Create a local group with the name from Confluence.") })
      .strict(),
  ])
  .describe("The group a Confluence group becomes.");

export const permissionEntriesSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid("ID of the entry."),
            scope: extensibleEnum(
              ["space", "page"],
              "Whether the entry is a space permission or a page restriction.",
            ),
            item: z
              .object({
                id: uuid("ID of the page."),
                title: z
                  .string()
                  .nullable()
                  .describe("Title of the page, or null when the caller cannot read it."),
              })
              .nullable()
              .describe("The restricted page, or null for space permissions."),
            restriction: extensibleEnum(["view", "edit"], "Kind of page restriction.").nullable(),
            holder: z
              .object({
                kind: extensibleEnum(
                  ["account", "group", "organizationMembers", "anonymous"],
                  "Who held the permission: a person, a group, all signed-in users or anonymous visitors.",
                ),
                id: uuid("ID of the account or group in Pagehall.").nullable(),
                name: z.string().nullable().describe("Name in Pagehall, or null."),
                sourceName: z.string().nullable().describe("Name of the group in Confluence, or null."),
              })
              .describe("The holder of the permission."),
            role: roleSchema.nullable().describe("Role in Pagehall, or null when nothing is taken over."),
            permissions: z
              .array(z.string())
              .describe("Confluence permissions of the holder, such as `VIEWSPACE`."),
            status: extensibleEnum(
              ["mapped", "check", "missing", "notTaken", "waiting"],
              "`mapped` fits exactly, `check` differs from Confluence, `missing` waits for a group, `waiting` waits for a person to be mapped, `notTaken` is not taken over.",
            ),
            code: z
              .string()
              .nullable()
              .describe(
                "Why the entry needs attention: `widened`, `narrowed`, `withoutView`, `anonymous`, `groupMissing`, `placeholder` or `withoutSpaceRole` (named in a restriction without a role in the space).",
              ),
          })
          .describe("A permission taken from Confluence."),
      )
      .describe("Permission entries in the order they were found."),
    nextCursor: z.string().nullable().describe("Cursor of the next page, or null on the last page."),
  })
  .describe("Permissions of the import.");

export const proposedAccessSchema = z
  .object({
    visibility: visibilitySchema,
    grants: z
      .array(
        spaceGrantSchema
          .extend({ name: z.string().nullable().describe("Name of the person or group, or null.") })
          .describe("A role for a holder, with the holder's name."),
      )
      .describe("Roles taken from Confluence for people and groups that exist in Pagehall."),
    pending: z
      .number()
      .int()
      .describe("Imported roles that wait for a person or group to be mapped; they apply when it is mapped."),
  })
  .describe("Who gets access when the import is accepted, as imported from Confluence.");
