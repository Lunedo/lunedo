import {
  MAX_SHORTCUTS,
  SHORTCUT_LABEL_MAX_LENGTH,
  SHORTCUT_URL_MAX_LENGTH,
  treeItemKinds,
} from "@lunedo/server";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, itemNumber, uuid } from "../http/schemas.js";

const TAG = "Spaces";
const space = { type: "space", param: "spaceId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const shortcutParams = spaceParams.extend({ shortcutId: uuid("ID of the shortcut.") }).strict();

const shortcutSchema = z
  .object({
    id: uuid("ID of the shortcut."),
    label: z.string().describe("The label shown in the sidebar."),
    url: z.string().nullable().describe("The external address, or null for content in Lunedo."),
    item: z
      .object({
        id: uuid("ID of the content."),
        number: itemNumber("Number of the content in the addresses of the app."),
        kind: extensibleEnum(treeItemKinds, "Kind of the content."),
        title: z.string().describe("Title of the content."),
        spaceKey: z.string().describe("Key of the space the content is in."),
      })
      .nullable()
      .describe("The content in Lunedo, or null for an external address or content the caller cannot open."),
    hidden: z
      .boolean()
      .describe(
        "Whether the caller cannot open the content. Only space admins see such shortcuts, in the settings.",
      ),
    position: z.number().int().describe("Position in the list."),
  })
  .describe("A shortcut in the space sidebar.");

const exampleShortcut = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a50",
  label: "On-call rota",
  url: null,
  item: {
    id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a51",
    number: 1051,
    kind: "page" as const,
    title: "On-call rota 2026",
    spaceKey: "OPS",
  },
  hidden: false,
  position: 0,
};

const targetSchema = z
  .union([
    z.object({ itemId: uuid("A page, folder, blog post or meeting series you can open.") }).strict(),
    z
      .object({
        url: z
          .string()
          .max(SHORTCUT_URL_MAX_LENGTH)
          .describe("An address starting with https:// or http://."),
      })
      .strict(),
  ])
  .describe("Where the shortcut leads.");

const labelSchema = z
  .string()
  .max(SHORTCUT_LABEL_MAX_LENGTH)
  .describe(`Up to ${SHORTCUT_LABEL_MAX_LENGTH} characters.`);

const createSchema = z
  .object({ label: labelSchema, target: targetSchema })
  .strict()
  .describe("The new shortcut.");
const updateSchema = z
  .object({ label: labelSchema.optional(), target: targetSchema.optional() })
  .strict()
  .describe("The changes.");
const orderSchema = z
  .object({
    ids: z.array(uuid("ID of a shortcut.")).max(MAX_SHORTCUTS).describe("Every shortcut, in the new order."),
  })
  .strict()
  .describe("The new order.");

const listSchema = z.array(shortcutSchema).describe("The shortcuts, in order.");

@Controller("api/v1")
export class ShortcutsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/shortcuts")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the shortcuts of a space",
    description:
      "Lists the shortcuts in the space sidebar. Shortcuts to content the caller cannot open are left out entirely.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The shortcuts.", schema: listSchema, example: [exampleShortcut] },
  })
  async list(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.shortcuts.list(actorOf(request), spaceId);
  }

  @Get("spaces/:spaceId/shortcuts/manage")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List all shortcuts of a space for editing",
    description:
      "Lists every shortcut, also those to content the caller cannot open. For those, `hidden` is true and the content is not named.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The shortcuts.", schema: listSchema, example: [exampleShortcut] },
  })
  async manage(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.shortcuts.manage(actorOf(request), spaceId);
  }

  @Post("spaces/:spaceId/shortcuts")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Add a shortcut",
    description: `Adds a shortcut at the end of the list. A space can have up to ${MAX_SHORTCUTS} shortcuts. Content needs to be open to you; people who cannot open it do not see the shortcut.`,
    tags: [TAG],
    params: spaceParams,
    body: createSchema,
    bodyExample: { label: "Status page", target: { url: "https://status.example.org" } },
    status: 201,
    response: { description: "The new shortcut.", schema: shortcutSchema, example: exampleShortcut },
    errors: ["invalidShortcut", "shortcutTargetNotFound", "tooManyShortcuts"],
  })
  async add(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.shortcuts.add(actorOf(request), spaceId, body);
  }

  @Patch("spaces/:spaceId/shortcuts/:shortcutId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a shortcut",
    description: "Changes the label or the target. A new content target needs to be open to the caller.",
    tags: [TAG],
    params: shortcutParams,
    body: updateSchema,
    bodyExample: { label: "On-call" },
    response: { description: "The changed shortcut.", schema: shortcutSchema, example: exampleShortcut },
    errors: ["invalidShortcut", "shortcutNotFound", "shortcutTargetNotFound"],
  })
  async update(
    @Param("spaceId") spaceId: string,
    @Param("shortcutId") shortcutId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.shortcuts.update(actorOf(request), spaceId, shortcutId, body);
  }

  @Put("spaces/:spaceId/shortcuts/order")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Reorder the shortcuts",
    description: "Sets the order of the shortcuts in the sidebar. Name every shortcut of the space once.",
    tags: [TAG],
    params: spaceParams,
    body: orderSchema,
    bodyExample: { ids: [exampleShortcut.id] },
    response: {
      description: "The shortcuts in their new order.",
      schema: listSchema,
      example: [exampleShortcut],
    },
    errors: ["invalidShortcut"],
  })
  async reorder(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof orderSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.shortcuts.reorder(actorOf(request), spaceId, body.ids);
  }

  @Delete("spaces/:spaceId/shortcuts/:shortcutId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove a shortcut",
    description: "Removes the shortcut from the sidebar of the space.",
    tags: [TAG],
    status: 204,
    params: shortcutParams,
    errors: ["shortcutNotFound"],
  })
  async remove(
    @Param("spaceId") spaceId: string,
    @Param("shortcutId") shortcutId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.shortcuts.remove(actorOf(request), spaceId, shortcutId);
  }
}
