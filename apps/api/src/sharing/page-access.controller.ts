import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import {
  type AccessChange,
  type GiveAccessDraft,
  giveAccessDraftSchema,
  type Principal,
  restrictionKinds,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { exampleImpact } from "../spaces/schemas.js";
import {
  accessChangesSchema,
  accessExplanationSchema,
  exampleExplanation,
  examplePageAccess,
  examplePageImpact,
  exampleSharedWithMe,
  giveEffectSchema,
  givePreviewSchema,
  pageAccessSchema,
  pageImpactSchema,
  restrictedPageSchema,
  sharedWithMeSchema,
  shareRoleSchema,
} from "./schemas.js";

const TAG = "Page access";
const page = { type: "item", param: "pageId" } as const;
const space = { type: "space", param: "spaceId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const restrictionParams = spaceParams
  .extend({
    itemId: uuid("ID of the restricted page."),
    kind: z.enum(restrictionKinds).describe("`view` or `edit`."),
  })
  .strict();
const explainQuery = z.object({ accountId: uuid("The person.") }).strict();

const guestInviteSchema = z
  .object({
    email: z.string().max(320).describe("E-mail address of the guest."),
    role: shareRoleSchema,
    includeDescendants: z
      .boolean()
      .default(false)
      .describe("Also give access to the pages below. Default false."),
  })
  .strict()
  .describe("A guest to invite to the page.");

const invitationResultSchema = z
  .object({
    id: uuid("ID of the invitation."),
    email: z.string().describe("Invited address."),
    expiresAt: z.iso.datetime().describe("When the invitation expires. ISO 8601 timestamp in UTC."),
  })
  .describe("The invitation that was sent.");

const draftResponseSchema = z
  .object({ draft: giveAccessDraftSchema.nullable().describe("The unfinished assistant, or null.") })
  .describe("Your unfinished Give access assistant for this space.");

const exampleDraft: GiveAccessDraft = {
  step: 1,
  holder: { kind: "account", id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  level: "editor",
  where: "space",
  page: null,
};

const exampleEffect = {
  pages: 34,
  readable: 31,
  editable: 31,
  restricted: 3,
  alreadyHas: null,
  impact: exampleImpact,
};

@Controller("api/v1")
export class PageAccessController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("shared-with-me")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "List pages shared with you",
    description:
      "Lists the pages that someone shared with the caller or one of their groups, newest first. Pages the caller can no longer view are left out.",
    tags: [TAG],
    response: {
      description: "The pages.",
      schema: z.array(sharedWithMeSchema).describe("Shared pages, newest first."),
      example: [exampleSharedWithMe],
    },
  })
  async sharedWithMe(@Req() request: FastifyRequest) {
    return this.#services.pageAccess.sharedWith(actorOf(request));
  }

  @Get("pages/:pageId/access")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Get the access of a page",
    description:
      "Lists the people and groups the page is shared with, its restrictions and the people who opened it through a share link.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The access of the page.",
      schema: pageAccessSchema,
      example: examplePageAccess,
    },
  })
  async get(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#withGuests(
      actorOf(request),
      pageId,
      await this.#services.pageAccess.get(actorOf(request), pageId),
    );
  }

  async #withGuests<T extends object>(actor: Principal, pageId: string, access: T) {
    return { ...access, canInviteGuests: await this.#services.guestShares.allowed(actor, pageId) };
  }

  @Post("pages/:pageId/access/preview")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Preview a change of page access",
    description: "Shows who would gain or lose the right to read or edit the page. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: accessChangesSchema,
    bodyExample: { changes: [{ action: "restrict", kind: "view" }] },
    response: { description: "The effect.", schema: pageImpactSchema, example: examplePageImpact },
    errors: [
      "invalidHolder",
      "alreadyShared",
      "shareNotFound",
      "restrictionWithoutViewers",
      "restrictionWithoutEditors",
    ],
  })
  async preview(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof accessChangesSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.pageAccess.preview(actorOf(request), pageId, body.changes as AccessChange[]);
  }

  @Post("pages/:pageId/access")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Change the access of a page",
    description:
      "Shares the page, changes or removes access entries and sets or removes restrictions, all at once. Restrictions only narrow access: a view restriction lets only the access list see the page and the pages below, an edit restriction lets only entries with `editor` edit the page. People the page is shared with get a notification.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: accessChangesSchema,
    bodyExample: {
      changes: [
        {
          action: "share",
          holderKind: "account",
          holderId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
          role: "editor",
        },
      ],
    },
    response: {
      description: "The access after the change.",
      schema: pageAccessSchema,
      example: examplePageAccess,
    },
    errors: [
      "invalidHolder",
      "alreadyShared",
      "shareNotFound",
      "restrictionWithoutViewers",
      "restrictionWithoutEditors",
    ],
  })
  async change(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof accessChangesSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    return this.#withGuests(
      actor,
      pageId,
      await this.#services.pageAccess.change(actor, pageId, body.changes as AccessChange[]),
    );
  }

  @Get("pages/:pageId/access/explain")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Explain why someone has access to a page",
    description:
      "Lists the roles, shares and links that give the person access, and the restrictions that narrow it.",
    tags: [TAG],
    params: pageParams,
    query: explainQuery,
    response: {
      description: "The explanation.",
      schema: accessExplanationSchema,
      example: exampleExplanation,
    },
    errors: ["personNotFound"],
  })
  async explain(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof explainQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accessExplanations.explainAccess(
      actorOf(request),
      { type: "item", id: pageId },
      query.accountId,
    );
  }

  @Get("pages/:pageId/access/mine")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get your own access to a page",
    description: "Explains the caller's own role on the page.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The explanation.",
      schema: accessExplanationSchema,
      example: exampleExplanation,
    },
  })
  async mine(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    return this.#services.accessExplanations.explainAccess(actor, { type: "item", id: pageId }, actor.id);
  }

  @Post("pages/:pageId/access/invitations")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Invite a guest to a page",
    description:
      "Invites a person without an account as a guest of the organization and shares the page with them when they accept. Organization administrators can always do this; members only when the organization allows it.",
    tags: [TAG],
    status: 201,
    params: pageParams,
    body: guestInviteSchema,
    bodyExample: { email: "contractor@example.net", role: "reader", includeDescendants: false },
    response: {
      description: "The invitation.",
      schema: invitationResultSchema,
      example: {
        id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a80",
        email: "contractor@example.net",
        expiresAt: "2026-10-15T09:30:00.000Z",
      },
    },
    errors: ["guestInvitesDisabled", "invalidScope", "invalidResponsible"],
  })
  async invite(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof guestInviteSchema>,
    @Req() request: FastifyRequest,
  ) {
    const invitation = await this.#services.guestShares.invite(actorOf(request), pageId, body);
    return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt };
  }

  @Post("pages/:pageId/give-access/preview")
  @Permission("item.share", page)
  @ApiRoute({
    summary: "Preview giving access to a page",
    description:
      "Shows how many pages the person or group could then read and edit, how many restricted pages they would still not see, and who gains access. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: givePreviewSchema,
    bodyExample: {
      holderKind: "account",
      holderId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      level: "editor",
      scope: "pageAndChildren",
    },
    response: {
      description: "The effect.",
      schema: giveEffectSchema,
      example: { ...exampleEffect, impact: examplePageImpact },
    },
    errors: ["invalidHolder", "invalidRole"],
  })
  async givePagePreview(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof givePreviewSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const located = await this.#services.tree.spaceOf(pageId);
    if (!located) throw notFound();
    if (body.level === "admin" || body.scope === "space") {
      throw new ProblemException("invalidRole", "Pages can be shared to read, comment or edit");
    }
    const access = await this.#services.pageAccess.get(actor, pageId);
    const existing = access.shares.find(
      (share) => share.holder.kind === body.holderKind && share.holder.id === body.holderId,
    );
    const includeDescendants = body.scope === "pageAndChildren";
    const change: AccessChange = existing
      ? { action: "changeShare", shareId: existing.id, role: body.level, includeDescendants }
      : {
          action: "share",
          holderKind: body.holderKind,
          holderId: body.holderId,
          role: body.level,
          includeDescendants,
        };
    const impact = await this.#services.pageAccess.preview(actor, pageId, [change]);
    const effect = await this.#services.accessExplanations.giveAccessEffect(
      { kind: body.holderKind, id: body.holderId },
      { spaceId: located, itemId: pageId, scope: body.scope },
      body.level,
    );
    return { ...effect, impact };
  }

  @Get("spaces/:spaceId/give-access/draft")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Read your Give access draft",
    description:
      "Returns the Give access assistant you left unfinished in this space, so it can be continued. Each person has their own draft per space.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The draft.", schema: draftResponseSchema, example: { draft: exampleDraft } },
  })
  async giveAccessDraft(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return { draft: await this.#services.giveAccessDrafts.get(actorOf(request), spaceId) };
  }

  @Put("spaces/:spaceId/give-access/draft")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Save your Give access draft",
    description:
      "Stores the state of the unfinished Give access assistant for you in this space, replacing the previous draft. Nothing changes who has access.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: giveAccessDraftSchema,
    bodyExample: exampleDraft,
    response: { description: "The draft.", schema: draftResponseSchema, example: { draft: exampleDraft } },
  })
  async saveGiveAccessDraft(
    @Param("spaceId") spaceId: string,
    @Body() body: GiveAccessDraft,
    @Req() request: FastifyRequest,
  ) {
    return { draft: await this.#services.giveAccessDrafts.save(actorOf(request), spaceId, body) };
  }

  @Delete("spaces/:spaceId/give-access/draft")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Discard your Give access draft",
    description:
      "Removes your unfinished Give access assistant in this space. It does nothing when there is none.",
    tags: [TAG],
    params: spaceParams,
  })
  async discardGiveAccessDraft(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    await this.#services.giveAccessDrafts.discard(actorOf(request), spaceId);
  }

  @Post("spaces/:spaceId/give-access/preview")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Preview giving access to a space",
    description:
      "Shows how many pages the person or group could then read and edit, how many restricted pages they would still not see, and who gains access. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: givePreviewSchema,
    bodyExample: {
      holderKind: "account",
      holderId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      level: "editor",
      scope: "space",
    },
    response: { description: "The effect.", schema: giveEffectSchema, example: exampleEffect },
    errors: ["invalidHolder"],
  })
  async giveSpacePreview(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof givePreviewSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const permissions = await this.#services.spacePermissions.list(spaceId);
    const existing = permissions.find(
      (permission) =>
        permission.principalKind === body.holderKind && permission.principalId === body.holderId,
    );
    const impact = await this.#services.spacePermissions.preview(
      actor,
      spaceId,
      existing
        ? { action: "change", permissionId: existing.id, role: body.level }
        : { action: "grant", principalKind: body.holderKind, principalId: body.holderId, role: body.level },
    );
    const effect = await this.#services.accessExplanations.giveAccessEffect(
      { kind: body.holderKind, id: body.holderId },
      { spaceId, itemId: null, scope: "space" },
      body.level,
    );
    return { ...effect, impact };
  }

  @Get("spaces/:spaceId/access/explain")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Explain why someone has access to a space",
    description: "Lists the roles that give the person access to the space and how they hold them.",
    tags: [TAG],
    params: spaceParams,
    query: explainQuery,
    response: {
      description: "The explanation.",
      schema: accessExplanationSchema,
      example: exampleExplanation,
    },
    errors: ["personNotFound"],
  })
  async explainSpace(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof explainQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accessExplanations.explainAccess(
      actorOf(request),
      { type: "space", id: spaceId },
      query.accountId,
    );
  }

  @Get("spaces/:spaceId/restricted-pages")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the restricted pages of a space",
    description:
      "Lists every restricted page of the space with its title, for space admins. Their content stays hidden; admins can only remove restrictions.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "Restricted pages, ordered by title.",
      schema: z.array(restrictedPageSchema).describe("Restricted pages."),
      example: [
        {
          itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
          title: "Salaries 2027",
          kind: "page",
          view: {
            setBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21", name: "Lukas Hofer" },
            setAt: "2026-10-01T09:30:00.000Z",
          },
          edit: null,
          orphaned: false,
        },
      ],
    },
  })
  async restrictedPages(@Param("spaceId") spaceId: string) {
    return this.#services.pageAccess.restrictedPages(spaceId);
  }

  @Delete("spaces/:spaceId/restricted-pages/:itemId/restrictions/:kind")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove a restriction as space admin",
    description:
      "Removes a restriction of a page without reading it. The page becomes visible to everyone with access to the space; the removal is written to the audit log.",
    tags: [TAG],
    params: restrictionParams,
    errors: ["restrictionNotFound"],
  })
  async removeRestriction(
    @Param("spaceId") spaceId: string,
    @Param("itemId") itemId: string,
    @Param("kind") kind: "view" | "edit",
    @Req() request: FastifyRequest,
  ) {
    await this.#services.pageAccess.removeRestrictionAsAdministrator(actorOf(request), spaceId, itemId, kind);
  }
}
