import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FactorAdded, RegistrationResponseJSON } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { InternalRoute, SessionRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { COOKIES, clearCookie } from "../http/cookies.js";
import { sessionOf } from "../http/request.js";
import { ZodPipe } from "../http/zod.pipe.js";
import { servicesOf, setSessionCookie } from "./auth.controller.js";
import {
  idSchema,
  newEmailSchema,
  newPasswordSchema,
  passkeyRegistrationSchema,
  totpConfirmationSchema,
} from "./schemas.js";

function notFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: "notFound", message: "Not found" });
}

/** Security settings of the signed-in account: password, e-mail, second factors and sessions. */
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
  async security(@Req() request: FastifyRequest) {
    return this.#services.security.overview(sessionOf(request).accountId);
  }

  @Post("password")
  @SessionRoute({ recentAuthentication: true })
  @HttpCode(204)
  async changePassword(
    @Body(new ZodPipe(newPasswordSchema)) body: z.output<typeof newPasswordSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token } = await this.#services.security.changePassword(sessionOf(request), body.password);
    await setSessionCookie(this.context, reply, token);
  }

  @Post("email")
  @SessionRoute({ recentAuthentication: true })
  @HttpCode(202)
  async changeEmail(
    @Body(new ZodPipe(newEmailSchema)) body: z.output<typeof newEmailSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.requestEmailChange(sessionOf(request), body.email);
  }

  @Post("totp")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @HttpCode(200)
  async beginTotp(@Req() request: FastifyRequest) {
    return this.#services.security.beginTotp(sessionOf(request));
  }

  @Post("totp/confirm")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @HttpCode(200)
  async confirmTotp(
    @Body(new ZodPipe(totpConfirmationSchema)) body: z.output<typeof totpConfirmationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#factorAdded(reply, await this.#services.security.confirmTotp(sessionOf(request), body.code));
  }

  @Delete("totp")
  @SessionRoute({ recentAuthentication: true })
  @HttpCode(204)
  async removeTotp(@Req() request: FastifyRequest) {
    if (!(await this.#services.security.removeTotp(sessionOf(request)))) throw notFound();
  }

  @Post("passkeys/registration-options")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @HttpCode(200)
  async passkeyRegistrationOptions(@Req() request: FastifyRequest) {
    return this.#services.security.passkeyRegistrationOptions(sessionOf(request));
  }

  @Post("passkeys")
  @SessionRoute({ secondFactorSetup: true, recentAuthentication: true })
  @HttpCode(201)
  async registerPasskey(
    @Body(new ZodPipe(passkeyRegistrationSchema)) body: z.output<typeof passkeyRegistrationSchema>,
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
  @HttpCode(204)
  async removePasskey(@Param("id", new ZodPipe(idSchema)) id: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.security.removePasskey(sessionOf(request), id))) throw notFound();
  }

  @Post("recovery-codes")
  @SessionRoute({ recentAuthentication: true })
  @HttpCode(200)
  async generateRecoveryCodes(@Req() request: FastifyRequest) {
    return { recoveryCodes: await this.#services.security.generateRecoveryCodes(sessionOf(request)) };
  }

  @Get("sessions")
  @SessionRoute()
  async sessions(@Req() request: FastifyRequest) {
    const current = sessionOf(request);
    const sessions = await this.#services.sessions.list(current.accountId);
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === current.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      clientIp: session.clientIp,
      browser: session.browser,
      operatingSystem: session.operatingSystem,
      methods: session.methods,
    }));
  }

  @Delete("sessions/:id")
  @SessionRoute()
  @HttpCode(204)
  async endSession(
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const current = sessionOf(request);
    if (!(await this.#services.sessions.end(current.accountId, id, "endedByAccount"))) throw notFound();
    if (id === current.id) clearCookie(reply, COOKIES.session);
  }

  @Post("sessions/end-others")
  @SessionRoute()
  @HttpCode(200)
  async endOtherSessions(@Req() request: FastifyRequest) {
    const current = sessionOf(request);
    return { ended: await this.#services.sessions.endOthers(current.accountId, current.id) };
  }
}
