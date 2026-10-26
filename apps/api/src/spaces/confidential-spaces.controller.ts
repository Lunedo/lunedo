import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { nameCursor, pageQuerySchema, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, timestamp, uuid } from "../http/schemas.js";

const TAG = "Spaces";
const organization = { type: "organization", param: "organizationId" } as const;
const spaceParams = organizationIdParams.extend({ spaceId: uuid("ID of the confidential space.") }).strict();

const summarySchema = z
  .object({
    id: uuid("ID of the space."),
    key: z.string().describe("Key of the space."),
    createdAt: timestamp("When the space was created."),
    members: z.number().int().describe("Number of people with a role."),
    activeMembers: z.number().int().describe("Number of members whose account is active."),
    pages: z.number().int().describe("Number of pages, without the trash."),
    lastChangedAt: timestamp("Last change of the space or its content."),
    needsAdministrator: z
      .boolean()
      .describe(
        "True when no active space admin remains but other members do; one of them can be appointed.",
      ),
  })
  .describe("A confidential space as organization administrators see it: no name, members or content.");

const exampleSummary = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b00",
  key: "MSAB",
  createdAt: "2026-10-01T08:00:00.000Z",
  members: 2,
  activeMembers: 1,
  pages: 12,
  lastChangedAt: "2026-10-08T15:00:00.000Z",
  needsAdministrator: true,
};

const appointSchema = z
  .object({ accountId: uuid("Remaining member who becomes space admin.") })
  .strict()
  .describe("The new space admin.");

@Controller("api/v1/organizations")
export class ConfidentialSpacesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get(":organizationId/confidential-spaces")
  @Permission("organization.spaces.view", organization)
  @ApiRoute({
    summary: "List confidential spaces",
    description:
      "Lists the confidential spaces of the organization with key, creation date, number of members and pages and last change. Names, members, titles and content stay hidden.",
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Confidential spaces, ordered by key.",
      schema: pageSchema(summarySchema, "Confidential spaces."),
      example: { items: [exampleSummary], nextCursor: null },
    },
  })
  async list(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(
      await this.#services.confidentialSpaces.list(organizationId, pageRequest(query, nameCursor)),
    );
  }

  @Get(":organizationId/confidential-spaces/:spaceId/remaining-members")
  @Permission("organization.spaces.manage", organization)
  @ApiRoute({
    summary: "List the remaining members of a confidential space without space admin",
    description:
      "Lists only the names of the active members of a confidential space whose last space admin was deactivated, without the caller. The list is empty while the space has a space admin.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The remaining members.",
      schema: z
        .array(
          z.object({ id: uuid("Account ID."), name: z.string().describe("Name.") }).describe("A member."),
        )
        .describe("Remaining members."),
      example: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" }],
    },
  })
  async remaining(
    @Param("organizationId") organizationId: string,
    @Param("spaceId") spaceId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.confidentialSpaces.remainingMembers(actorOf(request), organizationId, spaceId);
  }

  @Post(":organizationId/confidential-spaces/:spaceId/administrator")
  @Permission("organization.spaces.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Appoint a space admin of a confidential space",
    description:
      "Makes a remaining member space admin of a confidential space that has none. Never the caller and never someone who is not a member. The appointment is audited and the member is notified.",
    tags: [TAG],
    params: spaceParams,
    body: appointSchema,
    bodyExample: { accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20" },
    errors: ["spaceHasAdministrator", "invalidHolder", "selfAppointment"],
  })
  async appoint(
    @Param("organizationId") organizationId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof appointSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.confidentialSpaces.appointAdministrator(
      actorOf(request),
      organizationId,
      spaceId,
      body.accountId,
    );
  }
}
