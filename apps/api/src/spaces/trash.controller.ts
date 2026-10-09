import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { ERASURE_REASON_MAX_LENGTH, type TrashEntry } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { exampleTrashEntry, trashEntrySchema } from "./schemas.js";

const TAG = "Trash";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const spaceEntryParams = spaceParams.extend({ entryId: uuid("ID of the trash entry.") });
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const organizationEntryParams = organizationParams.extend({ entryId: uuid("ID of the trash entry.") });
const entryParams = z.object({ entryId: uuid("ID of the trash entry.") }).strict();
const personalSpaceParams = z.object({ spaceId: uuid("ID of the personal space.") }).strict();

const restoreResultSchema = z
  .object({
    itemId: uuid("The restored item, or null for a space.").nullable(),
    parentId: uuid("Where the item went: its parent, or null for the top level.").nullable(),
  })
  .describe("Where the restored content went.");

const reasonSchema = z
  .object({
    reason: z
      .string()
      .max(ERASURE_REASON_MAX_LENGTH * 2)
      .describe(
        `Why the content must be deleted at once, for example a legal erasure request. 1 to ${ERASURE_REASON_MAX_LENGTH} characters; it goes into the audit log.`,
      ),
  })
  .strict()
  .describe("The reason for deleting permanently at once.");

const confirmationSchema = z
  .object({
    confirmation: z
      .string()
      .max(200)
      .describe("The name of the space, typed exactly; for a personal space without a name, its key."),
  })
  .strict()
  .describe("Confirmation of the deletion.");

const archivedSchema = z
  .object({ archived: z.boolean().describe("True to archive the space, false to bring it back.") })
  .strict()
  .describe("The archive state of the space.");

const entries = z.array(trashEntrySchema).describe("Trash entries.");

@Controller("api/v1")
export class TrashController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #entryIn(
    entryId: string,
    check: (
      entry: TrashEntry,
      organizationId: string | null,
      personal: boolean,
      confidential: boolean,
    ) => boolean,
  ) {
    const located = await this.#services.trash.spaceOf(entryId);
    const entry = await this.#services.trash.get(entryId);
    if (!located || !entry || !check(entry, located.organizationId, located.personal, located.confidential)) {
      throw notFound();
    }
    return entry;
  }

  @Get("spaces/:spaceId/trash")
  @Permission("space.trash", space)
  @ApiRoute({
    summary: "List the trash of a space",
    description:
      "Lists deleted pages, folders and links still in the space trash, newest first, with who deleted them and when they will be removed for good. In a confidential space, its space admins also get the entries of the second stage, which only they can restore.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "Trash entries.", schema: entries, example: [exampleTrashEntry] },
  })
  async spaceTrash(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    const entries = await this.#services.trash.listSpace(actor, spaceId);
    if (!(await this.#confidentialAdministrator(actor, spaceId))) return entries;
    return [...entries, ...(await this.#services.trash.listSpace(actor, spaceId, { secondStage: true }))];
  }

  async #confidentialAdministrator(actor: ReturnType<typeof actorOf>, spaceId: string): Promise<boolean> {
    const found = await this.#services.spaces.get(spaceId);
    if (!found?.confidential) return false;
    return this.#services.authorization.authorize(actor, "space.manage", { type: "space", id: spaceId });
  }

  @Post("spaces/:spaceId/trash/:entryId/restore")
  @Permission("space.trash", space)
  @ApiRoute({
    summary: "Restore from the trash",
    description:
      "Puts a trash entry back at its old place, or at the top level of the space when that place no longer exists.",
    tags: [TAG],
    status: 200,
    params: spaceEntryParams,
    response: {
      description: "Where it went.",
      schema: restoreResultSchema,
      example: { itemId: exampleTrashEntry.itemId, parentId: null },
    },
  })
  async restoreInSpace(
    @Param("spaceId") spaceId: string,
    @Param("entryId") entryId: string,
    @Req() request: FastifyRequest,
  ) {
    const secondStage = await this.#confidentialAdministrator(actorOf(request), spaceId);
    await this.#entryIn(
      entryId,
      (entry) => entry.spaceId === spaceId && entry.kind === "items" && (entry.stage === 1 || secondStage),
    );
    if (!(await this.#services.trash.accessible(actorOf(request), entryId))) throw notFound();
    return this.#services.trash.restore(actorOf(request), entryId);
  }

  @Post("spaces/:spaceId/trash/empty")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Empty the trash of a space",
    description:
      "Moves every entry of the space trash to the second stage. Organization administrators can still restore them until the second period ends.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    response: {
      description: "Number of entries moved.",
      schema: z
        .object({ entries: z.number().int().describe("Entries moved to the second stage.") })
        .describe("The result."),
      example: { entries: 3 },
    },
  })
  async empty(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return { entries: await this.#services.trash.empty(actorOf(request), spaceId) };
  }

  @Post("spaces/:spaceId/delete")
  @Permission("space.delete", space)
  @ApiRoute({
    summary: "Delete a space",
    description:
      "Deletes the space with all its content. It goes directly to the second stage of the trash; organization administrators can restore it until that period ends. Requires typing the name of the space.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: confirmationSchema,
    bodyExample: { confirmation: "IT Operations" },
    response: {
      description: "The trash entry of the space.",
      schema: trashEntrySchema,
      example: { ...exampleTrashEntry, kind: "space", itemId: null, itemKind: null, stage: 2 },
    },
    errors: ["confirmationMismatch"],
  })
  async deleteSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof confirmationSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.trash.deleteSpace(actorOf(request), spaceId, body.confirmation);
  }

  @Put("spaces/:spaceId/archived")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Archive a space or bring it back",
    description:
      "An archived space is read-only and no longer appears in the default list of spaces. Its content keeps its versions and links.",
    tags: [TAG],
    params: spaceParams,
    body: archivedSchema,
    bodyExample: { archived: true },
  })
  async archiveSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof archivedSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.archive.setSpaceArchived(actorOf(request), spaceId, body.archived);
  }

  @Get("organizations/:organizationId/trash")
  @Permission("organization.trash.manage", organization)
  @ApiRoute({
    summary: "List deleted content of an organization",
    description:
      "Lists all trash entries of the organization's spaces, both stages, and deleted spaces. Only organization administrators can restore entries of the second stage. Confidential spaces are left out.",
    tags: [TAG],
    params: organizationParams,
    response: {
      description: "Trash entries.",
      schema: entries,
      example: [{ ...exampleTrashEntry, stage: 2 }],
    },
  })
  async organizationTrash(@Param("organizationId") organizationId: string) {
    return this.#services.trash.listOrganization(organizationId);
  }

  @Post("organizations/:organizationId/trash/:entryId/restore")
  @Permission("organization.trash.manage", organization)
  @ApiRoute({
    summary: "Restore deleted content of an organization",
    description:
      "Restores a trash entry of either stage or a deleted space. Items return to their old place or the top level of their space. Confidential spaces are not reachable here; only their own space admins restore their content.",
    tags: [TAG],
    status: 200,
    params: organizationEntryParams,
    response: {
      description: "Where it went.",
      schema: restoreResultSchema,
      example: { itemId: null, parentId: null },
    },
  })
  async restoreInOrganization(
    @Param("organizationId") organizationId: string,
    @Param("entryId") entryId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#entryIn(
      entryId,
      (_entry, owner, _personal, confidential) => owner === organizationId && !confidential,
    );
    return this.#services.trash.restore(actorOf(request), entryId);
  }

  @Post("organizations/:organizationId/trash/:entryId/delete")
  @Permission("organization.trash.manage", organization, { recentAuthentication: true })
  @ApiRoute({
    summary: "Delete content permanently at once",
    description:
      "Deletes a trash entry or a deleted space permanently without waiting for the retention periods, for example for a legal erasure request. Requires a reason, which goes into the audit log. This cannot be undone.",
    tags: [TAG],
    params: organizationEntryParams,
    body: reasonSchema,
    bodyExample: { reason: "Erasure request of 6 Oct 2026, ticket 4711" },
    errors: ["reasonRequired"],
  })
  async deleteInOrganization(
    @Param("organizationId") organizationId: string,
    @Param("entryId") entryId: string,
    @Body() body: z.output<typeof reasonSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#entryIn(
      entryId,
      (_entry, owner, _personal, confidential) => owner === organizationId && !confidential,
    );
    await this.#services.trash.deleteImmediately(actorOf(request), entryId, body.reason);
  }

  @Post("instance/personal-spaces/:spaceId/delete")
  @Permission("instance.personalSpaces.manage", { type: "instance" })
  @ApiRoute({
    summary: "Delete a personal space",
    description:
      "Deletes a personal space under review. It goes to the second stage of the trash; instance administrators can restore it until that period ends. Requires typing its name or, without a name, its key.",
    tags: [TAG],
    status: 200,
    params: personalSpaceParams,
    body: confirmationSchema,
    bodyExample: { confirmation: "~K7Q2" },
    response: {
      description: "The trash entry of the space.",
      schema: trashEntrySchema,
      example: { ...exampleTrashEntry, kind: "space", itemId: null, itemKind: null, stage: 2 },
    },
    errors: ["confirmationMismatch"],
  })
  async deletePersonalSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof confirmationSchema>,
    @Req() request: FastifyRequest,
  ) {
    const found = await this.#services.spaces.get(spaceId);
    if (!found?.personal) throw notFound();
    return this.#services.trash.deleteSpace(actorOf(request), spaceId, body.confirmation);
  }

  @Get("instance/personal-spaces/trash")
  @Permission("instance.personalSpaces.manage", { type: "instance" })
  @ApiRoute({
    summary: "List deleted personal spaces",
    description:
      "Lists deleted personal spaces and content of personal spaces in the second stage of the trash, as long as they can be restored.",
    tags: [TAG],
    response: { description: "Trash entries.", schema: entries, example: [] },
  })
  async personalTrash() {
    return this.#services.trash.listPersonal();
  }

  @Post("instance/personal-spaces/trash/:entryId/restore")
  @Permission("instance.personalSpaces.manage", { type: "instance" })
  @ApiRoute({
    summary: "Restore a deleted personal space",
    description: "Restores a deleted personal space with its content.",
    tags: [TAG],
    status: 200,
    params: entryParams,
    response: {
      description: "The result.",
      schema: restoreResultSchema,
      example: { itemId: null, parentId: null },
    },
  })
  async restorePersonal(@Param("entryId") entryId: string, @Req() request: FastifyRequest) {
    await this.#entryIn(
      entryId,
      (entry, _owner, personal) => personal && (entry.kind === "space" || entry.stage === 2),
    );
    return this.#services.trash.restore(actorOf(request), entryId);
  }

  @Post("instance/personal-spaces/trash/:entryId/delete")
  @Permission("instance.personalSpaces.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Delete a personal space permanently at once",
    description:
      "Deletes a deleted personal space permanently without waiting for the retention period. Requires a reason, which goes into the audit log.",
    tags: [TAG],
    params: entryParams,
    body: reasonSchema,
    bodyExample: { reason: "Erasure request of 6 Oct 2026" },
    errors: ["reasonRequired"],
  })
  async deletePersonal(
    @Param("entryId") entryId: string,
    @Body() body: z.output<typeof reasonSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#entryIn(
      entryId,
      (entry, _owner, personal) => personal && (entry.kind === "space" || entry.stage === 2),
    );
    await this.#services.trash.deleteImmediately(actorOf(request), entryId, body.reason);
  }
}
