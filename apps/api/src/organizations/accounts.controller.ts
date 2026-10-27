import {
  accountNameSchema,
  idSchema,
  linkTokenSchema,
  passwordSchema,
  signInEmailSchema,
} from "@lunedo/shared";
import { Body, Controller, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { originOf } from "../http/instance-url.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";

const acceptSchema = z
  .object({
    token: linkTokenSchema,
    name: accountNameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict();
const registrationSchema = z.object({ email: signInEmailSchema }).strict();
const completeSchema = z
  .object({
    token: linkTokenSchema,
    name: accountNameSchema,
    password: passwordSchema,
  })
  .strict();
const joinedSchema = z.object({ accountId: idSchema, organizationId: idSchema });
const domainProviderSchema = z
  .object({
    id: idSchema.describe("ID of the identity provider."),
    name: z.string().describe("Name of the identity provider."),
    type: z.enum(["oidc", "saml", "ldap"]).describe("Kind of identity provider."),
  })
  .describe("The identity provider that manages addresses of this domain.");
const invitationPreviewSchema = z.object({
  state: z
    .enum(["open", "expired", "accepted", "revoked"])
    .describe("Whether the invitation can be accepted, or why not."),
  email: z.string().describe("The invited e-mail address."),
  expiresAt: z.iso.datetime().describe("When the invitation expires."),
  organizationName: z.string().describe("The organization the invitation is for."),
  invitedByName: z
    .string()
    .nullable()
    .describe("The person who sent the invitation, when the account still exists."),
  knowledgeBaseName: z
    .string()
    .nullable()
    .describe(
      "The knowledge base whose portal the invited reader account reads, or null for other invitations.",
    ),
  newAccount: z
    .boolean()
    .describe(
      "Whether accepting creates an account, so a name and, without `provider`, a password are needed. False once the invitation is no longer open.",
    ),
  provider: domainProviderSchema
    .nullable()
    .describe(
      "The identity provider of the invited address's domain when accepting creates an account: the account gets no password and signs in through it. Null otherwise.",
    ),
});
const secondFactorResetSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        "Why the second factor is reset, 1 to 500 characters. Recorded in the audit log and sent to the account.",
      ),
  })
  .strict();

const pictureQuery = z
  .object({ v: z.string().max(64).optional().describe("The `pictureRef` of the person, to bypass caches.") })
  .strict();

@Controller("api/v1")
@InternalRoute()
export class AccountsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("accounts/:accountId/picture")
  @SessionRoute()
  @ApiRoute({
    summary: "Get a profile picture",
    description:
      "Returns the profile picture of a person whose name the caller may see, with its stored image type. Add the `pictureRef` of the person as `v` so a changed picture is loaded again. It is sent with `X-Content-Type-Options: nosniff` and a content security policy that blocks scripts.",
    tags: ["Accounts"],
    params: z.object({ accountId: idSchema }).strict(),
    query: pictureQuery,
    raw: {
      contentTypes: ["image/png", "image/jpeg", "image/webp"],
      description: "The picture.",
      example: "",
    },
    errors: ["notFound"],
  })
  async picture(
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const picture = await this.#services.profiles.picture(actorOf(request), accountId);
    if (!picture) throw notFound();
    reply
      .header("content-type", picture.contentType)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "private, max-age=300")
      .header("etag", `"${picture.ref}"`);
    return picture.data;
  }

  @Post("accounts/:accountId/deactivate")
  @Permission("account.deactivate", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Deactivate an account",
    tags: ["Accounts"],
    status: 200,
    params: z.object({ accountId: idSchema }).strict(),
    response: { description: "Sessions that ended.", schema: z.object({ endedSessions: z.number().int() }) },
    errors: ["deactivateSelf", "instanceOwner", "lastOwner"],
  })
  async deactivate(@Param("accountId") accountId: string, @Req() request: FastifyRequest) {
    const endedSessions = await this.#services.memberships.deactivate(actorOf(request), accountId);
    return { endedSessions };
  }

  @Post("accounts/:accountId/reactivate")
  @Permission("account.reactivate", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Reactivate an account",
    description:
      "Lets a deactivated account sign in again. Its revoked tokens and ended memberships stay as they are.",
    tags: ["Accounts"],
    params: z.object({ accountId: idSchema }).strict(),
    errors: ["notFound"],
  })
  async reactivate(@Param("accountId") accountId: string, @Req() request: FastifyRequest) {
    await this.#services.administration.reactivate(actorOf(request), accountId);
  }

  @Post("accounts/:accountId/sessions/end")
  @Permission("account.sessions.end", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "End all sessions of another account",
    description: "Signs the account out everywhere. Owners can only be signed out by owners.",
    tags: ["Accounts"],
    status: 200,
    params: z.object({ accountId: idSchema }).strict(),
    response: { description: "Sessions that ended.", schema: z.object({ endedSessions: z.number().int() }) },
    errors: ["endOwnSessions", "notFound"],
  })
  async endSessions(@Param("accountId") accountId: string, @Req() request: FastifyRequest) {
    return this.#services.administration.endSessions(actorOf(request), accountId);
  }

  @Post("accounts/:accountId/sessions/:sessionId/end")
  @Permission("account.sessions.end", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "End one session of another account",
    description: "Signs the account out on one device. Owners can only be signed out by owners.",
    tags: ["Accounts"],
    status: 204,
    params: z.object({ accountId: idSchema, sessionId: idSchema }).strict(),
    errors: ["endOwnSessions", "notFound"],
  })
  async endSession(
    @Param("accountId") accountId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.administration.endSession(actorOf(request), accountId, sessionId))) {
      throw notFound();
    }
  }

  @Post("accounts/:accountId/second-factor/reset")
  @Permission(
    "account.secondFactor.reset",
    { type: "account", param: "accountId" },
    { recentAuthentication: true },
  )
  @ApiRoute({
    summary: "Reset the second factor of another account",
    description:
      "Removes all authenticator apps, passkeys and recovery codes of the account and ends its sessions. At the next sign-in the account must set up a new second factor. The account receives an e-mail. Owners can only be reset by owners, and nobody can reset their own second factor this way.",
    tags: ["Accounts"],
    status: 200,
    params: z.object({ accountId: idSchema }).strict(),
    body: secondFactorResetSchema,
    response: { description: "Sessions that ended.", schema: z.object({ endedSessions: z.number().int() }) },
    errors: ["managedAccount", "resetOwnSecondFactor", "notFound"],
  })
  async resetSecondFactor(
    @Param("accountId") accountId: string,
    @Body() body: z.output<typeof secondFactorResetSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.administration.resetSecondFactor(actorOf(request), accountId, body.reason);
  }

  @Put("accounts/:accountId/home-organization")
  @Permission("account.homeOrganization.change", { type: "account", param: "accountId" })
  @ApiRoute({
    summary: "Change the home organization of an account",
    description:
      "Makes another organization the account is a member of its home organization. Instance administrators and administrators of the current home organization can do this. The person and the administrators of both organizations are notified.",
    tags: ["Accounts"],
    params: z.object({ accountId: idSchema }).strict(),
    body: z
      .object({ organizationId: idSchema.describe("ID of the new home organization.") })
      .strict()
      .describe("The new home organization."),
    errors: ["notMember", "notFound"],
  })
  async changeHomeOrganization(
    @Param("accountId") accountId: string,
    @Body() body: { organizationId: string },
    @Req() request: FastifyRequest,
  ) {
    await this.#services.homeOrganizations.change(actorOf(request), accountId, body.organizationId);
  }

  @Post("invitations/preview")
  @PublicRoute()
  @ApiRoute({
    summary: "Look up an invitation",
    tags: ["Accounts"],
    status: 200,
    body: z.object({ token: linkTokenSchema }).strict(),
    response: {
      description: "What the invitation is for and whether it can still be accepted.",
      schema: invitationPreviewSchema,
    },
    errors: ["invalidToken", "rateLimited"],
  })
  async previewInvitation(@Body() body: { token: string }, @Req() request: FastifyRequest) {
    const preview = await this.#services.invitations.preview(body.token, request.ip);
    return { ...preview, expiresAt: preview.expiresAt.toISOString() };
  }

  @Post("invitations/accept")
  @PublicRoute()
  @ApiRoute({
    summary: "Accept an invitation",
    tags: ["Accounts"],
    status: 200,
    body: acceptSchema,
    response: {
      description: "The joined organization.",
      schema: joinedSchema.extend({
        accountCreated: z.boolean().describe("Whether a new account was created."),
        portalUrl: z
          .string()
          .nullable()
          .describe("Address of the portal for a reader account of a knowledge base, or null."),
        provider: domainProviderSchema
          .nullable()
          .describe("The identity provider the new account signs in through, or null."),
      }),
    },
    errors: [
      "invalidToken",
      "invalidInvitation",
      "accountDetailsRequired",
      "passwordPolicy",
      "portalInvitationAccountExists",
      "rateLimited",
    ],
  })
  async accept(@Body() body: z.output<typeof acceptSchema>, @Req() request: FastifyRequest) {
    const { token, ...details } = body;
    const accepted = await this.#services.invitations.accept(token, details, request.ip);
    const config = accepted.portalSpaceId
      ? await this.#services.portals.config(accepted.portalSpaceId)
      : null;
    return {
      accountId: accepted.accountId,
      organizationId: accepted.organizationId,
      accountCreated: accepted.accountCreated,
      provider: accepted.provider,
      portalUrl: config
        ? config.domain
          ? `https://${config.domain}/`
          : `${await originOf(this.context, request)}/help/${config.path}/`
        : null,
    };
  }

  @Post("registrations")
  @PublicRoute()
  @ApiRoute({
    summary: "Request a registration",
    description:
      "Sends a registration link when self-registration is open for the address's domain. Addresses in a domain of an identity provider are refused with `managedDomain`; they sign in through that provider.",
    tags: ["Accounts"],
    status: 202,
    body: registrationSchema,
    errors: ["managedDomain", "rateLimited"],
  })
  async register(@Body() body: z.output<typeof registrationSchema>, @Req() request: FastifyRequest) {
    await this.#services.invitations.requestRegistration(body.email, request.ip);
  }

  @Post("registrations/complete")
  @PublicRoute()
  @ApiRoute({
    summary: "Complete a registration",
    tags: ["Accounts"],
    status: 200,
    body: completeSchema,
    response: { description: "The new account and its organization.", schema: joinedSchema },
    errors: ["invalidToken", "managedDomain", "passwordPolicy", "emailInUse", "rateLimited"],
  })
  async complete(@Body() body: z.output<typeof completeSchema>, @Req() request: FastifyRequest) {
    const { token, ...details } = body;
    return this.#services.invitations.completeRegistration(token, details, request.ip);
  }
}
