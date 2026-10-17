import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { COPY_IN_REQUEST_LIMIT, copyStates, treeItemKinds } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";
import { copyImpactSchema, exampleCopyImpact } from "./schemas.js";

const TAG = "Pages";
const item = { type: "item", param: "itemId" } as const;
const copyResource = { type: "copy", param: "copyId" } as const;
const itemParams = z.object({ itemId: uuid("ID of the page, folder or whiteboard.") }).strict();
const copyParams = z.object({ copyId: uuid("ID of the copy.") }).strict();

const descendants = z
  .boolean()
  .default(false)
  .describe("Copy the items below as well. Default false: only the item itself.");

const previewCopySchema = z
  .object({
    spaceId: uuid("Target space. Leave it out to copy within the space.").optional(),
    parentId: uuid("Parent item at the target, or null for the root of the tree.").nullable(),
    descendants,
  })
  .strict()
  .describe("The place the copy would go to.");

const copyItemSchema = z
  .object({
    spaceId: uuid("Target space. Leave it out to copy within the space.").optional(),
    parentId: uuid("Parent item at the target, or null for the root of the tree.").nullable(),
    beforeId: uuid("Place the copy directly before this sibling.").nullable().optional(),
    afterId: uuid("Place the copy directly after this sibling.").nullable().optional(),
    descendants,
    confirmation: z
      .string()
      .max(200)
      .optional()
      .describe(
        "The `confirmation` of a preview. Needed when the copy can be read by people who cannot read the source.",
      ),
  })
  .strict()
  .describe("Where the copy goes and what it contains.");

export const copySchema = z
  .object({
    id: uuid("ID of the copy."),
    state: extensibleEnum(
      copyStates,
      "`queued` and `running` while a large copy runs in the background, `done` when the copy exists, `failed` when nothing was created.",
    ),
    title: z.string().describe("Title of the copied item when the copy started."),
    descendants: z.boolean().describe("Whether the items below were copied as well."),
    sourceItemId: uuid("The copied item, or null when it was deleted permanently since.").nullable(),
    targetSpaceId: uuid("The target space, or null when it was deleted permanently since.").nullable(),
    progress: z
      .object({
        done: z.number().int().describe("Number of items copied so far."),
        total: z.number().int().describe("Number of items the copy creates."),
      })
      .describe("Progress of a copy that runs in the background."),
    copied: z.number().int().describe("Number of items created, once the copy is done."),
    hidden: z
      .number()
      .int()
      .describe("Number of items below that were left out because the person copying cannot read them."),
    skipped: z
      .number()
      .int()
      .describe(
        "Number of items below that were left out because they cannot be copied: pages never published, meetings and their series.",
      ),
    item: z
      .object({
        id: uuid("ID of the new item."),
        spaceId: uuid("ID of its space."),
        spaceKey: z.string().describe("Key of its space."),
        kind: extensibleEnum(treeItemKinds, "Kind of the new item."),
        title: z.string().describe("Title of the new item."),
      })
      .nullable()
      .describe("The new item at the top of the copy, or null until the copy is done."),
    errorCode: z
      .string()
      .nullable()
      .describe(
        "Why a copy failed, for example `copyChangesAccess` (access changed after the confirmation), `storageFull`, `copyInterrupted` or `copyFailed`; null otherwise.",
      ),
    createdAt: timestamp("When the copy started."),
    finishedAt: timestamp("When the copy finished or failed, or null.").nullable(),
  })
  .describe("A copy of a page, folder or whiteboard.");

const exampleCopy = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
  state: "done",
  title: "VPN access",
  descendants: true,
  sourceItemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40",
  targetSpaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  progress: { done: 4, total: 4 },
  copied: 4,
  hidden: 1,
  skipped: 0,
  item: {
    id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a71",
    spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
    spaceKey: "OPS",
    kind: "page",
    title: "VPN access",
  },
  errorCode: null,
  createdAt: "2026-10-17T09:30:00.000Z",
  finishedAt: "2026-10-17T09:30:01.000Z",
};

@Controller("api/v1")
export class CopiesController {
  readonly #services;

  constructor(@Inject(API_CONTEXT) context: ApiContext) {
    this.#services = servicesOf(context);
  }

  @Post("items/:itemId/copy/preview")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Preview a copy",
    description: `Shows what a copy to the place would contain and who could read it. The copy inherits the view restrictions of its new place and carries no restrictions, shares or links of its own. When people could read the copy who cannot read the source, the answer carries a confirmation to send with the copy. Items below that the caller cannot read are counted in \`hidden\`, never named. Copies of more than ${COPY_IN_REQUEST_LIMIT} items run in the background. Needs read access to the item and edit permission in the target space; copying out of a confidential space also needs edit permission there. Nothing is changed.`,
    tags: [TAG],
    status: 200,
    params: itemParams,
    body: previewCopySchema,
    bodyExample: { spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10", parentId: null, descendants: true },
    response: {
      description: "What the copy contains and who could read it.",
      schema: copyImpactSchema,
      example: exampleCopyImpact,
    },
    errors: ["invalidPlacement", "notCopyable", "neverPublished", "otherOrganization"],
  })
  async preview(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof previewCopySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.copies.preview(actorOf(request), itemId, body);
  }

  @Post("items/:itemId/copy")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Copy an item",
    description: `Copies a page, a folder or a whiteboard, optionally with everything below it, within its space or into another space of the same organization. Each copy starts from the published version with one version in its history, gets the current version of every attachment, the labels, page properties, options and status, and belongs to the caller. Comments, reactions, watchers, shares and links stay behind. Links between copied pages point to the copies. When people could read the copy who cannot read the source, the copy is refused with \`copyChangesAccess\` unless the request carries the confirmation of a preview of exactly that change. Copies of up to ${COPY_IN_REQUEST_LIMIT} items finish within the request; larger ones answer with state \`queued\`, run in the background and notify the caller at the end; a failed copy leaves nothing behind.`,
    tags: [TAG],
    status: 200,
    params: itemParams,
    body: copyItemSchema,
    bodyExample: { spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10", parentId: null, descendants: true },
    response: { description: "The copy.", schema: copySchema, example: exampleCopy },
    errors: [
      "invalidPlacement",
      "notCopyable",
      "neverPublished",
      "otherOrganization",
      "copyChangesAccess",
      "storageFull",
    ],
  })
  async copy(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof copyItemSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.copies.copy(actorOf(request), itemId, body);
  }

  @Get("copies/:copyId")
  @Permission("copy.view", copyResource)
  @ApiRoute({
    summary: "Get a copy",
    description: "Returns the state and progress of a copy the caller started.",
    tags: [TAG],
    params: copyParams,
    response: { description: "The copy.", schema: copySchema, example: exampleCopy },
  })
  async get(@Param("copyId") copyId: string) {
    const copy = await this.#services.copies.get(copyId);
    if (!copy) throw notFound("The copy does not exist.");
    return copy;
  }
}
