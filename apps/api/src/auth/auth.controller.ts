import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import {
  type AccountServices,
  type AuthenticationResponseJSON,
  ChallengeExpiredError,
  generateToken,
  type Session,
  type SessionKind,
  sessionLifetimeSetting,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { InternalRoute, PublicRoute, SessionRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import {
  COOKIES,
  clearCookie,
  ensureDeviceCookie,
  readCookie,
  setCookie,
  setPendingCookie,
} from "../http/cookies.js";
import { clientOf, sessionOf } from "../http/request.js";
import { ZodPipe } from "../http/zod.pipe.js";
import {
  passkeySignInSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  reauthenticationSchema,
  secondFactorSchema,
  signInSchema,
  tokenSchema,
} from "./schemas.js";

export async function setSessionCookie(
  context: ApiContext,
  reply: FastifyReply,
  token: string,
): Promise<void> {
  const minutes = context.settings ? await context.settings.get(sessionLifetimeSetting, {}) : 0;
  setCookie(reply, COOKIES.session, token, minutes * 60);
}

export function servicesOf(context: ApiContext): AccountServices {
  if (!context.services) throw new Error("The account services are not available");
  return context.services;
}

async function describeSession(services: AccountServices, session: Session) {
  const account = await services.accounts.get(session.accountId);
  return {
    sessionKind: session.kind satisfies SessionKind,
    account: account ? { id: account.id, email: account.email, name: account.name } : null,
  };
}

@Controller("api/v1/auth")
@InternalRoute()
export class AuthController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Post("sign-in")
  @PublicRoute()
  @HttpCode(200)
  async signIn(
    @Body(new ZodPipe(signInSchema)) body: z.output<typeof signInSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    const result = await this.#services.signIn.signInWithPassword({
      email: body.email,
      password: body.password,
      client: clientOf(request, device),
    });
    if (result.status === "secondFactorRequired") {
      setPendingCookie(reply, result.pendingToken);
      return { status: result.status, factors: result.factors };
    }
    await setSessionCookie(this.context, reply, result.token);
    return { status: result.status, ...(await describeSession(this.#services, result.session)) };
  }

  @Post("sign-in/second-factor/passkey-options")
  @PublicRoute()
  @HttpCode(200)
  async secondFactorPasskeyOptions(@Req() request: FastifyRequest) {
    return this.#services.signIn.secondFactorPasskeyOptions(this.#pendingToken(request));
  }

  @Post("sign-in/second-factor")
  @PublicRoute()
  @HttpCode(200)
  async secondFactor(
    @Body(new ZodPipe(secondFactorSchema)) body: z.output<typeof secondFactorSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    const factor =
      body.type === "passkey"
        ? { type: body.type, response: body.response as AuthenticationResponseJSON }
        : { type: body.type, code: body.code };
    const result = await this.#services.signIn.completeSecondFactor({
      pendingToken: this.#pendingToken(request),
      factor,
      client: clientOf(request, device),
    });
    clearCookie(reply, COOKIES.pending);
    await setSessionCookie(this.context, reply, result.token);
    return { status: result.status, ...(await describeSession(this.#services, result.session)) };
  }

  @Post("sign-in/passkey-options")
  @PublicRoute()
  @HttpCode(200)
  async passkeyOptions(@Res({ passthrough: true }) reply: FastifyReply) {
    const { options, token } = await this.#services.signIn.passkeyOptions();
    setPendingCookie(reply, token);
    return options;
  }

  @Post("sign-in/passkey")
  @PublicRoute()
  @HttpCode(200)
  async passkeySignIn(
    @Body(new ZodPipe(passkeySignInSchema)) body: z.output<typeof passkeySignInSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    const result = await this.#services.signIn.signInWithPasskey({
      token: this.#pendingToken(request),
      response: body.response as AuthenticationResponseJSON,
      client: clientOf(request, device),
    });
    clearCookie(reply, COOKIES.pending);
    await setSessionCookie(this.context, reply, result.token);
    return { status: result.status, ...(await describeSession(this.#services, result.session)) };
  }

  @Get("session")
  @SessionRoute({ secondFactorSetup: true })
  async session(@Req() request: FastifyRequest) {
    const session = sessionOf(request);
    return {
      ...(await describeSession(this.#services, session)),
      methods: session.methods,
      recentlyAuthenticated: await this.#services.sessions.isRecentlyAuthenticated(session),
    };
  }

  @Post("sign-out")
  @SessionRoute({ secondFactorSetup: true })
  @HttpCode(204)
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = sessionOf(request);
    await this.#services.sessions.end(session.accountId, session.id, "signedOut");
    clearCookie(reply, COOKIES.session);
  }

  @Post("reauthenticate/passkey-options")
  @SessionRoute({ secondFactorSetup: true })
  @HttpCode(200)
  async reauthenticationPasskeyOptions(@Req() request: FastifyRequest) {
    return this.#services.signIn.reauthenticationPasskeyOptions(sessionOf(request));
  }

  @Post("reauthenticate")
  @SessionRoute({ secondFactorSetup: true })
  @HttpCode(204)
  async reauthenticate(
    @Body(new ZodPipe(reauthenticationSchema)) body: z.output<typeof reauthenticationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input =
      body.method === "passkey"
        ? { method: body.method, response: body.response as AuthenticationResponseJSON }
        : body;
    const token = await this.#services.signIn.reauthenticate(sessionOf(request), input, clientOf(request));
    await setSessionCookie(this.context, reply, token);
  }

  @Post("password-reset")
  @PublicRoute()
  @HttpCode(202)
  async requestPasswordReset(
    @Body(new ZodPipe(passwordResetRequestSchema)) body: z.output<typeof passwordResetRequestSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.requestPasswordReset(body.email, request.ip);
  }

  @Post("password-reset/complete")
  @PublicRoute()
  @HttpCode(204)
  async completePasswordReset(
    @Body(new ZodPipe(passwordResetSchema)) body: z.output<typeof passwordResetSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.completePasswordReset(body.token, body.password, request.ip);
  }

  @Post("email-change/confirm")
  @PublicRoute()
  @HttpCode(204)
  async confirmEmailChange(
    @Body(new ZodPipe(tokenSchema)) body: z.output<typeof tokenSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.confirmEmailChange(body.token, request.ip);
  }

  #pendingToken(request: FastifyRequest): string {
    const token = readCookie(request, COOKIES.pending);
    if (!token) throw new ChallengeExpiredError();
    return token;
  }
}
