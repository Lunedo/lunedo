import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { BlogCursor } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, uuid } from "../http/schemas.js";
import {
  blogPageSchema,
  blogPostSchema,
  blogQuerySchema,
  createBlogPostSchema,
  exampleBlogPost,
  organizationBlogQuerySchema,
  pinSchema,
  scheduleSchema,
  updateBlogPostSchema,
} from "./schemas.js";

const TAG = "Blog";
const post = { type: "item", param: "postId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const postParams = z.object({ postId: uuid("ID of the blog post.") }).strict();
const organizationPostParams = organizationIdParams.extend({ postId: uuid("ID of the blog post.") }).strict();
const blogCursor = z.tuple([z.string().max(64), z.string().max(64), z.string().max(40)]);

function page(result: { posts: unknown[]; next: BlogCursor | null }) {
  return { items: result.posts, nextCursor: result.next ? encodeCursor(result.next) : null };
}

@Controller("api/v1")
export class BlogController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #post(request: FastifyRequest, postId: string) {
    const found = await this.#services.blog.get(actorOf(request), postId);
    if (!found) throw notFound();
    return found;
  }

  @Get("spaces/:spaceId/blog")
  @Permission("space.view", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "List the blog of a space",
    description:
      "Lists the blog posts of a space: pinned posts first, then the newest. Editors also see drafts and scheduled posts.",
    tags: [TAG],
    params: spaceParams,
    query: blogQuerySchema,
    response: {
      description: "The posts.",
      schema: blogPageSchema,
      example: { items: [exampleBlogPost], nextCursor: null },
    },
  })
  async listSpace(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof blogQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, blogCursor) ?? undefined;
    return page(
      await this.#services.blog.listSpace(actorOf(request), spaceId, { after, limit: query.limit }),
    );
  }

  @Post("spaces/:spaceId/blog")
  @Permission("space.edit", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "Write a blog post",
    description:
      "Creates a blog post as a draft. Blog posts always use publish mode: edit the content like a page, then publish it or schedule the publication.",
    tags: [TAG],
    params: spaceParams,
    body: createBlogPostSchema,
    bodyExample: { title: "New VPN client from Monday", excerpt: "The company portal ships WireGuard 0.6." },
    status: 201,
    response: {
      description: "The new post.",
      schema: blogPostSchema,
      example: { ...exampleBlogPost, published: false },
    },
    errors: ["invalidTitle", "invalidExcerpt"],
  })
  async create(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createBlogPostSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.blog.create(actorOf(request), spaceId, body);
  }

  @Get("blog-posts/:postId")
  @Permission("item.view", post)
  @ApiRoute({
    summary: "Get a blog post",
    description: "Returns the details of a blog post. Its content comes from the page content endpoints.",
    tags: [TAG],
    params: postParams,
    response: { description: "The post.", schema: blogPostSchema, example: exampleBlogPost },
  })
  async get(@Param("postId") postId: string, @Req() request: FastifyRequest) {
    return this.#post(request, postId);
  }

  @Patch("blog-posts/:postId")
  @Permission("item.edit", post)
  @ApiRoute({
    summary: "Change a blog post",
    description:
      "Changes the excerpt. The title is changed through the item endpoint and becomes visible with the next publication.",
    tags: [TAG],
    params: postParams,
    body: updateBlogPostSchema,
    bodyExample: { excerpt: "Existing tunnels keep working." },
    response: { description: "The changed post.", schema: blogPostSchema, example: exampleBlogPost },
    errors: ["invalidExcerpt"],
  })
  async update(
    @Param("postId") postId: string,
    @Body() body: z.output<typeof updateBlogPostSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.blog.update(actorOf(request), postId, body);
  }

  @Put("blog-posts/:postId/schedule")
  @Permission("item.edit", post)
  @ApiRoute({
    summary: "Schedule the publication of a blog post",
    description:
      "Publishes the draft at the given time, exactly once, also with several nodes. A new schedule replaces the old one. If the person who scheduled it can no longer edit the post at that time, the schedule is dropped.",
    tags: [TAG],
    params: postParams,
    body: scheduleSchema,
    bodyExample: { at: "2026-10-14T07:00:00+02:00", timeZone: "Europe/Vienna" },
    response: {
      description: "The post with its schedule.",
      schema: blogPostSchema,
      example: {
        ...exampleBlogPost,
        scheduledAt: "2026-10-14T05:00:00.000Z",
        scheduledTimeZone: "Europe/Vienna",
      },
    },
    errors: ["scheduleInPast", "scheduleTooLate", "invalidTimeZone"],
  })
  async schedule(
    @Param("postId") postId: string,
    @Body() body: z.output<typeof scheduleSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.blog.schedule(actorOf(request), postId, body);
  }

  @Delete("blog-posts/:postId/schedule")
  @Permission("item.edit", post)
  @ApiRoute({
    summary: "Cancel a scheduled publication",
    description: "Drops the schedule. The post stays a draft until someone publishes it.",
    tags: [TAG],
    params: postParams,
    response: { description: "The post without schedule.", schema: blogPostSchema, example: exampleBlogPost },
  })
  async cancelSchedule(@Param("postId") postId: string, @Req() request: FastifyRequest) {
    return this.#services.blog.schedule(actorOf(request), postId, null);
  }

  @Put("blog-posts/:postId/pinned")
  @Permission("item.pin", post)
  @ApiRoute({
    summary: "Pin a blog post in its space",
    description: "Space admins pin published posts at the top of their space's blog.",
    tags: [TAG],
    params: postParams,
    body: pinSchema,
    bodyExample: { pinned: true },
    response: {
      description: "The post.",
      schema: blogPostSchema,
      example: { ...exampleBlogPost, pinnedInSpace: true },
    },
    errors: ["notPublished"],
  })
  async pinInSpace(
    @Param("postId") postId: string,
    @Body() body: z.output<typeof pinSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.blog.pin(actorOf(request), postId, "space", body.pinned);
  }

  @Get("organizations/:organizationId/blog")
  @Permission("organization.view", { type: "organization", param: "organizationId" })
  @ApiRoute({
    summary: "List the blog posts of an organization",
    description:
      "Lists published blog posts of all spaces of the organization the caller can read: pinned posts first, then the newest. Filter by space and label.",
    tags: [TAG],
    params: organizationIdParams,
    query: organizationBlogQuerySchema,
    response: {
      description: "The posts.",
      schema: blogPageSchema,
      example: { items: [exampleBlogPost], nextCursor: null },
    },
  })
  async listOrganization(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof organizationBlogQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, blogCursor) ?? undefined;
    return page(
      await this.#services.blog.listOrganization(actorOf(request), organizationId, {
        spaceId: query.spaceId,
        label: query.label,
        after,
        limit: query.limit,
      }),
    );
  }

  @Put("organizations/:organizationId/blog/pinned/:postId")
  @Permission("organization.blog.pin", { type: "organization", param: "organizationId" })
  @ApiRoute({
    summary: "Pin a blog post in the organization overview",
    description: "Organization admins pin published posts at the top of the organization's blog overview.",
    tags: [TAG],
    params: organizationPostParams,
    body: pinSchema,
    bodyExample: { pinned: true },
    response: { description: "The post.", schema: blogPostSchema, example: exampleBlogPost },
    errors: ["notPublished", "notInOrganization"],
  })
  async pinInOrganization(
    @Param("organizationId") organizationId: string,
    @Param("postId") postId: string,
    @Body() body: z.output<typeof pinSchema>,
    @Req() request: FastifyRequest,
  ) {
    const found = await this.#post(request, postId);
    const space = await this.#services.spaces.get(found.spaceId);
    if (space?.organizationId !== organizationId) throw notFound();
    return this.#services.blog.pin(actorOf(request), postId, "organization", body.pinned);
  }
}
