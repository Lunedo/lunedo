import {
  type AccountServices,
  type AuthenticationResponseJSON,
  ChallengeExpiredError,
  generateToken,
  type Session,
  type SessionKind,
  sessionLifetimeSetting,
} from "@lunedo/server";
import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { InternalRoute, PublicRoute, SessionRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import {
  COOKIES,
  clearCookie,
  ensureDeviceCookie,
  readCookie,
  setCookie,
  setPendingCookie,
} from "../http/cookies.js";
import { clientOf, sessionOf } from "../http/request.js";
import {
  passkeySignInSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  reauthenticationSchema,
  requestOptionsSchema,
  secondFactorSchema,
  sessionInfoSchema,
  signedInSchema,
  signInResultSchema,
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
    account: account
      ? {
          id: account.id,
          email: account.email,
          name: account.name,
          type: account.type,
          homeOrganizationId: account.homeOrganizationId,
        }
      : null,
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
  @ApiRoute({
    summary: "Sign in with a password",
    tags: ["Authentication"],
    status: 200,
    body: signInSchema,
    response: { description: "The result.", schema: signInResultSchema },
    errors: ["invalidCredentials", "locked", "rateLimited", "setupIncomplete"],
  })
  async signIn(
    @Body() body: z.output<typeof signInSchema>,
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
  @ApiRoute({
    summary: "Start the passkey second factor",
    tags: ["Authentication"],
    status: 200,
    response: { description: "Options for the browser.", schema: requestOptionsSchema },
    errors: ["challengeExpired"],
  })
  async secondFactorPasskeyOptions(@Req() request: FastifyRequest) {
    return this.#services.signIn.secondFactorPasskeyOptions(this.#pendingToken(request));
  }

  @Post("sign-in/second-factor")
  @PublicRoute()
  @ApiRoute({
    summary: "Complete the second factor",
    tags: ["Authentication"],
    status: 200,
    body: secondFactorSchema,
    response: { description: "The session.", schema: signedInSchema },
    errors: ["challengeExpired", "invalidSecondFactor", "locked", "rateLimited"],
  })
  async secondFactor(
    @Body() body: z.output<typeof secondFactorSchema>,
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
  @ApiRoute({
    summary: "Start passkey sign-in",
    tags: ["Authentication"],
    status: 200,
    response: { description: "Options for the browser.", schema: requestOptionsSchema },
    errors: ["instanceUrlMissing", "rateLimited"],
  })
  async passkeyOptions(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { options, token } = await this.#services.signIn.passkeyOptions(request.ip);
    setPendingCookie(reply, token);
    return options;
  }

  @Post("sign-in/passkey")
  @PublicRoute()
  @ApiRoute({
    summary: "Sign in with a passkey",
    tags: ["Authentication"],
    status: 200,
    body: passkeySignInSchema,
    response: { description: "The session.", schema: signedInSchema },
    errors: ["challengeExpired", "invalidSecondFactor", "rateLimited"],
  })
  async passkeySignIn(
    @Body() body: z.output<typeof passkeySignInSchema>,
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
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "Get the current session",
    tags: ["Authentication"],
    response: { description: "The session.", schema: sessionInfoSchema },
  })
  async session(@Req() request: FastifyRequest) {
    const session = sessionOf(request);
    return {
      ...(await describeSession(this.#services, session)),
      methods: session.methods,
      recentlyAuthenticated: await this.#services.sessions.isRecentlyAuthenticated(session),
    };
  }

  @Post("sign-out")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({ summary: "Sign out", tags: ["Authentication"] })
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = sessionOf(request);
    await this.#services.sessions.end(session.accountId, session.id, "signedOut");
    clearCookie(reply, COOKIES.session);
  }

  @Post("reauthenticate/passkey-options")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "Start passkey reauthentication",
    tags: ["Authentication"],
    status: 200,
    response: { description: "Options for the browser.", schema: requestOptionsSchema },
  })
  async reauthenticationPasskeyOptions(@Req() request: FastifyRequest) {
    return this.#services.signIn.reauthenticationPasskeyOptions(sessionOf(request));
  }

  @Post("reauthenticate")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "Confirm the identity",
    tags: ["Authentication"],
    body: reauthenticationSchema,
    errors: ["invalidCredentials", "invalidSecondFactor", "challengeExpired", "rateLimited"],
  })
  async reauthenticate(
    @Body() body: z.output<typeof reauthenticationSchema>,
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
  @ApiRoute({
    summary: "Request a password reset",
    tags: ["Authentication"],
    status: 202,
    body: passwordResetRequestSchema,
    errors: ["rateLimited"],
  })
  async requestPasswordReset(
    @Body() body: z.output<typeof passwordResetRequestSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.requestPasswordReset(body.email, request.ip);
  }

  @Post("password-reset/complete")
  @PublicRoute()
  @ApiRoute({
    summary: "Set a new password",
    tags: ["Authentication"],
    body: passwordResetSchema,
    errors: ["invalidToken", "passwordPolicy", "rateLimited"],
  })
  async completePasswordReset(
    @Body() body: z.output<typeof passwordResetSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.security.completePasswordReset(body.token, body.password, request.ip);
  }

  @Post("email-change/confirm")
  @PublicRoute()
  @ApiRoute({
    summary: "Confirm an e-mail change",
    tags: ["Authentication"],
    body: tokenSchema,
    errors: ["invalidToken", "emailInUse", "rateLimited"],
  })
  async confirmEmailChange(@Body() body: z.output<typeof tokenSchema>, @Req() request: FastifyRequest) {
    await this.#services.security.confirmEmailChange(body.token, request.ip);
  }

  #pendingToken(request: FastifyRequest): string {
    const token = readCookie(request, COOKIES.pending);
    if (!token) throw new ChallengeExpiredError();
    return token;
  }
}
