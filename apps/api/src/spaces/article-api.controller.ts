import type { Readable } from "node:stream";
import {
  CHANGES_PAGE_SIZE,
  FILE_NAME_MAX_LENGTH,
  MAX_ARTICLE_SECTIONS,
  MAX_CHANGES_PAGE_SIZE,
  TOMBSTONE_DAYS,
} from "@lunedo/server";
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { attachmentSchema, exampleAttachment } from "../files/schemas.js";
import { ApiRoute } from "../http/api-route.js";
import { originOf } from "../http/instance-url.js";
import { ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { inputTimestamp, timestamp, uuid } from "../http/schemas.js";
import { articleSchema, exampleArticleRecord } from "./knowledge-bases.controller.js";
import { articleTypeSchema } from "./schemas.js";

const TAG = "Knowledge base articles";
const space = { type: "space", param: "spaceId" } as const;
const item = { type: "item", param: "itemId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const articleParams = z.object({ itemId: uuid("ID of the article.") }).strict();

const changesQuery = z
  .object({
    changedSince: inputTimestamp("Only articles that changed after this moment.")
      .optional()
      .describe(
        `Only articles that changed after this moment, ISO 8601, with the numbers of articles removed since then. Leave it out for all published articles. At most ${TOMBSTONE_DAYS} days back.`,
      ),
    cursor: z.string().max(500).optional().describe("Cursor from the previous page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CHANGES_PAGE_SIZE)
      .default(CHANGES_PAGE_SIZE)
      .describe(`Articles per page, 1 to ${MAX_CHANGES_PAGE_SIZE}.`),
    draft: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "`true` returns the current drafts, also of unpublished articles, of the articles the caller may edit. Needs a token that may write drafts.",
      ),
  })
  .strict();

const removedSchema = z
  .object({
    itemId: uuid("ID the article had."),
    number: z.number().int().nullable().describe("Number the article had, or null."),
    language: z.string().nullable().describe("Language of the removed article or translation."),
    reason: z
      .enum(["deleted", "unpublished", "moved"])
      .describe(
        "`deleted`: in the trash or deleted. `unpublished`: no longer readable. `moved`: moved to another space.",
      ),
    removedAt: timestamp("When it was removed."),
  })
  .describe("An article that readers can no longer find under its number and language.");

const changesSchema = z
  .object({
    items: z.array(articleSchema).describe("New and changed articles, oldest change first."),
    removed: z.array(removedSchema).describe(`Removed articles. They are kept for ${TOMBSTONE_DAYS} days.`),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
    nextChangedSince: timestamp(
      "Value to send as `changedSince` in the next sync. It lies a few minutes in the past, so changes that were saved at the same moment are not missed; articles can therefore appear twice and are best stored by ID.",
    ),
  })
  .describe("Changes of the articles of a knowledge base.");

const sectionInputSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,39}$/)
      .describe("Key of the section, such as `steps` or `cause`."),
    title: z.string().max(255).optional().describe("Heading of the section."),
    icon: z.string().max(60).nullable().optional().describe("Name of a Lucide icon, or null."),
    markdown: z
      .string()
      .max(500_000)
      .optional()
      .describe(
        "Content as Markdown. Images uploaded to the article are referenced by their file name, for example `![Login screen](login.png)`.",
      ),
    content: z
      .array(z.json())
      .max(10_000)
      .optional()
      .describe("Content as ProseMirror JSON nodes instead of Markdown. Images reference `attachmentId`."),
  })
  .strict()
  .describe("A section of the article.");

const writeShape = {
  title: z.string().min(1).max(255).optional().describe("Title of the article."),
  lead: z.string().max(1000).optional().describe("Short introduction below the title."),
  type: articleTypeSchema.nullable().optional().describe("Type of the article, or null for none."),
  categoryId: uuid("Category or subcategory to place the article in, or null for the top level.")
    .nullable()
    .optional(),
  sections: z
    .array(sectionInputSchema)
    .max(MAX_ARTICLE_SECTIONS)
    .optional()
    .describe("Sections in order. They replace the whole content of the draft."),
  versionNote: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "Note shown in the history, for example who checked the content. Stored with the draft and used when it is published.",
    ),
};

const createSchema = z
  .object({
    ...writeShape,
    title: z.string().min(1).max(255).describe("Title of the article."),
    translationOf: uuid("Original article when the new article is its translation.").optional(),
    language: z
      .string()
      .optional()
      .describe(
        "Language of a translation. New articles without `translationOf` are in the default language.",
      ),
    publish: z
      .boolean()
      .default(false)
      .describe("Publish at once. Needs a token that may publish; otherwise the article stays a draft."),
  })
  .strict()
  .describe("A new article.");

const draftSchema = z.object(writeShape).strict().describe("Changes saved as the draft of the article.");

const publishSchema = z.object({ versionNote: writeShape.versionNote }).strict().describe("The publication.");

const imageQuery = z
  .object({
    name: z
      .string()
      .min(1)
      .max(FILE_NAME_MAX_LENGTH * 4)
      .describe("File name. Sections reference the image by it. The same name replaces the image."),
  })
  .strict();

@Controller("api/v1")
export class ArticleApiController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/article-changes")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List changed and removed articles",
    description:
      "Returns the articles of a knowledge base that the caller can read and that changed since `changedSince`, with their sections as HTML and text, and the numbers of articles removed since then. Without `changedSince` it returns every published article. Pages through a stable cursor.",
    tags: [TAG],
    params: spaceParams,
    query: changesQuery,
    response: {
      description: "The changes.",
      schema: changesSchema,
      example: {
        items: [exampleArticleRecord],
        removed: [
          {
            itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a63",
            number: 98,
            language: "de",
            reason: "deleted" as const,
            removedAt: "2026-10-12T07:00:00.000Z",
          },
        ],
        nextCursor: null,
        nextChangedSince: "2026-10-20T05:55:00.000Z",
      },
    },
    errors: ["notKnowledgeBase", "changedSinceTooOld", "invalidCursor", "draftNotVisible"],
  })
  async changes(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof changesQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.articleApi.changes(actorOf(request), spaceId, {
      changedSince: query.changedSince ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit,
      draft: query.draft === "true",
      origin: await originOf(this.context, request),
    });
  }

  @Post("spaces/:spaceId/articles")
  @Permission("space.createDraft", space)
  @ApiRoute({
    summary: "Create an article",
    description:
      "Creates an article with its sections, category and type, or a translation of an article. It stays a draft unless `publish` is set and the caller may publish. Upload images afterwards and reference them in a draft.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    body: createSchema,
    bodyExample: {
      title: "Set up the VPN connection",
      type: "howTo",
      categoryId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60",
      sections: [{ key: "steps", title: "Steps", markdown: "1. Open the VPN client.\n2. Sign in." }],
      versionNote: "Checked by Anna Huber in the help assistant",
      publish: false,
    },
    response: { description: "The new article.", schema: articleSchema, example: exampleArticleRecord },
    errors: [
      "notKnowledgeBase",
      "knowledgeBasePlacement",
      "invalidLanguage",
      "languageNotEnabled",
      "translationExists",
      "translationSource",
      "publishNotAllowed",
      "requiredSectionsEmpty",
      "invalidDocument",
      "invalidNote",
    ],
  })
  async create(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.articleApi.create(
      actorOf(request),
      spaceId,
      body,
      await originOf(this.context, request),
    );
  }

  @Put("articles/:itemId/draft")
  @Permission("item.editDraft", item)
  @ApiRoute({
    summary: "Save a draft of an article",
    description:
      "Saves title and sections as the draft of the article without publishing it; a person publishes it in Lunedo, or a caller that may publish. Type, category and lead change at once for readers, so they need permission to publish once the article is published.",
    tags: [TAG],
    params: articleParams,
    body: draftSchema,
    bodyExample: {
      sections: [
        { key: "steps", title: "Steps", markdown: "1. Open the VPN client.\n2. Sign in with the new code." },
      ],
      versionNote: "Checked by Anna Huber in the help assistant",
    },
    response: { description: "The draft.", schema: articleSchema, example: exampleArticleRecord },
    errors: ["notArticle", "publishNotAllowed", "invalidDocument", "invalidNote", "moveChangesAccess"],
  })
  async saveDraft(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof draftSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.articleApi.saveDraft(
      actorOf(request),
      itemId,
      body,
      await originOf(this.context, request),
    );
  }

  @Post("articles/:itemId/images")
  @Permission("item.editDraft", item)
  @ApiRoute({
    summary: "Upload an image to an article",
    description:
      "Adds an image to the draft of an article. Send the bytes with `Content-Type: application/octet-stream`. Sections of a draft reference it by its name.",
    tags: [TAG],
    params: articleParams,
    query: imageQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the image." },
    status: 201,
    response: { description: "The image.", schema: attachmentSchema, example: exampleAttachment },
    errors: ["notArticle", "fileTooLarge", "invalidFileName", "unsupportedMediaType", "storageFull"],
  })
  async addImage(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof imageQuery>,
    @Req() request: FastifyRequest,
  ) {
    const body = request.body as Readable | undefined;
    if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
      throw new ProblemException("unsupportedMediaType", "Send the image as application/octet-stream");
    }
    const length = request.headers["content-length"];
    return this.#services.articleApi.addImage(actorOf(request), itemId, {
      name: query.name,
      body,
      contentLength: length && /^\d+$/.test(length) ? Number(length) : undefined,
    });
  }

  @Post("articles/:itemId/publish")
  @Permission("item.publish", item)
  @ApiRoute({
    summary: "Publish an article",
    description:
      "Publishes the current draft as a new version with the caller as its author. The version note, or the one saved with the draft, appears in the history. Audited.",
    tags: [TAG],
    status: 200,
    params: articleParams,
    body: publishSchema,
    bodyExample: { versionNote: "Checked by Anna Huber in the help assistant" },
    response: { description: "The published article.", schema: articleSchema, example: exampleArticleRecord },
    errors: ["notArticle", "requiredSectionsEmpty", "invalidNote"],
  })
  async publish(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof publishSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.articleApi.publish(
      actorOf(request),
      itemId,
      { versionNote: body.versionNote },
      await originOf(this.context, request),
    );
  }
}
