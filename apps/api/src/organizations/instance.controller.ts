import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { accountPrincipal, roleNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { sessionOf } from "../http/request.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";
import { ZodPipe } from "../http/zod.pipe.js";

const id = z.uuid();
const customRoleSchema = z.object({ name: roleNameSchema, areas: z.record(z.string(), z.string()) }).strict();
const customRoleUpdateSchema = z
  .object({ name: roleNameSchema.optional(), areas: z.record(z.string(), z.string()).optional() })
  .strict();
const assignmentSchema = z
  .object({
    role: z.union([
      z.object({ builtIn: z.enum(["administrator", "securityAuditor"]) }).strict(),
      z.object({ customRoleId: z.uuid() }).strict(),
    ]),
    principal: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("account"), id: z.uuid() }).strict(),
      z.object({ kind: z.literal("instanceUsers") }).strict(),
    ]),
    expiresAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .nullable()
      .optional(),
  })
  .strict();
const ownershipSchema = z.object({ accountId: z.uuid() }).strict();

function settingPermission(key: string): string {
  if (key.startsWith("auth.")) return "instance.signIn.manage";
  if (key.startsWith("audit.")) return "instance.audit.manage";
  if (key.startsWith("organizations.")) return "instance.organizations.manage";
  return "instance.settings.manage";
}

function notFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: "notFound", message: "Not found" });
}

@Controller("api/v1/instance")
@InternalRoute()
export class InstanceController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  #actor(request: FastifyRequest) {
    return accountPrincipal(sessionOf(request).accountId);
  }

  @Get("organizations")
  @Permission("instance.organizations.view")
  async organizations() {
    return this.#services.organizations.list();
  }

  @Get("accounts")
  @Permission("instance.accounts.view")
  async accounts() {
    return this.#services.accounts.list();
  }

  @Get("roles")
  @Permission("instance.roles.view")
  async roles() {
    return this.#services.roles.listCustom("instance", null);
  }

  @Post("roles")
  @Permission("instance.roles.manage")
  @HttpCode(201)
  async createRole(
    @Body(new ZodPipe(customRoleSchema)) body: z.output<typeof customRoleSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.createCustom(this.#actor(request), "instance", null, body);
  }

  @Patch("roles/:roleId")
  @Permission("instance.roles.manage")
  async updateRole(
    @Param("roleId", new ZodPipe(id)) roleId: string,
    @Body(new ZodPipe(customRoleUpdateSchema)) body: z.output<typeof customRoleUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.updateCustom(this.#actor(request), "instance", null, roleId, body);
  }

  @Delete("roles/:roleId")
  @Permission("instance.roles.manage")
  @HttpCode(204)
  async deleteRole(@Param("roleId", new ZodPipe(id)) roleId: string, @Req() request: FastifyRequest) {
    await this.#services.roles.deleteCustom(this.#actor(request), "instance", null, roleId);
  }

  @Get("role-assignments")
  @Permission("instance.roles.view")
  async assignments() {
    return this.#services.roles.listAssignments("instance", null);
  }

  @Post("role-assignments")
  @Permission("instance.roles.manage")
  @HttpCode(201)
  async assign(
    @Body(new ZodPipe(assignmentSchema)) body: z.output<typeof assignmentSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.assign(this.#actor(request), {
      scope: "instance",
      organizationId: null,
      role: body.role,
      principal: { kind: body.principal.kind, id: "id" in body.principal ? body.principal.id : null },
      expiresAt: body.expiresAt ?? null,
    });
  }

  @Delete("role-assignments/:assignmentId")
  @Permission("instance.roles.manage")
  @HttpCode(204)
  async unassign(
    @Param("assignmentId", new ZodPipe(id)) assignmentId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.roles.unassign(this.#actor(request), "instance", null, assignmentId))) {
      throw notFound();
    }
  }

  @Post("ownership")
  @Permission("instance.ownership.transfer", { type: "instance" }, { recentAuthentication: true })
  @HttpCode(204)
  async transferOwnership(
    @Body(new ZodPipe(ownershipSchema)) body: z.output<typeof ownershipSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.memberships.transferOwnership(this.#actor(request), body.accountId);
  }

  @Get("settings")
  @Permission("instance.settings.view")
  async settings() {
    const { settings, settingsRegistry } = this.#settingsServices();
    return listSettings(settings, settingsRegistry, "instance", {});
  }

  @Put("settings/:key")
  @Permission("instance.settings.view")
  @HttpCode(204)
  async updateSetting(
    @Param("key", new ZodPipe(z.string().max(200))) key: string,
    @Body(new ZodPipe(settingUpdateSchema)) body: z.output<typeof settingUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "instance");
    await this.#services.authorization.require(this.#actor(request), settingPermission(key), {
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
