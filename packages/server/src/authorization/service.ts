import { type SQL, sql } from "drizzle-orm";
import type { Principal, TokenGrant } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor } from "../database/database.js";
import type { BuiltInRoleKey, PrincipalKind, RoleScope } from "../organizations/access-schema.js";
import { grantsSpaceRole } from "../spaces/roles.js";
import type { SpaceRole } from "../spaces/schema.js";
import {
  type Areas,
  builtInRoleAreas,
  coversAreas,
  grantsLevel,
  intersectAreas,
  mergeAreas,
} from "./areas.js";
import {
  type HeldRole,
  type InstanceFacts,
  instanceFacts,
  type OrganizationFacts,
  organizationFacts,
  type RoleReference,
  type SpaceFacts,
  type SpaceVia,
  spaceFacts,
  type Via,
} from "./facts.js";
import {
  type ItemAccessOptions,
  type ItemFacts,
  itemFacts,
  itemRoleCondition,
  type ShareVia,
} from "./item-access.js";
import type { AuthorizationRegistry, RegisteredAction, Resource, RestrictionDenial } from "./registry.js";
import { spaceRoleCondition, tokenSpaceCondition } from "./space-access.js";

export type Grant =
  | { kind: "system" }
  | { kind: "role"; role: RoleReference; via: Via; expiresAt: Date | null }
  | { kind: "membership"; membershipKind: string }
  | { kind: "spaceRole"; role: SpaceRole; via: SpaceVia }
  | { kind: "share"; role: SpaceRole; itemId: string; inherited: boolean; via: ShareVia }
  | { kind: "link"; linkId: string; scope: string }
  | { kind: "rule"; rule: string };

export type Denial =
  | "anonymous"
  | "accountInactive"
  | "resourceNotFound"
  | "notMember"
  | "limitedMembership"
  | "noRoleGrantsArea"
  | "ownerOnly"
  | "instanceRolesDoNotGrantOrganizationAccess"
  | "roleExceedsOwnPermissions"
  | "selfExtension"
  | "noSpaceRole"
  | "tokenScope"
  | "ruleNotMet"
  | RestrictionDenial;

export interface GrantCheck {
  scope: RoleScope;
  organizationId: string | null;
  areas: Areas;
  owner?: boolean;
  principal?: { kind: PrincipalKind; id: string | null };
  actorHolds?: boolean;
  action?: string;
}

export interface RankCheck {
  scope: RoleScope;
  organizationId: string | null;
  areas: Areas;
  owner?: boolean;
  action?: string;
}

function defaultAction(scope: RoleScope): string {
  return scope === "instance" ? "instance.roles.manage" : "organization.roles.manage";
}

export interface Decision {
  action: string;
  resource: Resource;
  allowed: boolean;
  grants: Grant[];
  denials: Denial[];
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";

  constructor(readonly decision: Decision) {
    super(`Not allowed: ${decision.action}`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roleGrant(role: HeldRole): Grant {
  return { kind: "role", role: role.role, via: role.via, expiresAt: role.expiresAt };
}

function tokenAreas(token: TokenGrant, scope: RoleScope, organizationId: string | null): Areas {
  if (token.organizationId && (scope === "instance" || token.organizationId !== organizationId)) return {};
  return (scope === "instance" ? token.scopes.instance : token.scopes.organization) ?? {};
}

function tokenAllows(token: TokenGrant, action: RegisteredAction, organizationId: string | null): boolean {
  if (action.tokenScope) {
    return grantsLevel(token.scopes.organization?.[action.tokenScope.area], action.tokenScope.level);
  }
  if (action.scope === "space") {
    if (token.organizationId && token.organizationId !== organizationId) return false;
    const level = action.spaceRole === "editor" || action.spaceRole === "admin" ? "manage" : "view";
    return grantsLevel(token.scopes.organization?.spaces, level);
  }
  const areas = tokenAreas(token, action.scope, organizationId);
  if (action.area && action.level) return grantsLevel(areas[action.area], action.level);
  return action.name.endsWith(".view") && Object.keys(areas).length > 0;
}

function limitByToken(
  principal: Principal,
  action: RegisteredAction,
  organizationId: string | null,
  decision: Decision,
): Decision {
  if (!decision.allowed || principal.type !== "account" || !principal.token) return decision;
  if (tokenAllows(principal.token, action, organizationId)) return decision;
  return { ...decision, allowed: false, grants: [], denials: ["tokenScope"] };
}

function ownerRole(role: HeldRole): boolean {
  return "builtIn" in role.role && role.role.builtIn === "owner";
}

export class AuthorizationService {
  readonly #database: Database;
  readonly #registry: AuthorizationRegistry;
  readonly #audit: AuditLog;

  constructor(options: { database: Database; registry: AuthorizationRegistry; audit: AuditLog }) {
    this.#database = options.database;
    this.#registry = options.registry;
    this.#audit = options.audit;
  }

  get registry(): AuthorizationRegistry {
    return this.#registry;
  }

  async explain(
    principal: Principal,
    actionName: string,
    resource: Resource,
    options: { executor?: Executor; fresh?: boolean } = {},
  ): Promise<Decision> {
    const action = this.#registry.action(actionName);
    const decision = (grants: Grant[], denials: Denial[]): Decision => ({
      action: actionName,
      resource,
      allowed: grants.length > 0,
      grants,
      denials: grants.length > 0 ? [] : denials,
    });
    if (principal.type === "system") return decision([{ kind: "system" }], []);
    if (principal.type === "anonymous") return decision([], ["anonymous"]);
    const executor = options.executor ?? this.#database;
    const fresh = options.fresh ?? executor !== this.#database;
    const accountId = principal.id;

    if (action.scope === "instance") {
      const facts = await instanceFacts(executor, accountId, { fresh });
      if (facts.account?.state !== "active") return decision([], ["accountInactive"]);
      const grants = this.#roleGrants(action, facts.roles);
      const denials: Denial[] = [action.ownerOnly ? "ownerOnly" : "noRoleGrantsArea"];
      if (action.rule) {
        const allowed = await this.#rule(action, accountId, resource, null, executor, fresh);
        if (allowed) grants.push({ kind: "rule", rule: action.rule });
      }
      return limitByToken(principal, action, null, decision(grants, denials));
    }

    if (action.scope === "space") {
      const spaceId = await this.#spaceOf(action, resource, executor);
      if (!spaceId) return decision([], ["resourceNotFound"]);
      const facts = await spaceFacts(executor, accountId, spaceId, { fresh });
      if (!facts.space) return decision([], ["resourceNotFound"]);
      if (facts.account?.state !== "active") return decision([], ["accountInactive"]);
      let grants = this.#spaceGrants(action, facts);
      const item = await this.#itemFacts(action, resource, accountId, facts, executor, fresh);
      if (item) grants.push(...this.#itemGrants(action, item));
      const ruleMet =
        action.rule !== undefined && (await this.#rule(action, accountId, resource, null, executor, fresh));
      if (action.ruleRequired) {
        if (grants.length > 0 && !ruleMet) return decision([], ["ruleNotMet"]);
      } else if (ruleMet && action.rule) {
        grants.push({ kind: "rule", rule: action.rule });
      }
      if (item && grants.length > 0) {
        if (item.viewRestrictions.some((restriction) => !restriction.listed)) {
          return decision([], ["restricted"]);
        }
        const editsItem = action.resourceType.type === "item" && action.spaceRole === "editor";
        if (editsItem && item.editRestriction && !item.editRestriction.listed) {
          return decision([], ["editRestricted"]);
        }
      }
      const restriction = action.restriction
        ? await action.resourceType.restrictions?.[action.restriction]?.(
            executor,
            (resource.id ?? "").toLowerCase(),
          )
        : null;
      if (restriction && grants.length > 0) {
        const { unless } = restriction;
        grants = unless
          ? grants.filter(
              (grant) =>
                (grant.kind === "spaceRole" || grant.kind === "share") && grantsSpaceRole(grant.role, unless),
            )
          : [];
        if (grants.length === 0) return decision([], [restriction.denial]);
      }
      return limitByToken(principal, action, facts.space.organizationId, decision(grants, ["noSpaceRole"]));
    }

    const organizationId = await this.#organizationOf(action, resource, executor);
    if (!organizationId) return decision([], ["resourceNotFound"]);
    const facts = await organizationFacts(executor, accountId, organizationId, { fresh });
    if (facts.account?.state !== "active") return decision([], ["accountInactive"]);
    const grants = this.#roleGrants(action, facts.roles);
    if (facts.membership && action.membership?.includes(facts.membership.kind)) {
      grants.push({ kind: "membership", membershipKind: facts.membership.kind });
    }
    if (action.breakGlass) {
      for (const role of facts.roles) if (role.via.type === "breakGlass") grants.push(roleGrant(role));
    }
    if (action.rule && (await this.#rule(action, accountId, resource, organizationId, executor, fresh))) {
      grants.push({ kind: "rule", rule: action.rule });
    }
    return limitByToken(
      principal,
      action,
      organizationId,
      decision(grants, await this.#organizationDenials(action, facts, accountId, executor, fresh)),
    );
  }

  async decide(
    principal: Principal,
    actionName: string,
    resource: Resource,
    options: { executor?: Executor } = {},
  ): Promise<Decision> {
    const decision = await this.explain(principal, actionName, resource, options);
    if (decision.allowed && principal.type === "account")
      await this.#recordBreakGlassUse(decision, principal.id);
    return decision;
  }

  async authorize(
    principal: Principal,
    actionName: string,
    resource: Resource,
    options: { executor?: Executor } = {},
  ): Promise<boolean> {
    return (await this.decide(principal, actionName, resource, options)).allowed;
  }

  async require(
    principal: Principal,
    actionName: string,
    resource: Resource,
    options: { executor?: Executor } = {},
  ): Promise<void> {
    const decision = await this.explain(principal, actionName, resource, options);
    if (!decision.allowed) throw new ForbiddenError(decision);
    if (principal.type === "account") await this.#recordBreakGlassUse(decision, principal.id);
  }

  async #heldRoles(
    accountId: string,
    scope: RoleScope,
    organizationId: string | null,
    executor: Executor,
  ): Promise<{ roles: HeldRole[]; facts: InstanceFacts | OrganizationFacts }> {
    if (scope === "instance") {
      const facts = await instanceFacts(executor, accountId, { fresh: true });
      return { roles: facts.account?.state === "active" ? facts.roles : [], facts };
    }
    const facts = await organizationFacts(executor, accountId, organizationId ?? "", { fresh: true });
    return { roles: facts.account?.state === "active" ? facts.roles : [], facts };
  }

  #covers(
    principal: { kind: PrincipalKind; id: string | null },
    accountId: string,
    facts: InstanceFacts | OrganizationFacts,
  ): boolean {
    switch (principal.kind) {
      case "account":
        return principal.id === accountId;
      case "group":
        return "groups" in facts && facts.groups.some((group) => group.id === principal.id);
      case "organizationMembers":
        return "membership" in facts && facts.membership?.kind === "member";
      case "instanceUsers":
        return facts.account?.type === "standard";
    }
  }

  #denier(action: string, scope: RoleScope, organizationId: string | null) {
    const resource: Resource =
      scope === "instance" ? { type: "instance" } : { type: "organization", id: organizationId ?? "" };
    return (denial: Denial): never => {
      throw new ForbiddenError({ action, resource, allowed: false, grants: [], denials: [denial] });
    };
  }

  async checkGrant(
    actor: Principal,
    grant: GrantCheck,
    options: { executor?: Executor } = {},
  ): Promise<void> {
    if (actor.type === "system") return;
    const deny = this.#denier(grant.action ?? defaultAction(grant.scope), grant.scope, grant.organizationId);
    if (actor.type === "anonymous") return deny("anonymous");
    const executor = options.executor ?? this.#database;
    const held = await this.#heldRoles(actor.id, grant.scope, grant.organizationId, executor);
    const roles = this.#limitRoles(held.roles, actor, grant.scope, grant.organizationId);
    const permanent = roles.filter((role) => role.expiresAt === null && role.via.type !== "breakGlass");
    if (grant.owner) {
      if (actor.token) deny("tokenScope");
      if (!permanent.some(ownerRole)) deny("ownerOnly");
      return;
    }
    if (coversAreas(mergeAreas(...permanent.map((role) => role.areas)), grant.areas)) return;
    if (!coversAreas(mergeAreas(...roles.map((role) => role.areas)), grant.areas))
      deny("roleExceedsOwnPermissions");
    const selfTargeted =
      grant.actorHolds === true ||
      (grant.principal ? this.#covers(grant.principal, actor.id, held.facts) : false);
    deny(selfTargeted ? "selfExtension" : "roleExceedsOwnPermissions");
  }

  async checkRank(actor: Principal, target: RankCheck, options: { executor?: Executor } = {}): Promise<void> {
    if (actor.type === "system") return;
    const deny = this.#denier(
      target.action ?? defaultAction(target.scope),
      target.scope,
      target.organizationId,
    );
    if (actor.type === "anonymous") return deny("anonymous");
    const executor = options.executor ?? this.#database;
    const held = await this.#heldRoles(actor.id, target.scope, target.organizationId, executor);
    const roles = this.#limitRoles(held.roles, actor, target.scope, target.organizationId);
    if (target.owner) {
      if (actor.token) deny("tokenScope");
      if (!roles.some((role) => ownerRole(role) && role.via.type !== "breakGlass")) deny("ownerOnly");
    }
    if (!coversAreas(mergeAreas(...roles.map((role) => role.areas)), target.areas))
      deny("roleExceedsOwnPermissions");
  }

  async checkRankOverAccount(
    actor: Principal,
    organizationId: string,
    accountId: string,
    options: { executor?: Executor; action?: string } = {},
  ): Promise<void> {
    const executor = options.executor ?? this.#database;
    await this.checkRank(
      actor,
      {
        scope: "organization",
        organizationId,
        areas: await this.heldAreas(accountId, "organization", organizationId, executor),
        owner: await this.isOrganizationOwner(accountId, organizationId, executor),
        ...(options.action ? { action: options.action } : {}),
      },
      { executor },
    );
  }

  async checkOwnersOverAccount(
    actor: Principal,
    accountId: string,
    options: { executor?: Executor; action?: string } = {},
  ): Promise<void> {
    if (actor.type !== "account") return;
    const executor = options.executor ?? this.#database;
    const instance = await executor.execute<{ owner: string | null }>(
      sql`select owner_account_id as owner from instance`,
    );
    if (instance.rows[0]?.owner === actor.id) return;
    const memberships = await executor.execute<{ organization_id: string }>(sql`
      select organization_id from memberships where account_id = ${accountId}
      order by organization_id`);
    for (const { organization_id: organizationId } of memberships.rows) {
      if (!(await this.isOrganizationOwner(accountId, organizationId, executor))) continue;
      if (await this.isOrganizationOwner(actor.id, organizationId, executor)) continue;
      throw new ForbiddenError({
        action: options.action ?? "account.manage",
        resource: { type: "account", id: accountId },
        allowed: false,
        grants: [],
        denials: ["ownerOnly"],
      });
    }
  }

  async groupAreas(groupId: string, executor: Executor = this.#database): Promise<Areas> {
    const result = await executor.execute<{ built_in_role: BuiltInRoleKey | null; areas: Areas | null }>(sql`
      select ra.built_in_role, cr.areas
      from role_assignments ra left join custom_roles cr on cr.id = ra.custom_role_id
      where ra.principal_kind = 'group' and ra.principal_id = ${groupId} and ra.scope = 'organization'
        and (ra.expires_at is null or ra.expires_at > now())`);
    return mergeAreas(
      ...result.rows.map((row) =>
        row.built_in_role ? builtInRoleAreas("organization", row.built_in_role) : (row.areas ?? {}),
      ),
    );
  }

  async holdsCustomRole(
    accountId: string,
    scope: RoleScope,
    organizationId: string | null,
    roleId: string,
    executor: Executor = this.#database,
  ): Promise<boolean> {
    const { roles } = await this.#heldRoles(accountId, scope, organizationId, executor);
    return roles.some((role) => "customRoleId" in role.role && role.role.customRoleId === roleId);
  }

  async isOrganizationOwner(accountId: string, organizationId: string, executor: Executor = this.#database) {
    const { roles } = await this.#heldRoles(accountId, "organization", organizationId, executor);
    return roles.some((role) => ownerRole(role) && role.via.type !== "breakGlass");
  }

  async grantableAreas(
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
    executor: Executor = this.#database,
  ): Promise<Areas> {
    if (actor.type === "anonymous" || actor.type === "system") return {};
    const held = await this.#heldRoles(actor.id, scope, organizationId, executor);
    const roles = this.#limitRoles(held.roles, actor, scope, organizationId);
    return mergeAreas(
      ...roles
        .filter((role) => role.expiresAt === null && role.via.type !== "breakGlass")
        .map((role) => role.areas),
    );
  }

  async heldAreas(
    accountId: string,
    scope: RoleScope,
    organizationId: string | null,
    executor: Executor = this.#database,
  ) {
    const { roles } = await this.#heldRoles(accountId, scope, organizationId, executor);
    return mergeAreas(...roles.map((role) => role.areas));
  }

  #limitRoles(
    roles: HeldRole[],
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
  ): HeldRole[] {
    if (actor.type !== "account" || !actor.token) return roles;
    const limit = tokenAreas(actor.token, scope, organizationId);
    return roles.map((role) => ({ ...role, areas: intersectAreas(role.areas, limit) }));
  }

  async #itemFacts(
    action: RegisteredAction,
    resource: Resource,
    accountId: string,
    facts: SpaceFacts,
    executor: Executor,
    fresh: boolean,
  ): Promise<ItemFacts | null> {
    if (!action.resourceType.itemOf || !resource.id) return null;
    const itemId = await action.resourceType.itemOf(executor, resource.id.toLowerCase());
    if (!itemId) return null;
    const item = await itemFacts(executor, accountId, itemId, { fresh });
    if (!item) return null;
    if (facts.account?.type === "portal") return { ...item, sources: [] };
    return item;
  }

  #itemGrants(action: RegisteredAction, item: ItemFacts): Grant[] {
    const required = action.spaceRole;
    if (!required) return [];
    const grants: Grant[] = [];
    for (const source of item.sources) {
      if (source.type === "share" && grantsSpaceRole(source.role, required)) {
        grants.push({
          kind: "share",
          role: source.role,
          itemId: source.itemId,
          inherited: source.inherited,
          via: source.via,
        });
      }
      if (source.type === "link" && required === "reader") {
        grants.push({ kind: "link", linkId: source.linkId, scope: source.scope });
      }
    }
    return grants;
  }

  itemFacts(
    accountId: string,
    itemId: string,
    options: { executor?: Executor; fresh?: boolean } = {},
  ): Promise<ItemFacts | null> {
    const executor = options.executor ?? this.#database;
    return itemFacts(executor, accountId, itemId, { fresh: options.fresh ?? executor !== this.#database });
  }

  itemFilter(
    principal: Principal,
    item: SQL,
    space: SQL,
    minimum: SpaceRole = "reader",
    options: ItemAccessOptions = {},
  ): SQL {
    return itemRoleCondition(principal, item, space, minimum, options);
  }

  #spaceGrants(action: RegisteredAction, facts: SpaceFacts): Grant[] {
    const required = action.spaceRole;
    if (!required) return [];
    return facts.sources
      .filter((source) => grantsSpaceRole(source.role, required))
      .map((source) => ({ kind: "spaceRole", role: source.role, via: source.via }));
  }

  async spaceRole(
    accountId: string,
    spaceId: string,
    options: { executor?: Executor; fresh?: boolean } = {},
  ): Promise<SpaceFacts> {
    const executor = options.executor ?? this.#database;
    return spaceFacts(executor, accountId, spaceId, { fresh: options.fresh ?? executor !== this.#database });
  }

  spaceFilter(principal: Principal, space: SQL, minimum: SpaceRole = "reader"): SQL {
    if (principal.type === "system") return sql`true`;
    if (principal.type === "anonymous") return sql`false`;
    return sql`(${space}.deleted_at is null and ${spaceRoleCondition(principal.id, space, minimum)} and ${tokenSpaceCondition(principal, space, minimum)})`;
  }

  async #spaceOf(action: RegisteredAction, resource: Resource, executor: Executor): Promise<string | null> {
    if (!resource.id || !UUID.test(resource.id)) return null;
    if (action.resourceType.type === "space") return resource.id.toLowerCase();
    return action.resourceType.spaceOf?.(executor, resource.id.toLowerCase()) ?? null;
  }

  #roleGrants(action: RegisteredAction, roles: HeldRole[]): Grant[] {
    if (action.ownerOnly) return roles.filter(ownerRole).map(roleGrant);
    if (!action.area || !action.level) return [];
    const { area, level } = action;
    return roles.filter((role) => grantsLevel(role.areas[area], level)).map(roleGrant);
  }

  async #organizationOf(
    action: RegisteredAction,
    resource: Resource,
    executor: Executor,
  ): Promise<string | null> {
    if (!resource.id || !UUID.test(resource.id)) return null;
    if (action.resourceType.type === "organization") {
      const exists = await executor.execute<{ id: string }>(sqlOrganizationExists(resource.id));
      return exists.rows[0]?.id ?? null;
    }
    return action.resourceType.organizationOf?.(executor, resource.id) ?? null;
  }

  async #rule(
    action: RegisteredAction,
    accountId: string,
    resource: Resource,
    organizationId: string | null,
    executor: Executor,
    fresh: boolean,
  ): Promise<boolean> {
    const rule = action.rule ? action.resourceType.rules?.[action.rule] : undefined;
    if (!rule) return false;
    return rule({
      accountId,
      resource,
      organizationId,
      executor,
      organizationFacts: (id) => organizationFacts(executor, accountId, id, { fresh }),
      spaceFacts: (id) => spaceFacts(executor, accountId, id, { fresh }),
    });
  }

  async #organizationDenials(
    action: RegisteredAction,
    facts: OrganizationFacts,
    accountId: string,
    executor: Executor,
    fresh: boolean,
  ): Promise<Denial[]> {
    const denials: Denial[] = [];
    if (!facts.membership && facts.roles.length === 0) denials.push("notMember");
    else if (facts.membership && facts.membership.kind !== "member") denials.push("limitedMembership");
    else denials.push(action.ownerOnly ? "ownerOnly" : "noRoleGrantsArea");
    if (!facts.membership && action.area && action.level) {
      const instance: InstanceFacts = await instanceFacts(executor, accountId, { fresh });
      if (instance.roles.length > 0) denials.push("instanceRolesDoNotGrantOrganizationAccess");
    }
    return denials;
  }

  async #recordBreakGlassUse(decision: Decision, accountId: string): Promise<void> {
    const roleGrants = decision.grants.filter((grant) => grant.kind === "role");
    if (roleGrants.length === 0 || decision.grants.length !== roleGrants.length) return;
    const breakGlass = roleGrants.map((grant) => grant.via).filter((via) => via.type === "breakGlass");
    if (breakGlass.length !== roleGrants.length) return;
    const action = this.#registry.action(decision.action);
    const organizationId =
      action.resourceType.type === "organization"
        ? (decision.resource.id ?? null)
        : await this.#organizationOf(action, decision.resource, this.#database);
    if (!organizationId) return;
    await this.#audit.recordAlone({
      name: "breakGlass.actionAuthorized",
      actor: { type: "account", id: accountId },
      targetId: breakGlass[0]?.type === "breakGlass" ? breakGlass[0].accessId : null,
      fields: {
        action: decision.action,
        resourceType: decision.resource.type,
        resourceId: decision.resource.id ?? null,
      },
      scope: { type: "organization", id: organizationId },
    });
  }
}

function sqlOrganizationExists(id: string) {
  return sql`select id from organizations where id = ${id}`;
}
