import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { exampleDocument } from "../spaces/schemas.js";
import {
  contentByLabelQuerySchema,
  decisionReportQuerySchema,
  decisionReportSchema,
  examplePropertiesReport,
  exampleReportPage,
  inclusionQuerySchema,
  inclusionSchema,
  labeledContentSchema,
  pageReportQuerySchema,
  propertiesReportQuerySchema,
  propertiesReportSchema,
  relatedLabelSchema,
  relatedLabelsQuerySchema,
  reportPageSchema,
} from "./schemas.js";

const TAG = "Reports";
const decisionCursor = z.tuple([z.string().max(40), z.string().max(40)]);
const page = { type: "item", param: "pageId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page that shows the block.") }).strict();

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

  @Get("reports/properties")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List pages for a page properties report",
    description:
      "Lists pages the caller can read that have page properties, filtered by spaces, labels and the ID of the property set, with the values of the chosen properties, as the page properties report block shows them. Only the published version of a page counts; drafts are left out. Pages the caller cannot read are never counted, named or used for sorting.",
    tags: [TAG],
    query: propertiesReportQuerySchema,
    response: {
      description: "A page of the report.",
      schema: propertiesReportSchema,
      example: examplePropertiesReport,
    },
  })
  async properties(
    @Query() query: z.output<typeof propertiesReportQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const result = await this.#services.reports.properties(
      actor,
      {
        spaceIds: query.spaceIds ?? [],
        labels: query.labels ?? [],
        setId: query.setId ?? null,
        columns: query.columns ?? [],
        sortBy: query.sortBy ?? null,
        reverse: query.reverse,
        pageSize: query.pageSize,
      },
      { offset: query.offset },
    );
    const cells = result.rows.flatMap((row) => row.cells.flatMap((cell) => cell ?? []));
    return {
      ...result,
      references: await this.#services.documents.references(actor, { type: "doc", content: cells }),
    };
  }

  @Get("reports/content-by-label")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List pages and blog posts with labels",
    description:
      "Lists pages and blog posts the caller can read that have the given labels, as the content by label block shows them. Archived content is left out unless the list is limited to archived spaces.",
    tags: [TAG],
    query: contentByLabelQuerySchema,
    response: {
      description: "The pages and blog posts.",
      schema: z.array(labeledContentSchema).describe("Pages and blog posts in the requested order."),
      example: [
        {
          id: exampleReportPage.id,
          title: exampleReportPage.title,
          kind: "page",
          path: exampleReportPage.path,
          space: { id: exampleReportPage.spaceId, name: "IT operations" },
          labels: ["how-to", "vpn"],
          excerpt: "Remote staff connect through WireGuard.",
        },
      ],
    },
  })
  async contentByLabel(
    @Query() query: z.output<typeof contentByLabelQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reports.labeledContent(actorOf(request), {
      labels: query.labels ?? [],
      matchAll: query.matchAll,
      spaceIds: query.spaceIds ?? [],
      kinds: query.kinds,
      sort: query.sort,
      reverse: query.reverse,
      limit: query.limit,
      excerpts: query.excerpts,
    });
  }

  @Get("pages/:pageId/related-labels")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List labels related to a page",
    description:
      "Lists labels that are used on pages the caller can read together with the labels of the page, or with the given labels, most used first, as the related labels block shows them.",
    tags: [TAG],
    params: pageParams,
    query: relatedLabelsQuerySchema,
    response: {
      description: "The labels.",
      schema: z.array(relatedLabelSchema).describe("Labels, most used first."),
      example: [{ label: "network", href: "/spaces/ITOPS/labels/network" }],
    },
  })
  async relatedLabels(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof relatedLabelsQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.reports.relatedLabels(actorOf(request), pageId, query.labels ?? []);
  }

  @Get("pages/:pageId/inclusion")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get content included in a page",
    description:
      "Returns the published content of another page, or its excerpt, as an include block of the page shows it, with the caller's permissions. For people who can edit the page, it also says whether some of its readers cannot read the included page. A page that was not part of a Confluence import is found by its space key and title once it is imported into the organization. A page the caller cannot read answers like a page that does not exist.",
    tags: [TAG],
    params: pageParams,
    query: inclusionQuerySchema,
    response: {
      description: "The included content.",
      schema: inclusionSchema,
      example: {
        state: "visible",
        page: {
          id: exampleReportPage.id,
          title: exampleReportPage.title,
          path: exampleReportPage.path,
          spaceId: exampleReportPage.spaceId,
        },
        document: exampleDocument,
        references: { people: {}, pages: {}, topics: {} },
        hiddenFromSomeReaders: false,
      },
    },
  })
  async inclusion(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof inclusionQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const included = await this.#services.includes.content(actor, pageId, {
      pageId: query.targetId ?? null,
      sourceSpace: query.sourceSpace ?? null,
      sourceTitle: query.sourceTitle ?? null,
      excerpt: query.excerpt,
      name: query.name ?? null,
    });
    if (!included) throw notFound("The included page does not exist or you cannot read it.");
    if (included.state === "noExcerpt") {
      return {
        state: "noExcerpt",
        page: included.page,
        document: null,
        references: { people: {}, pages: {}, topics: {} },
        hiddenFromSomeReaders: included.hiddenFromSomeReaders,
      };
    }
    return {
      state: "visible",
      page: included.page,
      document: included.document,
      references: await this.#services.documents.references(actor, included.document),
      hiddenFromSomeReaders: included.hiddenFromSomeReaders,
    };
  }
}
