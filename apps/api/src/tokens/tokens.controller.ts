import { type ApiToken, tokenNameSchema } from "@lunedo/server";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { idCursor, pageQuerySchema, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  apiTokenSchema,
  contentLevelSchema,
  exampleApiToken,
  inputTimestamp,
  organizationIdParams,
  tokenScopesSchema,
  uuid,
} from "../http/schemas.js";

const TAG = "API tokens";
const organization = { type: "organization", param: "organizationId" } as const;
const serviceAccount = { type: "serviceAccount", param: "serviceAccountId" } as const;

const tokenParams = z.object({ tokenId: uuid("ID of the token.") }).strict();
const serviceAccountParams = z.object({ serviceAccountId: uuid("ID of the service account.") }).strict();
const organizationTokenParams = organizationIdParams.extend({ tokenId: uuid("ID of the token.") });

const createSchema = z
  .object({
    name: tokenNameSchema.describe("Name to recognize the token, 1 to 100 characters."),
    scopes: tokenScopesSchema,
    organizationId: uuid(
      "Limit the token to this organization. Leave it out for all organizations.",
    ).optional(),
    expiresAt: inputTimestamp("When the token stops working.")
      .nullable()
      .optional()
      .describe(
        "When the token stops working, ISO 8601. Null or left out for a token without expiry. When a maximum lifetime of API tokens applies, an expiry within it is required; left out, it defaults to the maximum.",
      ),
    contentLevel: contentLevelSchema
      .optional()
      .describe(
        "What the token may do with content. Left out: `publish` when the spaces area is `manage`, otherwise `read`. `draft` and `publish` need the spaces area with `manage`.",
      ),
    knowledgeBaseIds: z
      .array(uuid("ID of a knowledge base."))
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .describe("Limit the token's content access to these knowledge bases. Null or left out for no limit."),
  })
  .strict()
  .describe("A new API token.");

const contentAccessSchema = z
  .object({
    contentLevel: contentLevelSchema,
    knowledgeBaseIds: z
      .array(uuid("ID of a knowledge base."))
      .min(1)
      .max(100)
      .nullable()
      .describe("Knowledge bases the token is limited to, or null for no limit."),
  })
  .strict()
  .describe("The new content access of the token.");

const renameSchema = z
  .object({ name: tokenNameSchema.describe("New name, 1 to 100 characters.") })
  .strict()
  .describe("The new name.");

const createdSchema = z
  .object({
    token: z.string().describe("The secret token. It is shown only now; store it safely."),
    apiToken: apiTokenSchema,
  })
  .describe("The new token with its secret.");

const tokenPage = pageSchema(apiTokenSchema, "Tokens, oldest first.");

const lifetimeQuery = z
  .object({
    organizationId: uuid(
      "Organization the new token would be limited to. Leave it out for all organizations.",
    ).optional(),
  })
  .strict();

const lifetimeSchema = z
  .object({
    maxLifetimeDays: z
      .number()
      .int()
      .nullable()
      .describe(
        "Maximum lifetime of API tokens in days that applies to a new token, or null when tokens may have no expiry.",
      ),
  })
  .describe("The lifetime rules for a new token.");

@Controller("api/v1")
@InternalRoute()
export class TokensController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #ownToken(request: FastifyRequest, tokenId: string): Promise<ApiToken> {
    const token = await this.#services.apiTokens.get(tokenId);
    if (!token || token.revokedAt || token.accountId !== actorOf(request).id) throw notFound();
    return token;
  }

  async #serviceAccountToken(serviceAccountId: string, tokenId: string): Promise<ApiToken> {
    const token = await this.#services.apiTokens.get(tokenId);
    if (!token || token.revokedAt || token.accountId !== serviceAccountId) throw notFound();
    return token;
  }

  @Get("account/tokens")
  @SessionRoute()
  @ApiRoute({
    summary: "List own API tokens",
    tags: [TAG],
    query: pageQuerySchema,
    response: { description: "Tokens of the caller.", schema: tokenPage },
  })
  async list(@Req() request: FastifyRequest, @Query() query: z.output<typeof pageQuerySchema>) {
    return toApiPage(
      await this.#services.apiTokens.listForAccount(actorOf(request).id, pageRequest(query, idCursor)),
    );
  }

  @Get("account/tokens/lifetime")
  @SessionRoute()
  @ApiRoute({
    summary: "Get the lifetime rules for a new personal token",
    tags: [TAG],
    query: lifetimeQuery,
    response: { description: "The maximum lifetime that applies.", schema: lifetimeSchema },
  })
  async lifetime(@Req() request: FastifyRequest, @Query() query: z.output<typeof lifetimeQuery>) {
    return {
      maxLifetimeDays: await this.#services.apiTokens.maxLifetimeDays(
        actorOf(request).id,
        query.organizationId ?? null,
      ),
    };
  }

  @Post("account/tokens")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Create a personal API token",
    tags: [TAG],
    status: 201,
    body: createSchema,
    response: { description: "The new token.", schema: createdSchema },
    errors: ["invalidScopes", "invalidKnowledgeBases", "expiryRequired", "expiryInPast", "expiryTooLate"],
  })
  async create(@Body() body: z.output<typeof createSchema>, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    return this.#services.apiTokens.create(actor, {
      accountId: actor.id,
      name: body.name,
      scopes: body.scopes,
      ...(body.organizationId ? { organizationId: body.organizationId } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      ...(body.contentLevel ? { contentLevel: body.contentLevel } : {}),
      ...(body.knowledgeBaseIds !== undefined ? { knowledgeBaseIds: body.knowledgeBaseIds } : {}),
    });
  }

  @Put("account/tokens/:tokenId/content-access")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Change what a personal API token may do with content",
    description: "Sets the write level and the knowledge bases the token is limited to. Audited.",
    tags: [TAG],
    params: tokenParams,
    body: contentAccessSchema,
    response: { description: "The changed token.", schema: apiTokenSchema },
    errors: ["invalidScopes", "invalidKnowledgeBases"],
  })
  async changeContentAccess(
    @Param("tokenId") tokenId: string,
    @Body() body: z.output<typeof contentAccessSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#ownToken(request, tokenId);
    return this.#services.apiTokens.changeContentAccess(actorOf(request), tokenId, body);
  }

  @Patch("account/tokens/:tokenId")
  @SessionRoute()
  @ApiRoute({
    summary: "Rename a personal API token",
    tags: [TAG],
    params: tokenParams,
    body: renameSchema,
    response: { description: "The renamed token.", schema: apiTokenSchema },
  })
  async rename(
    @Param("tokenId") tokenId: string,
    @Body() body: z.output<typeof renameSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#ownToken(request, tokenId);
    return this.#services.apiTokens.rename(actorOf(request), tokenId, body.name);
  }

  @Delete("account/tokens/:tokenId")
  @SessionRoute()
  @ApiRoute({ summary: "Revoke a personal API token", tags: [TAG], params: tokenParams })
  async revoke(@Param("tokenId") tokenId: string, @Req() request: FastifyRequest) {
    await this.#ownToken(request, tokenId);
    if (!(await this.#services.apiTokens.revoke(actorOf(request), tokenId))) throw notFound();
  }

  @Get("service-accounts/:serviceAccountId/tokens")
  @Permission("serviceAccount.view", serviceAccount, { sessionOnly: true })
  @ApiRoute({
    summary: "List tokens of a service account",
    tags: [TAG],
    params: serviceAccountParams,
    query: pageQuerySchema,
    response: { description: "Tokens of the service account.", schema: tokenPage },
  })
  async listForServiceAccount(
    @Param("serviceAccountId") serviceAccountId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(
      await this.#services.apiTokens.listForAccount(serviceAccountId, pageRequest(query, idCursor)),
    );
  }

  @Get("service-accounts/:serviceAccountId/tokens/lifetime")
  @Permission("serviceAccount.view", serviceAccount, { sessionOnly: true })
  @ApiRoute({
    summary: "Get the lifetime rules for a new service account token",
    tags: [TAG],
    params: serviceAccountParams,
    response: { description: "The maximum lifetime that applies.", schema: lifetimeSchema },
  })
  async lifetimeForServiceAccount(@Param("serviceAccountId") serviceAccountId: string) {
    return { maxLifetimeDays: await this.#services.apiTokens.maxLifetimeDays(serviceAccountId) };
  }

  @Post("service-accounts/:serviceAccountId/tokens")
  @Permission("serviceAccount.manage", serviceAccount, { recentAuthentication: true })
  @ApiRoute({
    summary: "Create a token for a service account",
    tags: [TAG],
    status: 201,
    params: serviceAccountParams,
    body: createSchema,
    response: { description: "The new token.", schema: createdSchema },
    errors: [
      "invalidScopes",
      "invalidKnowledgeBases",
      "invalidOwner",
      "expiryRequired",
      "expiryInPast",
      "expiryTooLate",
    ],
  })
  async createForServiceAccount(
    @Param("serviceAccountId") serviceAccountId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.apiTokens.create(actorOf(request), {
      accountId: serviceAccountId,
      name: body.name,
      scopes: body.scopes,
      ...(body.organizationId ? { organizationId: body.organizationId } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      ...(body.contentLevel ? { contentLevel: body.contentLevel } : {}),
      ...(body.knowledgeBaseIds !== undefined ? { knowledgeBaseIds: body.knowledgeBaseIds } : {}),
    });
  }

  @Put("service-accounts/:serviceAccountId/tokens/:tokenId/content-access")
  @Permission("serviceAccount.manage", serviceAccount, { recentAuthentication: true })
  @ApiRoute({
    summary: "Change what a service account token may do with content",
    description: "Sets the write level and the knowledge bases the token is limited to. Audited.",
    tags: [TAG],
    params: serviceAccountParams.extend({ tokenId: uuid("ID of the token.") }),
    body: contentAccessSchema,
    response: { description: "The changed token.", schema: apiTokenSchema },
    errors: ["invalidScopes", "invalidKnowledgeBases"],
  })
  async changeServiceAccountContentAccess(
    @Param("serviceAccountId") serviceAccountId: string,
    @Param("tokenId") tokenId: string,
    @Body() body: z.output<typeof contentAccessSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#serviceAccountToken(serviceAccountId, tokenId);
    return this.#services.apiTokens.changeContentAccess(actorOf(request), tokenId, body);
  }

  @Delete("service-accounts/:serviceAccountId/tokens/:tokenId")
  @Permission("serviceAccount.manage", serviceAccount, { sessionOnly: true })
  @ApiRoute({
    summary: "Revoke a token of a service account",
    tags: [TAG],
    params: serviceAccountParams.extend({ tokenId: uuid("ID of the token.") }),
  })
  async revokeForServiceAccount(
    @Param("serviceAccountId") serviceAccountId: string,
    @Param("tokenId") tokenId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#serviceAccountToken(serviceAccountId, tokenId);
    if (!(await this.#services.apiTokens.revoke(actorOf(request), tokenId))) throw notFound();
  }

  @Get("organizations/:organizationId/api-tokens")
  @Permission("organization.integrations.view", organization, { sessionOnly: true })
  @ApiRoute({
    summary: "List all tokens of an organization",
    description:
      "Lists the tokens of service accounts and the personal tokens of members whose home organization this is, or that are limited to it.",
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Tokens of the organization.",
      schema: tokenPage,
      example: { items: [exampleApiToken], nextCursor: null },
    },
  })
  async listForOrganization(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(
      await this.#services.apiTokens.listForOrganization(organizationId, pageRequest(query, idCursor)),
    );
  }

  @Delete("organizations/:organizationId/api-tokens/:tokenId")
  @Permission("organization.integrations.manage", organization, { sessionOnly: true })
  @ApiRoute({ summary: "Revoke a token of an organization", tags: [TAG], params: organizationTokenParams })
  async revokeForOrganization(
    @Param("organizationId") organizationId: string,
    @Param("tokenId") tokenId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.apiTokens.belongsToOrganization(tokenId, organizationId))) throw notFound();
    if (!(await this.#services.apiTokens.revoke(actorOf(request), tokenId))) throw notFound();
  }
}
