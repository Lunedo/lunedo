import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { serviceAccountDescriptionSchema, serviceAccountNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { pageQuerySchema, pageSchema, paginate } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  exampleMember,
  exampleServiceAccount,
  organizationIdParams,
  serviceAccountSchema,
  uuid,
} from "../http/schemas.js";

const TAG = "Service accounts";
const organization = { type: "organization", param: "organizationId" } as const;
const serviceAccount = { type: "serviceAccount", param: "serviceAccountId" } as const;
const serviceAccountParams = z.object({ serviceAccountId: uuid("ID of the service account.") }).strict();

const createSchema = z
  .object({
    name: serviceAccountNameSchema.describe("Display name, 1 to 200 characters."),
    description: serviceAccountDescriptionSchema
      .optional()
      .describe("What it is for, up to 1000 characters."),
  })
  .strict()
  .describe("A new service account.");

const updateSchema = z
  .object({
    name: serviceAccountNameSchema.optional().describe("New display name."),
    description: serviceAccountDescriptionSchema.optional().describe("New description."),
    responsibleAccountId: uuid("Member whose permissions bound the service account, or null for nobody.")
      .nullable()
      .optional(),
  })
  .strict()
  .describe("Fields to change.");

const deactivatedSchema = z
  .object({ revokedTokens: z.number().int().describe("Number of tokens revoked with the deactivation.") })
  .describe("Result of the deactivation.");

@Controller("api/v1")
export class ServiceAccountsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("organizations/:organizationId/service-accounts")
  @Permission("organization.integrations.view", organization)
  @ApiRoute({
    summary: "List service accounts",
    description: "Lists the service accounts of the organization, active and deactivated.",
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Service accounts of the organization.",
      schema: pageSchema(serviceAccountSchema, "Service accounts, ordered by name."),
      example: { items: [exampleServiceAccount], nextCursor: null },
    },
  })
  async list(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    const accounts = await this.#services.serviceAccounts.list(organizationId);
    return paginate(accounts, (account) => [account.name.toLowerCase(), account.id], query);
  }

  @Post("organizations/:organizationId/service-accounts")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Create a service account",
    description:
      "Creates an account for scripts and integrations. It has no password and cannot sign in; it acts only through API tokens. The creator becomes the responsible person: the service account never has more permissions than that person.",
    tags: [TAG],
    status: 201,
    params: organizationIdParams,
    body: createSchema,
    bodyExample: { name: "Release bot", description: "Publishes release notes" },
    response: {
      description: "The new service account.",
      schema: serviceAccountSchema,
      example: exampleServiceAccount,
    },
  })
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.serviceAccounts.create(actorOf(request), organizationId, body);
  }

  @Get("service-accounts/:serviceAccountId")
  @Permission("serviceAccount.view", serviceAccount)
  @ApiRoute({
    summary: "Get a service account",
    description: "Returns a service account.",
    tags: [TAG],
    params: serviceAccountParams,
    response: {
      description: "The service account.",
      schema: serviceAccountSchema,
      example: exampleServiceAccount,
    },
  })
  async get(@Param("serviceAccountId") serviceAccountId: string) {
    const found = await this.#services.serviceAccounts.get(serviceAccountId);
    if (!found) throw notFound();
    return found;
  }

  @Patch("service-accounts/:serviceAccountId")
  @Permission("serviceAccount.manage", serviceAccount)
  @ApiRoute({
    summary: "Change a service account",
    description: "Changes name, description or the responsible person, who must be an active member.",
    tags: [TAG],
    params: serviceAccountParams,
    body: updateSchema,
    bodyExample: { responsibleAccountId: exampleMember.accountId },
    response: {
      description: "The changed service account.",
      schema: serviceAccountSchema,
      example: exampleServiceAccount,
    },
    errors: ["invalidResponsible"],
  })
  async update(
    @Param("serviceAccountId") serviceAccountId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.serviceAccounts.update(actorOf(request), serviceAccountId, body);
  }

  @Post("service-accounts/:serviceAccountId/deactivate")
  @Permission("serviceAccount.manage", serviceAccount)
  @ApiRoute({
    summary: "Deactivate a service account",
    description: "Deactivates the service account and revokes all its tokens at once.",
    tags: [TAG],
    status: 200,
    params: serviceAccountParams,
    response: {
      description: "The number of revoked tokens.",
      schema: deactivatedSchema,
      example: { revokedTokens: 2 },
    },
  })
  async deactivate(@Param("serviceAccountId") serviceAccountId: string, @Req() request: FastifyRequest) {
    return {
      revokedTokens: await this.#services.serviceAccounts.deactivate(actorOf(request), serviceAccountId),
    };
  }
}
