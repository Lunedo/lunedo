import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_QUERY_LENGTH,
  QUICK_SEARCH_LIMIT,
  SEARCH_PAGE_LIMIT,
  type SearchResponse,
  searchContentTypes,
  searchSorts,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, inputTimestamp, organizationIdParams, timestamp, uuid } from "../http/schemas.js";

const TAG = "Search";
const organization = { type: "organization", param: "organizationId" } as const;
const MAX_LIST_VALUES = 20;

function list<T extends z.ZodType<unknown, string>>(item: T, description: string) {
  return z
    .string()
    .max(2000)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(item).max(MAX_LIST_VALUES))
    .optional()
    .describe(`${description} Up to ${MAX_LIST_VALUES} values, separated by commas.`);
}

const cursorSchema = z.tuple([z.number(), z.string().max(40), uuid("ID of the last result.")]);

const searchQuery = z
  .object({
    q: z
      .string()
      .max(MAX_QUERY_LENGTH)
      .default("")
      .describe(
        'The search text. Words must all match. `"exact phrase"` matches the words in this order, `-word` excludes a word, `OR` between two words matches either. The operators `space:KEY`, `label:name`, `author:name`, `status:value` and `type:page|blog|comment` filter like the parameters; quote values with spaces.',
      ),
    mode: z
      .enum(["full", "quick"])
      .default("full")
      .describe(
        "`full` (default) for the search page with counts per filter value and pages of results. `quick` for search while typing: few results, the last word also matches longer words, results of `spaceId` first, no counts and no further pages.",
      ),
    spaceId: uuid("In quick search, the space the person is in; its results come first.").optional(),
    spaceIds: list(uuid("ID of a space."), "Only results in these spaces."),
    types: list(z.enum(searchContentTypes), "Only results of these types: `page`, `blogPost` or `comment`."),
    labels: list(z.string().max(100), "Only pages with at least one of these labels."),
    authorIds: list(uuid("ID of an author."), "Only results by these authors."),
    statuses: list(z.string().max(100), "Only pages with one of these statuses."),
    includeArchived: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true")
      .describe("`true` includes archived pages. Default `false`."),
    updatedAfter: inputTimestamp("Only results changed at or after this time.").optional(),
    updatedBefore: inputTimestamp("Only results changed before this time.").optional(),
    sort: z
      .enum(searchSorts)
      .default("relevance")
      .describe("`relevance` (default), best matches first, or `newest`, last changed first."),
    cursor: z
      .string()
      .max(500)
      .optional()
      .describe("Cursor from `nextCursor` of the previous page. Leave it out for the first page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SEARCH_PAGE_LIMIT)
      .optional()
      .describe(
        `Maximum number of results, from 1 to ${SEARCH_PAGE_LIMIT}. Default ${DEFAULT_SEARCH_LIMIT}, in quick search ${QUICK_SEARCH_LIMIT}.`,
      ),
  })
  .strict();

const excerptSchema = z
  .array(
    z
      .object({
        text: z.string().describe("Part of the excerpt."),
        highlighted: z.boolean().describe("Whether this part matched the search words."),
      })
      .describe("Part of an excerpt."),
  )
  .describe("Text around the matched words, from content the caller can read only.");

const spaceRefSchema = z
  .object({
    id: uuid("ID of the space."),
    key: z.string().describe("Key of the space."),
    name: z.string().describe("Name of the space."),
  })
  .describe("A space the caller can open.");

const resultSchema = z
  .object({
    type: extensibleEnum(searchContentTypes, "`page`, `blogPost` or `comment`."),
    id: uuid("ID of the page, blog post or comment."),
    itemId: uuid("ID of the page or blog post; for a comment, the page it belongs to."),
    title: z.string().describe("Title of the page or blog post; for a comment, of its page."),
    heading: z.string().describe("Heading of the section that matched, or an empty string."),
    anchor: z.string().nullable().describe("Anchor of that heading on the page, or null."),
    excerpt: excerptSchema,
    space: spaceRefSchema
      .nullable()
      .describe("The space, or null when the caller can read the page only because it was shared with them."),
    sharedWithYou: z
      .boolean()
      .describe(
        "Whether the caller can read the page only through a share. Space and path stay hidden then.",
      ),
    path: z
      .array(
        z
          .object({ id: uuid("ID of the page."), title: z.string().describe("Title of the page.") })
          .describe("A parent page."),
      )
      .describe("Parent pages the caller can read, from the top. Empty for shared pages."),
    labels: z.array(z.string()).describe("Labels of the page."),
    status: z.string().nullable().describe("Status of the page, or null."),
    author: z
      .object({ id: uuid("ID of the author."), name: z.string().describe("Name of the author.") })
      .nullable()
      .describe("The author, or null when unknown or not visible to the caller."),
    archived: z.boolean().describe("Whether the page is archived."),
    updatedAt: timestamp("When the content last changed."),
  })
  .describe("A search result.");

function facetSchema<T extends z.ZodType>(value: T, description: string) {
  return z
    .array(z.object({ value, count: z.number().int().describe("Number of results.") }).describe(description))
    .describe(`${description}s with their number of results.`);
}

const responseSchema = z
  .object({
    results: z.array(resultSchema).describe("Results, in the requested order."),
    total: z.number().int().describe("Number of results the caller can read, on all pages."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
    facets: z
      .object({
        types: facetSchema(extensibleEnum(searchContentTypes, "The type."), "Type"),
        spaces: z
          .array(
            z
              .object({
                id: uuid("ID of the space.")
                  .nullable()
                  .describe("ID of the space, or null for pages shared with the caller."),
                key: z.string().nullable().describe("Key of the space, or null."),
                name: z.string().nullable().describe("Name of the space, or null."),
                count: z.number().int().describe("Number of results."),
              })
              .describe("A space."),
          )
          .describe("Spaces with their number of results."),
        labels: facetSchema(z.string().describe("The label."), "Label"),
        authors: z
          .array(
            z
              .object({
                id: uuid("ID of the author."),
                name: z.string().describe("Name of the author."),
                count: z.number().int().describe("Number of results."),
              })
              .describe("An author."),
          )
          .describe("Authors with their number of results."),
        statuses: facetSchema(z.string().describe("The status."), "Status"),
      })
      .nullable()
      .describe("Number of results per filter value, or null in quick search."),
    index: z
      .object({
        building: z
          .boolean()
          .describe("Whether the index is being built; results may be incomplete meanwhile."),
      })
      .describe("State of the search index."),
  })
  .describe("Search results.");

const exampleResponse = {
  results: [
    {
      type: "page",
      id: "01929b1e-7c1a-7000-8000-000000000020",
      itemId: "01929b1e-7c1a-7000-8000-000000000020",
      title: "VPN access",
      heading: "Setup",
      anchor: "setup",
      excerpt: [
        { text: "Install the ", highlighted: false },
        { text: "WireGuard", highlighted: true },
        { text: " client on your laptop.", highlighted: false },
      ],
      space: { id: "01929b1e-7c1a-7000-8000-000000000010", key: "ITOPS", name: "IT Operations" },
      sharedWithYou: false,
      path: [],
      labels: ["vpn"],
      status: null,
      author: { id: "01929b1e-7c1a-7000-8000-000000000001", name: "Ada Lovelace" },
      archived: false,
      updatedAt: "2026-10-14T08:30:00.000Z",
    },
  ],
  total: 1,
  nextCursor: null,
  facets: {
    types: [{ value: "page", count: 1 }],
    spaces: [{ id: "01929b1e-7c1a-7000-8000-000000000010", key: "ITOPS", name: "IT Operations", count: 1 }],
    labels: [{ value: "vpn", count: 1 }],
    authors: [{ id: "01929b1e-7c1a-7000-8000-000000000001", name: "Ada Lovelace", count: 1 }],
    statuses: [],
  },
  index: { building: false },
};

function toApi(response: SearchResponse): z.output<typeof responseSchema> {
  return {
    results: response.results.map(({ cursor: _cursor, ...hit }) => hit),
    total: response.total,
    nextCursor: response.nextCursor
      ? encodeCursor([response.nextCursor.score, response.nextCursor.updatedAt, response.nextCursor.sourceId])
      : null,
    facets: response.facets
      ? {
          types: response.facets.contentTypes,
          spaces: response.facets.spaces.map((facet) => ({
            id: facet.value,
            key: facet.key,
            name: facet.name,
            count: facet.count,
          })),
          labels: response.facets.labels,
          authors: response.facets.authors.map((facet) => ({
            id: facet.value,
            name: facet.name,
            count: facet.count,
          })),
          statuses: response.facets.statuses,
        }
      : null,
    index: { building: response.index.building },
  };
}

@Controller("api/v1/organizations")
export class SearchController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  @Get(":organizationId/search")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Search the content of an organization",
    description:
      "Searches pages, blog posts and comments of all spaces of the organization the caller can read, for the search page and for search while typing. Results, counts and excerpts only ever include content the caller can read; pages shared with the caller show no space or path. Drafts are never searched. Unknown filter values and values of things the caller cannot see give the same empty answer.",
    tags: [TAG],
    params: organizationIdParams,
    query: searchQuery,
    response: { description: "The results.", schema: responseSchema, example: exampleResponse },
  })
  async search(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof searchQuery>,
    @Req() request: FastifyRequest,
  ): Promise<z.output<typeof responseSchema>> {
    const after = decodeCursor(query.cursor, cursorSchema);
    const quick = query.mode === "quick";
    const response = await servicesOf(this.context).search.search(actorOf(request), organizationId, {
      query: query.q,
      mode: query.mode,
      spaceIds: query.spaceIds ?? [],
      contentTypes: query.types ?? [],
      labels: query.labels ?? [],
      authorIds: query.authorIds ?? [],
      statuses: query.statuses ?? [],
      includeArchived: query.includeArchived,
      updatedAfter: query.updatedAfter ?? null,
      updatedBefore: query.updatedBefore ?? null,
      sort: query.sort,
      limit: query.limit ?? (quick ? QUICK_SEARCH_LIMIT : DEFAULT_SEARCH_LIMIT),
      cursor: after ? { score: after[0], updatedAt: after[1], sourceId: after[2] } : null,
      currentSpaceId: query.spaceId ?? null,
    });
    return toApi(response);
  }
}
