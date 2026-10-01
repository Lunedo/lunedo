import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { roleNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { pageQuerySchema, pageSchema, paginate } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  accountSchema,
  customRoleSchema,
  exampleAccount,
  exampleOrganization,
  exampleSetting,
  instanceAreasSchema,
  optionalExpiry,
  organizationSchema,
  roleAssignmentSchema,
  settingSchema,
  uuid,
} from "../http/schemas.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";

const TAG = "Instance";

const customRoleBody = z
  .object({
    name: roleNameSchema.describe("Name of the role, 1 to 100 characters, unique at the instance level."),
    areas: instanceAreasSchema,
  })
  .strict()
  .describe("A new instance role. Nobody can define a role with more than they hold themselves.");

const customRoleUpdateBody = z
  .object({
    name: roleNameSchema.optional().describe("New name of the role."),
    areas: instanceAreasSchema.optional().describe("New access levels. Replaces all areas."),
  })
  .strict()
  .describe("Fields to change.");

const roleParams = z.object({ roleId: uuid("ID of the instance role.") }).strict();
const assignmentParams = z.object({ assignmentId: uuid("ID of the role assignment.") }).strict();
const settingParams = z.object({ key: z.string().max(200).describe("Key of the setting.") }).strict();

const assignmentBody = z
  .object({
    role: z
      .union([
        z
          .object({
            builtIn: z
              .enum(["administrator", "securityAuditor"])
              .describe("Key of the built-in instance role."),
          })
          .strict()
          .describe("A built-in role."),
        z
          .object({ customRoleId: uuid("ID of an instance role.") })
          .strict()
          .describe("A custom role."),
      ])
      .describe("The role to give."),
    principal: z
      .discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("account").describe("One account."), id: uuid("ID of the account.") })
          .strict()
          .describe("An internal account."),
        z
          .object({ kind: z.literal("instanceUsers").describe("Every internal user.") })
          .strict()
          .describe("All internal users."),
      ])
      .describe("Who receives the role."),
    expiresAt: optionalExpiry("When the assignment ends."),
  })
  .strict()
  .describe("An instance role assignment.");

const ownershipSchema = z
  .object({ accountId: uuid("Account that becomes the instance owner.") })
  .strict()
  .describe("The new owner.");

const exampleInstanceRole = {
  id: "01929b1f-6fd3-7a07-a8d4-cfb1b29ce3f4",
  scope: "instance",
  organizationId: null,
  name: "Operators",
  areas: { operations: "manage", auditLog: "view" },
};

const exampleInstanceAssignment = {
  id: "01929b1f-80e4-7b18-b9e5-d0c2c3adf405",
  scope: "instance",
  organizationId: null,
  role: "securityAuditor",
  builtInRole: "securityAuditor",
  customRoleId: null,
  principalKind: "account",
  principalId: exampleAccount.id,
  expiresAt: null,
};

function settingPermission(key: string): string {
  if (key.startsWith("auth.")) return "instance.signIn.manage";
  if (key.startsWith("audit.")) return "instance.audit.manage";
  if (key.startsWith("organizations.")) return "instance.organizations.manage";
  return "instance.settings.manage";
}

const byName = (item: { name: string; id: string }) => [item.name.toLowerCase(), item.id];

@Controller("api/v1/instance")
export class InstanceController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("organizations")
  @Permission("instance.organizations.view")
  @ApiRoute({
    summary: "List all organizations",
    description: "Lists every organization of the instance.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Organizations of the instance.",
      schema: pageSchema(organizationSchema, "Organizations, ordered by name."),
      example: { items: [exampleOrganization], nextCursor: null },
    },
  })
  async organizations(@Query() query: z.output<typeof pageQuerySchema>) {
    return paginate(await this.#services.organizations.list(), byName, query);
  }

  @Get("accounts")
  @Permission("instance.accounts.view")
  @ApiRoute({
    summary: "List all accounts",
    description: "Lists every account of the instance, including service accounts.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Accounts of the instance.",
      schema: pageSchema(accountSchema, "Accounts, ordered by name."),
      example: { items: [exampleAccount], nextCursor: null },
    },
  })
  async accounts(@Query() query: z.output<typeof pageQuerySchema>) {
    return paginate(await this.#services.accounts.list(), byName, query);
  }

  @Get("roles")
  @Permission("instance.roles.view")
  @ApiRoute({
    summary: "List instance roles",
    description: "Lists the custom roles at the instance level. Built-in roles are not listed.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Custom instance roles.",
      schema: pageSchema(customRoleSchema, "Roles, ordered by name."),
      example: { items: [exampleInstanceRole], nextCursor: null },
    },
  })
  async roles(@Query() query: z.output<typeof pageQuerySchema>) {
    return paginate(await this.#services.roles.listCustom("instance", null), byName, query);
  }

  @Post("roles")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Create an instance role",
    description: "Defines an instance role from areas and access levels.",
    tags: [TAG],
    status: 201,
    body: customRoleBody,
    bodyExample: { name: "Operators", areas: { operations: "manage" } },
    response: { description: "The new role.", schema: customRoleSchema, example: exampleInstanceRole },
    errors: ["roleNameTaken"],
  })
  async createRole(@Body() body: z.output<typeof customRoleBody>, @Req() request: FastifyRequest) {
    return this.#services.roles.createCustom(actorOf(request), "instance", null, body);
  }

  @Patch("roles/:roleId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Change an instance role",
    description: "Renames an instance role or changes its areas.",
    tags: [TAG],
    params: roleParams,
    body: customRoleUpdateBody,
    bodyExample: { areas: { operations: "view" } },
    response: { description: "The changed role.", schema: customRoleSchema, example: exampleInstanceRole },
    errors: ["roleNotFound", "roleNameTaken"],
  })
  async updateRole(
    @Param("roleId") roleId: string,
    @Body() body: z.output<typeof customRoleUpdateBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.updateCustom(actorOf(request), "instance", null, roleId, body);
  }

  @Delete("roles/:roleId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Delete an instance role",
    description: "Deletes the role and all its assignments.",
    tags: [TAG],
    params: roleParams,
    errors: ["roleNotFound"],
  })
  async deleteRole(@Param("roleId") roleId: string, @Req() request: FastifyRequest) {
    await this.#services.roles.deleteCustom(actorOf(request), "instance", null, roleId);
  }

  @Get("role-assignments")
  @Permission("instance.roles.view")
  @ApiRoute({
    summary: "List instance role assignments",
    description: "Lists who holds which instance role.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Instance role assignments.",
      schema: pageSchema(roleAssignmentSchema, "Assignments, ordered by ID."),
      example: { items: [exampleInstanceAssignment], nextCursor: null },
    },
  })
  async assignments(@Query() query: z.output<typeof pageQuerySchema>) {
    const assignments = await this.#services.roles.listAssignments("instance", null);
    return paginate(assignments, (assignment) => [assignment.id], query);
  }

  @Post("role-assignments")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Assign an instance role",
    description: "Gives an instance role to an internal account or to all internal users.",
    tags: [TAG],
    status: 201,
    body: assignmentBody,
    bodyExample: {
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: exampleAccount.id },
    },
    response: {
      description: "The new assignment.",
      schema: roleAssignmentSchema,
      example: exampleInstanceAssignment,
    },
    errors: ["alreadyAssigned", "invalidPrincipal", "roleNotAssignable", "roleNotFound", "expiryInPast"],
  })
  async assign(@Body() body: z.output<typeof assignmentBody>, @Req() request: FastifyRequest) {
    return this.#services.roles.assign(actorOf(request), {
      scope: "instance",
      organizationId: null,
      role: body.role,
      principal: { kind: body.principal.kind, id: "id" in body.principal ? body.principal.id : null },
      expiresAt: body.expiresAt ?? null,
    });
  }

  @Delete("role-assignments/:assignmentId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Remove an instance role assignment",
    description: "Takes an instance role away. The permissions end at once.",
    tags: [TAG],
    params: assignmentParams,
  })
  async unassign(@Param("assignmentId") assignmentId: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.roles.unassign(actorOf(request), "instance", null, assignmentId))) {
      throw notFound();
    }
  }

  @Post("ownership")
  @Permission("instance.ownership.transfer", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Transfer instance ownership",
    tags: [TAG],
    body: ownershipSchema,
    errors: ["instanceOwner"],
  })
  async transferOwnership(@Body() body: z.output<typeof ownershipSchema>, @Req() request: FastifyRequest) {
    await this.#services.memberships.transferOwnership(actorOf(request), body.accountId);
  }

  @Get("settings")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "List instance settings",
    description: "Lists the settings at the instance level with their effective values.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Instance settings.",
      schema: pageSchema(settingSchema, "Settings, ordered by key."),
      example: { items: [exampleSetting], nextCursor: null },
    },
  })
  async settings(@Query() query: z.output<typeof pageQuerySchema>) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const listed = await listSettings(settings, settingsRegistry, "instance", {});
    return paginate(listed, (setting) => [setting.key], query);
  }

  @Put("settings/:key")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "Change an instance setting",
    description:
      "Sets, clears or locks an instance setting. Each setting needs the manage level of its area: sign-in, audit log, organizations or settings.",
    tags: [TAG],
    params: settingParams,
    body: settingUpdateSchema,
    bodyExample: { value: 30, locked: true },
    errors: ["invalidSetting", "settingManagedElsewhere"],
  })
  async updateSetting(
    @Param("key") key: string,
    @Body() body: z.output<typeof settingUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "instance");
    await this.#services.authorization.require(actorOf(request), settingPermission(key), {
      type: "instance",
    });
    await updateSetting(settings, definition, "instance", {}, body);
  }

  #settingsServices() {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw new Error("The settings are not available");
    return { settings, settingsRegistry };
  }
}
