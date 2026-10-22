import { Readable } from "node:stream";
import { ACCESS_REQUEST_MESSAGE_MAX_LENGTH } from "@lunedo/server";
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, uuid } from "../http/schemas.js";
import {
  accessRequestSchema,
  exampleAccessRequest,
  exampleExplanation,
  personAccessSchema,
} from "./schemas.js";

const REQUESTS = "Access requests";
const ACCESS = "Access";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const requestParams = z.object({ requestId: uuid("ID of the access request.") }).strict();
const personParams = organizationIdParams.extend({ accountId: uuid("The person.") }).strict();

const messageSchema = z
  .object({
    message: z
      .string()
      .max(ACCESS_REQUEST_MESSAGE_MAX_LENGTH)
      .default("")
      .describe(`Why the access is needed, up to ${ACCESS_REQUEST_MESSAGE_MAX_LENGTH} characters.`),
  })
  .strict()
  .describe("A request for access.");

const decisionSchema = z
  .discriminatedUnion("approve", [
    z
      .object({
        approve: z.literal(true).describe("Approve the request."),
        role: z
          .enum(["reader", "commenter", "editor", "admin"])
          .describe("Role to give. Pages can get `reader`, `commenter` or `editor`."),
        includeDescendants: z
          .boolean()
          .default(false)
          .describe("For pages: also give access to the pages below."),
      })
      .strict()
      .describe("Approval with a role."),
    z
      .object({ approve: z.literal(false).describe("Decline the request.") })
      .strict()
      .describe("Decline."),
  ])
  .describe("The decision.");

const discoverableSchema = z
  .array(
    z
      .object({
        id: uuid("ID of the space."),
        key: z.string().describe("Key of the space."),
        name: z.string().describe("Name of the space."),
        description: z.string().describe("Description of the space."),
        requested: z.boolean().describe("Whether the caller has an open request for it."),
      })
      .describe("A space the caller can find and ask to join."),
  )
  .describe("Spaces that can be found but not read, ordered by name.");

const storageSchema = z
  .object({
    bytes: z.number().int().describe("Bytes used by all versions of all attachments."),
    files: z.number().int().describe("Number of stored files."),
  })
  .describe("Storage used by attachments.");

const overviewQuery = z
  .object({ accountId: uuid("Only this person. Leave it out for every member.").optional() })
  .strict();

@Controller("api/v1")
export class AccessRequestsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("organizations/:organizationId/discoverable-spaces")
  @Permission("organization.view", organization)
  @ApiRoute({
    summary: "List spaces you can ask to join",
    description: "Lists the discoverable spaces of the organization that the caller cannot read yet.",
    tags: [REQUESTS],
    params: organizationIdParams,
    response: {
      description: "The spaces.",
      schema: discoverableSchema,
      example: [
        {
          id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a00",
          key: "ITOPS",
          name: "IT Operations",
          description: "Runbooks and on-call notes.",
          requested: false,
        },
      ],
    },
  })
  async discoverable(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return this.#services.accessRequests.discoverableSpaces(actorOf(request), organizationId);
  }

  @Post("spaces/:spaceId/access-requests")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Ask for access to a space",
    description:
      "Asks the space admins for access to a discoverable space. A second request while one is open returns the open one.",
    tags: [REQUESTS],
    status: 201,
    params: spaceParams,
    body: messageSchema,
    bodyExample: { message: "I take over the on-call duty next month." },
    response: { description: "The request.", schema: accessRequestSchema, example: exampleAccessRequest },
    errors: ["alreadyHasAccess", "messageTooLong", "tooManyRequests"],
  })
  async requestSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof messageSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accessRequests.requestSpace(actorOf(request), spaceId, body.message);
  }

  @Post("pages/:pageId/access-requests")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Ask for access to a page",
    description:
      "Asks for access to a page the caller reached but cannot read. The request goes to the space admins and to the people who restricted the page. The answer is the same whether or not the page exists.",
    tags: [REQUESTS],
    status: 202,
    params: pageParams,
    body: messageSchema,
    bodyExample: { message: "I need the runbook for the migration." },
    errors: ["messageTooLong", "tooManyRequests"],
  })
  async requestPage(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof messageSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.accessRequests.requestPage(actorOf(request), pageId, body.message);
  }

  @Get("access-requests/mine")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "List your access requests",
    description: "Lists the caller's requests, newest first.",
    tags: [REQUESTS],
    response: {
      description: "The requests.",
      schema: z.array(accessRequestSchema).describe("Requests, newest first."),
      example: [exampleAccessRequest],
    },
  })
  async mine(@Req() request: FastifyRequest) {
    return this.#services.accessRequests.mine(actorOf(request));
  }

  @Get("access-requests/:requestId")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Get an access request",
    description:
      "Returns a request of the caller, or a request the caller may decide as a space admin or as someone who may share the page.",
    tags: [REQUESTS],
    params: requestParams,
    response: { description: "The request.", schema: accessRequestSchema, example: exampleAccessRequest },
    errors: ["requestNotFound"],
  })
  async get(@Param("requestId") requestId: string, @Req() request: FastifyRequest) {
    const found = await this.#services.accessRequests.get(actorOf(request), requestId);
    if (!found) throw new ProblemException("requestNotFound", "The access request does not exist");
    return found;
  }

  @Post("access-requests/:requestId/withdraw")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Withdraw your access request",
    description: "Withdraws an open request of the caller.",
    tags: [REQUESTS],
    params: requestParams,
    errors: ["requestNotFound", "requestClosed"],
  })
  async withdraw(@Param("requestId") requestId: string, @Req() request: FastifyRequest) {
    await this.#services.accessRequests.withdraw(actorOf(request), requestId);
  }

  @Get("spaces/:spaceId/access-requests")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List open access requests of a space",
    description:
      "Lists the open requests the caller can decide: all of them for space admins, those for their restricted pages for the people who restricted them.",
    tags: [REQUESTS],
    params: spaceParams,
    response: {
      description: "Open requests, oldest first.",
      schema: z.array(accessRequestSchema).describe("Open requests."),
      example: [exampleAccessRequest],
    },
  })
  async forSpace(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.accessRequests.forSpace(actorOf(request), spaceId);
  }

  @Post("access-requests/:requestId/decide")
  @Permission("instance.content.view", { type: "instance" })
  @ApiRoute({
    summary: "Decide an access request",
    description:
      "Approves a request with a role or declines it. Space requests need space admin rights, page requests the right to share the page. The requester is notified.",
    tags: [REQUESTS],
    status: 200,
    params: requestParams,
    body: decisionSchema,
    bodyExample: { approve: true, role: "reader" },
    response: {
      description: "The decided request.",
      schema: accessRequestSchema,
      example: exampleAccessRequest,
    },
    errors: [
      "requestNotFound",
      "requestClosed",
      "invalidRole",
      "lastSpaceAdmin",
      "selfExtension",
      "shareBeyondOwnAccess",
    ],
  })
  async decide(
    @Param("requestId") requestId: string,
    @Body() body: z.output<typeof decisionSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accessRequests.decide(actorOf(request), requestId, body);
  }

  @Get("organizations/:organizationId/people/:accountId/access")
  @Permission("organization.access.view", organization)
  @ApiRoute({
    summary: "What can a person do?",
    description:
      "Lists all access of a person in the organization with the reason for each entry: role in a space, group, share or link. Entries that are stored but have no effect because the person's membership ended are marked inactive. Shared pages the caller cannot read are only counted per space; confidential spaces the caller does not belong to are only counted.",
    tags: [ACCESS],
    params: personParams,
    response: {
      description: "The access of the person.",
      schema: personAccessSchema,
      example: {
        accountId: exampleExplanation.accountId,
        name: exampleExplanation.name,
        email: "lukas.hofer@example.org",
        entries: [
          {
            kind: "space",
            spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a00",
            spaceName: "IT Operations",
            spaceKey: "ITOPS",
            itemId: null,
            itemTitle: null,
            role: "reader",
            count: 1,
            reasons: exampleExplanation.reasons,
            inactive: null,
          },
        ],
        confidentialSpaceCount: 0,
      },
    },
    errors: ["personNotFound"],
  })
  async person(
    @Param("organizationId") organizationId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accessExplanations.personAccess(actorOf(request), accountId, { organizationId });
  }

  @Get("organizations/:organizationId/access-overview")
  @Permission("organization.access.view", organization)
  @ApiRoute({
    summary: "Export the permission overview as CSV",
    description:
      "Streams the access of every member, or of one person, as CSV for audits. Restricted pages the caller cannot read appear only as a number per space. The export is written to the audit log.",
    tags: [ACCESS],
    params: organizationIdParams,
    query: overviewQuery,
    raw: {
      contentTypes: ["text/csv"],
      description: "The overview as CSV with a header row.",
      example: "person,email,kind,space,page,role,pages,reason\r\n",
    },
  })
  async overview(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof overviewQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.#services.accessExplanations.overviewCsv(
      actorOf(request),
      organizationId,
      query.accountId ?? null,
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="permission-overview.csv"');
    reply.header("cache-control", "no-store");
    return Readable.from(csv);
  }

  @Get("spaces/:spaceId/storage")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Get the storage used by a space",
    description: "Sums the attachments of the space, with every stored version.",
    tags: [ACCESS],
    params: spaceParams,
    response: {
      description: "The storage.",
      schema: storageSchema,
      example: { bytes: 104857600, files: 42 },
    },
  })
  async spaceStorage(@Param("spaceId") spaceId: string) {
    return this.#services.attachments.usage({ spaceId });
  }

  @Get("organizations/:organizationId/storage")
  @Permission("organization.spaces.view", organization)
  @ApiRoute({
    summary: "Get the storage used by an organization",
    description: "Sums the attachments of all spaces of the organization, with every stored version.",
    tags: [ACCESS],
    params: organizationIdParams,
    response: {
      description: "The storage.",
      schema: storageSchema,
      example: { bytes: 1073741824, files: 1200 },
    },
  })
  async organizationStorage(@Param("organizationId") organizationId: string) {
    return this.#services.attachments.usage({ organizationId });
  }
}
