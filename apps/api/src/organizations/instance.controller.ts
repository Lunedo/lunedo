import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import {
  accentColorSetting,
  instanceNameSetting,
  languageSetting,
  organizationSettingsChain,
  passwordMinLengthSetting,
  roleNameSchema,
  supportedLanguages,
} from "@pagehall/server";
import {
  accentColors,
  setupStepSchemas,
  smtpInputSchema,
  smtpTestInputSchema,
  smtpTestResultSchema,
} from "@pagehall/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import {
  idCursor,
  nameCursor,
  pageQuerySchema,
  pageRequest,
  pageSchema,
  paginate,
  toApiPage,
} from "../http/pagination.js";
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

const instanceInfoSchema = z.object({
  name: z.string(),
  setupComplete: z.boolean(),
  language: z.enum(supportedLanguages),
  accentColor: z.enum(accentColors),
  passwordMinLength: z.number().int(),
  selfRegistration: z.boolean(),
  organization: z
    .object({
      id: z.uuid(),
      name: z.string(),
      logoRef: z.string().nullable(),
      accentColor: z.enum(accentColors),
    })
    .nullable(),
});

const breakGlassEntrySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string(),
  accountId: z.uuid(),
  accountName: z.string(),
  reason: z.string(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

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
          .describe(
            "All internal users. Refused with `roleNeedsAccountOrGroup`: instance roles go to individual accounts only.",
          ),
      ])
      .describe("Who receives the role."),
    expiresAt: optionalExpiry("When the assignment ends."),
  })
  .strict()
  .describe("An instance role assignment.");

const batchAssignmentBody = z
  .object({
    role: assignmentBody.shape.role,
    principals: z
      .array(
        z
          .object({ kind: z.literal("account").describe("One account."), id: uuid("ID of the account.") })
          .strict()
          .describe("An internal account."),
      )
      .min(1)
      .max(50)
      .describe("Accounts that receive the role, 1 to 50."),
    expiresAt: optionalExpiry("When the assignments end."),
  })
  .strict()
  .describe("One instance role for several accounts. Either all assignments are made or none.");

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

  @Get("info")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Get public instance information",
    tags: [TAG],
    response: { description: "What the sign-in and setup pages show.", schema: instanceInfoSchema },
  })
  async info() {
    const { settings } = this.#settingsServices();
    const services = this.#services;
    const setupComplete = await services.setup.isComplete();
    const first = setupComplete ? await services.organizations.list({ limit: 2 }) : { items: [] };
    const only = first.items.length === 1 ? first.items[0] : undefined;
    return {
      name: await settings.get(instanceNameSetting, {}),
      setupComplete,
      language: await settings.get(languageSetting, {}),
      accentColor: await settings.get(accentColorSetting, {}),
      passwordMinLength: await settings.get(passwordMinLengthSetting, {}),
      selfRegistration: setupComplete ? await services.invitations.selfRegistrationOpen() : false,
      organization: only
        ? {
            id: only.id,
            name: only.name,
            logoRef: only.logoRef,
            accentColor: await settings.get(accentColorSetting, organizationSettingsChain(only.id)),
          }
        : null,
    };
  }

  @Get("break-glass")
  @Permission("instance.organizations.view")
  @InternalRoute()
  @ApiRoute({
    summary: "List recent break-glass access",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Break-glass access of the last 90 days, newest first.",
      schema: pageSchema(breakGlassEntrySchema, "Break-glass access, newest first."),
    },
  })
  async breakGlass(@Query() query: z.output<typeof pageQuerySchema>) {
    const entries = await this.#services.breakGlass.recent(90);
    return paginate(entries, (entry) => [-entry.startedAt.getTime(), entry.id], query);
  }

  @Get("mail")
  @Permission("instance.settings.view")
  @InternalRoute()
  @ApiRoute({
    summary: "Get the mail server",
    tags: [TAG],
    response: {
      description: "The SMTP configuration, without the password.",
      schema: setupStepSchemas.mail.details,
    },
  })
  async mail() {
    const mail = this.#services.mail;
    return { smtp: await mail.smtpConfiguration(), passwordSet: await mail.hasSmtpPassword() };
  }

  @Put("mail")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Configure the mail server",
    tags: [TAG],
    body: smtpInputSchema,
    errors: ["invalidSmtpConfiguration"],
  })
  async configureMail(@Body() body: z.output<typeof smtpInputSchema>) {
    const { password, ...configuration } = body;
    await this.#services.mail.configureSmtp(configuration, password);
  }

  @Post("mail/test")
  @Permission("instance.settings.manage")
  @InternalRoute()
  @ApiRoute({
    summary: "Send a test mail",
    tags: [TAG],
    status: 200,
    body: smtpTestInputSchema,
    response: { description: "Whether the mail server accepted the mail.", schema: smtpTestResultSchema },
    errors: ["invalidSmtpConfiguration"],
  })
  async testMail(@Body() body: z.output<typeof smtpTestInputSchema>) {
    const { to, language, password, ...configuration } = body;
    return this.#services.mail.sendTest(to, language, { configuration, password });
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
    return toApiPage(await this.#services.organizations.list(pageRequest(query, nameCursor)));
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
    return toApiPage(await this.#services.accounts.list(pageRequest(query, nameCursor)));
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
    return toApiPage(
      await this.#services.roles.listAssignments("instance", null, pageRequest(query, idCursor)),
    );
  }

  @Post("role-assignments")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Assign an instance role",
    description:
      "Gives an instance role to an internal account. Instance roles go to individual accounts only.",
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
    errors: [
      "alreadyAssigned",
      "invalidPrincipal",
      "roleNeedsAccountOrGroup",
      "roleNotAssignable",
      "roleNotFound",
      "expiryInPast",
    ],
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

  @Post("role-assignments/batch")
  @Permission("instance.roles.manage")
  @InternalRoute()
  @ApiRoute({
    summary: "Assign an instance role to several accounts",
    description:
      "Gives one instance role to several accounts at once. Either all assignments are made or none.",
    tags: [TAG],
    status: 201,
    body: batchAssignmentBody,
    response: {
      description: "The new assignments.",
      schema: z.object({ items: z.array(roleAssignmentSchema).describe("The new assignments.") }),
    },
    errors: ["alreadyAssigned", "invalidPrincipal", "roleNotAssignable", "roleNotFound", "expiryInPast"],
  })
  async assignMany(@Body() body: z.output<typeof batchAssignmentBody>, @Req() request: FastifyRequest) {
    const items = await this.#services.roles.assignMany(actorOf(request), {
      scope: "instance",
      organizationId: null,
      role: body.role,
      principals: body.principals,
      expiresAt: body.expiresAt ?? null,
    });
    return { items };
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
  @Permission([
    "instance.settings.manage",
    "instance.signIn.manage",
    "instance.audit.manage",
    "instance.organizations.manage",
  ])
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
