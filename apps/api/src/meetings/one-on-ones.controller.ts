import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  createOneOnOneSchema,
  exampleSeries,
  oneOnOneSchema,
  organizationsSchema,
  successorSchema,
} from "./schemas.js";

const TAG = "One-on-ones";
const exampleOneOnOne = {
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b00",
  spaceKey: "MSAB",
  seriesId: exampleSeries.id,
  partners: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" }],
  nextMeeting: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a10", startsAt: "2026-10-15T12:00:00.000Z" },
};
const createdSchema = z
  .object({ spaceId: uuid("The confidential space."), seriesId: uuid("The series.").nullable() })
  .describe("The one-on-one.");
const organizationsQuery = z.object({ personId: uuid("The other person.") }).strict();

@Controller("api/v1")
export class OneOnOnesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("one-on-ones")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List your one-on-ones",
    description: "Lists the one-on-ones of the caller with the other person and the next meeting.",
    tags: [TAG],
    response: {
      description: "The one-on-ones.",
      schema: z.array(oneOnOneSchema).describe("One-on-ones."),
      example: [exampleOneOnOne],
    },
  })
  async list(@Req() request: FastifyRequest) {
    return this.#services.oneOnOnes.list(actorOf(request));
  }

  @Get("one-on-ones/organizations")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List organizations for a one-on-one",
    description:
      "Lists the organizations in which both the caller and the other person are members. A one-on-one is only possible in one of them; an empty list means it is not possible.",
    tags: [TAG],
    query: organizationsQuery,
    response: {
      description: "The organizations.",
      schema: organizationsSchema,
      example: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f4a00", name: "Stadtwerke" }],
    },
  })
  async organizations(@Query() query: z.output<typeof organizationsQuery>, @Req() request: FastifyRequest) {
    return this.#services.oneOnOnes.organizations(actorOf(request), query.personId);
  }

  @Post("one-on-ones")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "Start a one-on-one",
    description:
      "Creates a confidential space named after both people, with both as space admins, and a series from the one-on-one template. The other person is notified. Administrators cannot read it or give anyone access.",
    tags: [TAG],
    status: 201,
    body: createOneOnOneSchema,
    bodyExample: {
      otherId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      organizationId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f4a00",
      rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] },
      startsOn: "2026-10-15",
      startTime: "14:00",
      timeZone: "Europe/Vienna",
      durationMinutes: 30,
    },
    response: {
      description: "The one-on-one.",
      schema: createdSchema,
      example: { spaceId: exampleOneOnOne.spaceId, seriesId: exampleSeries.id },
    },
    errors: [
      "noSharedOrganization",
      "invalidMember",
      "invalidRhythm",
      "invalidSchedule",
      "invalidTimeZone",
      "forbidden",
    ],
  })
  async create(@Body() body: z.output<typeof createOneOnOneSchema>, @Req() request: FastifyRequest) {
    return this.#services.oneOnOnes.create(actorOf(request), body);
  }

  @Post("spaces/:spaceId/one-on-one/successor")
  @Permission("space.manage", { type: "space", param: "spaceId" })
  @ApiRoute({
    summary: "Change a person of a one-on-one",
    description:
      "For the remaining person: `add` makes the successor space admin and member of the series and removes the previous person; the successor sees all earlier meetings. `new` starts a new one-on-one with the successor and leaves this one unchanged.",
    tags: [TAG],
    status: 200,
    params: z.object({ spaceId: uuid("The confidential space of the one-on-one.") }).strict(),
    body: successorSchema,
    bodyExample: {
      previousId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      successorId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21",
      mode: "add",
    },
    response: {
      description: "The one-on-one that continues.",
      schema: createdSchema,
      example: { spaceId: exampleOneOnOne.spaceId, seriesId: exampleSeries.id },
    },
    errors: ["notOneOnOne", "notOneOnOneMember", "invalidMember", "invalidHolder", "noSharedOrganization"],
  })
  async successor(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof successorSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.oneOnOnes.changePerson(actorOf(request), spaceId, body);
  }
}
