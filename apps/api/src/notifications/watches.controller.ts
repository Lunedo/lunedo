import { treeItemKinds, type WatchTarget } from "@lunedo/server";
import { watchStates } from "@lunedo/shared";
import { Body, Controller, Delete, Get, Inject, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf, sessionOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

const TAG = "Watching";
const item = { type: "item", param: "itemId" } as const;
const space = { type: "space", param: "spaceId" } as const;
const itemParams = z
  .object({ itemId: uuid("ID of the page, blog post, meeting series or meeting topic.") })
  .strict();
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();

const stateSchema = z
  .enum(watchStates)
  .describe(
    "`watching` delivers changes and comments, `muted` silences everything from it, `notWatching` stops watching it even when its space or meeting series is watched.",
  );

const watchUpdateSchema = z
  .object({
    state: stateSchema,
    keepActionable: z
      .boolean()
      .optional()
      .describe(
        "For `muted`: still deliver mentions, assigned tasks, shares with the caller and access requests the caller can decide. Default true.",
      ),
  })
  .strict()
  .describe("The new state.");

const watchStatusSchema = z
  .object({
    own: z
      .object({
        state: stateSchema,
        keepActionable: z
          .boolean()
          .describe(
            "Whether mentions, assigned tasks, shares with the person and access requests they can decide still arrive while muted.",
          ),
        automatic: z
          .boolean()
          .describe("True when the caller watches because they created, edited or commented on it."),
      })
      .nullable()
      .describe("The state the caller set for this item or space, or null."),
    effective: z
      .object({
        state: stateSchema,
        keepActionable: z
          .boolean()
          .describe(
            "Whether mentions, assigned tasks, shares with the person and access requests they can decide still arrive while muted.",
          ),
        source: z
          .enum(["target", "series", "space"])
          .describe("Where the state comes from: the item or space itself, its meeting series or its space."),
      })
      .nullable()
      .describe("The state that applies, or null when nothing is set."),
  })
  .describe("Whether the caller watches or muted the item or space.");

const exampleStatus = {
  own: null,
  effective: { state: "watching", keepActionable: true, source: "space" },
};

const watchedSchema = z
  .object({
    target: z
      .object({
        type: z.enum(["item", "space"]).describe("Kind of target."),
        id: uuid("ID of the item or space."),
      })
      .describe("What is watched or muted."),
    state: z.enum(["watching", "muted"]).describe("Watched or muted."),
    keepActionable: z
      .boolean()
      .describe(
        "Whether mentions, assigned tasks, shares with the person and access requests they can decide still arrive while muted.",
      ),
    automatic: z
      .boolean()
      .describe("True when it is watched because the caller created, edited or commented."),
    title: z.string().describe("Title of the item, or name of the space."),
    kind: extensibleEnum([...treeItemKinds, "space"], "Kind of the item, or `space`."),
    spaceId: uuid("The space."),
    spaceKey: z.string().describe("Key of the space."),
    spaceName: z.string().describe("Name of the space."),
    updatedAt: timestamp("When the state was last set."),
  })
  .describe("A watched or muted item or space.");

const watchedListSchema = z
  .object({
    items: z
      .array(watchedSchema)
      .describe("Watched and muted items and spaces, most recently changed first."),
    counts: z
      .object({
        watchedItems: z.number().int().describe("Watched items."),
        watchedSpaces: z.number().int().describe("Watched spaces."),
        mutedItems: z.number().int().describe("Muted items."),
        mutedSpaces: z.number().int().describe("Muted spaces."),
      })
      .describe("Numbers per kind."),
  })
  .describe("What the caller watches and muted. Items the caller can no longer open are left out.");

const deliverySchema = z
  .object({
    emailMethod: z
      .enum(["smtp", "graph"])
      .nullable()
      .describe("How the instance sends e-mail, or null when no mail server is set up."),
    browserPush: z.boolean().describe("Whether browser push is turned on for the instance."),
  })
  .describe("Which notification channels the instance can deliver.");

@Controller("api/v1")
export class WatchesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #watches() {
    return servicesOf(this.context).watches;
  }

  async #status(request: FastifyRequest, target: WatchTarget) {
    return this.#watches.status(actorOf(request).id, target);
  }

  async #set(request: FastifyRequest, target: WatchTarget, body: z.output<typeof watchUpdateSchema>) {
    return this.#watches.set(actorOf(request).id, target, body);
  }

  @Get("items/:itemId/watch")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Get the watch state of an item",
    description:
      "Shows the state the caller set for the item and the state that applies, which can come from the item's meeting series or space.",
    tags: [TAG],
    params: itemParams,
    response: { description: "The caller's watch state.", schema: watchStatusSchema, example: exampleStatus },
  })
  async itemStatus(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#status(request, { type: "item", id: itemId });
  }

  @Put("items/:itemId/watch")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Watch, mute or stop watching an item",
    description:
      "Watching never grants access: while the caller cannot read the item, nothing is delivered, and delivery resumes when access returns.",
    tags: [TAG],
    params: itemParams,
    body: watchUpdateSchema,
    bodyExample: { state: "muted", keepActionable: true },
    response: { description: "The new watch state.", schema: watchStatusSchema, example: exampleStatus },
  })
  async watchItem(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof watchUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#set(request, { type: "item", id: itemId }, body);
  }

  @Delete("items/:itemId/watch")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Remove the watch state of an item",
    description: "The item then follows its meeting series and its space again.",
    tags: [TAG],
    params: itemParams,
    response: {
      description: "The watch state that applies now.",
      schema: watchStatusSchema,
      example: exampleStatus,
    },
  })
  async resetItem(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#watches.set(actorOf(request).id, { type: "item", id: itemId }, { state: null });
  }

  @Get("spaces/:spaceId/watch")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get the watch state of a space",
    description: "Shows whether the caller watches or muted the space.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The caller's watch state.", schema: watchStatusSchema, example: exampleStatus },
  })
  async spaceStatus(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#status(request, { type: "space", id: spaceId });
  }

  @Put("spaces/:spaceId/watch")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Watch, mute or stop watching a space",
    description:
      "Watching a space delivers changes and comments on everything in it the caller can read. Muting it silences everything from it, except mentions, assigned tasks, shares with the caller and access requests the caller can decide when `keepActionable` is true.",
    tags: [TAG],
    params: spaceParams,
    body: watchUpdateSchema,
    bodyExample: { state: "watching" },
    response: { description: "The new watch state.", schema: watchStatusSchema, example: exampleStatus },
  })
  async watchSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof watchUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#set(request, { type: "space", id: spaceId }, body);
  }

  @Delete("spaces/:spaceId/watch")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Remove the watch state of a space",
    description: "The caller then neither watches nor mutes the space; pages keep their own states.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The watch state that applies now.",
      schema: watchStatusSchema,
      example: exampleStatus,
    },
  })
  async resetSpace(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#watches.set(actorOf(request).id, { type: "space", id: spaceId }, { state: null });
  }
}

@Controller("api/v1/account")
@InternalRoute()
export class AccountWatchesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  @Get("watches")
  @SessionRoute()
  @ApiRoute({
    summary: "List own watched and muted items",
    tags: [TAG],
    response: { description: "Watched and muted items and spaces.", schema: watchedListSchema },
  })
  async list(@Req() request: FastifyRequest) {
    const watches = servicesOf(this.context).watches;
    const items = await watches.list(sessionOf(request).accountId);
    const count = (type: "item" | "space", state: "watching" | "muted") =>
      items.filter((entry) => entry.target.type === type && entry.state === state).length;
    return {
      items,
      counts: {
        watchedItems: count("item", "watching"),
        watchedSpaces: count("space", "watching"),
        mutedItems: count("item", "muted"),
        mutedSpaces: count("space", "muted"),
      },
    };
  }

  @Get("notification-delivery")
  @SessionRoute()
  @ApiRoute({
    summary: "Show which notification channels are available",
    tags: [TAG],
    response: {
      description: "The available channels.",
      schema: deliverySchema,
      example: { emailMethod: null, browserPush: false },
    },
  })
  async delivery() {
    const services = servicesOf(this.context);
    return {
      emailMethod: await services.mail.configuredMethod(),
      browserPush: await services.push.enabled(),
    };
  }
}
