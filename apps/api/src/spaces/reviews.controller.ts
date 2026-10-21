import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { MAX_SOURCES, reviewRecipients } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, nameCursor, pageQuery } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";
import { articleTypeSchema, exampleSpace } from "./schemas.js";

const TAG = "Knowledge base reviews";
const space = { type: "space", param: "spaceId" } as const;
const item = { type: "item", param: "itemId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const articleParams = z.object({ itemId: uuid("ID of the article.") }).strict();

const intervalSchema = z
  .union([z.literal(3), z.literal(6), z.literal(12)])
  .describe("Review interval in months.");

const personSchema = z
  .object({
    id: uuid("ID of the person."),
    name: z
      .string()
      .nullable()
      .describe("Name of the person, or null when the caller may not see the person."),
  })
  .describe("A person.");

const examplePerson = { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Weber" };
const exampleArticleId = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a50";

const stateSchema = z
  .enum(["overdue", "sourceChanged", "dueSoon", "current", "off"])
  .describe(
    "`overdue`: the interval has passed. `sourceChanged`: a source page changed since the last review. `dueSoon`: due within 30 days. `current`: reviewed within the interval. `off`: no interval applies.",
  );

const settingsSchema = z
  .object({
    intervalMonths: intervalSchema
      .nullable()
      .describe("Interval for every article without its own, or null when reviews are off."),
    leadDays: z
      .union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)])
      .describe(
        "Days before the due date at which owners get a first reminder. 0 sends only the one on the due date.",
      ),
    recipients: z
      .enum(reviewRecipients)
      .describe(
        "Who is reminded: `owner`, or `ownerAndAdministrators` for the owner and the space admins. Articles without an owner always go to the space admins.",
      ),
  })
  .describe("Review settings of a knowledge base.");

const exampleSettings = { intervalMonths: 6 as const, leadDays: 14 as const, recipients: "owner" as const };

const settingsBodySchema = z
  .object({
    intervalMonths: intervalSchema
      .nullable()
      .optional()
      .describe("New interval, or null to switch reviews off."),
    leadDays: settingsSchema.shape.leadDays.optional(),
    recipients: settingsSchema.shape.recipients.optional(),
  })
  .strict()
  .describe("Settings to change. Fields that are left out keep their value.");

const articleReviewSchema = z
  .object({
    itemId: uuid("ID of the article."),
    intervalMonths: z
      .union([z.literal(0), intervalSchema])
      .nullable()
      .describe(
        "Interval set on the article itself: 0 for no reviews, or null when it uses the knowledge base's.",
      ),
    effectiveIntervalMonths: intervalSchema.nullable().describe("Interval that applies, or null when none."),
    inherited: z.boolean().describe("Whether the interval comes from the knowledge base."),
    publishedAt: timestamp("When the article was first published, or null.").nullable(),
    reviewedAt: timestamp("When the article was last marked as reviewed, or null.").nullable(),
    reviewedBy: personSchema.nullable().describe("Who reviewed it last, or null."),
    dueAt: timestamp("When the next review is due, or null when no interval applies.").nullable(),
    sourceChangedAt: timestamp("When a source page changed after the last review, or null.").nullable(),
    state: stateSchema,
  })
  .describe("Review state of an article.");

const exampleArticleReview = {
  itemId: exampleArticleId,
  intervalMonths: null,
  effectiveIntervalMonths: 6 as const,
  inherited: true,
  publishedAt: "2026-03-02T09:00:00.000Z",
  reviewedAt: "2026-10-02T09:00:00.000Z",
  reviewedBy: examplePerson,
  dueAt: "2027-04-02T09:00:00.000Z",
  sourceChangedAt: null,
  state: "current" as const,
};

const intervalBodySchema = z
  .object({
    intervalMonths: z
      .union([z.literal(0), intervalSchema])
      .nullable()
      .describe("3, 6 or 12 months, 0 for no reviews, or null to use the interval of the knowledge base."),
  })
  .strict()
  .describe("The interval of the article.");

const reviewRecordSchema = z
  .object({
    reviewId: uuid("ID of the review, used to undo it."),
    reviewedAt: timestamp("When it was recorded."),
    dueAt: timestamp("When the next review is due, or null.").nullable(),
  })
  .describe("The recorded review.");

const reviewParams = z
  .object({ itemId: uuid("ID of the article."), reviewId: uuid("ID of the review.") })
  .strict();

const listQuery = z
  .object({
    ...pageQuery,
    filter: z
      .enum(["all", "due", "soon", "unowned", "translations"])
      .default("all")
      .describe(
        "`due`: overdue or with a changed source page. `soon`: due within 30 days. `unowned`: without an active owner. `translations`: translations whose original was published after them. `all`: every article of these four.",
      ),
    mine: z.enum(["true", "false"]).default("false").describe("Only articles the caller owns."),
  })
  .strict();

const reviewItemSchema = z
  .object({
    id: uuid("ID of the article."),
    title: z.string().describe("Title of the article."),
    type: articleTypeSchema.nullable(),
    categoryPath: z
      .array(
        z
          .object({ id: uuid("ID of the category."), title: z.string().describe("Title.") })
          .describe("A category."),
      )
      .describe("Category and subcategory the caller can read, top level first."),
    owner: personSchema.nullable().describe("The owner, or null when the article has no active owner."),
    ownerActive: z.boolean().describe("Whether the article has an active owner."),
    formerOwner: personSchema
      .nullable()
      .describe("The owner who left, or null when the owner is active or the article never had one."),
    intervalMonths: intervalSchema.nullable().describe("Interval that applies, or null."),
    inherited: z.boolean().describe("Whether the interval comes from the knowledge base."),
    publishedAt: timestamp("When the article was first published, or null.").nullable(),
    reviewedAt: timestamp("When it was last reviewed, or null.").nullable(),
    dueAt: timestamp("When the review is due, or null.").nullable(),
    sourceChangedAt: timestamp("When a source page changed after the last review, or null.").nullable(),
    state: stateSchema,
    language: z
      .string()
      .nullable()
      .describe("Language of a translation, or null for an article in the default language."),
    translationOutdated: z
      .boolean()
      .describe("Whether this is a translation and its original was published after it."),
  })
  .describe("An article that needs a review, an owner or an updated translation.");

const reviewListSchema = z
  .object({
    items: z.array(reviewItemSchema).describe("Due and overdue articles first, then articles due soon."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
    counts: z
      .object({
        all: z.number().int().describe("Articles in the list."),
        due: z.number().int().describe("Overdue articles and articles with a changed source page."),
        soon: z.number().int().describe("Articles due within 30 days."),
        unowned: z.number().int().describe("Articles without an active owner."),
        translations: z.number().int().describe("Translations whose original was published after them."),
      })
      .describe("Number of articles per filter, with the `mine` choice applied."),
  })
  .describe("Articles to review that the caller may edit.");

const exampleReviewItem = {
  id: exampleArticleId,
  title: "Set up the VPN at home",
  type: "howTo" as const,
  categoryPath: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60", title: "IT" }],
  owner: examplePerson,
  ownerActive: true,
  formerOwner: null,
  intervalMonths: 6 as const,
  inherited: true,
  publishedAt: "2026-03-02T09:00:00.000Z",
  reviewedAt: "2026-04-02T09:00:00.000Z",
  dueAt: "2026-10-02T09:00:00.000Z",
  sourceChangedAt: null,
  state: "overdue" as const,
  language: null,
  translationOutdated: false,
};

const homeSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid("ID of the article."),
            title: z.string().describe("Title of the article."),
            type: articleTypeSchema.nullable(),
            spaceKey: z.string().describe("Key of the knowledge base."),
            spaceName: z.string().describe("Name of the knowledge base."),
            dueAt: timestamp("When the review is due, or null.").nullable(),
            sourceChangedAt: timestamp(
              "When a source page changed after the last review, or null.",
            ).nullable(),
            state: stateSchema,
          })
          .describe("An article of the caller that needs a review."),
      )
      .describe("Up to 20 articles, the most urgent first."),
    total: z.number().int().describe("Number of all such articles."),
  })
  .describe("Articles the caller owns that are due, due within 30 days or whose source page changed.");

const sourceSchema = z
  .object({
    id: uuid("ID of the source page."),
    title: z.string().describe("Title of the source page."),
    spaceKey: z.string().describe("Key of the space of the source page."),
    spaceName: z.string().describe("Name of the space of the source page."),
    changedAt: timestamp("When the page changed after the last review of the article, or null.").nullable(),
  })
  .describe("An internal page the article is based on.");

const sourcesSchema = z
  .array(sourceSchema)
  .describe("Source pages the caller can read. Others are left out, as if they were not linked.");

const exampleSource = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
  title: "VPN gateway",
  spaceKey: "OPS",
  spaceName: "IT operations",
  changedAt: null,
};

const sourceBodySchema = z
  .object({ sourceId: uuid("ID of a page the caller can read, in a space that is not a knowledge base.") })
  .strict()
  .describe("The source page to link.");

const hiddenSourcesSchema = z
  .object({
    count: z.number().int().min(0).describe("Number of linked source pages the caller cannot read."),
    changed: z.boolean().describe("Whether one of them changed after the last review of the article."),
  })
  .describe("Source pages the caller cannot read, without their titles.");

const sourceParams = z
  .object({ itemId: uuid("ID of the article."), sourceId: uuid("ID of the source page.") })
  .strict();

@Controller("api/v1")
export class ReviewsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/knowledge-base/reviews")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get the review settings of a knowledge base",
    description: "Returns the default review interval, the reminder lead time and who is reminded.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The settings.", schema: settingsSchema, example: exampleSettings },
    errors: ["notKnowledgeBase"],
  })
  async settings(@Param("spaceId") spaceId: string) {
    return this.#services.reviews.settings(spaceId);
  }

  @Put("spaces/:spaceId/knowledge-base/reviews")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the review settings of a knowledge base",
    description:
      "Changes the default interval, the lead time or who is reminded. Due dates and reminders of every article follow at once. Audited.",
    tags: [TAG],
    params: spaceParams,
    body: settingsBodySchema,
    bodyExample: { intervalMonths: 6 },
    response: {
      description: "The settings after the change.",
      schema: settingsSchema,
      example: exampleSettings,
    },
    errors: ["notKnowledgeBase"],
  })
  async updateSettings(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof settingsBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reviews.updateSettings(actorOf(request), spaceId, {
      ...(body.intervalMonths === undefined ? {} : { intervalMonths: body.intervalMonths }),
      ...(body.leadDays === undefined ? {} : { leadDays: body.leadDays }),
      ...(body.recipients === undefined ? {} : { recipients: body.recipients }),
    });
  }

  @Get("spaces/:spaceId/reviews")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the articles to review",
    description:
      "Lists articles that are overdue, due within 30 days, whose source page changed or that have no active owner. Only articles the caller may edit are listed.",
    tags: [TAG],
    params: spaceParams,
    query: listQuery,
    response: {
      description: "The articles.",
      schema: reviewListSchema,
      example: {
        items: [exampleReviewItem],
        nextCursor: null,
        counts: { all: 1, due: 1, soon: 0, unowned: 0, translations: 0 },
      },
    },
    errors: ["notKnowledgeBase"],
  })
  async list(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof listQuery>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, nameCursor);
    const listed = await this.#services.reviews.list(actorOf(request), spaceId, {
      filter: query.filter,
      mine: query.mine === "true",
      page: { limit: query.limit, ...(after ? { after } : {}) },
    });
    return {
      items: listed.items,
      nextCursor: listed.next ? encodeCursor(listed.next) : null,
      counts: listed.counts,
    };
  }

  @Get("reviews/mine")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List the caller's articles to review",
    description:
      "Lists knowledge base articles the caller owns and may edit that need a review, for the personal home page.",
    tags: [TAG],
    response: {
      description: "The articles.",
      schema: homeSchema,
      example: {
        items: [
          {
            id: exampleArticleId,
            title: "Set up the VPN at home",
            type: "howTo" as const,
            spaceKey: exampleSpace.key,
            spaceName: exampleSpace.name,
            dueAt: "2026-10-02T09:00:00.000Z",
            sourceChangedAt: null,
            state: "overdue" as const,
          },
        ],
        total: 1,
      },
    },
  })
  async mine(@Req() request: FastifyRequest) {
    return this.#services.reviews.mine(actorOf(request));
  }

  @Get("articles/:itemId/review")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Get the review state of an article",
    description: "Returns the interval, the last review and the next due date of an article.",
    tags: [TAG],
    params: articleParams,
    response: {
      description: "The review state.",
      schema: articleReviewSchema,
      example: exampleArticleReview,
    },
    errors: ["notArticle"],
  })
  async article(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.reviews.article(actorOf(request), itemId);
  }

  @Put("articles/:itemId/review/interval")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Set the review interval of an article",
    description:
      "Sets an interval of the article's own, switches reviews off for it, or returns to the knowledge base's.",
    tags: [TAG],
    params: articleParams,
    body: intervalBodySchema,
    bodyExample: { intervalMonths: 12 },
    response: {
      description: "The review state after the change.",
      schema: articleReviewSchema,
      example: exampleArticleReview,
    },
    errors: ["notArticle"],
  })
  async setInterval(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof intervalBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reviews.setInterval(actorOf(request), itemId, body.intervalMonths);
  }

  @Post("articles/:itemId/reviews")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Mark an article as reviewed",
    description:
      "Records who reviewed the article and when, without a new version. The next due date starts from now and changed source pages count as seen. Audited.",
    tags: [TAG],
    params: articleParams,
    status: 201,
    response: {
      description: "The recorded review.",
      schema: reviewRecordSchema,
      example: {
        reviewId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a80",
        reviewedAt: "2026-10-18T09:00:00.000Z",
        dueAt: "2027-04-18T09:00:00.000Z",
      },
    },
    errors: ["notArticle", "articleNotPublished"],
  })
  async markReviewed(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.reviews.markReviewed(actorOf(request), itemId);
  }

  @Delete("articles/:itemId/reviews/:reviewId")
  @Permission("item.edit", item)
  @HttpCode(204)
  @ApiRoute({
    summary: "Undo a review",
    description:
      "Restores the state before the latest review. Only the person who recorded it can undo it, within two minutes. Audited.",
    tags: [TAG],
    params: reviewParams,
    status: 204,
    errors: ["notArticle", "reviewNotUndoable"],
  })
  async undo(
    @Param("itemId") itemId: string,
    @Param("reviewId") reviewId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.reviews.undoReview(actorOf(request), itemId, reviewId);
  }

  @Get("articles/:itemId/sources")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "List the source pages of an article",
    description:
      "Lists the internal pages the article is based on. Pages the caller cannot read are left out. Source pages never appear in what readers of a knowledge base see.",
    tags: [TAG],
    params: articleParams,
    response: { description: "The source pages.", schema: sourcesSchema, example: [exampleSource] },
  })
  async sources(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.reviews.sources(actorOf(request), itemId);
  }

  @Post("articles/:itemId/sources")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Link a source page to an article",
    description: `Links an internal page. When it is published with changes, the article's owner is reminded to review it. At most ${MAX_SOURCES} per article. Audited.`,
    tags: [TAG],
    params: articleParams,
    body: sourceBodySchema,
    bodyExample: { sourceId: exampleSource.id },
    status: 200,
    response: {
      description: "The source pages after the change.",
      schema: sourcesSchema,
      example: [exampleSource],
    },
    errors: ["notArticle", "sourceNotFound", "invalidSourcePage", "tooManySources"],
  })
  async addSource(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof sourceBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reviews.addSource(actorOf(request), itemId, body.sourceId);
  }

  @Delete("articles/:itemId/sources/:sourceId")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Remove a source page from an article",
    description: "Removes the link to a source page the caller can read. Audited.",
    tags: [TAG],
    params: sourceParams,
    response: { description: "The source pages after the change.", schema: sourcesSchema, example: [] },
    errors: ["notArticle", "sourceNotFound"],
  })
  async removeSource(
    @Param("itemId") itemId: string,
    @Param("sourceId") sourceId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reviews.removeSource(actorOf(request), itemId, sourceId);
  }

  @Get("articles/:itemId/hidden-sources")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Count the source pages of an article the caller cannot read",
    description:
      "Tells editors of the article how many linked source pages they cannot read, without titles, so that they can remove links nobody can maintain any more.",
    tags: [TAG],
    params: articleParams,
    response: {
      description: "The source pages the caller cannot read.",
      schema: hiddenSourcesSchema,
      example: { count: 1, changed: true },
    },
    errors: ["notArticle"],
  })
  async hiddenSources(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.reviews.hiddenSources(actorOf(request), itemId);
  }

  @Delete("articles/:itemId/hidden-sources")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Remove the source pages of an article the caller cannot read",
    description:
      "Removes the links to all source pages the caller cannot read. People who can read such a page can link it again. Audited.",
    tags: [TAG],
    params: articleParams,
    response: {
      description: "The source pages the caller cannot read after the change.",
      schema: hiddenSourcesSchema,
      example: { count: 0, changed: false },
    },
    errors: ["notArticle"],
  })
  async removeHiddenSources(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.reviews.removeHiddenSources(actorOf(request), itemId);
  }
}
