import { MAX_CATEGORY_GROUPS } from "@lunedo/server";
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";

const TAG = "Knowledge bases";

const space = { type: "space", param: "spaceId" } as const;

const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();

const categoryParams = z
  .object({
    spaceId: uuid("ID of the knowledge base."),
    itemId: uuid("ID of the category, a folder of the knowledge base."),
  })
  .strict();

const groupSchema = z
  .object({ id: uuid("ID of the group."), name: z.string().describe("Name of the group.") })
  .describe("A group.");

const groupsSchema = z.array(groupSchema).describe("Groups, sorted by name.");

const categoryAccessSchema = z
  .object({
    itemId: uuid("ID of the category."),
    parentId: uuid("ID of the category above, or null for a top-level category.").nullable(),
    title: z.string().describe("Title of the category."),
    readable: z
      .boolean()
      .describe(
        "Whether the caller may read the category. Space admins also get categories they may not read, with title and settings only, so they can remove the restriction.",
      ),
    responsibleGroups: groupsSchema
      .nullable()
      .describe(
        "Groups set on this category that create, edit, publish, move and delete its articles; null when the category sets none. An empty list means its groups were deleted: only space admins write.",
      ),
    inheritedResponsibleGroups: groupsSchema
      .nullable()
      .describe("Groups of the nearest category above that sets responsible groups, or null."),
    visibleTo: groupsSchema
      .nullable()
      .describe(
        "Groups that may read this category and everything below it, or null when it reads like the knowledge base.",
      ),
    visibleToPeople: z
      .number()
      .int()
      .describe(
        "Number of single people who may also read the restricted category, set before categories had their own dialog.",
      ),
    inheritedVisibleTo: groupsSchema
      .nullable()
      .describe("Readers of the nearest restricted category above, or null."),
    articles: z.number().int().describe("Articles in the category and below that the caller may count."),
    subcategories: z.number().int().describe("Direct subcategories that the caller may count."),
    mine: z
      .boolean()
      .describe("Whether the caller belongs to the responsible groups of the category, set here or above."),
    writable: z
      .boolean()
      .describe(
        "Whether the caller may change the articles of the category, as responsible person or space admin.",
      ),
  })
  .describe("Access settings of a category.");

const exampleAccess = {
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  parentId: null,
  title: "IT and devices",
  readable: true,
  responsibleGroups: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a31", name: "IT" }],
  inheritedResponsibleGroups: null,
  visibleTo: null,
  visibleToPeople: 0,
  inheritedVisibleTo: null,
  articles: 42,
  subcategories: 3,
  mine: true,
  writable: true,
};

const changeSchema = z
  .object({
    responsibleGroupIds: z
      .array(uuid("ID of a group."))
      .max(MAX_CATEGORY_GROUPS)
      .describe(
        "Groups that create, edit, publish, move and delete articles here. Empty: everyone with the editor role.",
      ),
    visibleGroupIds: z
      .array(uuid("ID of a group."))
      .max(MAX_CATEGORY_GROUPS)
      .nullable()
      .describe("Groups that may read the category, or null to read it like the knowledge base."),
  })
  .strict();

const changeBodySchema = changeSchema
  .extend({
    confirmWidening: z
      .boolean()
      .default(false)
      .describe(
        "Confirms a change that lets more people read the category. Without it such a change is refused.",
      ),
  })
  .strict()
  .describe("The new access settings.");

const effectSchema = z
  .object({
    articles: z.number().int().describe("Articles in the category and below."),
    widening: z.boolean().describe("Whether more people could read the category after the change."),
    losingWrite: z
      .array(
        z
          .object({
            accountId: uuid("ID of the person."),
            name: z.string().describe("Name of the person."),
          })
          .describe("A person who can no longer change the articles."),
      )
      .describe("People who can no longer change articles, as far as the caller may see them, up to 100."),
    losingWriteCount: z.number().int().describe("Number of people who can no longer change articles."),
    losingRead: z.number().int().describe("Number of people who can no longer read some of the articles."),
    gainingRead: z
      .number()
      .int()
      .describe("Number of people who can read articles they could not read before."),
    publicPortalLosesAccess: z
      .boolean()
      .describe("Whether anonymous readers of the public portal and the static site lose the category."),
    unlisted: z.number().int().describe("People with changed access whom the caller may not see by name."),
  })
  .describe("What the change means.");

@Controller("api/v1")
export class CategoryAccessController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/knowledge-base/category-access")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the access of the categories",
    description:
      "Lists the categories of a knowledge base that the caller may read, with their responsible groups and readers, ordered by depth and position. Space admins also get categories they may not read.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The categories.",
      schema: z.array(categoryAccessSchema).describe("Categories."),
      example: [exampleAccess],
    },
    errors: ["notKnowledgeBase"],
  })
  async list(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.categoryAccess.list(actorOf(request), spaceId);
  }

  @Post("spaces/:spaceId/knowledge-base/categories/:itemId/access/preview")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Preview a change of the access of a category",
    description:
      "Says who could no longer change articles, how many people lose or gain read access and how many articles are affected. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: categoryParams,
    body: changeSchema.describe("The new access settings."),
    bodyExample: { responsibleGroupIds: ["01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a31"], visibleGroupIds: null },
    response: {
      description: "The effect.",
      schema: effectSchema,
      example: {
        articles: 42,
        widening: false,
        losingWrite: [{ accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21", name: "Lukas Hofer" }],
        losingWriteCount: 1,
        losingRead: 0,
        gainingRead: 0,
        publicPortalLosesAccess: false,
        unlisted: 0,
      },
    },
    errors: [
      "notKnowledgeBase",
      "categoryAccessForSpaceAdmins",
      "categoryGroupsMissing",
      "categoryWidensParent",
      "tooManyGroups",
      "invalidHolder",
    ],
  })
  async preview(
    @Param("spaceId") spaceId: string,
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof changeSchema>,
    @Req() request: FastifyRequest,
  ) {
    const effect = await this.#services.categoryAccess.preview(actorOf(request), spaceId, itemId, body);
    return {
      ...effect,
      losingWrite: effect.losingWrite.map((change) => ({ accountId: change.accountId, name: change.name })),
    };
  }

  @Put("spaces/:spaceId/knowledge-base/categories/:itemId/access")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change who maintains and who reads a category",
    description:
      "Sets the responsible groups and the readers of a category; both apply to everything below it, and a subcategory can only name groups of the category above. Only space admins of the knowledge base change them. A change that lets more people read needs `confirmWidening`. Every change is audited.",
    tags: [TAG],
    params: categoryParams,
    body: changeBodySchema,
    bodyExample: {
      responsibleGroupIds: ["01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a31"],
      visibleGroupIds: null,
      confirmWidening: false,
    },
    response: {
      description: "The category after the change.",
      schema: categoryAccessSchema,
      example: exampleAccess,
    },
    errors: [
      "notKnowledgeBase",
      "categoryAccessForSpaceAdmins",
      "categoryGroupsMissing",
      "categoryWidensParent",
      "categoryVisibilityWidening",
      "tooManyGroups",
      "invalidHolder",
    ],
  })
  async change(
    @Param("spaceId") spaceId: string,
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof changeBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.categoryAccess.change(actorOf(request), spaceId, itemId, body);
  }
}
