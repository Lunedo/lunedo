import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
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
import { actorOf, sessionOf } from "../http/request.js";
import {
  customRoleSchema,
  decisionSchema,
  exampleCustomRole,
  exampleDecision,
  exampleGroup,
  exampleInvitation,
  exampleMember,
  exampleOrganization,
  exampleRoleAssignment,
  exampleSetting,
  groupSchema,
  invitationSchema,
  memberSchema,
  optionalExpiry,
  organizationAreasSchema,
  organizationIdParams,
  organizationSchema,
  roleAssignmentSchema,
  settingSchema,
  timestamp,
  uuid,
} from "../http/schemas.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";

const TAG = "Organizations";
const MEMBERS = "Members";
const ROLES = "Roles";
const GROUPS = "Groups";
const SETTINGS = "Settings";

const organization = { type: "organization", param: "organizationId" } as const;

const roleInput = z
  .union([
    z
      .object({ builtIn: z.enum(["owner", "administrator"]).describe("Key of the built-in role.") })
      .strict()
      .describe("A built-in role."),
    z
      .object({ customRoleId: uuid("ID of a custom role of the organization.") })
      .strict()
      .describe("A custom role."),
  ])
  .describe("The role to give.");

const createSchema = z
  .object({
    name: organizationNameSchema.describe("Display name, 1 to 100 characters."),
    slug: slugSchema
      .optional()
      .describe("Short name used in addresses. Derived from the name when left out."),
    language: z
      .enum(supportedLanguages)
      .optional()
      .describe("Default language. The instance default when left out."),
    timeZone: timeZoneSchema
      .optional()
      .describe("Default IANA time zone. The instance default when left out."),
    ownerAccountId: uuid("Account that becomes owner. The caller when left out.").optional(),
  })
  .strict()
  .describe("A new organization.");

const updateSchema = z
  .object({
    name: organizationNameSchema.optional().describe("New display name, 1 to 100 characters."),
    slug: slugSchema.optional().describe("New short name used in addresses."),
    logoRef: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .optional()
      .describe("Reference to an uploaded logo, or null to remove it."),
    language: z.enum(supportedLanguages).optional().describe("New default language."),
    timeZone: timeZoneSchema.optional().describe("New default IANA time zone."),
  })
  .strict()
  .describe("Fields to change. Fields that are left out stay as they are.");

const domainBody = z
  .object({
    domain: domainSchema.describe("Domain such as `example.org`. Each domain belongs to one organization."),
  })
  .strict()
  .describe("A domain to add.");

const domainItem = z
  .object({ domain: z.string().describe("A domain of the organization.") })
  .describe("A domain.");

const memberParams = organizationIdParams.extend({ accountId: uuid("ID of the member's account.") });

const memberUpdateSchema = z
  .object({
    expiresAt: optionalExpiry("When the membership ends."),
    responsibleAccountId: uuid("Member responsible for a guest, or null.").nullable().optional(),
  })
  .strict()
  .describe("Fields to change.");

const customRoleBody = z
  .object({
    name: roleNameSchema.describe("Name of the role, 1 to 100 characters, unique in the organization."),
    areas: organizationAreasSchema,
  })
  .strict()
  .describe("A new custom role. Nobody can define a role with more than they hold themselves.");

const customRoleUpdateBody = z
  .object({
    name: roleNameSchema.optional().describe("New name of the role."),
    areas: organizationAreasSchema.optional().describe("New access levels. Replaces all areas."),
  })
  .strict()
  .describe("Fields to change.");

const roleParams = organizationIdParams.extend({ roleId: uuid("ID of the custom role.") });

const assignmentBody = z
  .object({
    role: roleInput,
    principal: z
      .discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("account").describe("One account."), id: uuid("ID of the account.") })
          .strict()
          .describe("An account, including service accounts."),
        z
          .object({
            kind: z.literal("group").describe("All members of a group."),
            id: uuid("ID of the group."),
          })
          .strict()
          .describe("A group."),
        z
          .object({ kind: z.literal("organizationMembers").describe("Every member of the organization.") })
          .strict()
          .describe("All members."),
        z
          .object({
            kind: z.literal("instanceUsers").describe("Every internal user of the instance who is a member."),
          })
          .strict()
          .describe("All internal users."),
      ])
      .describe("Who receives the role."),
    expiresAt: optionalExpiry("When the assignment ends."),
  })
  .strict()
  .describe("A role assignment. Nobody can give more than they hold themselves.");

const assignmentParams = organizationIdParams.extend({ assignmentId: uuid("ID of the role assignment.") });

const groupBody = z
  .object({
    name: groupNameSchema.describe("Name of the group, 1 to 100 characters, unique in the organization."),
    description: groupDescriptionSchema.optional().describe("Description, up to 1000 characters."),
  })
  .strict()
  .describe("A new group.");

const invitationBody = z
  .object({
    email: emailSchema.describe("Address to send the invitation to."),
    kind: z.enum(["member", "collaborator", "guest"]).describe("Kind of membership to grant."),
    role: roleInput.nullable().optional(),
    membershipExpiresAt: optionalExpiry("When the resulting membership ends."),
    responsibleAccountId: uuid("Member responsible for a guest. The caller when left out.")
      .nullable()
      .optional(),
  })
  .strict()
  .describe("A new invitation.");

const invitationParams = organizationIdParams.extend({ invitationId: uuid("ID of the invitation.") });
const settingParams = organizationIdParams.extend({
  key: z.string().max(200).describe("Key of the setting."),
});
const breakGlassBody = z
  .object({
    reason: breakGlassReasonSchema.describe(
      "Why access is needed, 10 to 2000 characters. Mailed to the owners.",
    ),
  })
  .strict()
  .describe("A break-glass request.");
const breakGlassParams = organizationIdParams.extend({ accessId: uuid("ID of the break-glass access.") });
const breakGlassSchema = z
  .object({
    id: uuid("ID of the access."),
    organizationId: uuid("ID of the organization."),
    accountId: uuid("Administrator who requested access."),
    reason: z.string().describe("Reason given."),
    startedAt: timestamp("When the access started."),
    expiresAt: timestamp("When the access ends at the latest."),
    endedAt: timestamp("When the access was ended early, or null.").nullable(),
  })
  .describe("Temporary administrator access.");

const byName = (item: { name: string; id: string }) => [item.name.toLowerCase(), item.id];

@Controller("api/v1/organizations")
export class OrganizationsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get()
  @SessionRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "List own organizations",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Organizations the caller belongs to.",
      schema: pageSchema(
        organizationSchema
          .extend({ membershipKind: z.string().describe("Kind of the caller's membership.") })
          .describe("An organization with the caller's membership."),
        "Organizations, ordered by name.",
      ),
    },
  })
  async list(@Req() request: FastifyRequest, @Query() query: z.output<typeof pageQuerySchema>) {
    const organizations = await this.#services.organizations.listForAccount(sessionOf(request).accountId);
    return paginate(organizations, byName, query);
  }

  @Post()
  @Permission("instance.organizations.create")
  @ApiRoute({
    summary: "Create an organization",
    description:
      "Creates an organization with an owner. The owner is the caller unless another account is named.",
    tags: [TAG],
    status: 201,
    body: createSchema,
    bodyExample: { name: "Example Inc.", language: "en", timeZone: "Europe/Vienna" },
    response: {
      description: "The new organization.",
      schema: organizationSchema,
      example: exampleOrganization,
    },
    errors: ["slugTaken"],
  })
  async create(@Body() body: z.output<typeof createSchema>, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    const created = await this.#services.organizations.createAsActor(actor, {
      ...body,
      ownerAccountId: body.ownerAccountId ?? actor.id,
    });
    return this.#services.organizations.get(created.id);
  }

  @Get(":organizationId")
  @Permission("organization.view", organization)
  @ApiRoute({
    summary: "Get an organization",
    description: "Returns an organization the caller is a member of.",
    tags: [TAG],
    params: organizationIdParams,
    response: { description: "The organization.", schema: organizationSchema, example: exampleOrganization },
  })
  async get(@Param("organizationId") organizationId: string) {
    const found = await this.#services.organizations.get(organizationId);
    if (!found) throw notFound();
    return found;
  }

  @Patch(":organizationId")
  @Permission("organization.update", organization)
  @ApiRoute({
    summary: "Change an organization",
    description: "Changes name, slug, logo, language or time zone.",
    tags: [TAG],
    params: organizationIdParams,
    body: updateSchema,
    bodyExample: { name: "Example Group" },
    response: {
      description: "The changed organization.",
      schema: organizationSchema,
      example: exampleOrganization,
    },
    errors: ["slugTaken"],
  })
  async update(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.organizations.update(actorOf(request), organizationId, body);
  }

  @Get(":organizationId/domains")
  @Permission("organization.signIn.view", organization)
  @ApiRoute({
    summary: "List domains",
    description: "Lists the e-mail domains of the organization. New accounts with these domains join it.",
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Domains of the organization.",
      schema: pageSchema(domainItem, "Domains, in alphabetical order."),
      example: { items: [{ domain: "example.org" }], nextCursor: null },
    },
  })
  async domains(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    const domains = await this.#services.organizations.domains(organizationId);
    return paginate(
      domains.map((domain) => ({ domain })),
      (item) => [item.domain],
      query,
    );
  }

  @Post(":organizationId/domains")
  @Permission("instance.organizations.manage")
  @ApiRoute({
    summary: "Add a domain",
    description:
      "Assigns an e-mail domain to the organization. Each domain belongs to at most one organization.",
    tags: [TAG],
    status: 201,
    params: organizationIdParams,
    body: domainBody,
    bodyExample: { domain: "example.org" },
    response: {
      description: "The added domain, normalized.",
      schema: domainItem,
      example: { domain: "example.org" },
    },
    errors: ["domainTaken"],
  })
  async addDomain(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof domainBody>,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.organizationExists(organizationId))) throw notFound();
    return {
      domain: await this.#services.organizations.addDomain(actorOf(request), organizationId, body.domain),
    };
  }

  @Delete(":organizationId/domains/:domain")
  @Permission("instance.organizations.manage")
  @ApiRoute({
    summary: "Remove a domain",
    description: "Removes an e-mail domain from the organization.",
    tags: [TAG],
    params: organizationIdParams.extend({ domain: domainSchema.describe("The domain to remove.") }),
  })
  async removeDomain(
    @Param("organizationId") organizationId: string,
    @Param("domain") domain: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.organizations.removeDomain(actorOf(request), organizationId, domain))) {
      throw notFound();
    }
  }

  @Get(":organizationId/members")
  @Permission("organization.members.view", organization)
  @ApiRoute({
    summary: "List members",
    description: "Lists members, collaborators and guests with their directly assigned roles.",
    tags: [MEMBERS],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Members of the organization.",
      schema: pageSchema(memberSchema, "Members, ordered by name."),
      example: { items: [exampleMember], nextCursor: null },
    },
  })
  async members(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(await this.#services.memberships.list(organizationId, pageRequest(query, nameCursor)));
  }

  @Patch(":organizationId/members/:accountId")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "Change a membership",
    description: "Changes when a membership ends or who is responsible for a guest.",
    tags: [MEMBERS],
    params: memberParams,
    body: memberUpdateSchema,
    bodyExample: { expiresAt: "2026-12-31T23:59:59Z" },
    errors: ["expiryInPast", "invalidResponsible"],
  })
  async updateMember(
    @Param("organizationId") organizationId: string,
    @Param("accountId") accountId: string,
    @Body() body: z.output<typeof memberUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.memberships.update(actorOf(request), organizationId, accountId, {
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      ...(body.responsibleAccountId !== undefined ? { responsibleAccountId: body.responsibleAccountId } : {}),
    });
    if (!updated) throw notFound();
  }

  @Delete(":organizationId/members/:accountId")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "Remove a member",
    description: "Removes the account from the organization with its roles and group memberships.",
    tags: [MEMBERS],
    params: memberParams,
    errors: ["lastOwner", "homeOrganization"],
  })
  async removeMember(
    @Param("organizationId") organizationId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.remove(actorOf(request), organizationId, accountId))) {
      throw notFound();
    }
  }

  @Delete(":organizationId/membership")
  @Permission("organization.leave", organization)
  @InternalRoute()
  @ApiRoute({
    summary: "Leave an organization",
    tags: [MEMBERS],
    params: organizationIdParams,
    errors: ["lastOwner", "homeOrganization"],
  })
  async leave(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    if (!(await this.#services.memberships.remove(actor, organizationId, actor.id, "left"))) throw notFound();
  }

  @Get(":organizationId/members/:accountId/permissions")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "Explain a member's permissions",
    description: "Shows for every organization action whether the member may perform it, and why.",
    tags: [MEMBERS],
    params: memberParams,
    response: {
      description: "One decision per action.",
      schema: z.array(decisionSchema).describe("Decisions, one per organization action."),
      example: [exampleDecision],
    },
  })
  async permissions(@Param("organizationId") organizationId: string, @Param("accountId") accountId: string) {
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
  @ApiRoute({
    summary: "List custom roles",
    description: "Lists the roles defined in the organization. Built-in roles are not listed.",
    tags: [ROLES],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Custom roles of the organization.",
      schema: pageSchema(customRoleSchema, "Roles, ordered by name."),
      example: { items: [exampleCustomRole], nextCursor: null },
    },
  })
  async roles(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return paginate(await this.#services.roles.listCustom("organization", organizationId), byName, query);
  }

  @Post(":organizationId/roles")
  @Permission("organization.roles.manage", organization)
  @ApiRoute({
    summary: "Create a custom role",
    description: "Defines a role from areas and access levels.",
    tags: [ROLES],
    status: 201,
    params: organizationIdParams,
    body: customRoleBody,
    bodyExample: { name: "Handbook editors", areas: { spaces: "manage" } },
    response: { description: "The new role.", schema: customRoleSchema, example: exampleCustomRole },
    errors: ["roleNameTaken"],
  })
  async createRole(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof customRoleBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.createCustom(actorOf(request), "organization", organizationId, body);
  }

  @Patch(":organizationId/roles/:roleId")
  @Permission("organization.roles.manage", organization)
  @ApiRoute({
    summary: "Change a custom role",
    description: "Renames a role or changes its areas. Holders get the new permissions at once.",
    tags: [ROLES],
    params: roleParams,
    body: customRoleUpdateBody,
    bodyExample: { areas: { spaces: "view" } },
    response: { description: "The changed role.", schema: customRoleSchema, example: exampleCustomRole },
    errors: ["roleNotFound", "roleNameTaken"],
  })
  async updateRole(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Body() body: z.output<typeof customRoleUpdateBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.updateCustom(actorOf(request), "organization", organizationId, roleId, body);
  }

  @Delete(":organizationId/roles/:roleId")
  @Permission("organization.roles.manage", organization)
  @ApiRoute({
    summary: "Delete a custom role",
    description: "Deletes the role and all its assignments.",
    tags: [ROLES],
    params: roleParams,
    errors: ["roleNotFound"],
  })
  async deleteRole(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.roles.deleteCustom(actorOf(request), "organization", organizationId, roleId);
  }

  @Get(":organizationId/role-assignments")
  @Permission("organization.roles.view", organization)
  @ApiRoute({
    summary: "List role assignments",
    description: "Lists who holds which role in the organization.",
    tags: [ROLES],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Role assignments of the organization.",
      schema: pageSchema(roleAssignmentSchema, "Assignments, ordered by ID."),
      example: { items: [exampleRoleAssignment], nextCursor: null },
    },
  })
  async assignments(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(
      await this.#services.roles.listAssignments(
        "organization",
        organizationId,
        pageRequest(query, idCursor),
      ),
    );
  }

  @Post(":organizationId/role-assignments")
  @Permission("organization.roles.manage", organization)
  @ApiRoute({
    summary: "Assign a role",
    description: "Gives a role to an account, a group, all members or all internal users.",
    tags: [ROLES],
    status: 201,
    params: organizationIdParams,
    body: assignmentBody,
    bodyExample: {
      role: { customRoleId: exampleCustomRole.id },
      principal: { kind: "group", id: exampleGroup.id },
    },
    response: {
      description: "The new assignment.",
      schema: roleAssignmentSchema,
      example: exampleRoleAssignment,
    },
    errors: [
      "alreadyAssigned",
      "invalidPrincipal",
      "roleNotAssignable",
      "roleNotFound",
      "expiryInPast",
      "ownerExpiry",
    ],
  })
  async assign(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof assignmentBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.assign(actorOf(request), {
      scope: "organization",
      organizationId,
      role: body.role,
      principal: { kind: body.principal.kind, id: "id" in body.principal ? body.principal.id : null },
      expiresAt: body.expiresAt ?? null,
    });
  }

  @Delete(":organizationId/role-assignments/:assignmentId")
  @Permission("organization.roles.manage", organization)
  @ApiRoute({
    summary: "Remove a role assignment",
    description: "Takes a role away. The permissions end at once.",
    tags: [ROLES],
    params: assignmentParams,
    errors: ["lastOwner"],
  })
  async unassign(
    @Param("organizationId") organizationId: string,
    @Param("assignmentId") assignmentId: string,
    @Req() request: FastifyRequest,
  ) {
    if (
      !(await this.#services.roles.unassign(actorOf(request), "organization", organizationId, assignmentId))
    ) {
      throw notFound();
    }
  }

  @Get(":organizationId/groups")
  @Permission("organization.groups.view", organization)
  @ApiRoute({
    summary: "List groups",
    description: "Lists the groups of the organization.",
    tags: [GROUPS],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Groups of the organization.",
      schema: pageSchema(groupSchema, "Groups, ordered by name."),
      example: { items: [exampleGroup], nextCursor: null },
    },
  })
  async groups(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(await this.#services.groups.list(organizationId, pageRequest(query, nameCursor)));
  }

  @Post(":organizationId/groups")
  @Permission("organization.groups.create", organization)
  @ApiRoute({
    summary: "Create a group",
    description: "Creates a group. The creator becomes its manager.",
    tags: [GROUPS],
    status: 201,
    params: organizationIdParams,
    body: groupBody,
    bodyExample: { name: "Editors", description: "Everyone who edits the handbook" },
    response: { description: "The new group.", schema: groupSchema, example: exampleGroup },
    errors: ["groupNameTaken"],
  })
  async createGroup(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof groupBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.groups.create(actorOf(request), organizationId, body);
  }

  @Get(":organizationId/invitations")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "List invitations",
    description: "Lists invitations that were neither accepted nor revoked.",
    tags: [MEMBERS],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Pending invitations.",
      schema: pageSchema(invitationSchema, "Invitations, ordered by e-mail address."),
      example: { items: [exampleInvitation], nextCursor: null },
    },
  })
  async invitations(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(await this.#services.invitations.list(organizationId, pageRequest(query, nameCursor)));
  }

  @Post(":organizationId/invitations")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "Invite someone",
    description: "Sends an invitation by e-mail. The link works once and expires.",
    tags: [MEMBERS],
    status: 201,
    params: organizationIdParams,
    body: invitationBody,
    bodyExample: { email: "grace@example.org", kind: "member" },
    response: { description: "The new invitation.", schema: invitationSchema, example: exampleInvitation },
    errors: ["alreadyMember", "invalidResponsible", "roleNotFound", "expiryInPast"],
  })
  async invite(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof invitationBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.invitations.create(actorOf(request), organizationId, {
      email: body.email,
      kind: body.kind,
      role: body.role ?? null,
      membershipExpiresAt: body.membershipExpiresAt ?? null,
      ...(body.responsibleAccountId !== undefined ? { responsibleAccountId: body.responsibleAccountId } : {}),
    });
  }

  @Delete(":organizationId/invitations/:invitationId")
  @Permission("organization.members.manage", organization)
  @ApiRoute({
    summary: "Revoke an invitation",
    description: "Makes the invitation link stop working.",
    tags: [MEMBERS],
    params: invitationParams,
  })
  async revoke(
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.invitations.revoke(actorOf(request), organizationId, invitationId))) {
      throw notFound();
    }
  }

  @Get(":organizationId/settings")
  @Permission("organization.settings.view", organization)
  @ApiRoute({
    summary: "List settings",
    description: "Lists the settings that can be set for the organization, with their effective values.",
    tags: [SETTINGS],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Settings of the organization.",
      schema: pageSchema(settingSchema, "Settings, ordered by key."),
      example: { items: [exampleSetting], nextCursor: null },
    },
  })
  async settings(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const listed = await listSettings(
      settings,
      settingsRegistry,
      "organization",
      organizationSettingsChain(organizationId),
    );
    return paginate(listed, (setting) => [setting.key], query);
  }

  @Put(":organizationId/settings/:key")
  @Permission(["organization.settings.manage", "organization.signIn.manage"], organization)
  @ApiRoute({
    summary: "Change a setting",
    description:
      "Sets, clears or locks a setting for the organization. Sign-in settings need the sign-in and security area, all others the settings area.",
    tags: [SETTINGS],
    params: settingParams,
    body: settingUpdateSchema,
    bodyExample: { value: true },
    errors: ["invalidSetting", "settingLocked", "settingManagedElsewhere"],
  })
  async updateSettings(
    @Param("organizationId") organizationId: string,
    @Param("key") key: string,
    @Body() body: z.output<typeof settingUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "organization");
    await this.#services.authorization.require(
      actorOf(request),
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
  @InternalRoute()
  @ApiRoute({
    summary: "Request break-glass access",
    tags: [TAG],
    status: 201,
    params: organizationIdParams,
    body: breakGlassBody,
    response: { description: "The access.", schema: breakGlassSchema },
  })
  async breakGlass(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof breakGlassBody>,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.memberships.organizationExists(organizationId))) throw notFound();
    return this.#services.breakGlass.request(actorOf(request), organizationId, body.reason);
  }

  @Delete(":organizationId/break-glass/:accessId")
  @Permission("instance.breakGlass.request", { type: "instance" }, { sessionOnly: true })
  @InternalRoute()
  @ApiRoute({ summary: "End break-glass access", tags: [TAG], params: breakGlassParams })
  async endBreakGlass(
    @Param("organizationId") organizationId: string,
    @Param("accessId") accessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.breakGlass.end(actorOf(request), organizationId, accessId))) throw notFound();
  }

  #settingsServices() {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw new Error("The settings are not available");
    return { settings, settingsRegistry };
  }
}
