import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { MAX_COMMENTS_PER_PAGE } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  commentInputSchema,
  commentListSchema,
  createCommentSchema,
  createdSchema,
  exampleCommentBody,
  exampleThread,
  mentionAccessSchema,
  reactionsSchema,
  resolveSchema,
} from "./schemas.js";

const TAG = "Comments";
const page = { type: "item", param: "pageId" } as const;
const comment = { type: "comment", param: "commentId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page or blog post.") }).strict();
const commentParams = z.object({ commentId: uuid("ID of the comment.") }).strict();
const emoji = z.string().min(1).max(64).describe("The emoji, URL-encoded.");
const pageReactionParams = pageParams.extend({ emoji }).strict();
const commentReactionParams = commentParams.extend({ emoji }).strict();
const mentionQuery = z
  .object({
    accountIds: z
      .string()
      .max(800)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(uuid("Account ID.")).min(1).max(20))
      .describe("Up to 20 account IDs, separated by commas."),
  })
  .strict();

@Controller("api/v1")
export class CommentsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("pages/:pageId/comments")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the comments of a page",
    description: `Lists page comments and inline comments with their replies, oldest first, up to ${MAX_COMMENTS_PER_PAGE}. Inline comments on text that exists only in the draft are visible to editors only, until the text is published.`,
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The comments.",
      schema: commentListSchema,
      example: { threads: [exampleThread], people: {} },
    },
  })
  async list(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.comments.list(actorOf(request), pageId);
  }

  @Post("pages/:pageId/comments")
  @Permission("item.comment", page)
  @ApiRoute({
    summary: "Comment on a page",
    description:
      "Adds a comment on the whole page or, with an anchor, on text in it. An inline comment marks the text in the draft, or in the current content in live mode; readers see the mark with the next publication. Mentioned people who can read the page are notified at once.",
    tags: [TAG],
    params: pageParams,
    body: createCommentSchema,
    bodyExample: {
      body: exampleCommentBody,
      anchor: { exact: "Hotel Wi-Fi blocks UDP 51820", prefix: "", suffix: "" },
    },
    status: 201,
    response: { description: "The new comment.", schema: createdSchema, example: { id: exampleThread.id } },
    errors: ["invalidComment", "invalidAnchor", "anchorNotFound", "tooManyComments"],
  })
  async create(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof createCommentSchema>,
    @Req() request: FastifyRequest,
  ) {
    const id = await this.#services.comments.create(actorOf(request), pageId, body);
    return { id };
  }

  @Post("comments/:commentId/replies")
  @Permission("comment.reply", comment)
  @ApiRoute({
    summary: "Reply to a comment",
    description:
      "Adds a reply to the thread of the comment. Replies are one level deep: a reply to a reply joins the same thread.",
    tags: [TAG],
    params: commentParams,
    body: commentInputSchema,
    bodyExample: { body: exampleCommentBody },
    status: 201,
    response: { description: "The new reply.", schema: createdSchema, example: { id: exampleThread.id } },
    errors: ["invalidComment", "tooManyComments"],
  })
  async reply(
    @Param("commentId") commentId: string,
    @Body() body: z.output<typeof commentInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    const id = await this.#services.comments.reply(actorOf(request), commentId, body);
    return { id };
  }

  @Put("comments/:commentId")
  @Permission("comment.update", comment)
  @ApiRoute({
    summary: "Change a comment",
    description: "Changes the content of the caller's own comment. The comment is marked as edited.",
    tags: [TAG],
    params: commentParams,
    body: commentInputSchema,
    bodyExample: { body: exampleCommentBody },
    errors: ["invalidComment"],
  })
  async update(
    @Param("commentId") commentId: string,
    @Body() body: z.output<typeof commentInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.comments.update(actorOf(request), commentId, body);
  }

  @Delete("comments/:commentId")
  @Permission("comment.delete", comment)
  @ApiRoute({
    summary: "Delete a comment",
    description:
      "Deletes a comment. Authors delete their own comments, space admins any comment; the latter is recorded in the audit log. A deleted comment with replies stays as a placeholder. Whoever deleted it can restore it within an hour.",
    tags: [TAG],
    params: commentParams,
  })
  async delete(@Param("commentId") commentId: string, @Req() request: FastifyRequest) {
    await this.#services.comments.delete(actorOf(request), commentId);
  }

  @Post("comments/:commentId/restore")
  @Permission("comment.restore", comment)
  @ApiRoute({
    summary: "Restore a deleted comment",
    description: "Brings back a comment the caller deleted within the last hour.",
    tags: [TAG],
    params: commentParams,
    errors: ["restoreExpired"],
  })
  async restore(@Param("commentId") commentId: string, @Req() request: FastifyRequest) {
    await this.#services.comments.restore(actorOf(request), commentId);
  }

  @Put("comments/:commentId/resolved")
  @Permission("comment.resolve", comment)
  @ApiRoute({
    summary: "Resolve or reopen an inline comment",
    description: "Resolved inline comments are hidden from the text and listed as resolved.",
    tags: [TAG],
    params: commentParams,
    body: resolveSchema,
    bodyExample: { resolved: true },
    errors: ["notInlineComment"],
  })
  async resolve(
    @Param("commentId") commentId: string,
    @Body() body: z.output<typeof resolveSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.comments.resolve(actorOf(request), commentId, body.resolved);
  }

  @Put("comments/:commentId/reactions/:emoji")
  @Permission("comment.react", comment)
  @ApiRoute({
    summary: "React to a comment",
    description: "Adds the caller's reaction with an emoji. Adding it again changes nothing.",
    tags: [TAG],
    params: commentReactionParams,
    errors: ["invalidEmoji", "reactionsDisabled", "tooManyReactions"],
  })
  async reactToComment(
    @Param("commentId") commentId: string,
    @Param("emoji") value: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.reactions.add(actorOf(request), { commentId }, value);
  }

  @Delete("comments/:commentId/reactions/:emoji")
  @Permission("comment.react", comment)
  @ApiRoute({
    summary: "Remove a reaction from a comment",
    description:
      "Removes the caller's reaction with the emoji. Removing a reaction that does not exist changes nothing.",
    tags: [TAG],
    params: commentReactionParams,
  })
  async unreactToComment(
    @Param("commentId") commentId: string,
    @Param("emoji") value: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.reactions.remove(actorOf(request), { commentId }, value);
  }

  @Get("pages/:pageId/reactions")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the reactions on a page",
    description: "Lists the reactions on a page or blog post with the people who reacted.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The reactions.",
      schema: reactionsSchema,
      example: {
        enabled: true,
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reacted: true,
            people: [{ id: exampleThread.author.id, name: "Lukas Hofer" }],
          },
        ],
      },
    },
  })
  async reactions(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.reactions.forItem(actorOf(request), pageId);
  }

  @Put("pages/:pageId/reactions/:emoji")
  @Permission("item.react", page)
  @ApiRoute({
    summary: "React to a page",
    description:
      "Adds the caller's reaction with an emoji to a page or blog post. Adding it again changes nothing.",
    tags: [TAG],
    params: pageReactionParams,
    errors: ["invalidEmoji", "reactionsDisabled", "tooManyReactions"],
  })
  async react(
    @Param("pageId") pageId: string,
    @Param("emoji") value: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.reactions.add(actorOf(request), { itemId: pageId }, value);
  }

  @Delete("pages/:pageId/reactions/:emoji")
  @Permission("item.react", page)
  @ApiRoute({
    summary: "Remove a reaction from a page",
    description:
      "Removes the caller's reaction with the emoji. Removing a reaction that does not exist changes nothing.",
    tags: [TAG],
    params: pageReactionParams,
  })
  async unreact(
    @Param("pageId") pageId: string,
    @Param("emoji") value: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.reactions.remove(actorOf(request), { itemId: pageId }, value);
  }

  @Get("pages/:pageId/mention-access")
  @Permission(["item.comment", "item.edit"], page)
  @ApiRoute({
    summary: "Check whether mentioned people can read a page",
    description:
      "Tells the author of a comment or of the page while writing which mentioned people cannot read the page. They are not notified. People the caller cannot see are left out.",
    tags: [TAG],
    params: pageParams,
    query: mentionQuery,
    response: {
      description: "Access per person.",
      schema: mentionAccessSchema,
      example: [{ accountId: exampleThread.author.id, hasAccess: false }],
    },
  })
  async mentionAccess(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof mentionQuery>,
    @Req() request: FastifyRequest,
  ) {
    const exists = await this.#services.tree.spaceOf(pageId);
    if (!exists) throw notFound();
    return this.#services.comments.mentionAccess(actorOf(request), pageId, query.accountIds);
  }
}
