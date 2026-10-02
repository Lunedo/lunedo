import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import {
  AuthError,
  type AuthenticationResponseJSON,
  type CallbackResult,
  generateToken,
  OrganizationError,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute, SessionRoute } from "../access/route-access.js";
import { servicesOf, setSessionCookie } from "../auth/auth.controller.js";
import { requestOptionsSchema, signedInSchema } from "../auth/schemas.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import {
  COOKIES,
  clearCookie,
  ensureDeviceCookie,
  PROVIDER_FLOW_MAX_AGE_SECONDS,
  readCookie,
  setCookie,
} from "../http/cookies.js";
import { ProblemException } from "../http/problems.js";
import { actorOf, clientOf, sessionOf } from "../http/request.js";
import { baseUrlOf } from "./identity-providers.controller.js";
import {
  identityParams,
  identitySchema,
  linkConfirmationSchema,
  linkIdentitySchema,
  linkInfoSchema,
  logoutBodySchema,
  providerIdParams,
  reauthenticateSchema,
  referenceSchema,
  signInOptionsQuery,
  signInOptionsSchema,
  startedSchema,
  startSchema,
} from "./schemas.js";

const TAG = "Identity providers";
const LINK_MAX_AGE_SECONDS = 5 * 60;
const accountIdParams = z.object({ accountId: identityParams.shape.accountId }).strict();
const account = { type: "account", param: "accountId" } as const;

function withQuery(path: string, values: Record<string, string>): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams(values).toString()}`;
}

@Controller("api/v1")
@InternalRoute()
export class ProviderAuthController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  #linkToken(request: FastifyRequest): string {
    const token = readCookie(request, COOKIES.link);
    if (!token) throw new ProblemException("challengeExpired", "Sign in through the provider again");
    return token;
  }

  async #describe(accountId: string) {
    const found = await this.#services.accounts.get(accountId);
    return found ? { id: found.id, email: found.email, name: found.name } : null;
  }

  @Get("auth/sign-in-options")
  @PublicRoute()
  @ApiRoute({
    summary: "Ways to sign in",
    description:
      "Providers the organization turned on and whether password sign-in is offered. Without `organization`, an instance with one organization answers for it.",
    tags: [TAG],
    query: signInOptionsQuery,
    response: { description: "Ways to sign in.", schema: signInOptionsSchema },
  })
  async signInOptions(@Query() query: z.output<typeof signInOptionsQuery>) {
    return this.#services.providerSignIn.signInOptions(query.organization ?? null);
  }

  @Post("auth/providers/:providerId/start")
  @PublicRoute()
  @ApiRoute({
    summary: "Start a sign-in through a provider",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    body: startSchema,
    response: { description: "The provider address to open.", schema: startedSchema },
  })
  async start(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof startSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const started = await this.#services.providerSignIn.start({
      providerId,
      purpose: "signIn",
      baseUrl: await baseUrlOf(this.context, request),
      organizationId: body.organizationId ?? null,
      returnTo: body.returnTo ?? null,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
    return { url: started.url };
  }

  @Get("auth/providers/:providerId/callback")
  @PublicRoute()
  @ApiRoute({
    summary: "Return from a provider",
    description:
      "The provider sends the browser here. Pagehall answers with a redirect (303) to the next page.",
    tags: [TAG],
    params: providerIdParams,
    redirect: { description: "Redirect to the next page: the start page, linking, or the refusal page." },
  })
  async callback(
    @Param("providerId") providerId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    const query = new URLSearchParams(request.url.split("?")[1] ?? "");
    clearCookie(reply, COOKIES.providerFlow);
    let result: CallbackResult;
    try {
      result = await this.#services.providerSignIn.callback({
        providerId,
        query,
        browserToken: readCookie(request, COOKIES.providerFlow),
        client: clientOf(request, device),
      });
    } catch (error) {
      if (!(error instanceof AuthError) && !(error instanceof OrganizationError)) throw error;
      await reply
        .status(303)
        .header("location", withQuery("/sign-in", { error: error.code }))
        .send();
      return;
    }
    let location: string;
    switch (result.kind) {
      case "signedIn":
        await setSessionCookie(this.context, reply, result.signedIn.token);
        location = result.returnTo ?? "/";
        break;
      case "reauthenticated":
        await setSessionCookie(this.context, reply, result.token);
        location = result.returnTo ?? "/settings/security";
        break;
      case "linkRequired":
        setCookie(reply, COOKIES.link, result.pendingToken, LINK_MAX_AGE_SECONDS);
        location = "/sign-in/link";
        break;
      case "refused":
        location = withQuery("/sign-in/refused", { reference: result.reference, reason: result.reason });
        break;
      case "tested":
        location = withQuery(result.returnTo ?? "/settings", { providerTest: result.flowId });
        break;
    }
    await reply.status(303).header("location", location).header("cache-control", "no-store").send();
  }

  @Post("auth/providers/:providerId/backchannel-logout")
  @PublicRoute()
  @ApiRoute({
    summary: "Back-channel logout",
    description:
      "The provider signs a person out. Pagehall validates the logout token and ends the sessions that came from that provider sign-in.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    body: logoutBodySchema,
    raw: { contentTypes: ["text/plain"], description: "The sessions ended.", example: "" },
  })
  async backchannelLogout(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof logoutBodySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("cache-control", "no-store").header("content-type", "text/plain");
    try {
      await this.#services.providerSignIn.backchannelLogout(providerId, body.logout_token);
    } catch (error) {
      this.context.logger.warn({ providerId, reason: (error as Error).message }, "Logout token rejected");
      throw new ProblemException("invalidInput", "The logout token was not accepted");
    }
    return "";
  }

  @Get("auth/link")
  @PublicRoute()
  @ApiRoute({
    summary: "Identity waiting to be linked",
    tags: [TAG],
    response: { description: "The identity and the account.", schema: linkInfoSchema },
    errors: ["challengeExpired"],
  })
  async linkInfo(@Req() request: FastifyRequest) {
    return this.#services.providerSignIn.linkInfo(this.#linkToken(request));
  }

  @Post("auth/link/passkey-options")
  @PublicRoute()
  @ApiRoute({
    summary: "Start the passkey confirmation of a link",
    tags: [TAG],
    status: 200,
    response: { description: "Options for the browser.", schema: requestOptionsSchema },
    errors: ["challengeExpired"],
  })
  async linkPasskeyOptions(@Req() request: FastifyRequest) {
    return this.#services.signIn.identityLinkPasskeyOptions(this.#linkToken(request));
  }

  @Post("auth/link")
  @PublicRoute()
  @ApiRoute({
    summary: "Link the identity to the existing account",
    description: "Confirms with the password and the second factor of the existing account, then signs in.",
    tags: [TAG],
    status: 200,
    body: linkConfirmationSchema,
    response: { description: "The session.", schema: signedInSchema },
    errors: ["challengeExpired", "invalidCredentials", "invalidSecondFactor", "locked", "rateLimited"],
  })
  async link(
    @Body() body: z.output<typeof linkConfirmationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    const factor = body.factor
      ? body.factor.type === "passkey"
        ? { type: body.factor.type, response: body.factor.response as AuthenticationResponseJSON }
        : { type: body.factor.type, code: body.factor.code }
      : null;
    const result = await this.#services.signIn.confirmIdentityLink({
      pendingToken: this.#linkToken(request),
      password: body.password,
      factor,
      client: clientOf(request, device),
    });
    clearCookie(reply, COOKIES.link);
    await setSessionCookie(this.context, reply, result.token);
    return {
      status: result.status,
      sessionKind: result.session.kind,
      account: await this.#describe(result.session.accountId),
    };
  }

  @Post("auth/link/decline")
  @PublicRoute()
  @ApiRoute({
    summary: "Decline linking",
    description:
      "The person says the account is not theirs. The sign-in ends with a reference for administrators.",
    tags: [TAG],
    status: 200,
    response: { description: "The reference.", schema: referenceSchema },
    errors: ["challengeExpired"],
  })
  async declineLink(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.#services.providerSignIn.declineLink(this.#linkToken(request));
    clearCookie(reply, COOKIES.link);
    return result;
  }

  @Post("auth/reauthenticate/provider")
  @SessionRoute()
  @ApiRoute({
    summary: "Confirm the identity through a provider",
    description: "Starts a fresh sign-in at the provider. Pagehall checks that it happened just now.",
    tags: [TAG],
    status: 200,
    body: reauthenticateSchema,
    response: { description: "The provider address to open.", schema: startedSchema },
  })
  async reauthenticate(
    @Body() body: z.output<typeof reauthenticateSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = sessionOf(request);
    const started = await this.#services.providerSignIn.start({
      providerId: body.providerId,
      purpose: "reauthentication",
      baseUrl: await baseUrlOf(this.context, request),
      sessionId: session.id,
      accountId: session.accountId,
      returnTo: body.returnTo ?? null,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
    return { url: started.url };
  }

  @Get("account/identities")
  @SessionRoute()
  @ApiRoute({
    summary: "List own linked identities",
    tags: [TAG],
    response: { description: "Linked identities.", schema: z.array(identitySchema) },
  })
  async ownIdentities(@Req() request: FastifyRequest) {
    return this.#services.administration.identities(sessionOf(request).accountId);
  }

  @Get("accounts/:accountId/identities")
  @Permission("account.identities.view", account)
  @ApiRoute({
    summary: "List the identities of an account",
    tags: [TAG],
    params: accountIdParams,
    response: { description: "Linked identities.", schema: z.array(identitySchema) },
  })
  async identities(@Param("accountId") accountId: string) {
    return this.#services.administration.identities(accountId);
  }

  @Post("accounts/:accountId/identities")
  @Permission("account.identities.manage", account, { recentAuthentication: true })
  @ApiRoute({
    summary: "Link an identity to an account",
    tags: [TAG],
    status: 201,
    params: accountIdParams,
    body: linkIdentitySchema,
    response: { description: "The linked identity.", schema: identitySchema },
    errors: ["identityInUse", "providerNotEnabled", "otherOrganization", "reauthenticationRequired"],
  })
  async linkIdentity(
    @Param("accountId") accountId: string,
    @Body() body: z.output<typeof linkIdentitySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.administration.linkIdentity(actorOf(request), accountId, body);
  }

  @Delete("accounts/:accountId/identities/:identityId")
  @Permission("account.identities.manage", account, { recentAuthentication: true })
  @ApiRoute({
    summary: "Unlink an identity from an account",
    description: "Ends the sessions that came from this identity. The last way to sign in cannot be removed.",
    tags: [TAG],
    params: identityParams,
    errors: ["lastSignInMethod", "reauthenticationRequired"],
  })
  async unlinkIdentity(
    @Param("accountId") accountId: string,
    @Param("identityId") identityId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.administration.unlinkIdentity(actorOf(request), accountId, identityId);
  }
}
