import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ANONYMOUS, accountPrincipal, type Principal } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { attachmentListSchema, exampleAttachment } from "../files/schemas.js";
import { sendAttachment } from "../files/serve.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, readCookie } from "../http/cookies.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";
import { documentSchema, exampleDocument } from "../spaces/schemas.js";
import { exampleShareLink, shareLinkInputSchema, shareLinkSchema, shareLinkUpdateSchema } from "./schemas.js";

const TAG = "Share links";
const page = { type: "item", param: "pageId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const linkParams = pageParams.extend({ linkId: uuid("ID of the share link.") }).strict();
const tokenParams = z
  .object({ token: z.string().max(100).describe("The token from the link address.") })
  .strict();
const tokenAttachmentParams = tokenParams.extend({ attachmentId: uuid("ID of the attachment.") }).strict();
const UNLOCK_HEADER = "x-pagehall-unlock";

const unlockQuery = z
  .object({
    unlock: z
      .string()
      .max(200)
      .optional()
      .describe("Proof of the password from the open endpoint, for links with a password."),
    version: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Number of the version. Default: the current one."),
  })
  .strict();

const linkListSchema = z
  .object({
    links: z.array(shareLinkSchema).describe("Active links, newest first."),
    options: z
      .object({
        enabled: z.boolean().describe("Whether the organization allows share links."),
        anyone: z.boolean().describe("Whether links for anyone are allowed."),
        anyoneMaxDays: z.number().int().describe("Longest lifetime of a link for anyone, in days."),
      })
      .describe("What the organization allows."),
  })
  .describe("Share links of a page.");

const createdLinkSchema = z
  .object({
    link: shareLinkSchema,
    token: z
      .string()
      .describe(
        "Secret part of the link address. The address is the instance URL followed by `/s/` and the token.",
      ),
  })
  .describe("The new link.");

const openSchema = z
  .object({ password: z.string().max(200).optional().describe("The password of the link, if it has one.") })
  .strict()
  .describe("Opening a link.");

const openedSchema = z
  .object({
    kind: z
      .enum(["account", "anonymous"])
      .describe("`account` when the signed-in person now has access, `anonymous` otherwise."),
    itemId: uuid("The page the link opens."),
    unlock: z
      .string()
      .nullable()
      .describe(
        "For anonymous visitors of links with a password: proof to send with the following requests.",
      ),
  })
  .describe("Where the link leads.");

const sharedPageSchema = z
  .object({
    itemId: uuid("ID of the page."),
    title: z.string().describe("Title of the page."),
    document: documentSchema,
    updatedAt: timestamp("When the shown content was published."),
    attachments: attachmentListSchema,
  })
  .describe("A page opened through a link for anyone, without the page tree and comments.");

@Controller("api/v1")
export class ShareLinksController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("pages/:pageId/share-links")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "List the share links of a page",
    description: "Lists the links that are not revoked, with what the organization allows for new ones.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The links.",
      schema: linkListSchema,
      example: { links: [exampleShareLink], options: { enabled: true, anyone: false, anyoneMaxDays: 30 } },
    },
  })
  async list(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return {
      links: await this.#services.shareLinks.list(actorOf(request), pageId),
      options: await this.#services.shareLinks.options(pageId),
    };
  }

  @Post("pages/:pageId/share-links")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Create a share link",
    description:
      "Creates a link that opens the page for reading: for specific people, signed-in members of the organization, signed-in users of the instance, or anyone. Links for anyone must be allowed by the organization and need an expiry within its maximum. The token is returned only once; the password is stored as a hash.",
    tags: [TAG],
    status: 201,
    params: pageParams,
    body: shareLinkInputSchema,
    bodyExample: { scope: "organization", expiresAt: "2026-11-30T00:00:00Z" },
    response: {
      description: "The link with its token.",
      schema: createdLinkSchema,
      example: { link: exampleShareLink, token: "Yk3mR0vQx8LfJ2aB7cT9wE4nU6pH1sD5gK0zV3iM8oA2qX7r" },
    },
    errors: [
      "shareLinksDisabled",
      "anyoneLinksDisabled",
      "restrictedPage",
      "expiryRequired",
      "expiryTooLate",
      "expiryInPast",
      "invalidScope",
      "peopleRequired",
      "tooManyPeople",
      "invalidPassword",
      "invalidHolder",
    ],
  })
  async create(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof shareLinkInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.shareLinks.create(actorOf(request), pageId, body);
  }

  @Patch("pages/:pageId/share-links/:linkId")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Change a share link",
    description: "Changes scope, expiry, password or people of a link. The address stays the same.",
    tags: [TAG],
    params: linkParams,
    body: shareLinkUpdateSchema,
    bodyExample: { expiresAt: "2026-12-31T00:00:00Z" },
    response: { description: "The link.", schema: shareLinkSchema, example: exampleShareLink },
    errors: [
      "linkNotFound",
      "anyoneLinksDisabled",
      "restrictedPage",
      "expiryRequired",
      "expiryTooLate",
      "expiryInPast",
      "invalidScope",
      "peopleRequired",
      "tooManyPeople",
      "invalidPassword",
      "invalidHolder",
    ],
  })
  async update(
    @Param("pageId") pageId: string,
    @Param("linkId") linkId: string,
    @Body() body: z.output<typeof shareLinkUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    if ((await this.#services.shareLinks.itemOf(linkId)) !== pageId) throw notFound();
    return this.#services.shareLinks.update(actorOf(request), linkId, body);
  }

  @Delete("pages/:pageId/share-links/:linkId")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Revoke a share link",
    description: "Revokes the link at once. Access that people had only through it ends.",
    tags: [TAG],
    params: linkParams,
    errors: ["linkNotFound"],
  })
  async revoke(
    @Param("pageId") pageId: string,
    @Param("linkId") linkId: string,
    @Req() request: FastifyRequest,
  ) {
    if ((await this.#services.shareLinks.itemOf(linkId)) !== pageId) throw notFound();
    await this.#services.shareLinks.revoke(actorOf(request), linkId);
  }

  async #visitor(request: FastifyRequest): Promise<Principal> {
    const token = readCookie(request, COOKIES.session);
    const session = token ? await this.#services.sessions.resolve(token) : null;
    return session?.kind === "full" ? accountPrincipal(session.accountId) : ANONYMOUS;
  }

  @Post("share-links/:token/open")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Open a share link",
    description:
      "Checks the link and its password. Signed-in people who may open it get read access to the page and appear in its access list as visitors through the link. Anonymous visitors can open only links for anyone. Failed attempts are rate limited.",
    tags: [TAG],
    status: 200,
    params: tokenParams,
    body: openSchema,
    bodyExample: {},
    response: {
      description: "Where the link leads.",
      schema: openedSchema,
      example: { kind: "account", itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10", unlock: null },
    },
    errors: [
      "linkNotFound",
      "linkNotForYou",
      "signInRequired",
      "passwordRequired",
      "wrongPassword",
      "rateLimited",
    ],
  })
  async open(
    @Param("token") token: string,
    @Body() body: z.output<typeof openSchema>,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.#services.shareLinks.open(token, await this.#visitor(request), {
      password: body.password,
      clientIp: request.ip,
    });
    return {
      kind: result.kind,
      itemId: result.itemId,
      unlock: result.kind === "anonymous" ? result.unlock : null,
    };
  }

  #unlock(request: FastifyRequest, query?: { unlock?: string | undefined }): string | undefined {
    const header = request.headers[UNLOCK_HEADER];
    return (typeof header === "string" ? header : undefined) ?? query?.unlock;
  }

  @Get("share-links/:token/page")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Read a page through a link for anyone",
    description:
      "Returns the published content and the attachments of the page the link opens, without the page tree and comments. Links with a password need the proof from the open endpoint in the `X-Pagehall-Unlock` header.",
    tags: [TAG],
    params: tokenParams,
    response: {
      description: "The page.",
      schema: sharedPageSchema,
      example: {
        itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
        title: "VPN access for remote staff",
        document: exampleDocument,
        updatedAt: "2026-10-01T09:30:00.000Z",
        attachments: [exampleAttachment],
      },
    },
    errors: ["linkNotFound", "signInRequired", "passwordRequired", "rateLimited"],
  })
  async page(@Param("token") token: string, @Req() request: FastifyRequest) {
    const itemId = await this.#services.shareLinks.resolveAnonymous(token, this.#unlock(request), request.ip);
    const readable = await this.#services.documents.readable(itemId);
    if (!readable) throw notFound();
    return {
      itemId,
      title: readable.title,
      document: readable.document,
      updatedAt: readable.updatedAt,
      attachments: await this.#services.attachments.list(ANONYMOUS, itemId),
    };
  }

  @Get("share-links/:token/attachments/:attachmentId/content")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Download an attachment through a link for anyone",
    description:
      "Sends an attachment of the page the link opens. Links with a password need the proof from the open endpoint, in the `X-Pagehall-Unlock` header or the `unlock` parameter.",
    tags: [TAG],
    params: tokenAttachmentParams,
    query: unlockQuery,
    raw: {
      contentTypes: ["*/*"],
      ranges: true,
      description: "The file, sent like the regular download.",
      example: "",
    },
    errors: ["linkNotFound", "signInRequired", "passwordRequired", "rateLimited", "rangeNotSatisfiable"],
  })
  async attachment(
    @Param("token") token: string,
    @Param("attachmentId") attachmentId: string,
    @Query() query: z.output<typeof unlockQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const itemId = await this.#services.shareLinks.resolveAnonymous(
      token,
      this.#unlock(request, query),
      request.ip,
    );
    const found = await this.#services.attachments.get(ANONYMOUS, attachmentId);
    if (!found || found.itemId !== itemId) throw notFound();
    const content = await this.#services.attachments.content(attachmentId, query.version);
    if (!content) throw notFound();
    reply.header("referrer-policy", "no-referrer");
    return sendAttachment(request, reply, this.#services.files, content, {
      inline: true,
      crossOrigin: false,
    });
  }
}
