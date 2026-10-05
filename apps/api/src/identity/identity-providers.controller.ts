import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import {
  type CredentialInput,
  LOGO_MAX_BYTES,
  type ProviderDraft,
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
import { instanceUrlOf } from "../http/instance-url.js";
import { notFound } from "../http/problems.js";
import { actorOf, sessionOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  addedCredentialSchema,
  caCertificateUploadSchema,
  connectionCheckResultSchema,
  connectionCheckSchema,
  createDraftSchema,
  createdProviderSchema,
  createdScimTokenSchema,
  createProviderSchema,
  credentialChoiceSchema,
  credentialInputSchema,
  credentialParams,
  directoryTestResultSchema,
  directoryTestSchema,
  draftParams,
  draftSchema,
  providerIdParams,
  providerSchema,
  referenceParams,
  refusalSchema,
  removalPreviewSchema,
  samlMetadataUploadSchema,
  scimStatusSchema,
  scimTokenParams,
  startedSchema,
  testResultParams,
  testResultSchema,
  testStartSchema,
  updateDraftSchema,
  updateProviderSchema,
} from "./schemas.js";
import { scimPath } from "./scim.controller.js";

const TAG = "Identity providers";

const emergencyRecipientsSchema = z
  .object({
    instanceAdministrators: z
      .boolean()
      .describe("Whether all instance owners and administrators are told, besides the instance owner."),
    accounts: z
      .array(
        z.object({
          id: uuid("ID of the account."),
          name: z.string().describe("Name of the account."),
          email: z.string().nullable().describe("E-mail address of the account."),
        }),
      )
      .describe("Further accounts that get a notification."),
    addresses: z.array(z.string()).describe("E-mail addresses outside Pagehall that get an e-mail."),
  })
  .describe("Who is told about an emergency sign-in of the instance owner.");

const emergencyRecipientsInputSchema = z
  .object({
    instanceAdministrators: z.boolean().describe("Whether instance owners and administrators are told."),
    accountIds: z
      .array(uuid("ID of an account."))
      .max(50)
      .describe("Further active accounts to notify, up to 50."),
    addresses: z.array(z.email()).max(20).describe("E-mail addresses outside Pagehall, up to 20."),
  })
  .strict()
  .describe("The recipients of emergency sign-in warnings.");

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

function credentialOf(body: z.output<typeof credentialInputSchema>): CredentialInput {
  return body.kind === "clientSecret"
    ? {
        kind: "clientSecret",
        secret: body.secret,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      }
    : body;
}

export async function baseUrlOf(context: ApiContext, request: FastifyRequest): Promise<string> {
  return (await instanceUrlOf(context)) || ownOrigin(request);
}

@Controller("api/v1")
@InternalRoute()
export class IdentityProvidersController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #present(request: FastifyRequest, provider: ProviderSummary) {
    const base = (await baseUrlOf(this.context, request)).replace(/\/+$/, "");
    if (provider.type === "saml") {
      const { callbackPath, saml, ...rest } = provider;
      return {
        ...rest,
        redirectUri: `${base}${callbackPath}`,
        saml: {
          entityId: `${base}${saml.metadataPath}`,
          metadataUrl: `${base}${saml.metadataPath}`,
          identityProvider: saml.identityProvider,
        },
      };
    }
    if (provider.type === "ldap") {
      const { callbackPath: _callbackPath, ...rest } = provider;
      return { ...rest, redirectUri: `${base}/sign-in` };
    }
    const { callbackPath, ...rest } = provider;
    return { ...rest, redirectUri: `${base}${callbackPath}` };
  }

  async #presentDraft(request: FastifyRequest, draft: ProviderDraft) {
    const base = (await baseUrlOf(this.context, request)).replace(/\/+$/, "");
    const { callbackPath, saml, ...rest } = draft;
    return {
      ...rest,
      redirectUri: draft.type === "ldap" ? `${base}/sign-in` : `${base}${callbackPath}`,
      saml: saml
        ? {
            entityId: `${base}${saml.metadataPath}`,
            metadataUrl: `${base}${saml.metadataPath}`,
            signingCredentialId: saml.signingCredentialId,
          }
        : null,
    };
  }

  @Post("instance/identity-provider-drafts")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Start setting up an instance identity provider",
    description:
      "Creates a draft with its final ID, so that the redirect URI, the SAML entity ID and Pagehall's signing certificate are known before anything is entered at the provider.",
    tags: [TAG],
    status: 201,
    body: createDraftSchema,
    response: { description: "The draft.", schema: draftSchema },
    errors: ["invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async createDraft(@Body() body: z.output<typeof createDraftSchema>, @Req() request: FastifyRequest) {
    return this.#presentDraft(
      request,
      await this.#services.identityProviders.createDraft(actorOf(request), body),
    );
  }

  @Get("instance/identity-provider-drafts")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "List the unfinished drafts of instance identity providers",
    tags: [TAG],
    response: { description: "The drafts, newest first.", schema: z.array(draftSchema) },
  })
  async listDrafts(@Req() request: FastifyRequest) {
    const drafts = await this.#services.identityProviders.drafts();
    return Promise.all(drafts.map((draft) => this.#presentDraft(request, draft)));
  }

  @Get("instance/identity-provider-drafts/:draftId")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Get a draft of an instance identity provider",
    tags: [TAG],
    params: draftParams,
    response: { description: "The draft.", schema: draftSchema },
  })
  async getDraft(@Param("draftId") draftId: string, @Req() request: FastifyRequest) {
    return this.#presentDraft(request, await this.#services.identityProviders.draft(draftId));
  }

  @Patch("instance/identity-provider-drafts/:draftId")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Save a draft of an instance identity provider",
    tags: [TAG],
    params: draftParams,
    body: updateDraftSchema,
    response: { description: "The draft.", schema: draftSchema },
    errors: ["invalidProviderConfiguration", "invalidInput"],
  })
  async updateDraft(
    @Param("draftId") draftId: string,
    @Body() body: z.output<typeof updateDraftSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#presentDraft(request, await this.#services.identityProviders.updateDraft(draftId, body));
  }

  @Delete("instance/identity-provider-drafts/:draftId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a draft of an instance identity provider",
    tags: [TAG],
    params: draftParams,
    errors: ["reauthenticationRequired"],
  })
  async removeDraft(@Param("draftId") draftId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.draft(draftId);
    await this.#services.identityProviders.remove(actorOf(request), draftId);
  }

  @Post("instance/identity-providers/:providerId/complete-setup")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Finish the setup of an instance identity provider",
    description: "From now on, people sign in through the provider and it is synchronized.",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["reauthenticationRequired"],
  })
  async completeSetup(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    return this.#present(
      request,
      await this.#services.identityProviders.completeSetup(actorOf(request), providerId),
    );
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
    await this.#services.identityProviders.get(providerId);
    const started = await this.#services.providerSignIn.start({
      providerId,
      purpose: "test",
      baseUrl: await baseUrlOf(this.context, request),
      sessionId: sessionOf(request).id,
      returnTo: returnTo ?? null,
      clientIp: request.ip,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, PROVIDER_FLOW_MAX_AGE_SECONDS);
    return { url: started.url };
  }

  async #testResult(request: FastifyRequest, providerId: string, flowId: string) {
    await this.#services.identityProviders.get(providerId);
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
    return this.#presentAll(request, await this.#services.identityProviders.list());
  }

  @Post("instance/identity-providers")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Set up an instance identity provider",
    tags: [TAG],
    status: 201,
    body: createProviderSchema,
    response: { description: "The provider.", schema: createdProviderSchema },
    errors: [
      "invalidProviderConfiguration",
      "invalidSamlMetadata",
      "domainInUse",
      "invalidInput",
      "reauthenticationRequired",
    ],
  })
  async createInstance(@Body() body: z.output<typeof createProviderSchema>, @Req() request: FastifyRequest) {
    return this.#create(request, body);
  }

  async #create(request: FastifyRequest, body: z.output<typeof createProviderSchema>) {
    const credential = body.credential ? credentialOf(body.credential) : null;
    const created = await this.#services.identityProviders.create(actorOf(request), {
      type: body.type,
      name: body.name,
      config: body.config,
      credential,
      metadataXml: body.type === "saml" ? (body.metadataXml ?? null) : null,
      draftId: body.draftId ?? null,
    });
    return { provider: await this.#present(request, created.provider), credential: created.credential };
  }

  @Get("instance/emergency-sign-in-recipients")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Get who is told about an emergency sign-in",
    tags: [TAG],
    response: { description: "The recipients.", schema: emergencyRecipientsSchema },
  })
  async emergencyRecipients() {
    return this.#services.emergencyRecipients.get();
  }

  @Put("instance/emergency-sign-in-recipients")
  @Permission("instance.emergencyRecipients.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Change who is told about an emergency sign-in",
    description:
      "Only the instance owner can change the recipients. The instance owner is always told. Every change is audited.",
    tags: [TAG],
    body: emergencyRecipientsInputSchema,
    response: { description: "The recipients.", schema: emergencyRecipientsSchema },
    errors: ["invalidInput", "reauthenticationRequired"],
  })
  async setEmergencyRecipients(
    @Body() body: z.output<typeof emergencyRecipientsInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.emergencyRecipients.set(actorOf(request), body);
  }

  @Get("instance/sign-in-security")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Get warnings about the sign-in security of the instance",
    tags: [TAG],
    response: {
      description: "The warnings.",
      schema: z
        .object({
          insecureIdentityProviders: z
            .boolean()
            .describe(
              "Whether PAGEHALL_INSECURE_IDENTITY_PROVIDERS is set, so identity providers may use plain HTTP and any host.",
            ),
        })
        .describe("Sign-in security warnings."),
    },
  })
  signInSecurity() {
    return { insecureIdentityProviders: this.#services.identityProviders.allowsInsecure };
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
    return this.#present(request, await this.#services.identityProviders.get(providerId));
  }

  @Patch("instance/identity-providers/:providerId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Change an instance identity provider",
    tags: [TAG],
    params: providerIdParams,
    body: updateProviderSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidProviderConfiguration", "domainInUse", "reauthenticationRequired"],
  })
  async updateInstance(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof updateProviderSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.identityProviders.update(actorOf(request), providerId, body);
    return this.#present(request, updated);
  }

  @Post("instance/identity-providers/:providerId/deactivate")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Deactivate an instance identity provider",
    description:
      "Nobody can sign in through the provider any more, synchronization stops and the sessions that came from it end. Everything else stays and returns when the provider is activated again.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["reauthenticationRequired"],
  })
  async deactivateInstance(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    const provider = await this.#services.identityProviders.deactivate(actorOf(request), providerId);
    return this.#present(request, provider);
  }

  @Post("instance/identity-providers/:providerId/activate")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Activate an instance identity provider again",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["reauthenticationRequired"],
  })
  async activateInstance(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    const provider = await this.#services.identityProviders.activate(actorOf(request), providerId);
    return this.#present(request, provider);
  }

  @Get("instance/identity-providers/:providerId/removal-preview")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Preview the removal of an instance identity provider",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "What the removal changes.", schema: removalPreviewSchema },
  })
  async removalPreview(@Param("providerId") providerId: string) {
    return this.#services.identityProviders.removalPreview(providerId);
  }

  @Delete("instance/identity-providers/:providerId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove an instance identity provider",
    description:
      "Removes the provider, its credentials, its mapping rules and all identities linked through it. Memberships and roles its rules granted are withdrawn; its synchronized groups become ordinary groups with their members and permissions.",
    tags: [TAG],
    params: providerIdParams,
    errors: ["reauthenticationRequired"],
  })
  async removeInstance(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.remove(actorOf(request), providerId);
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
    errors: ["expiryInPast", "invalidInput", "reauthenticationRequired"],
  })
  async addInstanceCredential(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof credentialInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#addCredential(request, providerId, body);
  }

  async #addCredential(
    request: FastifyRequest,
    providerId: string,
    body: z.output<typeof credentialInputSchema>,
  ) {
    return this.#services.identityProviders.addCredential(actorOf(request), providerId, credentialOf(body));
  }

  @Get("instance/identity-providers/:providerId/scim")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Show the SCIM connection of a provider",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "The SCIM endpoint, its tokens and recent activity.", schema: scimStatusSchema },
    errors: ["notFound"],
  })
  async scimStatus(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.get(providerId);
    const base = (await baseUrlOf(this.context, request)).replace(/\/+$/, "");
    return { url: `${base}${scimPath(providerId)}`, ...(await this.#services.scimTokens.status(providerId)) };
  }

  @Post("instance/identity-providers/:providerId/scim/tokens")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Create a SCIM token",
    description:
      "The token is shown only in this response. Creating the first token turns SCIM on for the provider.",
    tags: [TAG],
    status: 201,
    params: providerIdParams,
    response: { description: "The token.", schema: createdScimTokenSchema },
    errors: ["notFound", "reauthenticationRequired"],
  })
  async createScimToken(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    return this.#services.scimTokens.create(actorOf(request), providerId);
  }

  @Post("instance/identity-providers/:providerId/scim/tokens/:tokenId/renew")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Renew a SCIM token",
    description:
      "Creates a new token. The old one keeps working for seven days, so the new one can be entered at the provider without an interruption.",
    tags: [TAG],
    status: 201,
    params: scimTokenParams,
    response: { description: "The new token.", schema: createdScimTokenSchema },
    errors: ["notFound", "reauthenticationRequired"],
  })
  async renewScimToken(
    @Param("providerId") providerId: string,
    @Param("tokenId") tokenId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.scimTokens.renew(actorOf(request), providerId, tokenId);
  }

  @Delete("instance/identity-providers/:providerId/scim/tokens/:tokenId")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a SCIM token",
    description: "The token stops working at once. Without tokens, SCIM is off for the provider.",
    tags: [TAG],
    params: scimTokenParams,
    errors: ["notFound", "reauthenticationRequired"],
  })
  async removeScimToken(
    @Param("providerId") providerId: string,
    @Param("tokenId") tokenId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.scimTokens.remove(actorOf(request), providerId, tokenId);
  }

  @Put("instance/identity-providers/:providerId/credentials/:credentialId/use")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Choose the credential an instance provider uses",
    description:
      "Pagehall uses the newest valid credential of each kind unless an administrator chooses another one. A chosen credential stays in use until it expires, is removed or another choice is made.",
    tags: [TAG],
    params: credentialParams,
    body: credentialChoiceSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["credentialExpired", "notFound", "reauthenticationRequired"],
  })
  async chooseInstanceCredential(
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Body() body: z.output<typeof credentialChoiceSchema>,
    @Req() request: FastifyRequest,
  ) {
    const chosen = await this.#services.identityProviders.chooseCredential(
      actorOf(request),
      providerId,
      credentialId,
      body.use,
    );
    return this.#present(request, chosen);
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
    await this.#services.identityProviders.removeCredential(actorOf(request), providerId, credentialId);
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
    const certificate = await this.#services.identityProviders.certificate(providerId, credentialId);
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
    await this.#services.identityProviders.setLogo(actorOf(request), providerId, {
      contentType: body.contentType,
      data: Buffer.from(body.data, "base64"),
    });
    return this.#present(request, await this.#services.identityProviders.get(providerId));
  }

  @Delete("instance/identity-providers/:providerId/logo")
  @Permission("instance.signIn.manage")
  @ApiRoute({ summary: "Remove the logo of an instance provider", tags: [TAG], params: providerIdParams })
  async removeInstanceLogo(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.removeLogo(actorOf(request), providerId);
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

  @Put("instance/identity-providers/:providerId/saml-metadata")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Upload the SAML metadata of an instance provider",
    description:
      "Replaces the metadata of a SAML provider whose metadata source is a file. Changed signing certificates are audited.",
    tags: [TAG],
    params: providerIdParams,
    body: samlMetadataUploadSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidSamlMetadata", "invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async uploadSamlMetadata(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof samlMetadataUploadSchema>,
    @Req() request: FastifyRequest,
  ) {
    const provider = await this.#services.identityProviders.uploadSamlMetadata(
      actorOf(request),
      providerId,
      body.xml,
    );
    return this.#present(request, provider);
  }

  @Post("instance/identity-providers/:providerId/saml-metadata/refresh")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Load the SAML metadata of an instance provider again",
    description:
      "Loads the metadata from its address now. A failure keeps the last good metadata and is shown as a warning.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidSamlMetadata", "invalidProviderConfiguration"],
  })
  async refreshSamlMetadata(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    const provider = await this.#services.identityProviders.refreshSamlMetadata(actorOf(request), providerId);
    return this.#present(request, provider);
  }

  @Put("instance/identity-providers/:providerId/ca-certificate")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Trust a certificate authority for a directory",
    description:
      "For directories whose certificate comes from an internal certificate authority. Only certificates of authorities are accepted. Every change is audited.",
    tags: [TAG],
    params: providerIdParams,
    body: caCertificateUploadSchema,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["invalidCertificate", "invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async setCaCertificate(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof caCertificateUploadSchema>,
    @Req() request: FastifyRequest,
  ) {
    const provider = await this.#services.identityProviders.setCaCertificate(
      actorOf(request),
      providerId,
      body.certificate,
    );
    return this.#present(request, provider);
  }

  @Delete("instance/identity-providers/:providerId/ca-certificate")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Stop trusting the uploaded certificate authority",
    description: "The directory's certificate must then come from an authority the system trusts.",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "The provider.", schema: providerSchema },
    errors: ["reauthenticationRequired"],
  })
  async removeCaCertificate(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    const provider = await this.#services.identityProviders.removeCaCertificate(actorOf(request), providerId);
    return this.#present(request, provider);
  }

  @Post("instance/identity-provider-connection-checks")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Check connection settings before saving them",
    description:
      "Reads the OIDC discovery document, loads the SAML metadata or connects to the directory with the given settings. Saves nothing.",
    tags: [TAG],
    status: 200,
    body: connectionCheckSchema,
    response: { description: "The result of the check.", schema: connectionCheckResultSchema },
    errors: ["invalidProviderConfiguration", "notFound", "invalidInput"],
  })
  async checkConnection(@Body() body: z.output<typeof connectionCheckSchema>) {
    if (body.providerId) await this.#services.identityProviders.get(body.providerId);
    return this.#services.providerSignIn.checkConnection({
      type: body.type,
      config: body.config,
      bindPassword: body.type === "ldap" ? (body.bindPassword ?? null) : null,
      providerId: body.providerId ?? null,
    });
  }

  @Post("instance/identity-providers/:providerId/directory-test")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Test the connection to a directory",
    description:
      "Checks the connection, the certificate, the bind of the service account and a sample search. Signs nobody in and changes nothing.",
    tags: [TAG],
    status: 200,
    params: providerIdParams,
    body: directoryTestSchema,
    response: { description: "The result of each check.", schema: directoryTestResultSchema },
    errors: ["invalidInput"],
  })
  async testDirectory(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof directoryTestSchema>,
  ) {
    await this.#services.identityProviders.get(providerId);
    return this.#services.providerSignIn.testDirectory(providerId, body.signInName ?? null);
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
    const refusal = await this.#services.providerSignIn.refusal(reference);
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
