import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { type ApiToken, tokenNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { pageQuerySchema, pageSchema, paginate } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  apiTokenSchema,
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
        "When the token stops working, ISO 8601. Default 90 days, at most the configured maximum. Null only when tokens without expiry are allowed.",
      ),
  })
  .strict()
  .describe("A new API token.");

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

const tokenPage = pageSchema(apiTokenSchema, "Tokens, ordered by creation time.");
const byCreation = (token: ApiToken) => [token.createdAt.getTime(), token.id];

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
    return paginate(await this.#services.apiTokens.listForAccount(actorOf(request).id), byCreation, query);
  }

  @Post("account/tokens")
  @SessionRoute({ recentAuthentication: true })
  @ApiRoute({
    summary: "Create a personal API token",
    tags: [TAG],
    status: 201,
    body: createSchema,
    response: { description: "The new token.", schema: createdSchema },
    errors: ["invalidScopes", "expiryRequired", "expiryInPast", "expiryTooLate"],
  })
  async create(@Body() body: z.output<typeof createSchema>, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    return this.#services.apiTokens.create(actor, {
      accountId: actor.id,
      name: body.name,
      scopes: body.scopes,
      ...(body.organizationId ? { organizationId: body.organizationId } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    });
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
    return paginate(await this.#services.apiTokens.listForAccount(serviceAccountId), byCreation, query);
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
    errors: ["invalidScopes", "invalidOwner", "expiryRequired", "expiryInPast", "expiryTooLate"],
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
    });
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
    return paginate(await this.#services.apiTokens.listForOrganization(organizationId), byCreation, query);
  }

  @Delete("organizations/:organizationId/api-tokens/:tokenId")
  @Permission("organization.integrations.manage", organization, { sessionOnly: true })
  @ApiRoute({ summary: "Revoke a token of an organization", tags: [TAG], params: organizationTokenParams })
  async revokeForOrganization(
    @Param("organizationId") organizationId: string,
    @Param("tokenId") tokenId: string,
    @Req() request: FastifyRequest,
  ) {
    const listed = await this.#services.apiTokens.listForOrganization(organizationId);
    if (!listed.some((token) => token.id === tokenId)) throw notFound();
    if (!(await this.#services.apiTokens.revoke(actorOf(request), tokenId))) throw notFound();
  }
}
