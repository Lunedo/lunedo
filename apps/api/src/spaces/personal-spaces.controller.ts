import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import {
  idCursor,
  nameCursor,
  pageQuerySchema,
  pageRequest,
  pageSchema,
  searchQuerySchema,
  toApiPage,
} from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";
import { exampleSpace, spaceSchema } from "./schemas.js";

const TAG = "Spaces";

const ensureSchema = z
  .object({
    overviewTitle: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .describe("Title of the overview page if the personal space is created now, in the person's language."),
  })
  .strict()
  .describe("Details for creating the personal space on first use.");

const reviewSchema = z
  .object({
    spaceId: uuid("ID of the personal space."),
    ownerId: uuid("Owner of the personal space, or null.").nullable(),
    ownerName: z.string().nullable().describe("Name of the owner, or null."),
    ownerState: z.string().nullable().describe("State of the owner's account, such as `deactivated`."),
    pages: z.number().int().describe("Number of pages in the space."),
    lastChangedAt: timestamp("When the space or one of its pages last changed."),
  })
  .describe("A personal space whose owner is no longer active. Titles and content are not shown.");

const transferParams = z.object({ spaceId: uuid("ID of the personal space.") }).strict();
const transferSchema = z
  .object({ accountId: uuid("Active standard account that receives the space.") })
  .strict()
  .describe("The new owner.");

const personSchema = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().describe("Name of the person."),
    email: z.string().nullable().describe("E-mail address, shown for people of the caller's organizations."),
    type: z.string().describe("`standard`, `guest`, `portal` or `service`."),
  })
  .describe("A person the caller may see.");

@Controller("api/v1")
export class PersonalSpacesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Post("account/personal-space")
  @SessionRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Open the own personal space",
    description:
      "Returns the caller's personal space and creates it on first use, when the instance allows personal spaces and the caller has a standard account.",
    tags: [TAG],
    status: 200,
    body: ensureSchema,
    bodyExample: { overviewTitle: "Personal space" },
    response: {
      description: "The personal space.",
      schema: spaceSchema,
      example: { ...exampleSpace, key: "P7K2M9QX", name: "", personal: true, organizationId: null },
    },
  })
  async ensure(@Body() body: z.output<typeof ensureSchema>, @Req() request: FastifyRequest) {
    return this.#services.personalSpaces.ensure(actorOf(request), body.overviewTitle);
  }

  @Get("people")
  @SessionRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Find people",
    description:
      "Searches the people the caller may see: members of the caller's organizations and people the caller shares a space with.",
    tags: [TAG],
    query: searchQuerySchema,
    response: {
      description: "People, ordered by name.",
      schema: pageSchema(personSchema, "People, ordered by name."),
      example: {
        items: [
          { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger", email: null, type: "standard" },
        ],
        nextCursor: null,
      },
    },
  })
  async people(@Query() query: z.output<typeof searchQuerySchema>, @Req() request: FastifyRequest) {
    return toApiPage(await this.#services.people.search(actorOf(request), pageRequest(query, nameCursor)));
  }

  @Get("instance/personal-spaces")
  @Permission("instance.personalSpaces.view")
  @ApiRoute({
    summary: "List personal spaces to review",
    description:
      "Lists personal spaces whose owner is deactivated, with the number of pages and the last change. Instance roles never show titles or content.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Personal spaces to review.",
      schema: pageSchema(reviewSchema, "Personal spaces, ordered by owner name."),
      example: {
        items: [
          {
            spaceId: exampleSpace.id,
            ownerId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
            ownerName: "Anna Berger",
            ownerState: "deactivated",
            pages: 12,
            lastChangedAt: "2026-09-30T08:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    },
  })
  async review(@Query() query: z.output<typeof pageQuerySchema>) {
    return toApiPage(await this.#services.personalSpaces.forReview(pageRequest(query, nameCursor)));
  }

  @Post("instance/personal-spaces/:spaceId/transfer")
  @Permission("instance.personalSpaces.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Transfer a personal space",
    description:
      "Gives a personal space under review to another standard account, who becomes its space admin. Nobody can transfer a space to themselves. The transfer is audited.",
    tags: [TAG],
    params: transferParams,
    body: transferSchema,
    bodyExample: { accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21" },
    errors: ["notUnderReview", "invalidHolder", "selfAppointment"],
  })
  async transfer(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof transferSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.personalSpaces.transfer(actorOf(request), spaceId, body.accountId);
  }
}
