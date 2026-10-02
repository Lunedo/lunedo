import { roleNameSchema } from "@pagehall/shared";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditEvents, AuditLog } from "../audit/audit-log.js";
import {
  type AccessLevel,
  type Areas,
  areasSchema,
  builtInRoleAreas,
  grantsLevel,
} from "../authorization/areas.js";
import type { RoleReference } from "../authorization/facts.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import {
  type BuiltInRoleKey,
  customRoles,
  groups,
  memberships,
  type PrincipalKind,
  type RoleScope,
  roleAssignments,
} from "./access-schema.js";
import { lockOrganization, ownerCount } from "./memberships.js";
import { OrganizationError } from "./organizations.js";

export { roleNameSchema };

const ASSIGNABLE: Record<RoleScope, readonly BuiltInRoleKey[]> = {
  instance: ["administrator", "securityAuditor"],
  organization: ["owner", "administrator"],
};

export interface CustomRole {
  id: string;
  scope: RoleScope;
  organizationId: string | null;
  name: string;
  areas: Areas;
}

export interface RoleAssignment {
  id: string;
  scope: RoleScope;
  organizationId: string | null;
  role: string;
  builtInRole: BuiltInRoleKey | null;
  customRoleId: string | null;
  principalKind: PrincipalKind;
  principalId: string | null;
  expiresAt: Date | null;
}

export type RoleInput = { builtIn: BuiltInRoleKey } | { customRoleId: string };

function addedAreas(before: Areas, after: Areas): Areas {
  const added: Areas = {};
  for (const [area, level] of Object.entries(after) as [keyof Areas, AccessLevel][]) {
    if (!grantsLevel(before[area], level)) added[area] = level;
  }
  return added;
}

function scopeOf(scope: RoleScope, organizationId: string | null) {
  return scope === "organization" && organizationId
    ? { type: "organization" as const, id: organizationId }
    : undefined;
}

function actorId(actor: Principal): string | null {
  return actor.type === "account" ? actor.id : null;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  return details.code === "23505" && details.constraint === constraint;
}

export class RoleService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; audit: AuditLog; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
  }

  async listCustom(scope: RoleScope, organizationId: string | null): Promise<CustomRole[]> {
    const rows = await this.#database
      .select()
      .from(customRoles)
      .where(
        and(
          eq(customRoles.scope, scope),
          organizationId
            ? eq(customRoles.organizationId, organizationId)
            : isNull(customRoles.organizationId),
        ),
      )
      .orderBy(customRoles.name);
    return rows.map((row) => ({ ...row, areas: row.areas as Areas }));
  }

  async #custom(executor: Executor, id: string, scope: RoleScope, organizationId: string | null) {
    const [row] = await executor
      .select()
      .from(customRoles)
      .where(
        and(
          eq(customRoles.id, id),
          eq(customRoles.scope, scope),
          organizationId
            ? eq(customRoles.organizationId, organizationId)
            : isNull(customRoles.organizationId),
        ),
      );
    if (!row) throw new OrganizationError("roleNotFound", "The role does not exist");
    return { ...row, areas: row.areas as Areas };
  }

  async createCustom(
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
    input: { name: string; areas: unknown },
  ): Promise<CustomRole> {
    const name = roleNameSchema.parse(input.name);
    const areas = areasSchema(scope).parse(input.areas);
    return this.#database.transaction(async (tx) => {
      await this.#authorization.checkGrant(actor, { scope, organizationId, areas }, { executor: tx });
      let row: typeof customRoles.$inferSelect | undefined;
      try {
        [row] = await tx.insert(customRoles).values({ scope, organizationId, name, areas }).returning();
      } catch (error) {
        if (isUniqueViolation(error, "custom_roles_name_unique")) {
          throw new OrganizationError("roleNameTaken", "A role with this name exists already");
        }
        throw error;
      }
      if (!row) throw new Error("The role was not created");
      await this.#audit.record(tx, {
        name: "role.created",
        actor,
        targetId: row.id,
        fields: { name, areas: areas as Record<string, string> },
        ...(scopeOf(scope, organizationId) ? { scope: scopeOf(scope, organizationId) } : {}),
      });
      return { ...row, areas };
    });
  }

  async updateCustom(
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
    id: string,
    input: { name?: string; areas?: unknown },
  ): Promise<CustomRole> {
    return this.#database.transaction(async (tx) => {
      if (organizationId) await lockOrganization(tx, organizationId);
      const current = await this.#custom(tx, id, scope, organizationId);
      const name = input.name === undefined ? current.name : roleNameSchema.parse(input.name);
      const areas = input.areas === undefined ? current.areas : areasSchema(scope).parse(input.areas);
      await this.#authorization.checkRank(
        actor,
        { scope, organizationId, areas: current.areas },
        { executor: tx },
      );
      const added = addedAreas(current.areas, areas);
      if (Object.keys(added).length > 0) {
        const actorHolds =
          actor.type === "account" &&
          (await this.#authorization.holdsCustomRole(actor.id, scope, organizationId, id, tx));
        await this.#authorization.checkGrant(
          actor,
          { scope, organizationId, areas: added, actorHolds },
          { executor: tx },
        );
      }
      try {
        await tx
          .update(customRoles)
          .set({ name, areas, updatedAt: new Date() })
          .where(eq(customRoles.id, id));
      } catch (error) {
        if (isUniqueViolation(error, "custom_roles_name_unique")) {
          throw new OrganizationError("roleNameTaken", "A role with this name exists already");
        }
        throw error;
      }
      await this.#audit.record(tx, {
        name: "role.updated",
        actor,
        targetId: id,
        fields: {
          name,
          areas: areas as Record<string, string>,
          previous: { name: current.name, areas: current.areas as Record<string, string> },
        },
        ...(scopeOf(scope, organizationId) ? { scope: scopeOf(scope, organizationId) } : {}),
      });
      return { ...current, name, areas };
    });
  }

  async deleteCustom(
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
    id: string,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      if (organizationId) await lockOrganization(tx, organizationId);
      const current = await this.#custom(tx, id, scope, organizationId);
      await this.#authorization.checkRank(
        actor,
        { scope, organizationId, areas: current.areas },
        { executor: tx },
      );
      await tx.delete(customRoles).where(eq(customRoles.id, id));
      await this.#audit.record(tx, {
        name: "role.deleted",
        actor,
        targetId: id,
        fields: { name: current.name },
        ...(scopeOf(scope, organizationId) ? { scope: scopeOf(scope, organizationId) } : {}),
      });
    });
  }

  async listAssignments(
    scope: RoleScope,
    organizationId: string | null,
    page: PageRequest = FIRST_PAGE,
  ): Promise<Page<RoleAssignment>> {
    const rows = await this.#database
      .select({
        id: roleAssignments.id,
        scope: roleAssignments.scope,
        organizationId: roleAssignments.organizationId,
        builtInRole: roleAssignments.builtInRole,
        customRoleId: roleAssignments.customRoleId,
        customRoleName: customRoles.name,
        principalKind: roleAssignments.principalKind,
        principalId: roleAssignments.principalId,
        expiresAt: roleAssignments.expiresAt,
      })
      .from(roleAssignments)
      .leftJoin(customRoles, eq(customRoles.id, roleAssignments.customRoleId))
      .where(
        and(
          eq(roleAssignments.scope, scope),
          organizationId
            ? eq(roleAssignments.organizationId, organizationId)
            : isNull(roleAssignments.organizationId),
          or(isNull(roleAssignments.expiresAt), sql`${roleAssignments.expiresAt} > now()`),
          afterKey([roleAssignments.id], page.after),
        ),
      )
      .orderBy(roleAssignments.id)
      .limit(pageLimit(page));
    return toPage(
      rows,
      page,
      (row) => [row.id],
      ({ customRoleName, ...row }) => ({ ...row, role: row.builtInRole ?? customRoleName ?? "" }),
    );
  }

  async #resolveRole(
    executor: Executor,
    scope: RoleScope,
    organizationId: string | null,
    role: RoleInput,
  ): Promise<{ reference: RoleReference; areas: Areas; name: string }> {
    if ("builtIn" in role) {
      if (!ASSIGNABLE[scope].includes(role.builtIn)) {
        throw new OrganizationError("roleNotAssignable", `The role ${role.builtIn} cannot be assigned`);
      }
      return {
        reference: { builtIn: role.builtIn },
        areas: builtInRoleAreas(scope, role.builtIn),
        name: role.builtIn,
      };
    }
    const custom = await this.#custom(executor, role.customRoleId, scope, organizationId);
    return {
      reference: { customRoleId: custom.id, name: custom.name },
      areas: custom.areas,
      name: custom.name,
    };
  }

  async #checkPrincipal(
    tx: Transaction,
    scope: RoleScope,
    organizationId: string | null,
    principal: { kind: PrincipalKind; id: string | null },
    owner: boolean,
  ): Promise<void> {
    const invalid = (message: string): never => {
      throw new OrganizationError("invalidPrincipal", message);
    };
    if (principal.kind === "organizationMembers" || principal.kind === "instanceUsers") {
      throw new OrganizationError(
        "roleNeedsAccountOrGroup",
        "Roles at the instance and organization level go to individual accounts and groups only",
      );
    }
    if (owner && principal.kind !== "account") invalid("Owners are accounts");
    if (scope === "instance" && principal.kind === "group") invalid("Instance roles go to accounts");
    if (!principal.id) return invalid("The principal needs an ID");
    if (principal.kind === "group") {
      const [group] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, principal.id), eq(groups.organizationId, organizationId ?? "")));
      if (!group) invalid("The group does not belong to the organization");
      return;
    }
    const [account] = await tx
      .select({ state: accounts.state, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, principal.id));
    if (account?.state !== "active") return invalid("The account is not active");
    if (owner && account.type !== "standard") invalid("Owners are standard accounts");
    if (scope === "instance") {
      if (account.type !== "standard") invalid("Instance roles go to standard accounts");
      return;
    }
    const [membership] = await tx
      .select({ kind: memberships.kind, expiresAt: memberships.expiresAt })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId ?? ""),
          eq(memberships.accountId, principal.id),
          or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
        ),
      );
    if (membership?.kind !== "member")
      invalid("Roles go to members; guests and collaborators have fixed limits");
    if (owner && membership?.expiresAt) invalid("The membership of an owner cannot expire");
  }

  async assign(
    actor: Principal,
    input: {
      scope: RoleScope;
      organizationId: string | null;
      role: RoleInput;
      principal: { kind: PrincipalKind; id: string | null };
      expiresAt?: Date | null;
    },
    options: { tx?: Transaction; collect?: AuditEvents } = {},
  ): Promise<RoleAssignment> {
    const run = async (tx: Transaction) => {
      if (input.organizationId) await lockOrganization(tx, input.organizationId);
      const role = await this.#resolveRole(tx, input.scope, input.organizationId, input.role);
      const owner = "builtIn" in input.role && input.role.builtIn === "owner";
      if (owner && input.expiresAt)
        throw new OrganizationError("ownerExpiry", "The owner role cannot expire");
      if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
        throw new OrganizationError("expiryInPast", "The expiry must be in the future");
      }
      await this.#checkPrincipal(tx, input.scope, input.organizationId, input.principal, owner);
      await this.#authorization.checkGrant(
        actor,
        {
          scope: input.scope,
          organizationId: input.organizationId,
          areas: role.areas,
          owner,
          principal: input.principal,
        },
        { executor: tx },
      );
      const values = {
        scope: input.scope,
        organizationId: input.organizationId,
        principalKind: input.principal.kind,
        principalId: input.principal.id,
        builtInRole: "builtIn" in input.role ? input.role.builtIn : null,
        customRoleId: "customRoleId" in input.role ? input.role.customRoleId : null,
        expiresAt: input.expiresAt ?? null,
        createdBy: actorId(actor),
      };
      const [row] = await tx.insert(roleAssignments).values(values).onConflictDoNothing().returning();
      if (!row) throw new OrganizationError("alreadyAssigned", "The role is already assigned");
      const event: AuditEvents[number] = {
        name: "role.assigned",
        actor,
        targetId: row.id,
        fields: {
          role: role.name,
          customRoleId: row.customRoleId,
          principalKind: row.principalKind,
          principalId: row.principalId,
          expiresAt: row.expiresAt?.toISOString() ?? null,
        },
        ...(scopeOf(input.scope, input.organizationId)
          ? { scope: scopeOf(input.scope, input.organizationId) }
          : {}),
      };
      if (options.collect) options.collect.push(event);
      else await this.#audit.record(tx, event);
      return { ...row, role: role.name };
    };
    return options.tx ? run(options.tx) : this.#database.transaction(run);
  }

  async assignMany(
    actor: Principal,
    input: {
      scope: RoleScope;
      organizationId: string | null;
      role: RoleInput;
      principals: readonly { kind: PrincipalKind; id: string | null }[];
      expiresAt?: Date | null;
    },
  ): Promise<RoleAssignment[]> {
    const unique = [
      ...new Map(
        input.principals.map((principal) => [`${principal.kind}:${principal.id}`, principal]),
      ).values(),
    ];
    return this.#database.transaction(async (tx) => {
      const events: AuditEvents = [];
      const assigned: RoleAssignment[] = [];
      for (const principal of unique) {
        assigned.push(
          await this.assign(
            actor,
            {
              scope: input.scope,
              organizationId: input.organizationId,
              role: input.role,
              principal,
              expiresAt: input.expiresAt ?? null,
            },
            { tx, collect: events },
          ),
        );
      }
      await this.#audit.recordMany(tx, events);
      return assigned;
    });
  }

  async checkAssignable(
    actor: Principal,
    organizationId: string,
    role: RoleInput,
    executor: Transaction,
  ): Promise<string> {
    const resolved = await this.#resolveRole(executor, "organization", organizationId, role);
    await this.#authorization.checkGrant(
      actor,
      {
        scope: "organization",
        organizationId,
        areas: resolved.areas,
        owner: "builtIn" in resolved.reference && resolved.reference.builtIn === "owner",
      },
      { executor },
    );
    return resolved.name;
  }

  async unassign(
    actor: Principal,
    scope: RoleScope,
    organizationId: string | null,
    id: string,
  ): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      if (organizationId) await lockOrganization(tx, organizationId);
      const [row] = await tx
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.id, id),
            eq(roleAssignments.scope, scope),
            organizationId
              ? eq(roleAssignments.organizationId, organizationId)
              : isNull(roleAssignments.organizationId),
          ),
        )
        .for("update");
      if (!row) return false;
      const role = await this.#resolveRole(
        tx,
        scope,
        organizationId,
        row.builtInRole ? { builtIn: row.builtInRole } : { customRoleId: row.customRoleId ?? "" },
      );
      await this.#authorization.checkRank(
        actor,
        { scope, organizationId, areas: role.areas, owner: row.builtInRole === "owner" },
        { executor: tx },
      );
      if (
        row.builtInRole === "owner" &&
        organizationId &&
        (await ownerCount(tx, organizationId, { assignmentId: id })) === 0
      ) {
        throw new OrganizationError(
          "lastOwner",
          "The last owner of an organization cannot leave or be removed",
        );
      }
      await tx.delete(roleAssignments).where(eq(roleAssignments.id, id));
      await this.#audit.record(tx, {
        name: "role.unassigned",
        actor,
        targetId: id,
        fields: {
          role: role.name,
          principalKind: row.principalKind,
          principalId: row.principalId,
          reason: "removed",
        },
        ...(scopeOf(scope, organizationId) ? { scope: scopeOf(scope, organizationId) } : {}),
      });
      return true;
    });
  }
}
