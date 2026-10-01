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
import {
  accountPrincipal,
  breakGlassReasonSchema,
  domainSchema,
  emailSchema,
  groupDescriptionSchema,
  groupNameSchema,
  organizationNameSchema,
  organizationSettingsChain,
  roleNameSchema,
  slugSchema,
  supportedLanguages,
  timeZoneSchema,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { sessionOf } from "../http/request.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";
import { ZodPipe } from "../http/zod.pipe.js";

const organization = { type: "organization", param: "organizationId" } as const;
const id = z.uuid();
const expiry = z.iso
  .datetime()
  .transform((value) => new Date(value))
  .nullable()
  .optional();
const roleInput = z.union([
  z.object({ builtIn: z.enum(["owner", "administrator"]) }).strict(),
  z.object({ customRoleId: z.uuid() }).strict(),
]);

const createSchema = z
  .object({
    name: organizationNameSchema,
    slug: slugSchema.optional(),
    language: z.enum(supportedLanguages).optional(),
    timeZone: timeZoneSchema.optional(),
    ownerAccountId: z.uuid().optional(),
  })
  .strict();
const updateSchema = z
  .object({
    name: organizationNameSchema.optional(),
    slug: slugSchema.optional(),
    logoRef: z.string().trim().min(1).max(500).nullable().optional(),
    language: z.enum(supportedLanguages).optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .strict();
const domainBody = z.object({ domain: domainSchema }).strict();
const memberUpdateSchema = z
  .object({ expiresAt: expiry, responsibleAccountId: z.uuid().nullable().optional() })
  .strict();
const customRoleSchema = z.object({ name: roleNameSchema, areas: z.record(z.string(), z.string()) }).strict();
const customRoleUpdateSchema = z
  .object({ name: roleNameSchema.optional(), areas: z.record(z.string(), z.string()).optional() })
  .strict();
const assignmentSchema = z
  .object({
    role: roleInput,
    principal: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("account"), id: z.uuid() }).strict(),
      z.object({ kind: z.literal("group"), id: z.uuid() }).strict(),
      z.object({ kind: z.literal("organizationMembers") }).strict(),
      z.object({ kind: z.literal("instanceUsers") }).strict(),
    ]),
    expiresAt: expiry,
  })
  .strict();
const groupSchema = z
  .object({ name: groupNameSchema, description: groupDescriptionSchema.optional() })
  .strict();
const invitationSchema = z
  .object({
    email: emailSchema,
    kind: z.enum(["member", "collaborator", "guest"]),
    role: roleInput.nullable().optional(),
    membershipExpiresAt: expiry,
    responsibleAccountId: z.uuid().nullable().optional(),
  })
  .strict();
const breakGlassSchema = z.object({ reason: breakGlassReasonSchema }).strict();

function notFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: "notFound", message: "Not found" });
}

@Controller("api/v1/organizations")
@InternalRoute()
export class OrganizationsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  #actor(request: FastifyRequest) {
    return accountPrincipal(sessionOf(request).accountId);
  }

  @Get()
  @SessionRoute()
  async list(@Req() request: FastifyRequest) {
    return this.#services.organizations.listForAccount(sessionOf(request).accountId);
  }

  @Post()
  @Permission("instance.organizations.create")
  @HttpCode(201)
  async create(
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = this.#actor(request);
    const created = await this.#services.organizations.createAsActor(actor, {
      ...body,
      ownerAccountId: body.ownerAccountId ?? actor.id,
    });
    return this.#services.organizations.get(created.id);
  }

  @Get(":organizationId")
  @Permission("organization.view", organization)
  async get(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    const found = await this.#services.organizations.get(organizationId);
    if (!found) throw notFound();
    return found;
  }

  @Patch(":organizationId")
  @Permission("organization.update", organization)
  async update(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(updateSchema)) body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.organizations.update(this.#actor(request), organizationId, body);
  }

  @Get(":organizationId/domains")
  @Permission("organization.signIn.view", organization)
  async domains(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.organizations.domains(organizationId);
  }

  @Post(":organizationId/domains")
  @Permission("instance.organizations.manage")
  @HttpCode(201)
  async addDomain(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(domainBody)) body: z.output<typeof domainBody>,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.organizationExists(organizationId))) throw notFound();
    return {
      domain: await this.#services.organizations.addDomain(this.#actor(request), organizationId, body.domain),
    };
  }

  @Delete(":organizationId/domains/:domain")
  @Permission("instance.organizations.manage")
  @HttpCode(204)
  async removeDomain(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("domain", new ZodPipe(domainSchema)) domain: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.organizations.removeDomain(this.#actor(request), organizationId, domain))) {
      throw notFound();
    }
  }

  @Get(":organizationId/members")
  @Permission("organization.members.view", organization)
  async members(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.memberships.list(organizationId);
  }

  @Patch(":organizationId/members/:accountId")
  @Permission("organization.members.manage", organization)
  @HttpCode(204)
  async updateMember(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("accountId", new ZodPipe(id)) accountId: string,
    @Body(new ZodPipe(memberUpdateSchema)) body: z.output<typeof memberUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.memberships.update(this.#actor(request), organizationId, accountId, {
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      ...(body.responsibleAccountId !== undefined ? { responsibleAccountId: body.responsibleAccountId } : {}),
    });
    if (!updated) throw notFound();
  }

  @Delete(":organizationId/members/:accountId")
  @Permission("organization.members.manage", organization)
  @HttpCode(204)
  async removeMember(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("accountId", new ZodPipe(id)) accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.remove(this.#actor(request), organizationId, accountId)))
      throw notFound();
  }

  @Delete(":organizationId/membership")
  @Permission("organization.leave", organization)
  @HttpCode(204)
  async leave(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Req() request: FastifyRequest,
  ) {
    const actor = this.#actor(request);
    if (!(await this.#services.memberships.remove(actor, organizationId, actor.id, "left"))) throw notFound();
  }

  @Get(":organizationId/members/:accountId/permissions")
  @Permission("organization.members.manage", organization)
  async permissions(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("accountId", new ZodPipe(id)) accountId: string,
  ) {
    const actions = this.#services.authorization.registry
      .actions()
      .filter((action) => action.resourceType.type === "organization")
      .map((action) => action.name);
    return Promise.all(
      actions.map((action) =>
        this.#services.authorization.explain(accountPrincipal(accountId), action, {
          type: "organization",
          id: organizationId,
        }),
      ),
    );
  }

  @Get(":organizationId/roles")
  @Permission("organization.roles.view", organization)
  async roles(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.roles.listCustom("organization", organizationId);
  }

  @Post(":organizationId/roles")
  @Permission("organization.roles.manage", organization)
  @HttpCode(201)
  async createRole(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(customRoleSchema)) body: z.output<typeof customRoleSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.createCustom(this.#actor(request), "organization", organizationId, body);
  }

  @Patch(":organizationId/roles/:roleId")
  @Permission("organization.roles.manage", organization)
  async updateRole(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("roleId", new ZodPipe(id)) roleId: string,
    @Body(new ZodPipe(customRoleUpdateSchema)) body: z.output<typeof customRoleUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.updateCustom(
      this.#actor(request),
      "organization",
      organizationId,
      roleId,
      body,
    );
  }

  @Delete(":organizationId/roles/:roleId")
  @Permission("organization.roles.manage", organization)
  @HttpCode(204)
  async deleteRole(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("roleId", new ZodPipe(id)) roleId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.roles.deleteCustom(this.#actor(request), "organization", organizationId, roleId);
  }

  @Get(":organizationId/role-assignments")
  @Permission("organization.roles.view", organization)
  async assignments(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.roles.listAssignments("organization", organizationId);
  }

  @Post(":organizationId/role-assignments")
  @Permission("organization.roles.manage", organization)
  @HttpCode(201)
  async assign(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(assignmentSchema)) body: z.output<typeof assignmentSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.assign(this.#actor(request), {
      scope: "organization",
      organizationId,
      role: body.role,
      principal: { kind: body.principal.kind, id: "id" in body.principal ? body.principal.id : null },
      expiresAt: body.expiresAt ?? null,
    });
  }

  @Delete(":organizationId/role-assignments/:assignmentId")
  @Permission("organization.roles.manage", organization)
  @HttpCode(204)
  async unassign(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("assignmentId", new ZodPipe(id)) assignmentId: string,
    @Req() request: FastifyRequest,
  ) {
    if (
      !(await this.#services.roles.unassign(
        this.#actor(request),
        "organization",
        organizationId,
        assignmentId,
      ))
    ) {
      throw notFound();
    }
  }

  @Get(":organizationId/groups")
  @Permission("organization.groups.view", organization)
  async groups(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.groups.list(organizationId);
  }

  @Post(":organizationId/groups")
  @Permission("organization.groups.create", organization)
  @HttpCode(201)
  async createGroup(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(groupSchema)) body: z.output<typeof groupSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.groups.create(this.#actor(request), organizationId, body);
  }

  @Get(":organizationId/invitations")
  @Permission("organization.members.manage", organization)
  async invitations(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    return this.#services.invitations.list(organizationId);
  }

  @Post(":organizationId/invitations")
  @Permission("organization.members.manage", organization)
  @HttpCode(201)
  async invite(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(invitationSchema)) body: z.output<typeof invitationSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.invitations.create(this.#actor(request), organizationId, {
      email: body.email,
      kind: body.kind,
      role: body.role ?? null,
      membershipExpiresAt: body.membershipExpiresAt ?? null,
      ...(body.responsibleAccountId !== undefined ? { responsibleAccountId: body.responsibleAccountId } : {}),
    });
  }

  @Delete(":organizationId/invitations/:invitationId")
  @Permission("organization.members.manage", organization)
  @HttpCode(204)
  async revoke(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("invitationId", new ZodPipe(id)) invitationId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.invitations.revoke(this.#actor(request), organizationId, invitationId))) {
      throw notFound();
    }
  }

  @Get(":organizationId/settings")
  @Permission("organization.settings.view", organization)
  async settings(@Param("organizationId", new ZodPipe(id)) organizationId: string) {
    const { settings, settingsRegistry } = this.#settingsServices();
    return listSettings(
      settings,
      settingsRegistry,
      "organization",
      organizationSettingsChain(organizationId),
    );
  }

  @Put(":organizationId/settings/:key")
  @Permission("organization.settings.view", organization)
  @HttpCode(204)
  async updateSettings(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("key", new ZodPipe(z.string().max(200))) key: string,
    @Body(new ZodPipe(settingUpdateSchema)) body: z.output<typeof settingUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "organization");
    await this.#services.authorization.require(
      this.#actor(request),
      key.startsWith("auth.") ? "organization.signIn.manage" : "organization.settings.manage",
      { type: "organization", id: organizationId },
    );
    await updateSetting(
      settings,
      definition,
      "organization",
      organizationSettingsChain(organizationId),
      body,
    );
  }

  @Post(":organizationId/break-glass")
  @Permission("instance.breakGlass.request", { type: "instance" }, { recentAuthentication: true })
  @HttpCode(201)
  async breakGlass(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Body(new ZodPipe(breakGlassSchema)) body: z.output<typeof breakGlassSchema>,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.organizationExists(organizationId))) throw notFound();
    return this.#services.breakGlass.request(this.#actor(request), organizationId, body.reason);
  }

  @Delete(":organizationId/break-glass/:accessId")
  @Permission("instance.breakGlass.request")
  @HttpCode(204)
  async endBreakGlass(
    @Param("organizationId", new ZodPipe(id)) organizationId: string,
    @Param("accessId", new ZodPipe(id)) accessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.breakGlass.end(this.#actor(request), organizationId, accessId)))
      throw notFound();
  }

  #settingsServices() {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw new Error("The settings are not available");
    return { settings, settingsRegistry };
  }
}
