import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, uuid } from "../http/schemas.js";
import { exampleItem } from "../spaces/schemas.js";
import {
  exampleBlogPost,
  exampleTask,
  forYouSchema,
  homePageSchema,
  mentionSchema,
  recentSchema,
  setHomePageSchema,
  starredSchema,
} from "./schemas.js";

const TAG = "Home";
const itemParams = z.object({ itemId: uuid("ID of the page or blog post.") }).strict();
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const exampleReference = {
  id: exampleTask.item.id,
  number: exampleItem.number,
  kind: "page",
  title: exampleTask.item.title,
  spaceId: exampleTask.item.spaceId,
  spaceKey: exampleTask.item.spaceKey,
  spaceName: exampleTask.item.spaceName,
  mySpace: false,
};
const exampleStarred = {
  items: [{ ...exampleReference, starredAt: "2026-10-06T08:00:00.000Z" }],
  spaces: [],
};
const exampleRecent = [{ ...exampleReference, viewedAt: "2026-10-07T08:00:00.000Z" }];
const exampleMention = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5e01",
  item: exampleReference,
  commentId: null,
  actor: { id: exampleTask.assignee.id, name: "Anna Berger" },
  at: "2026-10-07T08:00:00.000Z",
};

@Controller("api/v1")
export class HomeController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("home")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "Get the personal home page",
    description:
      'Returns what the personal home page "For you" shows: recently viewed items, starred items and spaces, open tasks due soon, mentions and new blog posts. Everything is limited to content the caller can read.',
    tags: [TAG],
    response: {
      description: "Data of the home page.",
      schema: forYouSchema,
      example: {
        recent: exampleRecent,
        starred: exampleStarred,
        tasks: [exampleTask],
        mentions: [exampleMention],
        posts: [exampleBlogPost],
      },
    },
    errors: ["personalOnly"],
  })
  async forYou(@Req() request: FastifyRequest) {
    return this.#services.home.forYou(actorOf(request));
  }

  @Get("starred")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List starred items and spaces",
    description: "Lists what the caller starred, limited to items and spaces the caller can still read.",
    tags: [TAG],
    response: { description: "Starred items and spaces.", schema: starredSchema, example: exampleStarred },
    errors: ["personalOnly"],
  })
  async starred(@Req() request: FastifyRequest) {
    return this.#services.home.starred(actorOf(request));
  }

  @Put("starred/items/:itemId")
  @Permission("item.view", { type: "item", param: "itemId" })
  @ApiRoute({
    summary: "Star a page or blog post",
    description: "Stars are personal; nobody else sees them.",
    tags: [TAG],
    params: itemParams,
    errors: ["personalOnly", "tooManyStars"],
  })
  async starItem(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    await this.#services.home.star(actorOf(request), { itemId }, true);
  }

  @Delete("starred/items/:itemId")
  @Permission("item.view", { type: "item", param: "itemId" })
  @ApiRoute({
    summary: "Remove the star from a page or blog post",
    description: "Removing a star that does not exist changes nothing.",
    tags: [TAG],
    params: itemParams,
  })
  async unstarItem(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    await this.#services.home.star(actorOf(request), { itemId }, false);
  }

  @Put("starred/spaces/:spaceId")
  @Permission("space.view", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "Star a space",
    description: "Stars are personal; nobody else sees them.",
    tags: [TAG],
    params: spaceParams,
    errors: ["personalOnly", "tooManyStars"],
  })
  async starSpace(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    await this.#services.home.star(actorOf(request), { spaceId }, true);
  }

  @Delete("starred/spaces/:spaceId")
  @Permission("space.view", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "Remove the star from a space",
    description: "Removing a star that does not exist changes nothing.",
    tags: [TAG],
    params: spaceParams,
  })
  async unstarSpace(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    await this.#services.home.star(actorOf(request), { spaceId }, false);
  }

  @Get("recent")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List recently viewed items",
    description:
      "Lists what the caller viewed in the last 90 days. Only the caller sees it; there are no read receipts.",
    tags: [TAG],
    response: { description: "Recently viewed items.", schema: recentSchema, example: exampleRecent },
    errors: ["personalOnly"],
  })
  async recent(@Req() request: FastifyRequest) {
    return this.#services.home.recent(actorOf(request));
  }

  @Post("items/:itemId/views")
  @Permission("item.view", { type: "item", param: "itemId" })
  @ApiRoute({
    summary: "Record a view",
    description: "Adds the item to the caller's recently viewed items. Views older than 90 days are deleted.",
    tags: [TAG],
    params: itemParams,
  })
  async view(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    await this.#services.home.recordView(actorOf(request), itemId);
  }

  @Get("mentions")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List mentions of the caller",
    description:
      "Lists the latest mentions of the caller in published content and comments the caller can read.",
    tags: [TAG],
    response: {
      description: "Mentions, newest first.",
      schema: z.array(mentionSchema).describe("Mentions."),
      example: [exampleMention],
    },
    errors: ["personalOnly"],
  })
  async mentions(@Req() request: FastifyRequest) {
    return this.#services.home.mentions(actorOf(request));
  }

  @Get("organizations/:organizationId/home-page")
  @Permission("organization.view", { type: "organization", param: "organizationId" })
  @ApiRoute({
    summary: "Get the organization home page",
    description: "Returns the page organization admins chose as home page, if the caller can read it.",
    tags: [TAG],
    params: organizationIdParams,
    response: { description: "The home page.", schema: homePageSchema, example: { page: exampleReference } },
  })
  async organizationHomePage(
    @Param("organizationId") organizationId: string,
    @Req() request: FastifyRequest,
  ) {
    return { page: await this.#services.home.organizationHomePage(actorOf(request), organizationId) };
  }

  @Put("organizations/:organizationId/home-page")
  @Permission("organization.settings.manage", { type: "organization", param: "organizationId" })
  @ApiRoute({
    summary: "Set the organization home page",
    description:
      "Chooses an existing page of a space of the organization as its home page, or none. Members choose in their preferences whether they land there after sign-in. The change is recorded in the audit log.",
    tags: [TAG],
    params: organizationIdParams,
    body: setHomePageSchema,
    bodyExample: { itemId: exampleReference.id },
    response: {
      description: "The new home page.",
      schema: homePageSchema,
      example: { page: exampleReference },
    },
    errors: ["invalidHomePage"],
  })
  async setOrganizationHomePage(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof setHomePageSchema>,
    @Req() request: FastifyRequest,
  ) {
    return {
      page: await this.#services.home.setOrganizationHomePage(actorOf(request), organizationId, body.itemId),
    };
  }
}
