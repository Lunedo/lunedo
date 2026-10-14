import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import {
  MAX_SAVED_SEARCH_NAME,
  RECENT_SEARCH_LIMIT,
  type RecentSearch,
  SAVED_SEARCH_LIMIT,
  type SavedSearch,
  searchContentTypes,
  searchFiltersSchema,
  searchQueryTextSchema,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

const TAG = "Search";
const organization = { type: "organization", param: "organizationId" } as const;

const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const recentParams = organizationParams.extend({ searchId: uuid("ID of the recent search.") }).strict();
const savedParams = organizationParams.extend({ searchId: uuid("ID of the saved search.") }).strict();

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SAVED_SEARCH_NAME)
  .describe(`Name of the saved search, 1 to ${MAX_SAVED_SEARCH_NAME} characters.`);

const rememberSchema = z
  .object({ query: searchQueryTextSchema, filters: searchFiltersSchema })
  .strict()
  .describe("A search the caller ran.");

const createSavedSchema = z
  .object({ name: nameSchema, query: searchQueryTextSchema, filters: searchFiltersSchema })
  .strict()
  .describe("A search to save.");

const updateSavedSchema = z
  .object({
    name: nameSchema.optional(),
    query: searchQueryTextSchema.optional(),
    filters: searchFiltersSchema.optional(),
  })
  .strict()
  .describe("Fields to change.");

const storedFiltersSchema = searchFiltersSchema
  .extend({
    types: z
      .array(extensibleEnum(searchContentTypes, "A type: `page`, `blogPost` or `comment`."))
      .describe("Types of results."),
  })
  .describe("Filters of a search, as on the search page.");

const recentSchema = z
  .object({
    id: uuid("ID of the recent search."),
    query: z.string().describe("The search text."),
    filters: storedFiltersSchema,
    searchedAt: timestamp("When the caller last ran this search."),
  })
  .describe("A recent search.");

const savedSchema = z
  .object({
    id: uuid("ID of the saved search."),
    name: z.string().describe("Name of the saved search."),
    query: z.string().describe("The search text."),
    filters: storedFiltersSchema,
    createdAt: timestamp("When the search was saved."),
    updatedAt: timestamp("When the saved search last changed."),
  })
  .describe("A saved search. It stores the query and filters, never results.");

const recentListSchema = z
  .array(recentSchema)
  .describe(`Up to ${RECENT_SEARCH_LIMIT} searches, newest first.`);
const savedListSchema = z.array(savedSchema).describe("Saved searches, ordered by name.");

const exampleFilters = {
  spaceIds: [],
  types: ["page"],
  labels: ["runbook"],
  authorIds: [],
  statusIds: [],
  languages: [],
  updated: "month",
  includeArchived: false,
  sort: "relevance",
} as const;

const exampleRecent = {
  id: "01929b1e-7c1a-7000-8000-000000000031",
  query: "vpn gateway",
  filters: exampleFilters,
  searchedAt: "2026-10-14T08:30:00.000Z",
};

const exampleSaved = {
  id: "01929b1e-7c1a-7000-8000-000000000032",
  name: "Runbooks to verify",
  query: "status:draft",
  filters: exampleFilters,
  createdAt: "2026-10-14T08:30:00.000Z",
  updatedAt: "2026-10-14T08:30:00.000Z",
};

function toRecent(search: RecentSearch): z.output<typeof recentSchema> {
  return { ...search, searchedAt: search.searchedAt.toISOString() };
}

function toSaved(search: SavedSearch): z.output<typeof savedSchema> {
  return { ...search, createdAt: search.createdAt.toISOString(), updatedAt: search.updatedAt.toISOString() };
}

@Controller("api/v1/organizations")
export class SavedSearchesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #searches() {
    return servicesOf(this.context).savedSearches;
  }

  @Get(":organizationId/search/recent")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "List your recent searches",
    description: `Lists the last ${RECENT_SEARCH_LIMIT} searches the caller ran in the organization, newest first. Only the caller sees them.`,
    tags: [TAG],
    params: organizationParams,
    response: { description: "Recent searches.", schema: recentListSchema, example: [exampleRecent] },
  })
  async recent(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return (await this.#searches.recent(actorOf(request), organizationId)).map(toRecent);
  }

  @Post(":organizationId/search/recent")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Remember a search",
    description: `Adds a search to the caller's recent searches, or moves it to the top when it is there already. Only the last ${RECENT_SEARCH_LIMIT} are kept. An empty query is not remembered.`,
    tags: [TAG],
    params: organizationParams,
    body: rememberSchema,
    bodyExample: { query: exampleRecent.query, filters: exampleFilters },
  })
  async remember(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof rememberSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#searches.remember(actorOf(request), organizationId, body.query, body.filters);
  }

  @Delete(":organizationId/search/recent")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Clear your recent searches",
    description: "Deletes all recent searches of the caller in the organization.",
    tags: [TAG],
    params: organizationParams,
  })
  async forgetAll(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    await this.#searches.forgetAll(actorOf(request), organizationId);
  }

  @Delete(":organizationId/search/recent/:searchId")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Delete a recent search",
    description: "Deletes one of the caller's recent searches.",
    tags: [TAG],
    params: recentParams,
    errors: ["notFound"],
  })
  async forget(
    @Param("organizationId") organizationId: string,
    @Param("searchId") searchId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#searches.forget(actorOf(request), organizationId, searchId))) throw notFound();
  }

  @Get(":organizationId/search/saved")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "List your saved searches",
    description: "Lists the searches the caller saved in the organization. Only the caller sees them.",
    tags: [TAG],
    params: organizationParams,
    response: { description: "Saved searches.", schema: savedListSchema, example: [exampleSaved] },
  })
  async saved(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return (await this.#searches.saved(actorOf(request), organizationId)).map(toSaved);
  }

  @Post(":organizationId/search/saved")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Save a search",
    description: `Saves a query with its filters under a name for the caller. Running it later shows what the caller can read at that time. Up to ${SAVED_SEARCH_LIMIT} per person and organization.`,
    tags: [TAG],
    params: organizationParams,
    body: createSavedSchema,
    bodyExample: { name: exampleSaved.name, query: exampleSaved.query, filters: exampleFilters },
    status: 201,
    response: { description: "The saved search.", schema: savedSchema, example: exampleSaved },
    errors: ["tooManySavedSearches"],
  })
  async save(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createSavedSchema>,
    @Req() request: FastifyRequest,
  ) {
    return toSaved(await this.#searches.save(actorOf(request), organizationId, body));
  }

  @Patch(":organizationId/search/saved/:searchId")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Change a saved search",
    description: "Renames a saved search of the caller or replaces its query or filters.",
    tags: [TAG],
    params: savedParams,
    body: updateSavedSchema,
    bodyExample: { name: "Verify runbooks" },
    response: { description: "The saved search.", schema: savedSchema, example: exampleSaved },
    errors: ["notFound"],
  })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("searchId") searchId: string,
    @Body() body: z.output<typeof updateSavedSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#searches.update(actorOf(request), organizationId, searchId, body);
    if (!updated) throw notFound();
    return toSaved(updated);
  }

  @Delete(":organizationId/search/saved/:searchId")
  @Permission("organization.search", organization)
  @ApiRoute({
    summary: "Delete a saved search",
    description: "Deletes one of the caller's saved searches.",
    tags: [TAG],
    params: savedParams,
    errors: ["notFound"],
  })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("searchId") searchId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#searches.remove(actorOf(request), organizationId, searchId))) throw notFound();
  }
}
