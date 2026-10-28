import { uuidv7 } from "@lunedo/shared";
import { inArray, sql } from "drizzle-orm";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import {
  type AccessImpact,
  accessImpact,
  accountRoleUnder,
  activeAdministratorCondition,
  proposedGrants,
  type SpaceAccessState,
  type SpaceGrantRow,
} from "../authorization/space-access.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { PrincipalKind } from "../organizations/access-schema.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import type { PeopleService } from "./people.js";
import { spaceRoleRank } from "./roles.js";
import { privateSpaceGrantRemovals, type SpaceRole } from "./schema.js";
import type { SpaceGrant } from "./settings.js";
import { signalSpaceChange } from "./signals.js";
import {
  type HolderValidation,
  refuseBroadGrantInPrivateSpace,
  type Space,
  type SpaceService,
  type SpaceTarget,
} from "./spaces.js";

export interface SpacePermissionEntry {
  id: string;
  principalKind: PrincipalKind;
  principalId: string | null;
  name: string | null;
  email: string | null;
  organizationName: string | null;
  role: SpaceRole;
}

export type PermissionChange =
  | { action: "grant"; principalKind: PrincipalKind; principalId: string | null; role: SpaceRole }
  | { action: "change"; permissionId: string; role: SpaceRole }
  | { action: "remove"; permissionId: string };

export interface SpaceHolder {
  principalKind: PrincipalKind;
  principalId: string | null;
}

function grantsOf(
  holders: readonly SpaceHolder[],
  role: SpaceRole,
): Extract<PermissionChange, { action: "grant" }>[] {
  return holders.map((holder) => ({ action: "grant" as const, ...holder, role }));
}

interface StoredPermission extends SpaceGrantRow {
  id: string;
}

async function storedPermissions(
  executor: Pick<Database, "execute">,
  spaceId: string,
): Promise<StoredPermission[]> {
  const result = await executor.execute<{
    id: string;
    principal_kind: PrincipalKind;
    principal_id: string | null;
    role: SpaceRole;
  }>(sql`select id, principal_kind, principal_id, role from space_permissions where space_id = ${spaceId}`);
  return result.rows.map((row) => ({
    id: row.id,
    principalKind: row.principal_kind,
    principalId: row.principal_id,
    role: row.role,
  }));
}

function apply(current: StoredPermission[], change: PermissionChange): StoredPermission[] {
  switch (change.action) {
    case "grant": {
      const existing = current.find(
        (permission) =>
          permission.principalKind === change.principalKind && permission.principalId === change.principalId,
      );
      if (existing) {
        throw new SpaceError(
          "alreadyGranted",
          "This holder already has a role in the space; change that role",
        );
      }
      return [
        ...current,
        { id: "", principalKind: change.principalKind, principalId: change.principalId, role: change.role },
      ];
    }
    case "change":
    case "remove": {
      if (!current.some((permission) => permission.id === change.permissionId)) {
        throw new SpaceError("permissionNotFound", "The permission does not exist anymore");
      }
      return change.action === "remove"
        ? current.filter((permission) => permission.id !== change.permissionId)
        : current.map((permission) =>
            permission.id === change.permissionId ? { ...permission, role: change.role } : permission,
          );
    }
  }
}

const REMOVAL_BATCH = 500;

export class SpaceHolders implements HolderValidation {
  readonly #people: PeopleService;

  constructor(people: PeopleService) {
    this.#people = people;
  }

  async validate(tx: Transaction, space: SpaceTarget, grant: SpaceGrant, _actor: Principal): Promise<void> {
    const invalid = (message: string): never => {
      throw new SpaceError("invalidHolder", message);
    };
    if (space.organizationId === null) {
      if (grant.principalKind === "account" && grant.principalId) {
        if (grant.principalId === space.ownerId) return;
        const owner = space.ownerId ? accountPrincipal(space.ownerId) : null;
        if (!owner || !(await this.#people.canSee(owner, grant.principalId, tx))) {
          invalid("Personal spaces can be shared with people the owner can see");
        }
        return;
      }
      if (grant.principalKind === "group" && grant.principalId) {
        const group = await tx.execute<{ id: string }>(sql`
          select g.id from groups g join memberships m on m.organization_id = g.organization_id
          where g.id = ${grant.principalId} and m.account_id = ${space.ownerId} and m.kind = 'member'
            and (m.expires_at is null or m.expires_at > now())`);
        if (!group.rows[0]) invalid("Personal spaces can be shared with groups of the owner's organizations");
        return;
      }
      invalid("Personal spaces can be shared with people and groups only");
    }
    if (space.confidential) {
      if (grant.principalKind !== "account" || !grant.principalId) {
        invalid("Confidential spaces give roles to individual people only");
      }
      const person = await tx.execute<{ id: string }>(sql`
        select a.id from accounts a join memberships m on m.account_id = a.id
        where a.id = ${grant.principalId} and a.type = 'standard' and a.state in ('active', 'invited')
          and m.organization_id = ${space.organizationId} and (m.expires_at is null or m.expires_at > now())`);
      if (!person.rows[0]) invalid("Only people of the organization can get a role in a confidential space");
      return;
    }
    refuseBroadGrantInPrivateSpace(space.visibility, grant.principalKind);
    if (grant.principalKind === "account" && grant.principalId) {
      const account = await tx.execute<{ id: string; type: string }>(sql`
        select a.id, a.type from accounts a
        where a.id = ${grant.principalId} and a.state in ('active', 'invited')
          and (exists (select 1 from memberships m where m.account_id = a.id
                and m.organization_id = ${space.organizationId} and (m.expires_at is null or m.expires_at > now()))
            or exists (select 1 from service_accounts sa where sa.account_id = a.id
                and sa.organization_id = ${space.organizationId}))`);
      if (!account.rows[0]) invalid("Only people and service accounts of the organization can get a role");
      if (account.rows[0]?.type === "portal" && grant.role !== "reader") {
        throw new SpaceError("portalAccountReaderOnly", "Portal accounts can only read");
      }
      return;
    }
    if (grant.principalKind === "group" && grant.principalId) {
      const group = await tx.execute<{ id: string }>(
        sql`select id from groups where id = ${grant.principalId} and organization_id = ${space.organizationId}`,
      );
      if (!group.rows[0]) invalid("Only groups of the organization can get a role");
      return;
    }
    if (grant.principalId !== null) invalid("This holder has no ID");
  }
}

export class SpacePermissionService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #spaces: SpaceService;
  readonly #holders: HolderValidation;
  readonly #people: PeopleService;
  readonly #listeners: ((tx: Transaction, spaceId: string) => Promise<void>)[] = [];

  constructor(options: {
    database: Database;
    audit: AuditLog;
    spaces: SpaceService;
    holders: HolderValidation;
    people: PeopleService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#spaces = options.spaces;
    this.#holders = options.holders;
    this.#people = options.people;
  }

  get holders(): HolderValidation {
    return this.#holders;
  }

  async list(spaceId: string, executor: Executor = this.#database): Promise<SpacePermissionEntry[]> {
    const result = await executor.execute<{
      id: string;
      principal_kind: PrincipalKind;
      principal_id: string | null;
      role: SpaceRole;
      name: string | null;
      email: string | null;
      organization_name: string | null;
    }>(sql`
      select sp.id, sp.principal_kind, sp.principal_id, sp.role,
        coalesce(a.name, g.name) as name, a.email, go.name as organization_name
      from space_permissions sp
      left join accounts a on sp.principal_kind = 'account' and a.id = sp.principal_id
      left join groups g on sp.principal_kind = 'group' and g.id = sp.principal_id
      left join organizations go on go.id = g.organization_id
      where sp.space_id = ${spaceId}
      order by case sp.principal_kind when 'instanceUsers' then 0 when 'organizationMembers' then 1
        when 'group' then 2 else 3 end, lower(coalesce(a.name, g.name, '')), sp.id`);
    return result.rows.map((row) => ({
      id: row.id,
      principalKind: row.principal_kind,
      principalId: row.principal_id,
      name: row.name,
      email: row.email,
      organizationName: row.organization_name,
      role: row.role,
    }));
  }

  async #states(space: Space, changes: PermissionChange[], executor: Pick<Database, "execute">) {
    const current = await storedPermissions(executor, space.id);
    const next = changes.reduce(apply, current);
    const state = (grants: StoredPermission[]): SpaceAccessState => ({
      organizationId: space.organizationId,
      visibility: space.visibility,
      grants,
    });
    return { current, next, before: state(current), after: state(next) };
  }

  async preview(actor: Principal, spaceId: string, change: PermissionChange): Promise<AccessImpact> {
    return this.#database.transaction(async (tx) => {
      const space = await this.#spaces.require(spaceId, tx);
      const { current, before, after } = await this.#states(space, [change], tx);
      if (change.action === "grant") await this.#validateGrant(tx, space, change, actor);
      if (change.action === "change") await this.#validateRoleChange(tx, current, change);
      return accessImpact(tx, before, after, (account) => this.#people.visibleCondition(actor, account));
    });
  }

  async #validateRoleChange(
    tx: Transaction,
    current: StoredPermission[],
    change: Extract<PermissionChange, { action: "change" }>,
  ): Promise<void> {
    const existing = current.find((permission) => permission.id === change.permissionId);
    if (change.role === "reader" || existing?.principalKind !== "account" || !existing.principalId) return;
    const account = await tx.execute<{ type: string }>(
      sql`select type from accounts where id = ${existing.principalId}`,
    );
    if (account.rows[0]?.type === "portal") {
      throw new SpaceError("portalAccountReaderOnly", "Portal accounts can only read");
    }
  }

  async #validateGrant(
    tx: Transaction,
    space: Space,
    change: Extract<PermissionChange, { action: "grant" }>,
    actor: Principal,
  ): Promise<void> {
    await this.#holders.validate(
      tx,
      {
        id: space.id,
        organizationId: space.organizationId,
        ownerId: space.ownerId,
        confidential: space.confidential,
        visibility: space.visibility,
      },
      { principalKind: change.principalKind, principalId: change.principalId, role: change.role },
      actor,
    );
  }

  async previewGrants(
    actor: Principal,
    spaceId: string,
    holders: readonly SpaceHolder[],
    role: SpaceRole,
  ): Promise<AccessImpact> {
    return this.#database.transaction(async (tx) => {
      const space = await this.#spaces.require(spaceId, tx);
      const changes = grantsOf(holders, role);
      const { before, after } = await this.#states(space, changes, tx);
      for (const change of changes) await this.#validateGrant(tx, space, change, actor);
      return accessImpact(tx, before, after, (account) => this.#people.visibleCondition(actor, account));
    });
  }

  async grant(
    actor: Principal,
    spaceId: string,
    holders: readonly SpaceHolder[],
    role: SpaceRole,
  ): Promise<SpacePermissionEntry[]> {
    await this.#database.transaction(async (tx) => {
      for (const change of grantsOf(holders, role)) await this.apply(actor, spaceId, change, { tx });
    });
    return this.list(spaceId);
  }

  async recordPrivateGrantRemovals(): Promise<number> {
    let recorded = 0;
    for (;;) {
      const count = await this.#database.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(privateSpaceGrantRemovals)
          .orderBy(privateSpaceGrantRemovals.spaceId)
          .limit(REMOVAL_BATCH)
          .for("update", { skipLocked: true });
        if (rows.length === 0) return 0;
        await this.#audit.recordMany(
          tx,
          rows.map((row) => ({
            name: "space.privateGrantsRemoved" as const,
            actor: SYSTEM,
            targetId: row.spaceId,
            fields: {
              name: row.name,
              grants: row.grants as {
                principalKind: "organizationMembers" | "instanceUsers";
                role: SpaceRole;
              }[],
            },
            scope: auditScopeOf({ organizationId: row.organizationId }),
          })),
        );
        const ids = rows.map((row) => row.spaceId);
        await tx.delete(privateSpaceGrantRemovals).where(inArray(privateSpaceGrantRemovals.spaceId, ids));
        const existing = await tx.execute<{ id: string }>(
          sql`select id from spaces where id = any(${sql.param(ids)}::uuid[])`,
        );
        for (const { id } of existing.rows) {
          await signalSpaceChange(tx, { spaceId: id, kind: "access", itemId: null });
          for (const listener of this.#listeners) await listener(tx, id);
        }
        return rows.length;
      });
      if (count === 0) return recorded;
      recorded += count;
    }
  }

  onAccessChange(listener: (tx: Transaction, spaceId: string) => Promise<void>): void {
    this.#listeners.push(listener);
  }

  async apply(
    actor: Principal,
    spaceId: string,
    change: PermissionChange,
    options: { tx?: Transaction } = {},
  ): Promise<SpacePermissionEntry[]> {
    await (options.tx ?? this.#database).transaction(async (tx) => {
      const space = await this.#spaces.lock(tx, spaceId);
      const { current, before, after } = await this.#states(space, [change], tx);
      if (change.action === "grant") await this.#validateGrant(tx, space, change, actor);
      if (change.action === "change") await this.#validateRoleChange(tx, current, change);
      const administrator = await tx.execute<{ present: boolean }>(sql`
        select ${activeAdministratorCondition(proposedGrants(after.grants), sql`${space.organizationId}::uuid`)} as present`);
      if (!administrator.rows[0]?.present) {
        throw new SpaceError(
          "lastSpaceAdmin",
          "A space needs at least one space admin. Appoint another space admin before this change.",
        );
      }
      if (actor.type === "account") {
        const held = await accountRoleUnder(tx, actor.id, before);
        const next = await accountRoleUnder(tx, actor.id, after);
        if (spaceRoleRank(next) > spaceRoleRank(held)) {
          throw new SpaceError("selfExtension", "Nobody can extend their own permissions");
        }
      }
      const fields = (grant: SpaceGrantRow) => ({
        name: space.name,
        principalKind: grant.principalKind,
        principalId: grant.principalId,
        role: grant.role,
      });
      const scope = auditScopeOf(space);
      if (change.action === "grant") {
        const grant = {
          principalKind: change.principalKind,
          principalId: change.principalId,
          role: change.role,
        };
        await tx.execute(sql`
          insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
          values (${uuidv7()}, ${spaceId}, ${grant.principalKind}, ${grant.principalId}, ${grant.role},
            ${actorIdOf(actor)})`);
        await this.#audit.record(tx, {
          name: "space.permissionGranted",
          actor,
          targetId: spaceId,
          fields: fields(grant),
          scope,
        });
      } else {
        const existing = current.find(
          (permission) => permission.id === change.permissionId,
        ) as StoredPermission;
        if (change.action === "remove") {
          await tx.execute(sql`delete from space_permissions where id = ${change.permissionId}`);
          await this.#audit.record(tx, {
            name: "space.permissionRemoved",
            actor,
            targetId: spaceId,
            fields: fields(existing),
            scope,
          });
        } else if (existing.role !== change.role) {
          await tx.execute(
            sql`update space_permissions set role = ${change.role}, updated_at = now() where id = ${change.permissionId}`,
          );
          await this.#audit.record(tx, {
            name: "space.permissionChanged",
            actor,
            targetId: spaceId,
            fields: { ...fields({ ...existing, role: change.role }), previousRole: existing.role },
            scope,
          });
        }
      }
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
      for (const listener of this.#listeners) await listener(tx, spaceId);
    });
    return this.list(spaceId, options.tx);
  }
}
