import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import {
  MAX_PAGE_STATUS_VALUES,
  MAX_UNOWNED_PAGE,
  PAGE_STATUS_NAME_MAX_LENGTH,
  treeItemKinds,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, nameCursor } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, organizationIdParams, timestamp, uuid } from "../http/schemas.js";
import { examplePageStatus, pageStatusColorSchema, pageStatusSchema } from "./schemas.js";

const TAG = "Ownership and status";
const space = { type: "space", param: "spaceId" } as const;
const item = { type: "item", param: "itemId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const itemParams = z
  .object({ itemId: uuid("ID of the page, folder, link, blog post or meeting series.") })
  .strict();
const statusParams = spaceParams.extend({ statusId: uuid("ID of the status value.") }).strict();

const cursorQuery = z
  .object({
    cursor: z.string().max(2000).optional().describe("Cursor from `nextCursor` of the previous page."),
  })
  .strict();

const candidateQuery = z
  .object({ q: z.string().trim().max(200).default("").describe("Part of the name or e-mail address.") })
  .strict();

const personSchema = z
  .object({
    id: uuid("ID of the person."),
    name: z
      .string()
      .nullable()
      .describe("Name of the person, or null when the caller may not see the person."),
  })
  .describe("A person.");

const examplePerson = { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Weber" };

const ownerSchema = z
  .object({ ownerId: uuid("The new owner. The person needs edit access to the item.") })
  .strict()
  .describe("The new owner.");

const candidateSchema = z
  .object({
    id: uuid("ID of the person."),
    name: z.string().describe("Name of the person."),
    email: z.string().nullable().describe("E-mail address, or null when the caller may not see it."),
  })
  .describe("A person who can become the owner.");

const unownedItemSchema = z
  .object({
    id: uuid("ID of the item."),
    spaceId: uuid("Space of the item."),
    spaceKey: z.string().describe("Key of the space."),
    spaceName: z.string().describe("Name of the space."),
    kind: extensibleEnum(treeItemKinds, "Kind of the item."),
    title: z.string().describe("Title of the item."),
    formerOwner: personSchema.nullable().describe("The owner who left, or null when the item never had one."),
    reason: z
      .enum(["none", "deactivated", "membershipEnded"])
      .describe(
        "Why the item has no owner: `none` (never had one), `deactivated` (the account was deactivated) or `membershipEnded` (the person is no longer a member of the organization).",
      ),
  })
  .describe("An item without an active owner.");

const unownedPageSchema = z
  .object({
    items: z.array(unownedItemSchema).describe(`Items, by title, up to ${MAX_UNOWNED_PAGE} per page.`),
    hidden: z
      .number()
      .int()
      .describe(
        "Number of further items without an owner that the caller cannot open, for example restricted pages. Remove their restriction or ask someone who can open them.",
      ),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Items without an active owner.");

const exampleUnowned = {
  items: [
    {
      id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40",
      spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a30",
      spaceKey: "ITOPS",
      spaceName: "IT Operations",
      kind: "page",
      title: "Restart the VPN gateway",
      formerOwner: examplePerson,
      reason: "deactivated",
    },
  ],
  hidden: 0,
  nextCursor: null,
};

const statusValueSchema = pageStatusSchema
  .extend({
    position: z.number().int().describe("Place in the list, starting at 0."),
    pages: z
      .number()
      .int()
      .describe("Number of pages with this status that the caller can view, without pages in the trash."),
  })
  .describe("A status value of a space.");

const exampleStatusValue = { ...examplePageStatus, position: 3, pages: 12 };

const statusValuesSchema = z
  .object({
    enabled: z.boolean().describe("Whether page status is turned on in the space."),
    values: z.array(statusValueSchema).describe("Values in their order."),
  })
  .describe("The page status values of a space.");

const statusName = z
  .string()
  .max(200)
  .describe(`Name, 1 to ${PAGE_STATUS_NAME_MAX_LENGTH} characters, unique in the space.`);

const createStatusSchema = z
  .object({ name: statusName, color: pageStatusColorSchema })
  .strict()
  .describe("A new status value.");

const updateStatusSchema = z
  .object({ name: statusName.optional(), color: pageStatusColorSchema.optional() })
  .strict()
  .describe("Changes to a status value. Renaming a default value replaces its translated name.");

const orderSchema = z
  .object({
    ids: z
      .array(uuid("ID of a status value."))
      .max(MAX_PAGE_STATUS_VALUES)
      .describe("Every status value of the space exactly once, in the new order."),
  })
  .strict()
  .describe("The new order.");

const removeQuery = z
  .object({
    pages: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Number of pages that lose the status, as shown to the person who confirmed. When it differs, nothing is removed and the answer `statusInUse` names the current number.",
      ),
  })
  .strict();

const setStatusSchema = z
  .object({
    statusId: uuid("A status value of the item's space, or null to remove the status.").nullable(),
  })
  .strict()
  .describe("The new status.");

const activitySchema = z
  .array(
    z
      .discriminatedUnion("type", [
        z
          .object({
            type: z.literal("status").describe("The status changed."),
            id: uuid("ID of the entry."),
            status: pageStatusSchema
              .extend({ id: uuid("ID of the status value, or null when it was removed since.").nullable() })
              .nullable()
              .describe("The new status, or null when it was removed."),
            actor: personSchema.nullable().describe("Who changed it, or null for an import."),
            at: timestamp("When it changed."),
          })
          .describe("A status change."),
        z
          .object({
            type: z.literal("owner").describe("The owner changed."),
            id: uuid("ID of the entry."),
            previousOwner: personSchema.nullable().describe("The owner before, or null."),
            owner: personSchema.nullable().describe("The new owner."),
            actor: personSchema.nullable().describe("Who changed it."),
            at: timestamp("When it changed."),
          })
          .describe("A change of owner."),
      ])
      .describe("An entry of the activity."),
  )
  .describe("Status and owner changes of the item, newest first.");

@Controller("api/v1")
export class OwnershipController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("items/:itemId/owner-candidates")
  @Permission("item.transferOwnership", item)
  @ApiRoute({
    summary: "Find people who can become the owner",
    description:
      "Lists active people the caller can see who have edit access to the item now, by name. The current owner is left out.",
    tags: [TAG],
    params: itemParams,
    query: candidateQuery,
    response: {
      description: "Up to 20 people.",
      schema: z.array(candidateSchema).describe("The people."),
      example: [{ ...examplePerson, email: "anna.weber@example.org" }],
    },
  })
  async candidates(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof candidateQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.ownership.candidates(actorOf(request), itemId, query.q);
  }

  @Put("items/:itemId/owner")
  @Permission("item.transferOwnership", item)
  @ApiRoute({
    summary: "Give an item a new owner",
    description:
      "Makes the person the owner of the item. The owner, space admins and, outside confidential spaces, organization admins who can read the space may do this. The new owner needs edit access to the item. Archived items, items in the trash and meeting topics keep their owner.",
    tags: [TAG],
    status: 204,
    params: itemParams,
    body: ownerSchema,
    bodyExample: { ownerId: examplePerson.id },
    errors: ["ownerNeedsEditAccess", "ownershipNotTransferable"],
  })
  async transfer(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof ownerSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.ownership.transfer(actorOf(request), itemId, body.ownerId);
  }

  @Get("spaces/:spaceId/unowned-items")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List items without an owner in a space",
    description:
      "Lists items of the space whose owner was deactivated or left the organization, and items that never had an owner. Only items the caller can open are listed; `hidden` counts the others. Giving an item a new owner removes it from the list; a returning owner is owner again unless someone else was given the item.",
    tags: [TAG],
    params: spaceParams,
    query: cursorQuery,
    response: { description: "The items.", schema: unownedPageSchema, example: exampleUnowned },
  })
  async spaceUnowned(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof cursorQuery>,
    @Req() request: FastifyRequest,
  ) {
    const page = await this.#services.ownership.spaceUnowned(
      actorOf(request),
      spaceId,
      decodeCursor(query.cursor, nameCursor) ?? null,
    );
    return { items: page.items, hidden: page.hidden, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  @Get("organizations/:organizationId/unowned-items")
  @Permission("organization.spaces.view", organization)
  @ApiRoute({
    summary: "List items without an owner in an organization",
    description:
      "Lists items without an active owner in the spaces of the organization that the caller can read, without confidential spaces. `hidden` counts items the caller cannot open.",
    tags: [TAG],
    params: organizationIdParams,
    query: cursorQuery,
    response: { description: "The items.", schema: unownedPageSchema, example: exampleUnowned },
  })
  async organizationUnowned(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof cursorQuery>,
    @Req() request: FastifyRequest,
  ) {
    const page = await this.#services.ownership.organizationUnowned(
      actorOf(request),
      organizationId,
      decodeCursor(query.cursor, nameCursor) ?? null,
    );
    return { items: page.items, hidden: page.hidden, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  @Get("spaces/:spaceId/page-statuses")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the page status values of a space",
    description: "Returns whether page status is turned on and the values editors can choose, in order.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The values.",
      schema: statusValuesSchema,
      example: { enabled: true, values: [exampleStatusValue] },
    },
  })
  async statuses(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return {
      enabled: await this.#services.pageStatus.enabled(spaceId),
      values: await this.#services.pageStatus.values(actorOf(request), spaceId),
    };
  }

  @Post("spaces/:spaceId/page-statuses")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Add a page status value",
    description: `Adds a value at the end of the list. A space can have up to ${MAX_PAGE_STATUS_VALUES} values.`,
    tags: [TAG],
    params: spaceParams,
    body: createStatusSchema,
    bodyExample: { name: "Outdated", color: "danger" },
    status: 201,
    response: { description: "The new value.", schema: statusValueSchema, example: exampleStatusValue },
    errors: ["invalidStatus", "statusExists", "tooManyStatusValues"],
  })
  async addStatus(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createStatusSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.pageStatus.add(actorOf(request), spaceId, body);
  }

  @Patch("spaces/:spaceId/page-statuses/:statusId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a page status value",
    description: "Renames a value or changes its color. Pages with the value show the change at once.",
    tags: [TAG],
    params: statusParams,
    body: updateStatusSchema,
    bodyExample: { name: "Approved" },
    response: { description: "The changed value.", schema: statusValueSchema, example: exampleStatusValue },
    errors: ["invalidStatus", "statusExists", "statusNotFound"],
  })
  async updateStatus(
    @Param("spaceId") spaceId: string,
    @Param("statusId") statusId: string,
    @Body() body: z.output<typeof updateStatusSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.pageStatus.update(actorOf(request), spaceId, statusId, body);
  }

  @Put("spaces/:spaceId/page-statuses/order")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Reorder the page status values",
    description: "Sets the order in which editors see the values.",
    tags: [TAG],
    params: spaceParams,
    body: orderSchema,
    bodyExample: { ids: [examplePageStatus.id] },
    response: {
      description: "The values in their new order.",
      schema: z.array(statusValueSchema).describe("The values."),
      example: [exampleStatusValue],
    },
    errors: ["invalidStatus"],
  })
  async reorder(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof orderSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.pageStatus.reorder(actorOf(request), spaceId, body.ids);
  }

  @Delete("spaces/:spaceId/page-statuses/:statusId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove a page status value",
    description:
      "Removes the value. Pages with it lose their status. Send the number of affected pages you confirmed; when it no longer matches, nothing is removed.",
    tags: [TAG],
    status: 204,
    params: statusParams,
    query: removeQuery,
    errors: ["statusInUse", "statusNotFound"],
  })
  async removeStatus(
    @Param("spaceId") spaceId: string,
    @Param("statusId") statusId: string,
    @Query() query: z.output<typeof removeQuery>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.pageStatus.remove(actorOf(request), spaceId, statusId, query.pages);
  }

  @Put("items/:itemId/status")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Set or remove the status of a page",
    description:
      "Sets the status of a page to a value of its space, or removes it. The status is not part of the content or its versions; the change appears in the page's activity.",
    tags: [TAG],
    params: itemParams,
    body: setStatusSchema,
    bodyExample: { statusId: examplePageStatus.id },
    response: {
      description: "The status now, or null.",
      schema: pageStatusSchema.nullable().describe("The status, or null."),
      example: examplePageStatus,
    },
    errors: ["invalidStatus", "statusDisabled", "statusNotFound"],
  })
  async setStatus(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof setStatusSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.pageStatus.set(actorOf(request), itemId, body.statusId);
  }

  @Get("items/:itemId/activity")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "List status and owner changes of an item",
    description: "Returns who changed the status or the owner of the item and when, newest first.",
    tags: [TAG],
    params: itemParams,
    response: {
      description: "The changes.",
      schema: activitySchema,
      example: [
        {
          type: "status",
          id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
          status: examplePageStatus,
          actor: examplePerson,
          at: "2026-10-05T08:00:00.000Z",
        },
      ],
    },
  })
  async activity(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    const viewer = actorOf(request);
    const [statuses, owners] = await Promise.all([
      this.#services.pageStatus.history(viewer, itemId),
      this.#services.ownership.history(viewer, itemId),
    ]);
    return [
      ...statuses.map((change) => ({
        type: "status" as const,
        id: change.id,
        status: change.removed ? null : change.status,
        actor: change.actor,
        at: change.changedAt,
      })),
      ...owners.map((change) => ({
        type: "owner" as const,
        id: change.id,
        previousOwner: change.previousOwner,
        owner: change.owner,
        actor: change.actor,
        at: change.changedAt,
      })),
    ].sort((left, right) => right.at.getTime() - left.at.getTime() || right.id.localeCompare(left.id));
  }
}
