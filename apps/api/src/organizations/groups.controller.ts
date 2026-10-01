import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import { groupDescriptionSchema, groupNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  exampleGroup,
  exampleGroupDetails,
  exampleMember,
  groupDetailsSchema,
  groupSchema,
  optionalExpiry,
  uuid,
} from "../http/schemas.js";

const TAG = "Groups";
const group = { type: "group", param: "groupId" } as const;
const groupParams = z.object({ groupId: uuid("ID of the group.") }).strict();
const accountParams = groupParams.extend({ accountId: uuid("ID of the account.") });

const updateSchema = z
  .object({
    name: groupNameSchema.optional().describe("New name, 1 to 100 characters, unique in the organization."),
    description: groupDescriptionSchema.optional().describe("New description, up to 1000 characters."),
  })
  .strict()
  .describe("Fields to change.");

const memberSchema = z
  .object({
    accountId: uuid("Account to add. It must be a member of the organization."),
    expiresAt: optionalExpiry("When the group membership ends."),
  })
  .strict()
  .describe("A new group member.");

const managerSchema = z
  .object({ accountId: uuid("Account that may manage the group's members.") })
  .strict()
  .describe("A new group manager.");

@Controller("api/v1/groups")
export class GroupsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get(":groupId")
  @Permission("group.view", group)
  @ApiRoute({
    summary: "Get a group",
    description: "Returns a group with its members and managers.",
    tags: [TAG],
    params: groupParams,
    response: { description: "The group.", schema: groupDetailsSchema, example: exampleGroupDetails },
  })
  async get(@Param("groupId") groupId: string) {
    const found = await this.#services.groups.get(groupId);
    if (!found) throw notFound();
    return found;
  }

  @Patch(":groupId")
  @Permission("group.manage", group)
  @ApiRoute({
    summary: "Change a group",
    description: "Renames a group or changes its description.",
    tags: [TAG],
    params: groupParams,
    body: updateSchema,
    bodyExample: { description: "Everyone who edits or reviews the handbook" },
    response: { description: "The changed group.", schema: groupSchema, example: exampleGroup },
    errors: ["groupNameTaken"],
  })
  async update(
    @Param("groupId") groupId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.groups.update(actorOf(request), groupId, body);
  }

  @Delete(":groupId")
  @Permission("group.delete", group)
  @ApiRoute({
    summary: "Delete a group",
    description: "Deletes the group. Roles given to the group end at once.",
    tags: [TAG],
    params: groupParams,
  })
  async delete(@Param("groupId") groupId: string, @Req() request: FastifyRequest) {
    await this.#services.groups.delete(actorOf(request), groupId);
  }

  @Post(":groupId/members")
  @Permission("group.manage", group)
  @ApiRoute({
    summary: "Add a group member",
    description: "Adds a member of the organization to the group, optionally until a date.",
    tags: [TAG],
    params: groupParams,
    body: memberSchema,
    bodyExample: { accountId: exampleMember.accountId },
    errors: ["notMember", "alreadyMember", "expiryInPast"],
  })
  async addMember(
    @Param("groupId") groupId: string,
    @Body() body: z.output<typeof memberSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.groups.addMember(actorOf(request), groupId, body.accountId, body.expiresAt ?? null);
  }

  @Delete(":groupId/members/:accountId")
  @Permission("group.manage", group)
  @ApiRoute({
    summary: "Remove a group member",
    description: "Removes the account from the group.",
    tags: [TAG],
    params: accountParams,
  })
  async removeMember(
    @Param("groupId") groupId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.groups.removeMember(actorOf(request), groupId, accountId))) throw notFound();
  }

  @Post(":groupId/managers")
  @Permission("group.manage", group)
  @ApiRoute({
    summary: "Add a group manager",
    description: "Lets a member of the organization manage the group's members.",
    tags: [TAG],
    params: groupParams,
    body: managerSchema,
    bodyExample: { accountId: exampleMember.accountId },
    errors: ["notMember"],
  })
  async addManager(
    @Param("groupId") groupId: string,
    @Body() body: z.output<typeof managerSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.groups.addManager(actorOf(request), groupId, body.accountId);
  }

  @Delete(":groupId/managers/:accountId")
  @Permission("group.manage", group)
  @ApiRoute({
    summary: "Remove a group manager",
    description: "Takes the management of the group away from the account.",
    tags: [TAG],
    params: accountParams,
  })
  async removeManager(
    @Param("groupId") groupId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.groups.removeManager(actorOf(request), groupId, accountId))) throw notFound();
  }
}
