import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import {
  AuthError,
  type AuthenticationResponseJSON,
  type CallbackResult,
  generateToken,
  OrganizationError,
  ProviderResponseError,
  RateLimitedError,
} from "@pagehall/server";
import { idSchema } from "@pagehall/shared";
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
  LAST_PROVIDER_MAX_AGE_SECONDS,
  PROVIDER_FLOW_MAX_AGE_SECONDS,
  readCookie,
  setCookie,
  setPendingCookie,
} from "../http/cookies.js";
import { ProblemException } from "../http/problems.js";
import { actorOf, clientOf, sessionOf } from "../http/request.js";
import { baseUrlOf } from "./identity-providers.controller.js";
import {
  directoryReauthenticationSchema,
  directorySignInResultSchema,
  directorySignInSchema,
  discoverSchema,
  identityParams,
  identitySchema,
  linkConfirmationSchema,
  linkIdentitySchema,
  linkInfoSchema,
  logoutBodySchema,
  providerIdParams,
  reauthenticateSchema,
  referenceSchema,
  samlResponseBodySchema,
  signInOptionsSchema,
  signInStepSchema,
  startedSchema,
  startSchema,
} from "./schemas.js";

const TAG = "Identity providers";
const LINK_MAX_AGE_SECONDS = 5 * 60;
const accountIdParams = z.object({ accountId: identityParams.shape.accountId }).strict();
const ownIdentityParams = z.object({ identityId: identityParams.shape.identityId }).strict();
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
    return found
      ? {
          id: found.id,
          email: found.email,
          name: found.name,
          type: found.type,
          homeOrganizationId: found.homeOrganizationId,
        }
      : null;
  }

  @Get("auth/sign-in-options")
  @PublicRoute()
  @ApiRoute({
    summary: "Ways to sign in",
    description:
      "Whether the page asks for the e-mail address first, the provider to show directly when it is the only way in, the provider this browser used last, and whether password sign-in is offered. Passkeys are always offered.",
    tags: [TAG],
    response: { description: "Ways to sign in.", schema: signInOptionsSchema },
  })
  async signInOptions(@Req() request: FastifyRequest) {
    const last = idSchema.safeParse(readCookie(request, COOKIES.lastProvider) ?? "");
    return this.#services.providerSignIn.signInOptions(last.success ? last.data : null);
  }

  @Post("auth/sign-in/discover")
  @PublicRoute()
  @ApiRoute({
    summary: "Choose the sign-in method for an e-mail address",
    description:
      "The domain of the address chooses the provider. Other addresses continue to password sign-in when it is allowed. The answer is the same whether an account with the address exists or not.",
    tags: [TAG],
    status: 200,
    body: discoverSchema,
    response: { description: "The next step.", schema: signInStepSchema },
    errors: ["rateLimited"],
  })
  async discover(@Body() body: z.output<typeof discoverSchema>, @Req() request: FastifyRequest) {
    return this.#services.providerSignIn.discover(body.email, request.ip);
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
    errors: ["providerUnavailable", "rateLimited"],
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
      returnTo: body.returnTo ?? null,
      clientIp: request.ip,
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
      const code =
        error instanceof ProviderResponseError
          ? "providerUnavailable"
          : error instanceof AuthError || error instanceof OrganizationError
            ? error.code
            : null;
      if (code === null) throw error;
      await reply
        .status(303)
        .header("location", withQuery("/sign-in", { error: code }))
        .send();
      return;
    }
    let location: string;
    switch (result.kind) {
      case "signedIn":
        await setSessionCookie(this.context, reply, result.signedIn.token);
        setCookie(reply, COOKIES.lastProvider, providerId, LAST_PROVIDER_MAX_AGE_SECONDS);
        location = result.returnTo ?? "/";
        break;
      case "reauthenticated":
        await setSessionCookie(this.context, reply, result.token);
        location = result.returnTo ?? "/settings/security";
        break;
      case "secondFactorRequired":
        setPendingCookie(reply, result.pendingToken);
        location = withQuery("/sign-in/verify", {
          factors: JSON.stringify(result.factors),
          ...(result.returnTo ? { redirect: result.returnTo } : {}),
        });
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

  @Get("auth/providers/:providerId/saml/metadata")
  @PublicRoute()
  @ApiRoute({
    summary: "SAML metadata of Pagehall",
    description:
      "The service provider metadata to register at the identity provider: entity ID, assertion consumer service and the signing certificates of Pagehall.",
    tags: [TAG],
    params: providerIdParams,
    raw: { contentTypes: ["application/samlmetadata+xml"], description: "The metadata.", example: "" },
  })
  async samlMetadata(
    @Param("providerId") providerId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const metadata = await this.#services.providerSignIn.serviceProviderMetadata(
      providerId,
      await baseUrlOf(this.context, request),
    );
    reply
      .header("content-type", "application/samlmetadata+xml")
      .header("content-disposition", `inline; filename="pagehall-${providerId}.xml"`)
      .header("cache-control", "no-cache");
    return metadata;
  }

  @Post("auth/providers/:providerId/saml/acs")
  @PublicRoute()
  @ApiRoute({
    summary: "Receive a SAML response",
    description:
      "The identity provider posts the response here. Pagehall keeps it with the started sign-in and redirects (303) to the callback, which checks it in the browser that started the sign-in.",
    tags: [TAG],
    params: providerIdParams,
    body: samlResponseBodySchema,
    redirect: { description: "Redirect to the callback or to the sign-in page with an error." },
  })
  async samlResponse(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof samlResponseBodySchema>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let location: string;
    try {
      const receipt = await this.#services.providerSignIn.receiveSamlResponse({
        providerId,
        samlResponse: body.SAMLResponse,
        relayState: body.RelayState ?? null,
        baseUrl: await baseUrlOf(this.context, request),
        clientIp: request.ip,
      });
      if (receipt.browserToken) {
        setCookie(reply, COOKIES.providerFlow, receipt.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
      }
      location = withQuery(`/api/v1/auth/providers/${providerId}/callback`, { state: receipt.state });
    } catch (error) {
      const code =
        error instanceof ProviderResponseError
          ? "providerUnavailable"
          : error instanceof AuthError || error instanceof OrganizationError
            ? error.code
            : null;
      if (code === null) throw error;
      location = withQuery("/sign-in", { error: code });
    }
    await reply.status(303).header("location", location).header("cache-control", "no-store").send();
  }

  @Post("auth/providers/:providerId/password")
  @PublicRoute()
  @ApiRoute({
    summary: "Sign in with a directory password",
    description:
      "For LDAP and Active Directory providers. Pagehall finds the person with its service account and checks the password with a bind. Pagehall's rate limits apply before the directory is asked, so failed attempts here never lock the directory account.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    body: directorySignInSchema,
    response: { description: "The outcome.", schema: directorySignInResultSchema },
    errors: [
      "invalidCredentials",
      "passwordExpired",
      "passwordMustChange",
      "accountLocked",
      "accountDisabled",
      "outsideSignInHours",
      "locked",
      "rateLimited",
      "providerUnavailable",
      "providerDeactivated",
    ],
  })
  async directorySignIn(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof directorySignInSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = ensureDeviceCookie(request, reply, generateToken);
    let result: CallbackResult;
    try {
      result = await this.#services.providerSignIn.signInWithDirectory({
        providerId,
        signInName: body.signInName,
        password: body.password,
        client: clientOf(request, device),
      });
    } catch (error) {
      if (error instanceof ProviderResponseError) {
        this.context.logger.warn({ providerId, reason: error.message }, "Directory sign-in failed");
        throw new ProblemException(
          "providerUnavailable",
          "The directory could not be reached. Try again in a few minutes or contact IT.",
        );
      }
      throw error;
    }
    switch (result.kind) {
      case "signedIn":
        await setSessionCookie(this.context, reply, result.signedIn.token);
        setCookie(reply, COOKIES.lastProvider, providerId, LAST_PROVIDER_MAX_AGE_SECONDS);
        return {
          status: "signedIn" as const,
          sessionKind: result.signedIn.session.kind,
          account: await this.#describe(result.signedIn.session.accountId),
        };
      case "secondFactorRequired":
        setPendingCookie(reply, result.pendingToken);
        return { status: "secondFactorRequired" as const, factors: result.factors };
      case "linkRequired":
        setCookie(reply, COOKIES.link, result.pendingToken, LINK_MAX_AGE_SECONDS);
        return { status: "linkRequired" as const };
      case "refused":
        return { status: "refused" as const, reference: result.reference, reason: result.reason };
      default:
        throw new ProblemException("providerUnavailable", "The sign-in could not be completed");
    }
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
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("cache-control", "no-store").header("content-type", "text/plain");
    try {
      await this.#services.providerSignIn.backchannelLogout(providerId, body.logout_token, request.ip);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
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
      clientIp: request.ip,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
    return { url: started.url };
  }

  @Post("auth/reauthenticate/directory")
  @SessionRoute()
  @ApiRoute({
    summary: "Confirm the identity with the directory password",
    description:
      "For accounts linked to an LDAP or Active Directory provider. Pagehall checks the password with a bind.",
    tags: [TAG],
    status: 200,
    body: directoryReauthenticationSchema,
    errors: ["invalidCredentials", "locked", "rateLimited", "providerUnavailable"],
  })
  async reauthenticateWithDirectory(
    @Body() body: z.output<typeof directoryReauthenticationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = sessionOf(request);
    let token: string;
    try {
      token = await this.#services.providerSignIn.reauthenticateWithDirectory({
        sessionId: session.id,
        accountId: session.accountId,
        providerId: body.providerId,
        password: body.password,
        client: clientOf(request),
      });
    } catch (error) {
      if (error instanceof ProviderResponseError) {
        throw new ProblemException(
          "providerUnavailable",
          "The directory could not be reached. Try again in a few minutes or contact IT.",
        );
      }
      throw error;
    }
    await setSessionCookie(this.context, reply, token);
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

  @Delete("account/identities/:identityId")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Unlink an own identity",
    description:
      "Ends the sessions that came from this identity. Refused while it is the last working way to sign in: another identity of an active provider, a passkey, or a password while password sign-in is on.",
    tags: [TAG],
    params: ownIdentityParams,
    errors: ["lastSignInMethod", "reauthenticationRequired"],
  })
  async unlinkOwnIdentity(@Param("identityId") identityId: string, @Req() request: FastifyRequest) {
    await this.#services.administration.unlinkOwnIdentity(sessionOf(request).accountId, identityId);
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
    errors: ["identityInUse", "reauthenticationRequired"],
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
