import { Controller, Delete, Get, HttpCode, Inject, Param, Query, Req } from "@nestjs/common";
import { MINIMUM_TERM_SEARCHES, statisticsPeriods } from "@pagehall/server";
import { idSchema } from "@pagehall/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";

const feedbackCursor = z.tuple([z.iso.date(), idSchema]);
const TAG = "Knowledge base statistics";
const space = { type: "space", param: "spaceId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const articleParams = z
  .object({ spaceId: uuid("ID of the knowledge base."), itemId: uuid("ID of the article.") })
  .strict();
const feedbackParams = z
  .object({ spaceId: uuid("ID of the knowledge base."), feedbackId: uuid("ID of the note.") })
  .strict();

const periodSchema = z
  .enum(statisticsPeriods)
  .default("30d")
  .describe(
    "`7d`, `30d` or `90d` for the last 7, 30 or 90 days, `12m` for the last 12 months, each up to today.",
  );

const periodQuery = z.object({ period: periodSchema }).strict();

const day = (description: string) => z.iso.date().describe(description);

const articleSchema = z
  .object({
    id: uuid("ID of the article."),
    title: z.string().describe("Title of the article."),
    categoryPath: z
      .array(
        z
          .object({ id: uuid("ID of the category."), title: z.string().describe("Title.") })
          .describe("A category."),
      )
      .describe("Category and subcategory the caller can read, top level first."),
  })
  .describe("An article the caller can read.");

const termSchema = z
  .object({
    term: z.string().describe("The search term, trimmed and in lowercase."),
    searches: z.number().int().describe("Searches for the term in the period."),
    zeroResults: z.number().int().describe("Of these, searches without results."),
    lastSearchedAt: timestamp("Hour of the last search for the term."),
  })
  .describe("A search term.");

const statisticsSchema = z
  .object({
    period: z
      .object({ from: day("First day, UTC."), to: day("Last day, UTC.") })
      .describe("The days counted, both included."),
    searches: z
      .object({
        total: z.number().int().describe("Searches in the portal."),
        zeroResults: z.number().int().describe("Searches without results."),
      })
      .describe("Searches in the period."),
    ratings: z
      .object({
        helpful: z.number().int().describe("Answers “yes” to “Was this helpful?”."),
        unhelpful: z.number().int().describe("Answers “no”."),
      })
      .describe("Ratings of the articles the caller can read."),
    views: z.number().int().describe("Views of the articles the caller can read."),
    topTerms: z
      .array(termSchema)
      .describe(`Up to 20 most frequent terms, each searched at least ${MINIMUM_TERM_SEARCHES} times.`),
    zeroResultTerms: z
      .array(termSchema)
      .describe(
        `Up to 20 terms most often searched without results, each at least ${MINIMUM_TERM_SEARCHES} times.`,
      ),
    unhelpful: z
      .array(
        z
          .object({
            article: articleSchema,
            helpful: z.number().int().describe("Answers “yes”."),
            unhelpful: z.number().int().describe("Answers “no”."),
            feedback: z.number().int().describe("Notes on what was missing, still kept."),
          })
          .describe("An article rated as not helpful."),
      )
      .describe("Up to 10 articles with the most answers “no”."),
    mostRead: z
      .array(
        z
          .object({ article: articleSchema, views: z.number().int().describe("Views in the period.") })
          .describe("A read article."),
      )
      .describe("Up to 10 articles with the most views."),
  })
  .describe(
    "What readers searched and how they rated articles in the portal. Nothing refers to a person; articles the caller cannot read are left out.",
  );

const exampleArticle = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a50",
  title: "Set up the VPN at home",
  categoryPath: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60", title: "IT" }],
};

const exampleStatistics = {
  period: { from: "2026-09-20", to: "2026-10-19" },
  searches: { total: 4812, zeroResults: 308 },
  ratings: { helpful: 1047, unhelpful: 157 },
  views: 9310,
  topTerms: [{ term: "vpn", searches: 412, zeroResults: 0, lastSearchedAt: "2026-10-19T08:00:00.000Z" }],
  zeroResultTerms: [
    { term: "parking permit", searches: 37, zeroResults: 37, lastSearchedAt: "2026-10-18T14:00:00.000Z" },
  ],
  unhelpful: [{ article: exampleArticle, helpful: 23, unhelpful: 18, feedback: 3 }],
  mostRead: [{ article: exampleArticle, views: 640 }],
};

const feedbackQuery = z.object({ ...pageQuery, period: periodSchema }).strict();

const feedbackPageSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid("ID of the note."),
            itemId: uuid("ID of the article."),
            day: day("Day the note was written, UTC."),
            text: z.string().describe("What the reader wrote, without any reference to them."),
          })
          .describe("A note on what was missing."),
      )
      .describe("Notes, newest first."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Notes readers left after answering “no”.");

@Controller("api/v1")
export class StatisticsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/statistics")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "Get the reader statistics of a knowledge base",
    description:
      "Returns searches, terms, ratings and views in the portal for a period. For editors and admins of the knowledge base.",
    tags: [TAG],
    params: spaceParams,
    query: periodQuery,
    response: { description: "The statistics.", schema: statisticsSchema, example: exampleStatistics },
    errors: ["notKnowledgeBase"],
  })
  async overview(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof periodQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.knowledgeBaseStatistics.overview(actorOf(request), spaceId, query.period);
  }

  @Get("spaces/:spaceId/statistics/articles/:itemId/feedback")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "List the notes on an article",
    description:
      "Lists what readers wrote after answering “no” to “Was this helpful?” in the period. Notes are deleted when the retention of the knowledge base ends.",
    tags: [TAG],
    params: articleParams,
    query: feedbackQuery,
    response: {
      description: "The notes.",
      schema: feedbackPageSchema,
      example: {
        items: [
          {
            id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a80",
            itemId: exampleArticle.id,
            day: "2026-10-17",
            text: "Step 2 looks different on my laptop.",
          },
        ],
        nextCursor: null,
      },
    },
    errors: ["notKnowledgeBase", "notFound"],
  })
  async feedback(
    @Param("spaceId") spaceId: string,
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof feedbackQuery>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, feedbackCursor);
    const page = await this.#services.knowledgeBaseStatistics.feedback(actorOf(request), spaceId, itemId, {
      period: query.period,
      limit: query.limit,
      ...(after ? { before: { day: after[0], id: after[1] } } : {}),
    });
    const next = page.nextCursor;
    return { items: page.items, nextCursor: next ? encodeCursor([next.day, next.id]) : null };
  }

  @Delete("spaces/:spaceId/statistics/feedback/:feedbackId")
  @Permission("space.manage", space)
  @HttpCode(204)
  @ApiRoute({
    summary: "Delete a note",
    description:
      "Deletes a note for good, for example when it contains personal data. Only space admins. Audited without the text.",
    tags: [TAG],
    params: feedbackParams,
    status: 204,
    errors: ["notKnowledgeBase", "feedbackNotFound"],
  })
  async deleteFeedback(
    @Param("spaceId") spaceId: string,
    @Param("feedbackId") feedbackId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.knowledgeBaseStatistics.deleteFeedback(actorOf(request), spaceId, feedbackId);
  }
}
