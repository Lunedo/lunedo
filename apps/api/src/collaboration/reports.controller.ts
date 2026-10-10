import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import {
  decisionReportQuerySchema,
  decisionReportSchema,
  exampleReportPage,
  pageReportQuerySchema,
  reportPageSchema,
} from "./schemas.js";

const TAG = "Reports";
const decisionCursor = z.tuple([z.string().max(40), z.string().max(40)]);

@Controller("api/v1")
export class ReportsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("reports/pages")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List pages for a page report",
    description:
      "Lists pages the caller can read, filtered by space and labels, as the page report block shows them. Archived pages are left out unless the report is limited to an archived space. Pages the caller cannot read are never counted or named.",
    tags: [TAG],
    query: pageReportQuerySchema,
    response: {
      description: "The pages.",
      schema: z.array(reportPageSchema).describe("Pages in the requested order."),
      example: [exampleReportPage],
    },
  })
  async pages(@Query() query: z.output<typeof pageReportQuerySchema>, @Req() request: FastifyRequest) {
    return this.#services.reports.pages(actorOf(request), {
      spaceId: query.spaceId ?? null,
      labels: query.labels ?? [],
      sort: query.sort,
      reverse: query.reverse,
      limit: query.limit,
    });
  }

  @Get("reports/decisions")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List decisions for a decision report",
    description:
      "Lists the decisions on published pages the caller can read, filtered by space, labels of the page and parent page, as the decision report block shows them. Empty decisions are left out.",
    tags: [TAG],
    query: decisionReportQuerySchema,
    response: {
      description: "A page of decisions.",
      schema: decisionReportSchema,
      example: {
        items: [
          {
            id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5d31",
            text: "Remote staff use WireGuard from November.",
            page: { id: exampleReportPage.id, title: exampleReportPage.title, path: exampleReportPage.path },
            date: exampleReportPage.createdAt,
          },
        ],
        nextCursor: null,
      },
    },
  })
  async decisions(
    @Query() query: z.output<typeof decisionReportQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, decisionCursor);
    const result = await this.#services.reports.decisions(
      actorOf(request),
      {
        spaceId: query.spaceId ?? null,
        labels: query.labels ?? [],
        parentId: query.parentId ?? null,
        order: query.order,
      },
      { after: after ?? undefined, limit: query.limit },
    );
    return { items: result.items, nextCursor: result.next ? encodeCursor(result.next) : null };
  }
}
