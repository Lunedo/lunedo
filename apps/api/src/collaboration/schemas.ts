import {
  ANCHOR_CONTEXT_LENGTH,
  cleanLabel,
  contentLabelSorts,
  DEFAULT_CONTENT_BY_LABEL_LIMIT,
  DEFAULT_PAGE_REPORT_LIMIT,
  DEFAULT_PROPERTIES_REPORT_PAGE_SIZE,
  decisionReportOrders,
  EXCERPT_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  labeledContentKinds,
  MAX_CONTENT_BY_LABEL_LIMIT,
  MAX_DECISION_REPORT_PAGE,
  MAX_EXCERPT_NAME_LENGTH,
  MAX_FILTER_LABELS,
  MAX_FILTER_PAGES,
  MAX_FILTER_SPACES,
  MAX_PAGE_REPORT_LIMIT,
  MAX_PROPERTIES_REPORT_COLUMNS,
  MAX_PROPERTIES_REPORT_PAGE_SIZE,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_SET_ID_LENGTH,
  MAX_QUOTE_LENGTH,
  pageReportSorts,
  taskReportDueWindows,
  taskReportStatuses,
  treeItemKinds,
} from "@lunedo/server";
import { z } from "zod";
import { extensibleEnum, inputTimestamp, pictureRefField, timestamp, uuid } from "../http/schemas.js";
import { documentSchema, exampleItem, exampleSpace, pageReferencesSchema } from "../spaces/schemas.js";

const person = (description: string) =>
  z
    .object({
      id: uuid("Account ID."),
      name: z.string().nullable().describe("Name, or null when the caller may not see the person."),
    })
    .describe(description);

const personWithPicture = (description: string) =>
  z
    .object({
      id: uuid("Account ID."),
      name: z.string().nullable().describe("Name, or null when the caller may not see the person."),
      pictureRef: pictureRefField,
    })
    .describe(description);

export const commentBodySchema = z
  .json()
  .describe(
    "Comment content as ProseMirror JSON with the reduced comment schema: paragraphs with bold, italic, underline, strike, subscript, superscript, inline code and links, mentions, bullet and numbered lists and code blocks. No tables, images or headings.",
  );

export const exampleCommentBody = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Happened twice this week." }] }],
};

export const reactionSchema = z
  .object({
    emoji: z.string().describe("The emoji."),
    count: z.number().int().describe("How many people reacted with it."),
    reacted: z.boolean().describe("Whether the caller reacted with it."),
    people: z
      .array(z.object({ id: uuid("Account ID."), name: z.string().describe("Name.") }).describe("A person."))
      .describe("The first 20 people who reacted, in order."),
  })
  .describe("One emoji with the people who reacted with it.");

const commentShape = {
  id: uuid("ID of the comment."),
  itemId: uuid("Page or blog post the comment belongs to."),
  parentId: uuid("The comment this replies to, or null for a new thread.").nullable(),
  author: personWithPicture("Author, or null for a deleted comment.").nullable(),
  body: commentBodySchema.nullable().describe("Content, or null for a deleted comment."),
  deleted: z
    .boolean()
    .describe("Whether the comment was deleted. A deleted comment with replies stays as a placeholder."),
  createdAt: timestamp("When the comment was written."),
  editedAt: timestamp("When the author last changed it, or null.").nullable(),
  reactions: z.array(reactionSchema).describe("Reactions, empty when reactions are turned off."),
};

export const commentSchema = z.object(commentShape).describe("A reply.");

export const threadSchema = z
  .object({
    ...commentShape,
    quote: z
      .string()
      .nullable()
      .describe(
        "For inline comments, the text the comment refers to; for comments on a whiteboard element, the text of the element (possibly empty). Readers see inline comments only once their text is published.",
      ),
    anchor: extensibleEnum(
      ["page", "inline", "element", "detached"],
      "`page` for a comment on the whole page or whiteboard, `inline` for a comment on text in it, `element` for a comment on an element of a whiteboard, `detached` for a comment whose text or element no longer exists. Detached comments are listed with the page comments.",
    ),
    elementId: z
      .string()
      .nullable()
      .describe("The whiteboard element the comment refers to, also after it was removed, or null."),
    resolvedAt: timestamp("When the inline comment was resolved, or null while it is open.").nullable(),
    resolvedBy: personWithPicture("Who resolved it, or null.").nullable(),
    replies: z.array(commentSchema).describe("Replies, oldest first. Replies are one level deep."),
  })
  .describe("A comment with its replies.");

export const commentListSchema = z
  .object({
    threads: z.array(threadSchema).describe("Threads, oldest first."),
    people: z
      .record(z.string(), z.string().describe("Name of the person."))
      .describe("Names of people mentioned in the comments that the caller may see, by account ID."),
  })
  .describe("Comments of a page.");

export const exampleThread = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b01",
  itemId: exampleItem.id,
  parentId: null,
  author: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Lukas Hofer", pictureRef: null },
  body: exampleCommentBody,
  deleted: false,
  createdAt: "2026-10-06T08:00:00.000Z",
  editedAt: null,
  reactions: [],
  quote: "Hotel Wi-Fi blocks UDP 51820",
  anchor: "inline",
  elementId: null,
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
};

export const anchorSchema = z
  .object({
    exact: z
      .string()
      .min(1)
      .max(MAX_QUOTE_LENGTH)
      .describe(`The selected text, up to ${MAX_QUOTE_LENGTH} characters within one paragraph.`),
    prefix: z
      .string()
      .max(ANCHOR_CONTEXT_LENGTH)
      .default("")
      .describe(
        `Up to ${ANCHOR_CONTEXT_LENGTH} characters directly before the selection in the same paragraph.`,
      ),
    suffix: z
      .string()
      .max(ANCHOR_CONTEXT_LENGTH)
      .default("")
      .describe(
        `Up to ${ANCHOR_CONTEXT_LENGTH} characters directly after the selection in the same paragraph.`,
      ),
  })
  .strict()
  .describe(
    "Text an inline comment refers to. Text nodes count; mentions, page links, dates and other inline elements do not. Commenters select text of the published version; the comment mark goes into the draft at the same text.",
  );

export const createCommentSchema = z
  .object({
    body: commentBodySchema,
    anchor: anchorSchema.optional().describe("Text the comment refers to. Leave it out for a page comment."),
    elementId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional()
      .describe("ID of the whiteboard element the comment refers to. Only for whiteboards."),
  })
  .strict()
  .describe("A new comment.");

export const commentInputSchema = z.object({ body: commentBodySchema }).strict().describe("Comment content.");

export const createdSchema = z.object({ id: uuid("ID of the new comment.") }).describe("The new comment.");

export const resolveSchema = z
  .object({ resolved: z.boolean().describe("True to resolve the inline comment, false to reopen it.") })
  .strict()
  .describe("Resolved state.");

export const reactionsSchema = z
  .object({
    enabled: z.boolean().describe("Whether reactions are turned on for the page's space."),
    reactions: z.array(reactionSchema).describe("Reactions on the page."),
  })
  .describe("Reactions on a page or blog post.");

export const mentionAccessSchema = z
  .array(
    z
      .object({
        accountId: uuid("The mentioned account."),
        hasAccess: z.boolean().describe("Whether the person can read the page and would be notified."),
      })
      .describe("Access of a mentioned person."),
  )
  .describe("Access of the mentioned people.");

export const taskStatusSchema = z
  .object({
    id: uuid("ID of the task, as in the `id` attribute of the task item."),
    done: z.boolean().describe("Whether the task is done."),
    changedAt: timestamp("When the status last changed, or null.").nullable(),
    changedBy: person("Who changed it last, or null.").nullable(),
  })
  .describe("Status of a task.");

export const setTaskStatusSchema = z
  .object({ done: z.boolean().describe("True for done, false for open.") })
  .strict()
  .describe("The new status. Setting the current status again changes nothing.");

const contentReferenceShape = {
  id: uuid("ID of the page or blog post."),
  kind: extensibleEnum(treeItemKinds, "Kind of the item."),
  title: z.string().describe("Title readers see."),
  spaceId: uuid("Space of the item."),
  spaceKey: z.string().describe("Key of that space."),
  spaceName: z.string().describe("Name of that space."),
};

export const contentReferenceSchema = z.object(contentReferenceShape).describe("A page or blog post.");

export const taskEntrySchema = z
  .object({
    id: uuid("ID of the task."),
    text: z.string().describe("Text of the task, without formatting, up to 500 characters."),
    done: z.boolean().describe("Whether the task is done."),
    dueDate: z.string().nullable().describe("Due date as `YYYY-MM-DD`, or null."),
    overdue: z
      .boolean()
      .describe("Whether the task is open and its due date lies before today in the caller's time zone."),
    assignee: z
      .object({ id: uuid("Account ID."), name: z.string().describe("Name.") })
      .nullable()
      .describe("The assignee, or null."),
    item: z
      .object({
        id: uuid("Page or blog post with the task."),
        kind: extensibleEnum(["page", "blogPost"], "Kind of that item."),
        title: z.string().describe("Its title."),
        spaceId: uuid("Its space."),
        spaceKey: z.string().describe("Key of the space."),
        spaceName: z.string().describe("Name of the space."),
      })
      .describe("Where the task is."),
  })
  .describe("A task from published content.");

export const exampleTask = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5c01",
  text: "Add the fallback over TCP 443 for hotels",
  done: false,
  dueDate: "2026-10-17",
  overdue: false,
  assignee: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Lukas Hofer" },
  item: {
    id: exampleItem.id,
    kind: "page",
    title: exampleItem.title,
    spaceId: exampleSpace.id,
    spaceKey: "ITOPS",
    spaceName: "IT Operations",
  },
};

export const taskListSchema = z
  .object({
    items: z.array(taskEntrySchema).describe("Tasks sorted by due date, tasks without one last."),
    counts: z
      .object({
        open: z.number().int().describe("Open tasks that match the filters other than the status."),
        done: z.number().int().describe("Done tasks that match the filters other than the status."),
        overdue: z.number().int().describe("Open tasks among them that are overdue."),
      })
      .describe("Counts over all pages of the result."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Tasks.");

export const taskQuerySchema = z
  .object({
    assignee: z
      .union([z.literal("me"), uuid("Account ID.")])
      .optional()
      .describe("`me` for the caller's tasks, or an account ID. Leave it out for everyone."),
    spaceId: uuid("Only tasks in this space.").optional(),
    seriesId: uuid(
      "Only tasks written in the meetings of this meeting series. Meetings that were skipped are left out.",
    ).optional(),
    pageIds: pageIdList("Only tasks on these pages and their descendants."),
    labels: labelList("Only tasks on pages with at least one of these labels."),
    status: z.enum(taskReportStatuses).default("open").describe("`open` (default), `done` or `all`."),
    due: z
      .enum(taskReportDueWindows)
      .default("any")
      .describe(
        "`any` (default), `overdue`, `next7Days` and `next30Days` (including overdue ones) or `none` for tasks without a due date.",
      ),
    cursor: z.string().max(200).optional().describe("Cursor from `nextCursor` of the previous page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .describe("Maximum number of tasks, 1 to 200."),
  })
  .strict();

export const blogPostSchema = z
  .object({
    id: uuid("ID of the blog post."),
    spaceId: uuid("Space of the post."),
    spaceKey: z.string().describe("Key of that space."),
    spaceName: z.string().describe("Name of that space."),
    title: z.string().describe("Title as readers see it."),
    excerpt: z.string().describe("Short summary shown in lists."),
    labels: z.array(z.string().describe("A label.")).describe("Labels, sorted."),
    author: person("Who wrote the post, or null.").nullable(),
    published: z
      .boolean()
      .describe("Whether the post was published. Unpublished posts are visible only to editors."),
    publishedAt: timestamp("When the post was first published, or null.").nullable(),
    scheduledAt: timestamp("When the post will be published, or null.").nullable(),
    scheduledTimeZone: z.string().nullable().describe("Time zone the author scheduled it in, or null."),
    scheduledBy: person("Who scheduled the publication, or null.").nullable(),
    held: z
      .boolean()
      .describe(
        "Whether the scheduled publication is waiting for a space admin because the person who scheduled it can no longer edit the post.",
      ),
    pinnedInSpace: z.boolean().describe("Whether the post is pinned at the top of its space's blog."),
    pinnedInOrganization: z
      .boolean()
      .describe("Whether the post is pinned in the organization's blog overview."),
    cover: z
      .object({
        attachmentId: uuid("The image attachment."),
        focusX: z.number().describe("Horizontal focal point from 0 (left) to 1 (right)."),
        focusY: z.number().describe("Vertical focal point from 0 (top) to 1 (bottom)."),
      })
      .nullable()
      .describe("Cover image with the point that stays visible in every crop, or null."),
    createdAt: timestamp("When the post was created."),
  })
  .describe("A blog post.");

export const exampleBlogPost = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5d01",
  spaceId: exampleSpace.id,
  spaceKey: "ITOPS",
  spaceName: "IT Operations",
  title: "New VPN client from Monday",
  excerpt: "The company portal ships WireGuard 0.6 on Monday.",
  labels: ["vpn"],
  author: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  published: true,
  publishedAt: "2026-10-06T07:00:00.000Z",
  scheduledAt: null,
  scheduledTimeZone: null,
  scheduledBy: null,
  held: false,
  pinnedInSpace: false,
  pinnedInOrganization: true,
  cover: { attachmentId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40", focusX: 0.5, focusY: 0.3 },
  createdAt: "2026-10-05T15:00:00.000Z",
};

export const blogPageSchema = z
  .object({
    items: z.array(blogPostSchema).describe("Posts: pinned ones first, then the newest."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Blog posts.");

export const blogQuerySchema = z
  .object({
    cursor: z.string().max(500).optional().describe("Cursor from `nextCursor` of the previous page."),
    limit: z.coerce.number().int().min(1).max(100).default(30).describe("Maximum number of posts, 1 to 100."),
  })
  .strict();

export const organizationBlogQuerySchema = blogQuerySchema
  .extend({
    spaceId: uuid("Only posts of this space.").optional(),
    label: z.string().max(100).optional().describe("Only posts with this label."),
  })
  .strict();

export const createBlogPostSchema = z
  .object({
    title: z.string().max(ITEM_TITLE_MAX_LENGTH).describe("Title, 1 to 255 characters."),
    excerpt: z
      .string()
      .max(EXCERPT_MAX_LENGTH)
      .optional()
      .describe(`Summary, up to ${EXCERPT_MAX_LENGTH} characters.`),
  })
  .strict()
  .describe("A new blog post. It starts as a draft visible to editors.");

export const updateBlogPostSchema = z
  .object({
    excerpt: z
      .string()
      .max(EXCERPT_MAX_LENGTH)
      .optional()
      .describe(`Summary, up to ${EXCERPT_MAX_LENGTH} characters.`),
  })
  .strict()
  .describe("Changes to a blog post. Change the title through the item endpoint.");

export const scheduleSchema = z
  .object({
    at: inputTimestamp("When to publish, in the future and at most a year ahead."),
    timeZone: z
      .string()
      .max(100)
      .describe("IANA time zone the author chose the time in, such as `Europe/Vienna`."),
  })
  .strict()
  .describe("When to publish the post. A background job publishes it once at that time.");

export const pinSchema = z
  .object({ pinned: z.boolean().describe("True to pin, false to unpin.") })
  .strict()
  .describe("Pinned state.");

export const starredSchema = z
  .object({
    items: z
      .array(
        z
          .object({ ...contentReferenceShape, starredAt: timestamp("When it was starred.") })
          .describe("A starred page or post."),
      )
      .describe("Starred pages and blog posts the caller can read, newest first."),
    spaces: z
      .array(
        z
          .object({
            id: uuid("ID of the space."),
            key: z.string().describe("Key of the space."),
            name: z.string().describe("Name of the space. Empty for a personal space without a name."),
            personal: z.boolean().describe("Whether it is a personal space."),
            starredAt: timestamp("When it was starred."),
          })
          .describe("A starred space."),
      )
      .describe("Starred spaces the caller can read, newest first."),
  })
  .describe("What the caller starred.");

export const recentSchema = z
  .array(
    z
      .object({ ...contentReferenceShape, viewedAt: timestamp("When the caller last viewed it.") })
      .describe("A recently viewed item."),
  )
  .describe("Items the caller viewed in the last 90 days, newest first. Only the caller sees this list.");

export const mentionSchema = z
  .object({
    id: uuid("ID of the mention."),
    item: contentReferenceSchema,
    commentId: uuid("The comment with the mention, or null for a mention in the content.").nullable(),
    actor: z
      .object({ id: uuid("Account ID."), name: z.string().describe("Name.") })
      .nullable()
      .describe("Who mentioned the caller, or null."),
    at: timestamp("When the mention became visible and notified the caller."),
  })
  .describe("A mention of the caller.");

export const forYouSchema = z
  .object({
    recent: recentSchema,
    starred: starredSchema,
    tasks: z.array(taskEntrySchema).describe("The caller's open tasks due in the next 7 days or overdue."),
    mentions: z.array(mentionSchema).describe("The latest mentions of the caller."),
    posts: z.array(blogPostSchema).describe("Blog posts of the last 30 days in spaces the caller can read."),
  })
  .describe("Data of the personal home page.");

export const homePageSchema = z
  .object({
    page: contentReferenceSchema
      .nullable()
      .describe("The organization home page, or null when none is set or the caller cannot read it."),
  })
  .describe("The organization home page.");

export const setHomePageSchema = z
  .object({
    itemId: uuid("A page in a space of the organization, or null for none.").nullable(),
  })
  .strict()
  .describe("The new organization home page.");

export function pageIdList(description: string) {
  return z
    .string()
    .max(800)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(uuid("Page ID.")).max(MAX_FILTER_PAGES))
    .optional()
    .describe(`${description} Up to ${MAX_FILTER_PAGES} page IDs, separated by commas.`);
}

export function labelList(description: string) {
  return z
    .string()
    .max(2100)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(
      z
        .array(
          z
            .string()
            .refine((label) => cleanLabel(label) === label, "Expected a lowercase label without spaces")
            .describe("A label."),
        )
        .max(MAX_FILTER_LABELS),
    )
    .optional()
    .describe(`${description} Up to ${MAX_FILTER_LABELS} labels, separated by commas.`);
}

export const pageReportQuerySchema = z
  .object({
    spaceId: uuid("Only pages in this space. Leave it out for every space the caller can read.").optional(),
    labels: labelList("Only pages with at least one of these labels."),
    sort: z
      .enum(pageReportSorts)
      .default("modified")
      .describe("`modified` (default) or `created`, newest first, or `title` from A to Z."),
    reverse: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true")
      .describe("`true` reverses the order."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_REPORT_LIMIT)
      .default(DEFAULT_PAGE_REPORT_LIMIT)
      .describe(`Maximum number of pages, 1 to ${MAX_PAGE_REPORT_LIMIT}.`),
  })
  .strict();

export const reportPageSchema = z
  .object({
    id: uuid("ID of the page."),
    title: z.string().describe("Title of the page."),
    path: z.string().describe("Path of the page in the web interface."),
    spaceId: uuid("Space of the page."),
    author: z
      .object({ id: uuid("Account ID."), name: z.string().describe("Name as the caller may see it.") })
      .nullable()
      .describe("Who created the page, or null when the caller may not see that person."),
    createdAt: timestamp("When the page was created."),
    updatedAt: timestamp("When the content last changed."),
  })
  .describe("A page in a page report.");

export const exampleReportPage = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5c11",
  title: "VPN access for remote staff",
  path: "/spaces/ITOPS/pages/01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5c11/vpn-access-for-remote-staff",
  spaceId: exampleSpace.id,
  author: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-10-06T07:00:00.000Z",
};

export const decisionReportQuerySchema = z
  .object({
    spaceId: uuid(
      "Only decisions in this space. Leave it out for every space the caller can read.",
    ).optional(),
    labels: labelList("Only decisions on pages with at least one of these labels."),
    parentId: uuid("Only decisions on direct children of this page.").optional(),
    order: z
      .enum(decisionReportOrders)
      .default("newest")
      .describe("`newest` (default) or `oldest` first, by the date of the page."),
    cursor: z.string().max(200).optional().describe("Cursor from `nextCursor` of the previous page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DECISION_REPORT_PAGE)
      .default(50)
      .describe(`Maximum number of decisions, 1 to ${MAX_DECISION_REPORT_PAGE}.`),
  })
  .strict();

export const reportDecisionSchema = z
  .object({
    id: uuid("ID of the decision."),
    text: z.string().describe("The decision as plain text."),
    page: z
      .object({
        id: uuid("ID of the page."),
        title: z.string().describe("Title of the page."),
        path: z.string().describe("Path of the page in the web interface."),
      })
      .describe("The page the decision was made on."),
    date: timestamp("When that page was created."),
  })
  .describe("A decision in a decision report.");

export const decisionReportSchema = z
  .object({
    items: z.array(reportDecisionSchema).describe("Decisions in the requested order."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Decisions.");

const booleanFlag = (description: string) =>
  z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
    .describe(description);

export function spaceIdList(description: string) {
  return z
    .string()
    .max(800)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(uuid("Space ID.")).max(MAX_FILTER_SPACES))
    .optional()
    .describe(`${description} Up to ${MAX_FILTER_SPACES} space IDs, separated by commas.`);
}

const propertyName = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROPERTY_KEY_LENGTH)
  .describe(`Name of a page property, up to ${MAX_PROPERTY_KEY_LENGTH} characters.`);

export const propertiesReportQuerySchema = z
  .object({
    spaceIds: spaceIdList("Only pages in these spaces. Leave it out for every space the caller can read."),
    labels: labelList("Only pages with at least one of these labels."),
    setId: z
      .string()
      .trim()
      .min(1)
      .max(MAX_PROPERTY_SET_ID_LENGTH)
      .optional()
      .describe("Only the page properties with this ID. Leave it out for all page properties of a page."),
    columns: z
      .string()
      .max(MAX_PROPERTIES_REPORT_COLUMNS * (MAX_PROPERTY_KEY_LENGTH + 1))
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .pipe(z.array(propertyName).max(MAX_PROPERTIES_REPORT_COLUMNS))
      .optional()
      .describe(
        `Property names to show as columns, separated by commas, up to ${MAX_PROPERTIES_REPORT_COLUMNS}. Leave it out for the names used on the listed pages. Names are compared without case.`,
      ),
    sortBy: propertyName
      .optional()
      .describe(
        "Sort by the value of this property. Leave it out to sort by title. Pages without the property come last.",
      ),
    reverse: booleanFlag("`true` sorts from Z to A."),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PROPERTIES_REPORT_PAGE_SIZE)
      .default(DEFAULT_PROPERTIES_REPORT_PAGE_SIZE)
      .describe(`Number of pages per page of results, 1 to ${MAX_PROPERTIES_REPORT_PAGE_SIZE}.`),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .default(0)
      .describe("Number of pages to skip, for the next pages of results."),
  })
  .strict();

const valueSchema = z
  .array(z.json().describe("A paragraph or list as ProseMirror JSON."))
  .describe(
    "Value of the property as ProseMirror blocks: paragraphs and lists with links, mentions, dates and status.",
  );

export const propertiesReportSchema = z
  .object({
    columns: z.array(z.string().describe("Property name.")).describe("Columns in the order of the cells."),
    keys: z
      .array(z.string().describe("Property name."))
      .describe("Property names used on the pages that match, as choices for the columns."),
    total: z.number().int().describe("Number of matching pages the caller can read."),
    rows: z
      .array(
        z
          .object({
            page: z
              .object({
                id: uuid("ID of the page."),
                title: z.string().describe("Title of the page."),
                path: z.string().describe("Path of the page in the web interface."),
                spaceId: uuid("Space of the page."),
              })
              .describe("The page."),
            creator: person(
              "Who created the page, or null when the caller may not see that person.",
            ).nullable(),
            labels: z.array(z.string().describe("A label.")).describe("Labels of the page."),
            cells: z
              .array(valueSchema.nullable())
              .describe("One value per column, or null when the page does not have the property."),
          })
          .describe("A page with its properties."),
      )
      .describe("Pages in the requested order."),
    references: pageReferencesSchema,
  })
  .describe("A page of a page properties report.");

export const examplePropertiesReport = {
  columns: ["Owner", "Uplink"],
  keys: ["Owner", "Uplink", "Switches"],
  total: 1,
  rows: [
    {
      page: {
        id: exampleReportPage.id,
        title: "Site Graz",
        path: `/spaces/ITOPS/pages/${exampleReportPage.id}/site-graz`,
        spaceId: exampleSpace.id,
      },
      creator: exampleReportPage.author,
      labels: ["site"],
      cells: [
        [{ type: "paragraph", content: [{ type: "mention", attrs: { id: exampleReportPage.author.id } }] }],
        [{ type: "paragraph", content: [{ type: "text", text: "1 Gbit/s fibre" }] }],
      ],
    },
  ],
  references: {
    people: { [exampleReportPage.author.id]: "Anna Berger" },
    pages: {},
    topics: {},
    tooLargeImages: [],
  },
};

export const contentByLabelQuerySchema = z
  .object({
    labels: labelList("Pages with these labels. Without labels the list is empty."),
    matchAll: booleanFlag(
      "`true` lists only pages with all of the labels, `false` (default) pages with any of them.",
    ),
    spaceIds: spaceIdList("Only pages in these spaces. Leave it out for every space the caller can read."),
    kinds: z
      .string()
      .max(40)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(z.enum(labeledContentKinds)).min(1))
      .default(["page", "blogPost"])
      .describe("`page`, `blogPost` or both, separated by commas (default)."),
    sort: z
      .enum(contentLabelSorts)
      .default("modified")
      .describe("`modified` (default) or `created`, newest first, or `title` from A to Z."),
    reverse: booleanFlag("`true` reverses the order."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CONTENT_BY_LABEL_LIMIT)
      .default(DEFAULT_CONTENT_BY_LABEL_LIMIT)
      .describe(`Maximum number of pages, 1 to ${MAX_CONTENT_BY_LABEL_LIMIT}.`),
    excerpts: booleanFlag("`true` adds the excerpt of each page."),
  })
  .strict();

export const labeledContentSchema = z
  .object({
    id: uuid("ID of the page or blog post."),
    title: z.string().describe("Title."),
    kind: extensibleEnum(labeledContentKinds, "`page` or `blogPost`."),
    path: z.string().describe("Path in the web interface."),
    space: z
      .object({
        id: uuid("ID of the space."),
        name: z
          .string()
          .describe("Name of the space, or empty when the caller has no access to the space itself."),
      })
      .describe("The space."),
    labels: z.array(z.string().describe("A label.")).describe("Labels, sorted."),
    excerpt: z
      .string()
      .nullable()
      .describe("Plain text of the excerpt when asked for, or the excerpt of a blog post; null otherwise."),
  })
  .describe("A page or blog post with a label.");

export const relatedLabelsQuerySchema = z
  .object({
    labels: labelList("Labels to start from. Leave it out for the labels of the page."),
  })
  .strict();

export const relatedLabelSchema = z
  .object({
    label: z.string().describe("A label."),
    href: z.string().describe("Path of the label in the space of the page."),
  })
  .describe("A label used together with the given labels.");

export const inclusionQuerySchema = z
  .object({
    targetId: uuid("The page to include.").optional(),
    sourceSpace: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Confluence space key of an included page that was not part of the import."),
    sourceTitle: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Confluence title of an included page that was not part of the import."),
    excerpt: booleanFlag("`true` gives only the excerpt of the page."),
    name: z
      .string()
      .min(1)
      .max(MAX_EXCERPT_NAME_LENGTH)
      .optional()
      .describe("Name of the excerpt. Leave it out for the first excerpt."),
  })
  .strict()
  .refine(
    (query) => (query.targetId === undefined) !== (query.sourceTitle === undefined),
    "Give either targetId or sourceTitle",
  )
  .refine(
    (query) => (query.sourceSpace === undefined) === (query.sourceTitle === undefined),
    "sourceSpace and sourceTitle go together",
  );

export const inclusionSchema = z
  .object({
    state: extensibleEnum(
      ["visible", "noExcerpt"],
      "`visible` with the content, or `noExcerpt` when the page has no excerpt of that name.",
    ),
    page: z
      .object({
        id: uuid("ID of the included page."),
        title: z.string().describe("Title of the included page."),
        path: z.string().describe("Path of the included page in the web interface."),
        spaceId: uuid("Space of the included page."),
      })
      .describe("The included page."),
    document: documentSchema
      .nullable()
      .describe("The published content, or only its excerpt. Null without excerpt."),
    references: pageReferencesSchema,
    hiddenFromSomeReaders: z
      .boolean()
      .describe(
        "True when some people who can read the including page cannot read the included page and see nothing in its place. Only checked for people who can edit the including page; false for everyone else.",
      ),
  })
  .describe("Content included from another page.");
