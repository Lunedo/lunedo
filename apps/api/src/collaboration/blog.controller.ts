import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { BlogCursor } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, timestamp, uuid } from "../http/schemas.js";
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
const coverSchema = z
  .object({
    attachmentId: uuid("An image attached to the post, or null for no cover.").nullable(),
    focusX: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Horizontal focal point from 0 (left) to 1 (right)."),
    focusY: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Vertical focal point from 0 (top) to 1 (bottom)."),
  })
  .strict()
  .describe("The cover image.");
const blogCursor = z.tuple([z.string().max(64), z.string().max(64), z.string().max(40)]);

const subscriptionSchema = z
  .object({ following: z.boolean().describe("Whether the caller follows the blog of the space.") })
  .describe("The caller's subscription.");
const followedBlogSchema = z
  .object({
    spaceId: uuid("ID of the space."),
    spaceKey: z.string().describe("Key of the space."),
    spaceName: z.string().describe("Name of the space."),
    personal: z.boolean().describe("Whether it is a personal space."),
    followedAt: timestamp("When the caller started following."),
  })
  .describe("A blog the caller follows.");
const followedBlogsSchema = z
  .object({
    items: z.array(followedBlogSchema).describe("Blogs of spaces the caller can read, by name."),
    unavailable: z
      .number()
      .int()
      .describe(
        "Followed blogs of spaces the caller cannot read at the moment. Their notifications resume when access returns.",
      ),
  })
  .describe("Followed blogs.");
const removedSchema = z
  .object({ removed: z.number().int().describe("Number of subscriptions removed.") })
  .describe("The result.");
const exampleFollowedBlog = {
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  spaceKey: "ENG",
  spaceName: "Engineering",
  personal: false,
  followedAt: "2026-10-01T08:00:00.000Z",
};

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
    errors: ["invalidTitle", "invalidExcerpt", "knowledgeBaseContent"],
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
      "Publishes the draft at the given time, exactly once, also with several nodes. A new schedule replaces the old one. If the person who scheduled it can no longer edit the post at that time, the post is held: the space admins and that person are notified, and a space admin publishes it or cancels the schedule.",
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

  @Put("blog-posts/:postId/cover")
  @Permission("item.edit", post)
  @ApiRoute({
    summary: "Set the cover image of a blog post",
    description:
      "Chooses an image attached to the post as cover, with the focal point that stays visible when lists crop the image. Send `attachmentId: null` to remove the cover.",
    tags: [TAG],
    params: postParams,
    body: coverSchema,
    bodyExample: { attachmentId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40", focusX: 0.5, focusY: 0.3 },
    response: { description: "The post.", schema: blogPostSchema, example: exampleBlogPost },
    errors: ["invalidCover", "invalidFocus"],
  })
  async cover(
    @Param("postId") postId: string,
    @Body() body: z.output<typeof coverSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.blog.setCover(
      actorOf(request),
      postId,
      body.attachmentId
        ? { attachmentId: body.attachmentId, focusX: body.focusX, focusY: body.focusY }
        : null,
    );
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

  @Get("spaces/:spaceId/blog/scheduled")
  @Permission("space.manage", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "List scheduled blog posts of a space",
    description:
      "Lists every scheduled post of the space for its space admins, the held ones first, then by scheduled time.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The scheduled posts.",
      schema: z
        .object({ items: z.array(blogPostSchema).describe("Scheduled posts.") })
        .describe("Scheduled posts."),
      example: { items: [{ ...exampleBlogPost, published: false, held: true }] },
    },
  })
  async listScheduled(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return { items: await this.#services.blog.listScheduled(actorOf(request), spaceId) };
  }

  @Post("blog-posts/:postId/held/publish")
  @Permission("item.approveSchedule", post)
  @ApiRoute({
    summary: "Publish a held blog post",
    description:
      "Publishes a scheduled post that is waiting for approval because the person who scheduled it can no longer edit it. Recorded in the audit log.",
    tags: [TAG],
    params: postParams,
    response: { description: "The published post.", schema: blogPostSchema, example: exampleBlogPost },
    errors: ["notHeld"],
  })
  async publishHeld(@Param("postId") postId: string, @Req() request: FastifyRequest) {
    return this.#services.blog.publishHeld(actorOf(request), postId);
  }

  @Delete("blog-posts/:postId/held")
  @Permission("item.approveSchedule", post)
  @ApiRoute({
    summary: "Cancel the schedule of a held blog post",
    description:
      "Drops the schedule of a post that is waiting for approval. The post stays a draft. Recorded in the audit log.",
    tags: [TAG],
    params: postParams,
    response: {
      description: "The post without schedule.",
      schema: blogPostSchema,
      example: { ...exampleBlogPost, published: false },
    },
    errors: ["notHeld"],
  })
  async cancelHeld(@Param("postId") postId: string, @Req() request: FastifyRequest) {
    return this.#services.blog.cancelHeld(actorOf(request), postId);
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

  @Get("spaces/:spaceId/blog/subscription")
  @Permission("space.view", { type: "space", param: "spaceId" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Check whether you follow a blog",
    description: "Says whether the caller gets a notification for new posts of the space's blog.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The subscription.", schema: subscriptionSchema, example: { following: true } },
  })
  async subscription(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return { following: await this.#services.blogSubscriptions.following(actorOf(request), spaceId) };
  }

  @Put("spaces/:spaceId/blog/subscription")
  @Permission("space.view", { type: "space", param: "spaceId" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Follow a blog",
    description:
      "You get a notification for every new post of the space's blog that you can read, when it is published. Posts you wrote yourself are left out. While you cannot read the space, the subscription stays but sends nothing.",
    tags: [TAG],
    status: 204,
    params: spaceParams,
  })
  async follow(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    await this.#services.blogSubscriptions.follow(actorOf(request), spaceId);
  }

  @Delete("spaces/:spaceId/blog/subscription")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Stop following a blog",
    description: "Ends the subscription. It succeeds also when you did not follow the blog.",
    tags: [TAG],
    status: 204,
    params: spaceParams,
  })
  async unfollow(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    await this.#services.blogSubscriptions.unfollow(actorOf(request), spaceId);
  }

  @Get("account/followed-blogs")
  @SessionRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "List the blogs you follow",
    description:
      "Lists followed blogs of spaces the caller can read, by name, and counts those of spaces the caller cannot read at the moment.",
    tags: [TAG],
    response: {
      description: "The blogs.",
      schema: followedBlogsSchema,
      example: { items: [exampleFollowedBlog], unavailable: 0 },
    },
  })
  async followed(@Req() request: FastifyRequest) {
    const result = await this.#services.blogSubscriptions.list(actorOf(request));
    return { items: result.blogs, unavailable: result.unavailable };
  }

  @Delete("account/followed-blogs/unavailable")
  @SessionRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Stop following blogs you cannot read",
    description: "Ends the subscriptions to blogs of spaces you cannot read at the moment.",
    tags: [TAG],
    status: 200,
    response: { description: "Subscriptions removed.", schema: removedSchema, example: { removed: 1 } },
  })
  async removeUnavailable(@Req() request: FastifyRequest) {
    return { removed: await this.#services.blogSubscriptions.removeUnavailable(actorOf(request)) };
  }
}
