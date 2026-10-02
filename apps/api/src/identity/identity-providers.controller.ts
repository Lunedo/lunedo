import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import {
  instanceUrlSetting,
  LOGO_MAX_BYTES,
  type ProviderScope,
  type ProviderSummary,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, PROVIDER_FLOW_MAX_AGE_SECONDS, setCookie } from "../http/cookies.js";
import { ownOrigin } from "../http/csrf.js";
import { notFound } from "../http/problems.js";
import { actorOf, sessionOf } from "../http/request.js";
import { organizationIdParams } from "../http/schemas.js";
import {
  addedCredentialSchema,
  availabilitySchema,
  createdProviderSchema,
  createProviderSchema,
  credentialInputSchema,
  credentialParams,
  enabledSchema,
  organizationCredentialParams,
  organizationProviderParams,
  organizationProviderSchema,
  organizationReferenceParams,
  organizationTestResultParams,
  providerIdParams,
  providerSchema,
  referenceParams,
  refusalSchema,
  startedSchema,
  testResultParams,
  testResultSchema,
  testStartSchema,
  updateProviderSchema,
} from "./schemas.js";

const TAG = "Identity providers";
const instanceScope: ProviderScope = { level: "instance" };
const organization = { type: "organization", param: "organizationId" } as const;

const logoBody = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]).describe("Type of the image."),
    data: z
      .base64()
      .max(Math.ceil(LOGO_MAX_BYTES / 3) * 4)
      .describe("The image, Base64-encoded."),
  })
  .strict()
  .describe("A logo image.");

function organizationScope(organizationId: string): ProviderScope {
  return { level: "organization", organizationId };
}

export async function baseUrlOf(context: ApiContext, request: FastifyRequest): Promise<string> {
  const configured = context.settings ? await context.settings.get(instanceUrlSetting, {}) : "";
  return configured || ownOrigin(request);
}

@Controller("api/v1")
@InternalRoute()
export class IdentityProvidersController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #present(request: FastifyRequest, provider: ProviderSummary) {
    const base = await baseUrlOf(this.context, request);
    const { callbackPath, ...rest } = provider;
    return { ...rest, redirectUri: `${base}${callbackPath}` };
  }

  async #presentAll(request: FastifyRequest, providers: ProviderSummary[]) {
    return Promise.all(providers.map((provider) => this.#present(request, provider)));
  }

  async #startTest(
    request: FastifyRequest,
    reply: FastifyReply,
    providerId: string,
    returnTo?: string | null,
  ) {
    await this.#services.identityProviders.get(this.#scopeOfRequest(request), providerId);
    const started = await this.#services.providerSignIn.start({
      providerId,
      purpose: "test",
      baseUrl: await baseUrlOf(this.context, request),
      sessionId: sessionOf(request).id,
      returnTo: returnTo ?? null,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
    return { url: started.url };
  }

  #scopeOfRequest(request: FastifyRequest): ProviderScope {
    const params = request.params as { organizationId?: string };
    return params.organizationId ? organizationScope(params.organizationId) : instanceScope;
  }

  async #testResult(request: FastifyRequest, providerId: string, flowId: string) {
    await this.#services.identityProviders.get(this.#scopeOfRequest(request), providerId);
    const result = await this.#services.providerSignIn.testResult(flowId, sessionOf(request).id);
    if (!result) throw notFound();
    return result;
  }

  async #logo(reply: FastifyReply, providerId: string) {
    const logo = await this.#services.identityProviders.logo(providerId);
    if (!logo) throw notFound();
    reply
      .header("content-type", logo.contentType)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "public, max-age=300")
      .header("etag", `"${logo.ref}"`);
    return logo.data;
  }

  @Get("instance/identity-providers")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "List instance identity providers",
    tags: [TAG],
    response: { description: "Providers set up for the instance.", schema: z.array(providerSchema) },
  })
  async listInstance(@Req() request: FastifyRequest) {
    return this.#presentAll(request, await this.#services.identityProviders.list(instanceScope));
  }

  @Post("instance/identity-providers")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Set up an instance identity provider",
    tags: [TAG],
    status: 201,
    body: createProviderSchema,
    response: { description: "The provider.", schema: createdProviderSchema },
    errors: ["invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async createInstance(@Body() body: z.output<typeof createProviderSchema>, @Req() request: FastifyRequest) {
    return this.#create(request, instanceScope, body);
  }

  async #create(request: FastifyRequest, scope: ProviderScope, body: z.output<typeof createProviderSchema>) {
    const created = await this.#services.identityProviders.create(actorOf(request), scope, {
      name: body.name,
      config: body.config,
      credential:
        body.credential.kind === "clientSecret"
          ? {
              kind: "clientSecret",
              secret: body.credential.secret,
              expiresAt: body.credential.expiresAt ? new Date(body.credential.expiresAt) : null,
            }
          : body.credential,
    });
    return { provider: await this.#present(request, created.provider), credential: created.credential };
  }

  @Get("instance/identity-providers/:providerId")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Get an instance identity provider",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
  })
  async getInstance(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    return this.#present(request, await this.#services.identityProviders.get(instanceScope, providerId));
  }

  @Patch("instance/identity-providers/:providerId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Change an instance identity provider",
    tags: [TAG],
    params: providerIdParams,
    body: updateProviderSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async updateInstance(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof updateProviderSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.identityProviders.update(
      actorOf(request),
      instanceScope,
      providerId,
      body,
    );
    return this.#present(request, updated);
  }

  @Delete("instance/identity-providers/:providerId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove an instance identity provider",
    description: "Removes the provider, its credentials and all identities linked through it.",
    tags: [TAG],
    params: providerIdParams,
    errors: ["reauthenticationRequired"],
  })
  async removeInstance(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.remove(actorOf(request), instanceScope, providerId);
  }

  @Put("instance/identity-providers/:providerId/availability")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Offer an instance provider to organizations",
    tags: [TAG],
    params: providerIdParams,
    body: availabilitySchema,
    response: { description: "The provider.", schema: providerSchema },
  })
  async setAvailability(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof availabilitySchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.identityProviders.setAvailability(
      actorOf(request),
      providerId,
      body.organizationIds,
    );
    return this.#present(request, updated);
  }

  @Post("instance/identity-providers/:providerId/credentials")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Add a credential to an instance provider",
    tags: [TAG],
    status: 201,
    params: providerIdParams,
    body: credentialInputSchema,
    response: { description: "The credential.", schema: addedCredentialSchema },
    errors: ["expiryInPast", "reauthenticationRequired"],
  })
  async addInstanceCredential(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof credentialInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#addCredential(request, instanceScope, providerId, body);
  }

  async #addCredential(
    request: FastifyRequest,
    scope: ProviderScope,
    providerId: string,
    body: z.output<typeof credentialInputSchema>,
  ) {
    return this.#services.identityProviders.addCredential(
      actorOf(request),
      scope,
      providerId,
      body.kind === "clientSecret"
        ? {
            kind: "clientSecret",
            secret: body.secret,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          }
        : body,
    );
  }

  @Delete("instance/identity-providers/:providerId/credentials/:credentialId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a credential of an instance provider",
    tags: [TAG],
    params: credentialParams,
    errors: ["lastCredential", "reauthenticationRequired"],
  })
  async removeInstanceCredential(
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.removeCredential(
      actorOf(request),
      instanceScope,
      providerId,
      credentialId,
    );
  }

  @Get("instance/identity-providers/:providerId/credentials/:credentialId/certificate")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Download the certificate of an instance provider",
    tags: [TAG],
    params: credentialParams,
    raw: { contentTypes: ["application/x-pem-file"], description: "The public certificate.", example: "" },
  })
  async instanceCertificate(
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const certificate = await this.#services.identityProviders.certificate(
      instanceScope,
      providerId,
      credentialId,
    );
    reply
      .header("content-type", "application/x-pem-file")
      .header("content-disposition", `attachment; filename="pagehall-${providerId}.pem"`);
    return certificate;
  }

  @Put("instance/identity-providers/:providerId/logo")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Upload the logo of an instance provider",
    tags: [TAG],
    params: providerIdParams,
    body: logoBody,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidLogo"],
  })
  async uploadInstanceLogo(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof logoBody>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.setLogo(actorOf(request), instanceScope, providerId, {
      contentType: body.contentType,
      data: Buffer.from(body.data, "base64"),
    });
    return this.#present(request, await this.#services.identityProviders.get(instanceScope, providerId));
  }

  @Delete("instance/identity-providers/:providerId/logo")
  @Permission("instance.signIn.manage")
  @ApiRoute({ summary: "Remove the logo of an instance provider", tags: [TAG], params: providerIdParams })
  async removeInstanceLogo(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.removeLogo(actorOf(request), instanceScope, providerId);
  }

  @Post("instance/identity-providers/:providerId/test")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Start a test sign-in with an instance provider",
    description: "Signs nobody in. The result shows what Pagehall received.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    body: testStartSchema,
    response: { description: "The started test.", schema: startedSchema },
  })
  async testInstance(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof testStartSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#startTest(request, reply, providerId, body.returnTo);
  }

  @Get("instance/identity-providers/:providerId/test-results/:flowId")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Get the result of a test sign-in",
    tags: [TAG],
    params: testResultParams,
    response: { description: "What Pagehall received.", schema: testResultSchema },
  })
  async instanceTestResult(
    @Param("providerId") providerId: string,
    @Param("flowId") flowId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#testResult(request, providerId, flowId);
  }

  @Get("instance/sign-in-refusals/:reference")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Look up a refused sign-in",
    tags: [TAG],
    params: referenceParams,
    response: { description: "The refused sign-in.", schema: refusalSchema },
  })
  async instanceRefusal(@Param("reference") reference: string) {
    const refusal = await this.#services.providerSignIn.refusal(reference, null);
    if (!refusal) throw notFound();
    return refusal;
  }

  @Get("organizations/:organizationId/identity-providers")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "List the organization's own identity providers",
    tags: [TAG],
    params: organizationIdParams,
    response: { description: "Providers owned by the organization.", schema: z.array(providerSchema) },
  })
  async listOrganization(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return this.#presentAll(
      request,
      await this.#services.identityProviders.list(organizationScope(organizationId)),
    );
  }

  @Post("organizations/:organizationId/identity-providers")
  @Permission("organization.signIn.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Set up an identity provider of the organization",
    description: "The provider signs in only accounts whose home organization is this organization.",
    tags: [TAG],
    status: 201,
    params: organizationIdParams,
    body: createProviderSchema,
    response: { description: "The provider.", schema: createdProviderSchema },
    errors: ["invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async createOrganization(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createProviderSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#create(request, organizationScope(organizationId), body);
  }

  @Get("organizations/:organizationId/identity-providers/:providerId")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "Get an identity provider of the organization",
    tags: [TAG],
    params: organizationProviderParams,
    response: { description: "The provider.", schema: providerSchema },
  })
  async getOrganization(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#present(
      request,
      await this.#services.identityProviders.get(organizationScope(organizationId), providerId),
    );
  }

  @Patch("organizations/:organizationId/identity-providers/:providerId")
  @Permission("organization.signIn.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Change an identity provider of the organization",
    tags: [TAG],
    params: organizationProviderParams,
    body: updateProviderSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async updateOrganization(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof updateProviderSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.identityProviders.update(
      actorOf(request),
      organizationScope(organizationId),
      providerId,
      body,
    );
    return this.#present(request, updated);
  }

  @Delete("organizations/:organizationId/identity-providers/:providerId")
  @Permission("organization.signIn.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove an identity provider of the organization",
    tags: [TAG],
    params: organizationProviderParams,
    errors: ["reauthenticationRequired"],
  })
  async removeOrganization(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.remove(
      actorOf(request),
      organizationScope(organizationId),
      providerId,
    );
  }

  @Post("organizations/:organizationId/identity-providers/:providerId/credentials")
  @Permission("organization.signIn.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Add a credential to a provider of the organization",
    tags: [TAG],
    status: 201,
    params: organizationProviderParams,
    body: credentialInputSchema,
    response: { description: "The credential.", schema: addedCredentialSchema },
    errors: ["expiryInPast", "reauthenticationRequired"],
  })
  async addOrganizationCredential(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof credentialInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#addCredential(request, organizationScope(organizationId), providerId, body);
  }

  @Delete("organizations/:organizationId/identity-providers/:providerId/credentials/:credentialId")
  @Permission("organization.signIn.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a credential of a provider of the organization",
    tags: [TAG],
    params: organizationCredentialParams,
    errors: ["lastCredential", "reauthenticationRequired"],
  })
  async removeOrganizationCredential(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.removeCredential(
      actorOf(request),
      organizationScope(organizationId),
      providerId,
      credentialId,
    );
  }

  @Get("organizations/:organizationId/identity-providers/:providerId/credentials/:credentialId/certificate")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "Download the certificate of a provider of the organization",
    tags: [TAG],
    params: organizationCredentialParams,
    raw: { contentTypes: ["application/x-pem-file"], description: "The public certificate.", example: "" },
  })
  async organizationCertificate(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const certificate = await this.#services.identityProviders.certificate(
      organizationScope(organizationId),
      providerId,
      credentialId,
    );
    reply
      .header("content-type", "application/x-pem-file")
      .header("content-disposition", `attachment; filename="pagehall-${providerId}.pem"`);
    return certificate;
  }

  @Put("organizations/:organizationId/identity-providers/:providerId/logo")
  @Permission("organization.signIn.manage", organization)
  @ApiRoute({
    summary: "Upload the logo of a provider of the organization",
    tags: [TAG],
    params: organizationProviderParams,
    body: logoBody,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidLogo"],
  })
  async uploadOrganizationLogo(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof logoBody>,
    @Req() request: FastifyRequest,
  ) {
    const scope = organizationScope(organizationId);
    await this.#services.identityProviders.setLogo(actorOf(request), scope, providerId, {
      contentType: body.contentType,
      data: Buffer.from(body.data, "base64"),
    });
    return this.#present(request, await this.#services.identityProviders.get(scope, providerId));
  }

  @Delete("organizations/:organizationId/identity-providers/:providerId/logo")
  @Permission("organization.signIn.manage", organization)
  @ApiRoute({
    summary: "Remove the logo of a provider of the organization",
    tags: [TAG],
    params: organizationProviderParams,
  })
  async removeOrganizationLogo(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.removeLogo(
      actorOf(request),
      organizationScope(organizationId),
      providerId,
    );
  }

  @Post("organizations/:organizationId/identity-providers/:providerId/test")
  @Permission("organization.signIn.manage", organization)
  @ApiRoute({
    summary: "Start a test sign-in with a provider of the organization",
    description: "Signs nobody in. The result shows what Pagehall received.",
    tags: [TAG],
    status: 200,
    params: organizationProviderParams,
    body: testStartSchema,
    response: { description: "The started test.", schema: startedSchema },
  })
  async testOrganization(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof testStartSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#startTest(request, reply, providerId, body.returnTo);
  }

  @Get("organizations/:organizationId/identity-providers/:providerId/test-results/:flowId")
  @Permission("organization.signIn.manage", organization)
  @ApiRoute({
    summary: "Get the result of a test sign-in of a provider of the organization",
    tags: [TAG],
    params: organizationTestResultParams,
    response: { description: "What Pagehall received.", schema: testResultSchema },
  })
  async organizationTestResult(
    @Param("providerId") providerId: string,
    @Param("flowId") flowId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#testResult(request, providerId, flowId);
  }

  @Get("organizations/:organizationId/sign-in-providers")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "List the providers available to the organization",
    description: "Instance providers offered to the organization and its own providers, each on or off.",
    tags: [TAG],
    params: organizationIdParams,
    response: { description: "Available providers.", schema: z.array(organizationProviderSchema) },
  })
  async organizationProviders(@Param("organizationId") organizationId: string) {
    return this.#services.identityProviders.organizationProviders(organizationId);
  }

  @Put("organizations/:organizationId/sign-in-providers/:providerId")
  @Permission("organization.signIn.manage", organization)
  @ApiRoute({
    summary: "Turn a provider on or off for the organization",
    tags: [TAG],
    params: organizationProviderParams,
    body: enabledSchema,
    response: { description: "Available providers.", schema: z.array(organizationProviderSchema) },
  })
  async setEnabled(
    @Param("organizationId") organizationId: string,
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof enabledSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.identityProviders.setEnabled(
      actorOf(request),
      organizationId,
      providerId,
      body.enabled,
    );
  }

  @Get("organizations/:organizationId/sign-in-refusals/:reference")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "Look up a refused sign-in in the organization",
    tags: [TAG],
    params: organizationReferenceParams,
    response: { description: "The refused sign-in.", schema: refusalSchema },
  })
  async organizationRefusal(
    @Param("organizationId") organizationId: string,
    @Param("reference") reference: string,
  ) {
    const refusal = await this.#services.providerSignIn.refusal(reference, organizationId);
    if (!refusal) throw notFound();
    return refusal;
  }

  @Get("identity-providers/:providerId/logo")
  @PublicRoute()
  @ApiRoute({
    summary: "Get the logo of a provider",
    tags: [TAG],
    params: providerIdParams,
    raw: { contentTypes: ["image/png", "image/jpeg", "image/webp"], description: "The logo.", example: "" },
  })
  async logo(@Param("providerId") providerId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.#logo(reply, providerId);
  }
}
