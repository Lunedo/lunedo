import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { auditScopeOf, SpaceError } from "./common.js";
import type { SpacePermissionService } from "./permissions.js";
import type { SpaceRole } from "./schema.js";
import type { SpaceService } from "./spaces.js";

export const MAX_SPACES_AT_ONCE = 50;

export interface SpaceAssignment {
  spaceId: string;
  role: SpaceRole;
}

export class MemberSpaceService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #spaces: SpaceService;
  readonly #permissions: SpacePermissionService;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    spaces: SpaceService;
    permissions: SpacePermissionService;
    audit: AuditLog;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#spaces = options.spaces;
    this.#permissions = options.permissions;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
  }

  async #administrators(executor: Executor, spaceId: string, except: string[]) {
    return executor.execute<{ id: string }>(sql`
      select distinct a.id from accounts a
      where a.state = 'active' and a.id <> all(${sql.param(except)}::uuid[]) and a.id in (
        select sp.principal_id from space_permissions sp
        where sp.space_id = ${spaceId} and sp.principal_kind = 'account' and sp.role = 'admin'
        union
        select gm.account_id from space_permissions sp join group_members gm on gm.group_id = sp.principal_id
        where sp.space_id = ${spaceId} and sp.principal_kind = 'group' and sp.role = 'admin'
          and (gm.expires_at is null or gm.expires_at > now()))`);
  }

  async remove(
    actor: Principal,
    organizationId: string,
    accountId: string,
    spaceId: string,
  ): Promise<{ spaceId: string; role: SpaceRole }> {
    if (actor.type !== "account") {
      throw new SpaceError("invalidHolder", "Only a person can remove people from spaces here");
    }
    const target = accountId.toLowerCase();
    const id = spaceId.toLowerCase();
    return this.#database.transaction(async (tx) => {
      const space = await this.#spaces.lock(tx, id);
      if (
        space.organizationId !== organizationId ||
        space.personal ||
        space.confidential ||
        space.quarantined
      ) {
        throw new SpaceError("spaceNotFound", "The space does not exist");
      }
      const spaceAdministrator = await this.#authorization.authorize(actor, "space.manage", {
        type: "space",
        id,
      });
      if (!spaceAdministrator) {
        await this.#authorization.require(actor, "organization.spaces.manage", {
          type: "organization",
          id: organizationId,
        });
      }
      const direct = await tx.execute<{ id: string; role: SpaceRole }>(sql`
        select id, role from space_permissions
        where space_id = ${id} and principal_kind = 'account' and principal_id = ${target}`);
      const permission = direct.rows[0];
      if (!permission)
        throw new SpaceError("permissionNotFound", "The person has no role of their own in the space");
      if (permission.role === "admin") {
        throw new SpaceError(
          "administratorKept",
          "Space admins are removed in the permissions of the space, where its space admins decide",
        );
      }
      await this.#permissions.apply(actor, id, { action: "remove", permissionId: permission.id }, { tx });
      if (spaceAdministrator) return { spaceId: id, role: permission.role };
      const names = await tx.execute<{
        actor_name: string;
        member_name: string;
        organization_name: string;
      }>(sql`
        select (select name from accounts where id = ${actor.id}) as actor_name,
          (select name from accounts where id = ${target}) as member_name,
          (select name from organizations where id = ${organizationId}) as organization_name`);
      const named = names.rows[0];
      await this.#audit.record(tx, {
        name: "space.memberRemovedByAdministration",
        actor,
        targetId: id,
        fields: { name: space.name, key: space.key, accountId: target, role: permission.role },
        scope: auditScopeOf(space),
      });
      const administrators = await this.#administrators(tx, id, [actor.id, target]);
      if (administrators.rows.length > 0) {
        await this.#notifications.notify(tx, {
          type: "space.memberRemovedByAdministration",
          recipients: administrators.rows.map((row) => row.id),
          organizationId,
          targetId: id,
          actor,
          params: {
            organizationName: named?.organization_name ?? "",
            spaceName: space.name,
            spaceKey: space.key,
            actorName: named?.actor_name ?? "",
            memberName: named?.member_name ?? "",
            role: permission.role,
          },
        });
      }
      return { spaceId: id, role: permission.role };
    });
  }

  async add(
    actor: Principal,
    organizationId: string,
    accountId: string,
    assignments: readonly SpaceAssignment[],
  ): Promise<void> {
    const ids = assignments.map((assignment) => assignment.spaceId.toLowerCase());
    if (ids.length === 0 || ids.length > MAX_SPACES_AT_ONCE || new Set(ids).size !== ids.length) {
      throw new SpaceError("invalidSpaces", `Choose 1 to ${MAX_SPACES_AT_ONCE} different spaces`);
    }
    const target = accountId.toLowerCase();
    if (actor.type !== "account") {
      throw new SpaceError("invalidHolder", "Only a person can add people to spaces here");
    }
    if (actor.id === target) {
      throw new SpaceError("selfExtension", "Nobody can extend their own permissions");
    }
    await this.#database.transaction(async (tx) => {
      const names = await tx.execute<{
        actor_name: string;
        member_name: string;
        organization_name: string;
      }>(sql`
        select (select name from accounts where id = ${actor.id}) as actor_name,
          (select name from accounts where id = ${target}) as member_name,
          (select name from organizations where id = ${organizationId}) as organization_name`);
      const named = names.rows[0];
      const membership = await tx.execute<{ id: string }>(sql`
        select a.id from accounts a join memberships m on m.account_id = a.id
        where a.id = ${target} and a.state = 'active' and a.type <> 'service'
          and m.organization_id = ${organizationId} and (m.expires_at is null or m.expires_at > now())`);
      if (!membership.rows[0]) {
        throw new SpaceError("invalidHolder", "Only active members of the organization can be added here");
      }
      for (const [index, assignment] of assignments.entries()) {
        const spaceId = ids[index] as string;
        const space = await this.#spaces.lock(tx, spaceId);
        if (
          space.organizationId !== organizationId ||
          space.personal ||
          space.confidential ||
          space.quarantined
        ) {
          throw new SpaceError("spaceNotFound", "The space does not exist");
        }
        const spaceAdministrator = await this.#authorization.authorize(actor, "space.manage", {
          type: "space",
          id: spaceId,
        });
        if (!spaceAdministrator) {
          await this.#authorization.require(actor, "organization.spaces.manage", {
            type: "organization",
            id: organizationId,
          });
          if (assignment.role === "admin") {
            throw new SpaceError(
              "administratorBySpaceAdmins",
              "Only space admins appoint space admins; organization administrators can become space admin themselves",
            );
          }
        }
        await this.#permissions.apply(
          actor,
          spaceId,
          { action: "grant", principalKind: "account", principalId: target, role: assignment.role },
          { tx },
        );
        if (spaceAdministrator) continue;
        await this.#audit.record(tx, {
          name: "space.memberAddedByAdministration",
          actor,
          targetId: spaceId,
          fields: { name: space.name, key: space.key, accountId: target, role: assignment.role },
          scope: auditScopeOf(space),
        });
        const administrators = await this.#administrators(tx, spaceId, [actor.id, target]);
        if (administrators.rows.length === 0) continue;
        await this.#notifications.notify(tx, {
          type: "space.memberAddedByAdministration",
          recipients: administrators.rows.map((row) => row.id),
          organizationId,
          targetId: spaceId,
          actor,
          params: {
            organizationName: named?.organization_name ?? "",
            spaceName: space.name,
            spaceKey: space.key,
            actorName: named?.actor_name ?? "",
            memberName: named?.member_name ?? "",
            role: assignment.role,
          },
        });
      }
    });
  }
}
