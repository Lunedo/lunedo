import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { originOf } from "../http/instance-url.js";
import { actorOf } from "../http/request.js";
import { inputTimestamp, timestamp, uuid } from "../http/schemas.js";

const TAG = "Knowledge bases";
const space = { type: "space", param: "spaceId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const accountParams = spaceParams.extend({ accountId: uuid("ID of the portal account.") }).strict();
const invitationParams = spaceParams.extend({ invitationId: uuid("ID of the invitation.") }).strict();

const portalAccountsSchema = z
  .object({
    accounts: z
      .array(
        z
          .object({
            id: uuid("ID of the account."),
            name: z.string().describe("Name of the reader."),
            email: z.string().describe("E-mail address the reader signs in with."),
            state: z.enum(["active", "deactivated"]).describe("Whether the account can sign in."),
            expiresAt: timestamp("When the access ends, or null.").nullable(),
            createdAt: timestamp("When the account was created."),
            lastSignInAt: timestamp("When the reader last signed in, or null.").nullable(),
            otherOrganizations: z
              .boolean()
              .describe("Whether the account also reads knowledge bases of other organizations."),
          })
          .describe("A portal account."),
      )
      .describe("Portal accounts of the organization, which read its knowledge bases for portal accounts."),
    invitations: z
      .array(
        z
          .object({
            id: uuid("ID of the invitation."),
            email: z.string().describe("Invited address."),
            membershipExpiresAt: timestamp("When the access will end, or null.").nullable(),
            expiresAt: timestamp("When the invitation link expires."),
            invitedByName: z.string().nullable().describe("Who sent the invitation."),
          })
          .describe("An open invitation."),
      )
      .describe("Open invitations sent from this knowledge base."),
  })
  .describe("Readers with portal accounts.");

const inviteSchema = z
  .object({
    email: z.email().max(254).describe("E-mail address of the reader."),
    expiresAt: inputTimestamp("When the access ends.")
      .nullable()
      .default(null)
      .describe("When the access ends, or null for no end."),
  })
  .strict()
  .describe("The invitation.");

const invitationSchema = z
  .object({
    id: uuid("ID of the invitation."),
    email: z.string().describe("Invited address."),
    membershipExpiresAt: timestamp("When the access will end, or null.").nullable(),
    expiresAt: timestamp("When the invitation link expires."),
  })
  .describe("The new invitation.");

const portalsSchema = z
  .array(
    z
      .object({
        spaceId: uuid("ID of the knowledge base."),
        name: z.string().describe("Name of the knowledge base."),
        url: z.string().describe("Address of its portal."),
      })
      .describe("A portal the account reads."),
  )
  .describe("Portals of knowledge bases for portal accounts that the account reads.");

@Controller("api/v1")
export class PortalAccountsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/portal-accounts")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the portal accounts of a knowledge base",
    description:
      "Lists the portal accounts of the organization and the open invitations sent from this knowledge base.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "Portal accounts and invitations.",
      schema: portalAccountsSchema,
      example: { accounts: [], invitations: [] },
    },
    errors: ["notKnowledgeBase"],
  })
  async list(@Param("spaceId") spaceId: string) {
    return this.#services.portalAccounts.list(spaceId);
  }

  @Post("spaces/:spaceId/portal-accounts")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Invite a reader as a portal account",
    description:
      "Sends an invitation to read the knowledge base. The reader creates a portal account that sees only the portal of the organization's knowledge bases for portal accounts. The person who invites is responsible for the account. Audited.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    body: inviteSchema,
    bodyExample: { email: "reader@example.org", expiresAt: "2027-03-31T00:00:00.000Z" },
    response: {
      description: "The invitation.",
      schema: invitationSchema,
      example: {
        id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
        email: "reader@example.org",
        membershipExpiresAt: "2027-03-31T00:00:00.000Z",
        expiresAt: "2026-10-27T08:00:00.000Z",
      },
    },
    errors: ["notKnowledgeBase", "portalAudienceRequired", "expiryInPast", "invalidResponsible"],
  })
  async invite(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof inviteSchema>,
    @Req() request: FastifyRequest,
  ) {
    const invitation = await this.#services.portalAccounts.invite(actorOf(request), spaceId, body);
    return {
      id: invitation.id,
      email: invitation.email,
      membershipExpiresAt: invitation.membershipExpiresAt,
      expiresAt: invitation.expiresAt,
    };
  }

  @Delete("spaces/:spaceId/portal-invitations/:invitationId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Withdraw an invitation of a portal account",
    description: "The link in the invitation stops working. Audited.",
    tags: [TAG],
    params: invitationParams,
    status: 204,
    errors: ["invitationNotFound"],
  })
  async revoke(
    @Param("spaceId") spaceId: string,
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.portalAccounts.revokeInvitation(actorOf(request), spaceId, invitationId);
  }

  @Post("spaces/:spaceId/portal-accounts/:accountId/deactivate")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Deactivate a portal account",
    description:
      "Ends all sessions of the account; it can no longer sign in. Its ratings and notes stay anonymous as before. Only for accounts that read no other organization. Audited.",
    tags: [TAG],
    params: accountParams,
    status: 204,
    errors: ["portalAccountNotFound", "portalAccountShared"],
  })
  async deactivate(
    @Param("spaceId") spaceId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.portalAccounts.deactivate(actorOf(request), spaceId, accountId);
  }

  @Delete("spaces/:spaceId/portal-accounts/:accountId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove a portal account from the organization",
    description:
      "The account no longer reads the organization's knowledge bases. It keeps reading other organizations it belongs to. Audited.",
    tags: [TAG],
    params: accountParams,
    status: 204,
    errors: ["portalAccountNotFound"],
  })
  async remove(
    @Param("spaceId") spaceId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.portalAccounts.remove(actorOf(request), spaceId, accountId);
  }

  @Get("account/portals")
  @SessionRoute({ portalAccounts: true })
  @InternalRoute()
  @ApiRoute({
    summary: "List the portals the caller reads as a portal account",
    description: "Lists the portals of knowledge bases for portal accounts in the caller's organizations.",
    tags: [TAG],
    response: {
      description: "The portals.",
      schema: portalsSchema,
      example: [
        {
          spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
          name: "Customer help",
          url: "https://help.example.org/",
        },
      ],
    },
  })
  async portals(@Req() request: FastifyRequest) {
    const origin = await originOf(this.context, request);
    return (await this.#services.portalAccounts.portalsOf(actorOf(request).id)).map((portal) => ({
      spaceId: portal.spaceId,
      name: portal.name,
      url: portal.domain ? `https://${portal.domain}/` : `${origin}/help/${portal.path}/`,
    }));
  }
}
