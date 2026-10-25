import { CLEANUP_GRACE_MINIMUM_DAYS, ERASURE_REASON_MAX_LENGTH } from "@lunedo/server";
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
const spaceParams = organizationIdParams.extend({ spaceId: uuid("ID of the space.") }).strict();

const orphanedSpaceSchema = z
  .object({
    id: uuid("ID of the space."),
    key: z.string().describe("Key of the space."),
    kind: z
      .enum(["personal", "oneOnOne", "confidential"])
      .describe(
        "`personal` for a personal space of someone whose home organization this is, `oneOnOne` or `confidential`.",
      ),
    storageBytes: z.number().int().describe("Size of all files attached in the space, in bytes."),
    pages: z.number().int().describe("Pages and blog posts in the space, without the trash."),
    lastActivityAt: timestamp("When content in the space last changed."),
    orphanedAt: timestamp("When the last active member left the space."),
    formerMembers: z
      .array(
        z
          .object({ id: uuid("ID of the account."), name: z.string().describe("Name of the person.") })
          .describe("A former member."),
      )
      .describe("People who held a role in the space, ordered by name. None of them is active anymore."),
  })
  .describe(
    "A protected space without active members, as organization administrators see it: no name or content.",
  );

const listSchema = pageSchema(orphanedSpaceSchema, "Spaces to clean up, ordered by key.").extend({
  graceDays: z.number().int().describe("Days a space stays without active members before it appears here."),
});

const deleteSchema = z
  .object({
    confirmation: z.string().max(40).describe("The key of the space, typed exactly."),
    reason: z
      .string()
      .max(ERASURE_REASON_MAX_LENGTH * 2)
      .describe(
        `Why the space is deleted, 1 to ${ERASURE_REASON_MAX_LENGTH} characters; it goes into the audit log.`,
      ),
  })
  .strict()
  .describe("Confirmation and reason.");

@Controller("api/v1/organizations")
export class SpaceCleanupController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get(":organizationId/space-cleanup")
  @Permission("organization.spaces.manage", organization)
  @ApiRoute({
    summary: "List protected spaces to clean up",
    description: `Lists personal, one-on-one and confidential spaces of the organization in which no active member remains and that have stayed so for the waiting period of the organization (at least ${CLEANUP_GRACE_MINIMUM_DAYS} days). Shows key, kind, size, pages, last activity and former members; names, titles and content stay hidden. Personal spaces count for the home organization of their owner.`,
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Spaces to clean up and the waiting period.",
      schema: listSchema,
      example: {
        items: [
          {
            id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b00",
            key: "MSAB",
            kind: "confidential",
            storageBytes: 1048576,
            pages: 12,
            lastActivityAt: "2026-08-01T15:00:00.000Z",
            orphanedAt: "2026-09-01T08:00:00.000Z",
            formerMembers: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" }],
          },
        ],
        nextCursor: null,
        graceDays: 30,
      },
    },
  })
  async list(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    const page = toApiPage(
      await this.#services.spaceCleanup.list(organizationId, pageRequest(query, nameCursor)),
    );
    return { ...page, graceDays: await this.#services.spaceCleanup.graceDays(organizationId) };
  }

  @Post(":organizationId/space-cleanup/:spaceId/delete")
  @Permission("organization.spaces.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Delete a protected space without members",
    description:
      "Deletes a space from the clean-up list without reading it. It goes to the second stage of the trash and is deleted permanently when its retention period ends; until then the people who were its space admins, and for personal spaces the instance administrators, can restore it. Requires typing the key and a reason, which goes into the audit log. Needs a signed-in session; API tokens are refused.",
    tags: [TAG],
    params: spaceParams,
    body: deleteSchema,
    bodyExample: { confirmation: "MSAB", reason: "Both people left the company" },
    errors: ["notInCleanup", "confirmationMismatch", "reasonRequired"],
  })
  async delete(
    @Param("organizationId") organizationId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof deleteSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.spaceCleanup.delete(actorOf(request), organizationId, spaceId, body);
  }
}
