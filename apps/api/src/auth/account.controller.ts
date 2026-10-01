import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FactorAdded, RegistrationResponseJSON } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { InternalRoute, SessionRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, clearCookie } from "../http/cookies.js";
import { pageQuerySchema, pageSchema, paginate } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { sessionOf } from "../http/request.js";
import { servicesOf, setSessionCookie } from "./auth.controller.js";
import {
  accountSessionSchema,
  creationOptionsSchema,
  endedSchema,
  idParams,
  newEmailSchema,
  newPasswordSchema,
  passkeyAddedSchema,
  passkeyRegistrationSchema,
  recoveryCodesSchema,
  securityOverviewSchema,
  totpConfirmationSchema,
  totpSetupSchema,
} from "./schemas.js";

@Controller("api/v1/account")
@InternalRoute()
export class AccountController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #factorAdded(reply: FastifyReply, added: FactorAdded) {
    if (added.token) await setSessionCookie(this.context, reply, added.token);
    return { recoveryCodes: added.recoveryCodes };
  }

  @Get("security")
  @SessionRoute({ secondFactorSetup: true })
  @ApiRoute({
    summary: "Get the security overview",
    tags: ["Account"],
    response: { description: "Second factors of the account.", schema: securityOverviewSchema },
  })
  async security(@Req() request: FastifyRequest) {
    return this.#services.security.overview(sessionOf(request).accountId);
  }

  @Post("password")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Change the password",
    tags: ["Account"],
    body: newPasswordSchema,
    errors: ["passwordPolicy"],
  })
  async changePassword(
    @Body() body: z.output<typeof newPasswordSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token } = await this.#services.security.changePassword(sessionOf(request), body.password);
    await setSessionCookie(this.context, reply, token);
  }

  @Post("email")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Change the e-mail address",
    tags: ["Account"],
    status: 202,
    body: newEmailSchema,
    errors: ["emailInUse", "sameEmail", "rateLimited"],
  })
  async changeEmail(@Body() body: z.output<typeof newEmailSchema>, @Req() request: FastifyRequest) {
    await this.#services.security.requestEmailChange(sessionOf(request), body.email);
  }

  @Post("totp")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Start authenticator setup",
    tags: ["Account"],
    status: 200,
    response: { description: "Secret and URI for the app.", schema: totpSetupSchema },
    errors: ["secondFactorExists"],
  })
  async beginTotp(@Req() request: FastifyRequest) {
    return this.#services.security.beginTotp(sessionOf(request));
  }

  @Post("totp/confirm")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Confirm authenticator setup",
    tags: ["Account"],
    status: 200,
    body: totpConfirmationSchema,
    response: { description: "New recovery codes, if any.", schema: recoveryCodesSchema },
    errors: ["invalidSecondFactor"],
  })
  async confirmTotp(
    @Body() body: z.output<typeof totpConfirmationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#factorAdded(reply, await this.#services.security.confirmTotp(sessionOf(request), body.code));
  }

  @Delete("totp")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({ summary: "Remove the authenticator app", tags: ["Account"], errors: ["lastSecondFactor"] })
  async removeTotp(@Req() request: FastifyRequest) {
    if (!(await this.#services.security.removeTotp(sessionOf(request)))) throw notFound();
  }

  @Post("passkeys/registration-options")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Start passkey registration",
    tags: ["Account"],
    status: 200,
    response: { description: "Options for the browser.", schema: creationOptionsSchema },
    errors: ["instanceUrlMissing"],
  })
  async passkeyRegistrationOptions(@Req() request: FastifyRequest) {
    return this.#services.security.passkeyRegistrationOptions(sessionOf(request));
  }

  @Post("passkeys")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Register a passkey",
    tags: ["Account"],
    status: 201,
    body: passkeyRegistrationSchema,
    response: { description: "The passkey and new recovery codes, if any.", schema: passkeyAddedSchema },
    errors: ["challengeExpired", "invalidSecondFactor"],
  })
  async registerPasskey(
    @Body() body: z.output<typeof passkeyRegistrationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const added = await this.#services.security.registerPasskey(
      sessionOf(request),
      body.response as RegistrationResponseJSON,
      body.name,
    );
    return { passkey: added.passkey, ...(await this.#factorAdded(reply, added)) };
  }

  @Delete("passkeys/:id")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a passkey",
    tags: ["Account"],
    params: idParams,
    errors: ["lastSecondFactor"],
  })
  async removePasskey(@Param("id") id: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.security.removePasskey(sessionOf(request), id))) throw notFound();
  }

  @Post("recovery-codes")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Generate recovery codes",
    tags: ["Account"],
    status: 200,
    response: { description: "The new codes.", schema: recoveryCodesSchema },
  })
  async generateRecoveryCodes(@Req() request: FastifyRequest) {
    return { recoveryCodes: await this.#services.security.generateRecoveryCodes(sessionOf(request)) };
  }

  @Get("sessions")
  @SessionRoute()
  @ApiRoute({
    summary: "List sessions",
    tags: ["Account"],
    query: pageQuerySchema,
    response: {
      description: "Sessions of the account.",
      schema: pageSchema(accountSessionSchema, "Sessions, newest first."),
    },
  })
  async sessions(@Req() request: FastifyRequest, @Query() query: z.output<typeof pageQuerySchema>) {
    const current = sessionOf(request);
    const sessions = await this.#services.sessions.list(current.accountId);
    const items = sessions.map((session) => ({
      id: session.id,
      current: session.id === current.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      clientIp: session.clientIp,
      browser: session.browser,
      operatingSystem: session.operatingSystem,
      methods: session.methods,
    }));
    return paginate(items, (item) => [-item.lastUsedAt.getTime(), item.id], query);
  }

  @Delete("sessions/:id")
  @SessionRoute()
  @ApiRoute({ summary: "End a session", tags: ["Account"], params: idParams })
  async endSession(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const current = sessionOf(request);
    if (!(await this.#services.sessions.end(current.accountId, id, "endedByAccount"))) throw notFound();
    if (id === current.id) clearCookie(reply, COOKIES.session);
  }

  @Post("sessions/end-others")
  @SessionRoute()
  @ApiRoute({
    summary: "End all other sessions",
    tags: ["Account"],
    status: 200,
    response: { description: "Number of ended sessions.", schema: endedSchema },
  })
  async endOtherSessions(@Req() request: FastifyRequest) {
    const current = sessionOf(request);
    return { ended: await this.#services.sessions.endOthers(current.accountId, current.id) };
  }
}
