import {
  responsibleAccountIdsSchema,
  type ServiceAccount,
  serviceAccountDescriptionSchema,
  serviceAccountNameSchema,
} from "@lunedo/server";
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { nameCursor, pageQuerySchema, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
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

const responsibleAccountIds = responsibleAccountIdsSchema.describe(
  "Members who receive reminders and notices, up to 20. They grant no permissions. The caller when left out; an empty list for nobody.",
);

function present(account: ServiceAccount) {
  return { ...account, unattended: account.responsibleAccountIds.length === 0 };
}

const createSchema = z
  .object({
    name: serviceAccountNameSchema.describe("Display name, 1 to 200 characters."),
    description: serviceAccountDescriptionSchema
      .optional()
      .describe("What it is for, up to 1000 characters."),
    responsibleAccountIds: responsibleAccountIds.optional(),
  })
  .strict()
  .describe("A new service account.");

const updateSchema = z
  .object({
    name: serviceAccountNameSchema.optional().describe("New display name."),
    description: serviceAccountDescriptionSchema.optional().describe("New description."),
    responsibleAccountIds: responsibleAccountIds
      .optional()
      .describe("New list of responsible members. Replaces the old list."),
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
    description:
      "Lists the service accounts of the organization, active and deactivated. Service accounts without a responsible person are marked as `unattended`.",
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
    const page = await this.#services.serviceAccounts.list(organizationId, pageRequest(query, nameCursor));
    return toApiPage({ ...page, items: page.items.map(present) });
  }

  @Post("organizations/:organizationId/service-accounts")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Create a service account",
    description:
      "Creates an account for scripts and integrations. It has no password and cannot sign in; it acts only through API tokens. Its permissions come only from the roles and groups it is given. The creator becomes its responsible person unless a list is given.",
    tags: [TAG],
    status: 201,
    params: organizationIdParams,
    body: createSchema,
    bodyExample: { name: "Release bot", description: "Publishes release notes" },
    errors: ["invalidResponsible"],
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
    return present(await this.#services.serviceAccounts.create(actorOf(request), organizationId, body));
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
    return present(found);
  }

  @Patch("service-accounts/:serviceAccountId")
  @Permission("serviceAccount.manage", serviceAccount)
  @ApiRoute({
    summary: "Change a service account",
    description:
      "Changes name, description or the responsible people, who must be active members. Responsible people receive reminders and notices; they do not change permissions.",
    tags: [TAG],
    params: serviceAccountParams,
    body: updateSchema,
    bodyExample: { responsibleAccountIds: [exampleMember.accountId] },
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
    return present(await this.#services.serviceAccounts.update(actorOf(request), serviceAccountId, body));
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
