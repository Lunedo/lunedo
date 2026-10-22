import type { ChatChannel, ChatScope, ChatTestResult } from "@lunedo/server";
import {
  chatChannelKinds,
  chatChannelStates,
  chatFailureReasons,
  organizationChatEvents,
  spaceChatEvents,
} from "@lunedo/shared";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

const TAG = "Chat channels";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const allEvents = [...spaceChatEvents, ...organizationChatEvents] as const;

const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const spaceChannelParams = z
  .object({ spaceId: uuid("ID of the space."), channelId: uuid("ID of the chat channel.") })
  .strict();
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const organizationChannelParams = z
  .object({ organizationId: uuid("ID of the organization."), channelId: uuid("ID of the chat channel.") })
  .strict();

const kindSchema = extensibleEnum(
  chatChannelKinds,
  "Service of the channel: Microsoft Teams (Workflows webhook), Slack, Matrix, Discord or a generic webhook.",
);

const targetSchema = z
  .union([
    z
      .object({
        url: z
          .string()
          .min(1)
          .max(2000)
          .describe("Webhook address the service created. Stored encrypted and never returned."),
      })
      .strict()
      .describe("For Teams, Slack, Discord and generic webhooks."),
    z
      .object({
        homeserver: z.string().min(1).max(2000).describe("Address of the Matrix homeserver."),
        roomId: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "Room as people see it in their client: an alias such as `#ops:example.org`, a matrix.to link or a room ID such as `!abc:example.org`. Aliases and links are resolved to the room ID when saving.",
          ),
        accessToken: z
          .string()
          .min(1)
          .max(2000)
          .describe("Access token of the bot account. Stored encrypted and never returned."),
      })
      .strict()
      .describe("For Matrix."),
  ])
  .describe(
    "Where messages go. Private, loopback and link-local addresses are refused unless the instance allows them.",
  );

const eventsSchema = z
  .array(z.enum(allEvents))
  .min(1)
  .max(allEvents.length)
  .describe(
    "What is posted. Spaces: `pagePublished`, `pageChanged` (combined per hour), `blogPostPublished`, `decisionRecorded`, `pageStatusChanged`, `commentCreated`. Organizations: `announcementPublished`.",
  );

const nameSchema = z.string().min(1).max(80).describe("Name of the channel in Lunedo.");

const createSchema = z
  .object({ kind: kindSchema, name: nameSchema, events: eventsSchema, target: targetSchema })
  .strict()
  .describe("The channel to connect.");

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    events: eventsSchema.optional(),
    target: targetSchema.optional().describe("New address or token. Leave it out to keep the stored one."),
    newSecret: z
      .boolean()
      .optional()
      .describe("For generic webhooks: create a new signing secret, returned once in the answer."),
  })
  .strict()
  .describe("Changes to the channel.");

const failureSchema = z
  .object({
    reason: extensibleEnum(chatFailureReasons, "Why the service did not accept messages."),
    status: z.number().int().nullable().describe("HTTP status the service answered with, if it answered."),
    code: z.string().nullable().describe("Error code the service reported, such as `invalid_token`, if any."),
  })
  .describe("Why a message was not delivered.");

const channelSchema = z
  .object({
    id: uuid("ID of the channel."),
    kind: kindSchema,
    name: z.string().describe("Name of the channel in Lunedo."),
    events: z.array(extensibleEnum(allEvents, "An event that is posted.")).describe("What is posted."),
    state: extensibleEnum(
      chatChannelStates,
      "`failing` when the service stopped accepting messages; nothing is posted until the channel is fixed.",
    ),
    failure: failureSchema
      .extend({ at: timestamp("When the channel started failing or the last test failed.") })
      .nullable()
      .describe(
        "Why the channel is failing, or, while it is `working`, why the last test failed. Null once a message was accepted again.",
      ),
    lastAttemptAt: timestamp("When a message was last sent.").nullable(),
    lastDeliveredAt: timestamp("When a message was last accepted.").nullable(),
    createdAt: timestamp("When the channel was connected."),
  })
  .describe("A chat channel. Addresses and tokens are never returned.");

const savedSchema = z
  .object({
    channel: channelSchema,
    signingSecret: z
      .string()
      .nullable()
      .describe(
        "For generic webhooks, the secret that signs each request (header `X-Lunedo-Signature`). Shown only in this answer.",
      ),
  })
  .describe("The saved channel.");

const listSchema = z
  .object({ items: z.array(channelSchema).describe("The channels.") })
  .describe("Chat channels.");

const testSchema = z
  .object({
    delivered: z.boolean().describe("Whether the service accepted the test message."),
    failure: failureSchema.nullable().describe("Why it was not accepted, or null."),
  })
  .describe("Result of the test message.");

const exampleChannel = {
  id: "0192a0d4-5b6e-7c3f-8a10-3e2f4c5d6e7f",
  kind: "teams",
  name: "IT-Ops · General",
  events: ["pagePublished", "blogPostPublished", "decisionRecorded"],
  state: "working",
  failure: null,
  lastAttemptAt: "2026-10-15T08:12:00.000Z",
  lastDeliveredAt: "2026-10-15T08:12:00.000Z",
  createdAt: "2026-10-01T09:00:00.000Z",
};

const exampleSaved = { channel: exampleChannel, signingSecret: null };
const exampleTest = {
  delivered: false,
  failure: { reason: "addressGone", status: 404, code: "no_service" },
};
const exampleList = { items: [exampleChannel] };

const exampleCreate = {
  kind: "teams",
  name: "IT-Ops · General",
  events: ["pagePublished", "blogPostPublished", "decisionRecorded"],
  target: { url: "https://prod-12.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke" },
};

const errors = [
  "invalidChatChannel",
  "invalidChatAddress",
  "chatAddressBlocked",
  "chatAddressInsecure",
  "confidentialSpace",
  "tooManyChatChannels",
] as const;

function testResult(result: ChatTestResult): z.output<typeof testSchema> {
  return result.delivered
    ? { delivered: true, failure: null }
    : { delivered: false, failure: result.failure };
}

function list(items: ChatChannel[]) {
  return { items };
}

@Controller("api/v1")
export class ChatChannelsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #channels() {
    return servicesOf(this.context).chatChannels;
  }

  #space(spaceId: string): ChatScope {
    return { kind: "space", spaceId };
  }

  #organization(organizationId: string): ChatScope {
    return { kind: "organization", organizationId };
  }

  @Get("spaces/:spaceId/chat-channels")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the chat channels of a space",
    description: "Shows the channels with their state. Addresses and tokens are never returned.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The channels.", schema: listSchema, example: exampleList },
  })
  async listSpace(@Param("spaceId") spaceId: string) {
    return list(await this.#channels.list(this.#space(spaceId)));
  }

  @Post("spaces/:spaceId/chat-channels")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Connect a space to a chat channel",
    description:
      "Only content every member of the space can read is posted: restricted pages, their comments and drafts never are. Confidential spaces cannot have chat channels.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    body: createSchema,
    bodyExample: exampleCreate,
    response: { description: "The channel.", schema: savedSchema, example: exampleSaved },
    errors: [...errors],
  })
  async createSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#channels.create(actorOf(request), this.#space(spaceId), body);
  }

  @Post("spaces/:spaceId/chat-channels/test")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Send a test message before connecting a channel",
    description: "Sends one message to the address without saving it.",
    tags: [TAG],
    params: spaceParams,
    body: createSchema,
    bodyExample: exampleCreate,
    response: { description: "Whether the service accepted it.", schema: testSchema, example: exampleTest },
    errors: [...errors],
  })
  async testSpace(@Param("spaceId") spaceId: string, @Body() body: z.output<typeof createSchema>) {
    return testResult(await this.#channels.test(this.#space(spaceId), body));
  }

  @Patch("spaces/:spaceId/chat-channels/:channelId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a chat channel of a space",
    description: "A new address or secret also clears the failing state.",
    tags: [TAG],
    params: spaceChannelParams,
    body: updateSchema,
    bodyExample: { events: ["pagePublished", "pageStatusChanged"] },
    response: { description: "The channel.", schema: savedSchema, example: exampleSaved },
    errors: ["notFound", ...errors],
  })
  async updateSpace(
    @Param("spaceId") spaceId: string,
    @Param("channelId") channelId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#channels.update(actorOf(request), this.#space(spaceId), channelId, body);
  }

  @Post("spaces/:spaceId/chat-channels/:channelId/test")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Send a test message to a chat channel",
    description: "When the service accepts it, a failing channel works again.",
    tags: [TAG],
    params: spaceChannelParams,
    response: { description: "Whether the service accepted it.", schema: testSchema, example: exampleTest },
    errors: ["notFound", "confidentialSpace"],
  })
  async testSavedSpace(@Param("spaceId") spaceId: string, @Param("channelId") channelId: string) {
    return testResult(await this.#channels.testSaved(this.#space(spaceId), channelId));
  }

  @Delete("spaces/:spaceId/chat-channels/:channelId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Disconnect a chat channel from a space",
    description: "Deletes the stored address; messages not yet sent are dropped.",
    tags: [TAG],
    params: spaceChannelParams,
    errors: ["notFound"],
  })
  async removeSpace(
    @Param("spaceId") spaceId: string,
    @Param("channelId") channelId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#channels.remove(actorOf(request), this.#space(spaceId), channelId);
  }

  @Get("organizations/:organizationId/chat-channels")
  @Permission("organization.integrations.view", organization)
  @ApiRoute({
    summary: "List the announcement channels of an organization",
    description: "Shows the channels with their state. Addresses and tokens are never returned.",
    tags: [TAG],
    params: organizationParams,
    response: { description: "The channels.", schema: listSchema, example: exampleList },
  })
  async listOrganization(@Param("organizationId") organizationId: string) {
    return list(await this.#channels.list(this.#organization(organizationId)));
  }

  @Post("organizations/:organizationId/chat-channels")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Post organization announcements to a chat channel",
    description: "Announcements are posted when they start.",
    tags: [TAG],
    status: 201,
    params: organizationParams,
    body: createSchema,
    bodyExample: { ...exampleCreate, events: ["announcementPublished"] },
    response: { description: "The channel.", schema: savedSchema, example: exampleSaved },
    errors: [...errors],
  })
  async createOrganization(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#channels.create(actorOf(request), this.#organization(organizationId), body);
  }

  @Post("organizations/:organizationId/chat-channels/test")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Send a test message before connecting an announcement channel",
    description: "Sends one message to the address without saving it.",
    tags: [TAG],
    params: organizationParams,
    body: createSchema,
    bodyExample: { ...exampleCreate, events: ["announcementPublished"] },
    response: { description: "Whether the service accepted it.", schema: testSchema, example: exampleTest },
    errors: [...errors],
  })
  async testOrganization(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createSchema>,
  ) {
    return testResult(await this.#channels.test(this.#organization(organizationId), body));
  }

  @Patch("organizations/:organizationId/chat-channels/:channelId")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Change an announcement channel",
    description: "A new address or secret also clears the failing state.",
    tags: [TAG],
    params: organizationChannelParams,
    body: updateSchema,
    bodyExample: { name: "All hands" },
    response: { description: "The channel.", schema: savedSchema, example: exampleSaved },
    errors: ["notFound", ...errors],
  })
  async updateOrganization(
    @Param("organizationId") organizationId: string,
    @Param("channelId") channelId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#channels.update(actorOf(request), this.#organization(organizationId), channelId, body);
  }

  @Post("organizations/:organizationId/chat-channels/:channelId/test")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Send a test message to an announcement channel",
    description: "When the service accepts it, a failing channel works again.",
    tags: [TAG],
    params: organizationChannelParams,
    response: { description: "Whether the service accepted it.", schema: testSchema, example: exampleTest },
    errors: ["notFound"],
  })
  async testSavedOrganization(
    @Param("organizationId") organizationId: string,
    @Param("channelId") channelId: string,
  ) {
    return testResult(await this.#channels.testSaved(this.#organization(organizationId), channelId));
  }

  @Delete("organizations/:organizationId/chat-channels/:channelId")
  @Permission("organization.integrations.manage", organization)
  @ApiRoute({
    summary: "Disconnect an announcement channel",
    description: "Deletes the stored address; messages not yet sent are dropped.",
    tags: [TAG],
    params: organizationChannelParams,
    errors: ["notFound"],
  })
  async removeOrganization(
    @Param("organizationId") organizationId: string,
    @Param("channelId") channelId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#channels.remove(actorOf(request), this.#organization(organizationId), channelId);
  }
}
