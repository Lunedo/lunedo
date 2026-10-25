import { groupDescriptionSchema, groupNameSchema } from "@lunedo/shared";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AccessReductions } from "../authorization/access-reductions.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import {
  afterKey,
  FIRST_PAGE,
  matchesSearch,
  type Page,
  type PageRequest,
  pageLimit,
  toPage,
} from "../database/keyset.js";
import { identityProviders, managedGroups } from "../identity/schema.js";
import { groupManagers, groupMembers, groups, memberships, roleAssignments } from "./access-schema.js";
import { lockOrganization } from "./memberships.js";
import { OrganizationError } from "./organizations.js";

export { groupDescriptionSchema, groupNameSchema };

export interface Group {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  managedBy?: { providerId: string; providerName: string } | null;
  formerlySynchronizedFrom?: string | null;
  memberCount?: number;
}

export interface GroupDetails extends Group {
  managers: { accountId: string; name: string }[];
}

export interface GroupMember {
  accountId: string;
  name: string;
  jobTitle: string | null;
  pictureRef: string | null;
  expiresAt: Date | null;
}

function managedBy(providerId: string | null, providerName: string | null) {
  return providerId ? { providerId, providerName: providerName ?? "" } : null;
}

export async function assertNotManaged(
  executor: Pick<Transaction, "select">,
  groupId: string,
): Promise<void> {
  const [managed] = await executor
    .select({ providerId: managedGroups.providerId })
    .from(managedGroups)
    .where(eq(managedGroups.groupId, groupId));
  if (managed) {
    throw new OrganizationError(
      "groupManagedByProvider",
      "Members of a synchronized group are managed by its identity provider",
    );
  }
}

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

function actorId(actor: Principal): string | null {
  return actor.type === "account" ? actor.id : null;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  return details.code === "23505" && details.constraint === constraint;
}

export class GroupService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #reductions: AccessReductions | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    reductions?: AccessReductions;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#reductions = options.reductions;
  }

  async list(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<Group>> {
    const sortName = sql<string>`lower(${groups.name})`;
    const rows = await this.#database
      .select({
        id: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        description: groups.description,
        formerlySynchronizedFrom: groups.formerProvider,
        managedProviderId: managedGroups.providerId,
        managedProviderName: identityProviders.name,
        memberCount: sql<number>`(
          select count(*)::int from ${groupMembers} gm
          join ${accounts} a on a.id = gm.account_id
          where gm.group_id = ${groups.id} and a.state = 'active'
            and (gm.expires_at is null or gm.expires_at > now()))`,
        sortName,
      })
      .from(groups)
      .leftJoin(managedGroups, eq(managedGroups.groupId, groups.id))
      .leftJoin(identityProviders, eq(identityProviders.id, managedGroups.providerId))
      .where(
        and(
          eq(groups.organizationId, organizationId),
          afterKey([sortName, groups.id], page.after),
          matchesSearch([groups.name, groups.description], page.search),
        ),
      )
      .orderBy(sortName, groups.id)
      .limit(pageLimit(page));
    return toPage(
      rows,
      page,
      (row) => [row.sortName, row.id],
      ({ sortName: _sortName, managedProviderId, managedProviderName, memberCount, ...row }) => ({
        ...row,
        memberCount: Number(memberCount),
        managedBy: managedBy(managedProviderId, managedProviderName),
      }),
    );
  }

  async members(groupId: string, page: PageRequest = FIRST_PAGE): Promise<Page<GroupMember>> {
    const sortName = sql<string>`lower(${accounts.name})`;
    const rows = await this.#database
      .select({
        accountId: groupMembers.accountId,
        name: accounts.name,
        jobTitle: accounts.jobTitle,
        pictureRef: accounts.pictureRef,
        expiresAt: groupMembers.expiresAt,
        sortName,
      })
      .from(groupMembers)
      .innerJoin(accounts, eq(accounts.id, groupMembers.accountId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          or(isNull(groupMembers.expiresAt), sql`${groupMembers.expiresAt} > now()`),
          afterKey([sortName, accounts.id], page.after),
        ),
      )
      .orderBy(sortName, accounts.id)
      .limit(pageLimit(page));
    return toPage(
      rows,
      page,
      (row) => [row.sortName, row.accountId],
      ({ sortName: _sortName, ...row }) => row,
    );
  }

  async get(id: string): Promise<GroupDetails | null> {
    const [group] = await this.#database
      .select({
        id: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        description: groups.description,
        formerlySynchronizedFrom: groups.formerProvider,
        managedProviderId: managedGroups.providerId,
        managedProviderName: identityProviders.name,
      })
      .from(groups)
      .leftJoin(managedGroups, eq(managedGroups.groupId, groups.id))
      .leftJoin(identityProviders, eq(identityProviders.id, managedGroups.providerId))
      .where(eq(groups.id, id));
    if (!group) return null;
    const managers = await this.#database
      .select({ accountId: groupManagers.accountId, name: accounts.name })
      .from(groupManagers)
      .innerJoin(accounts, eq(accounts.id, groupManagers.accountId))
      .where(eq(groupManagers.groupId, id))
      .orderBy(asc(accounts.name));
    const { managedProviderId, managedProviderName, ...rest } = group;
    return { ...rest, managedBy: managedBy(managedProviderId, managedProviderName), managers };
  }

  async #lockGroup(tx: Transaction, id: string): Promise<Group> {
    const [group] = await tx
      .select({ organizationId: groups.organizationId })
      .from(groups)
      .where(eq(groups.id, id));
    if (!group) throw new OrganizationError("groupNotFound", "The group does not exist");
    await lockOrganization(tx, group.organizationId);
    const [locked] = await tx
      .select({
        id: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        description: groups.description,
      })
      .from(groups)
      .where(eq(groups.id, id))
      .for("update");
    if (!locked) throw new OrganizationError("groupNotFound", "The group does not exist");
    return locked;
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: { name: string; description?: string },
    options: { tx?: Transaction } = {},
  ): Promise<Group> {
    const name = groupNameSchema.parse(input.name);
    const description = groupDescriptionSchema.parse(input.description ?? "");
    const create = async (tx: Transaction) => {
      await lockOrganization(tx, organizationId);
      let group: Group | undefined;
      try {
        [group] = await tx
          .insert(groups)
          .values({ organizationId, name, description, createdBy: actorId(actor) })
          .returning({
            id: groups.id,
            organizationId: groups.organizationId,
            name: groups.name,
            description: groups.description,
          });
      } catch (error) {
        if (isUniqueViolation(error, "groups_name_unique")) {
          throw new OrganizationError("groupNameTaken", "A group with this name exists already");
        }
        throw error;
      }
      if (!group) throw new Error("The group was not created");
      const events: Parameters<AuditLog["recordMany"]>[1] = [
        {
          name: "group.created",
          actor,
          targetId: group.id,
          fields: { name },
          scope: scopeOf(organizationId),
        },
      ];
      if (actor.type === "account") {
        await tx.insert(groupManagers).values({ groupId: group.id, accountId: actor.id });
        events.push({
          name: "group.managerAdded",
          actor,
          targetId: group.id,
          fields: { accountId: actor.id },
          scope: scopeOf(organizationId),
        });
      }
      await this.#audit.recordMany(tx, events);
      return group;
    };
    return options.tx ? create(options.tx) : this.#database.transaction(create);
  }

  async update(actor: Principal, id: string, input: { name?: string; description?: string }): Promise<Group> {
    return this.#database.transaction(async (tx) => {
      const current = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      const name = input.name === undefined ? current.name : groupNameSchema.parse(input.name);
      const description =
        input.description === undefined
          ? current.description
          : groupDescriptionSchema.parse(input.description);
      try {
        await tx.update(groups).set({ name, description, updatedAt: new Date() }).where(eq(groups.id, id));
      } catch (error) {
        if (isUniqueViolation(error, "groups_name_unique")) {
          throw new OrganizationError("groupNameTaken", "A group with this name exists already");
        }
        throw error;
      }
      await this.#audit.record(tx, {
        name: "group.updated",
        actor,
        targetId: id,
        fields: { name, description, previous: { name: current.name, description: current.description } },
        scope: scopeOf(current.organizationId),
      });
      return { ...current, name, description };
    });
  }

  async delete(actor: Principal, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const group = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      await this.#authorization.checkRank(
        actor,
        {
          scope: "organization",
          organizationId: group.organizationId,
          areas: await this.#authorization.groupAreas(id, tx),
          action: "group.delete",
        },
        { executor: tx },
      );
      await tx
        .delete(roleAssignments)
        .where(and(eq(roleAssignments.principalKind, "group"), eq(roleAssignments.principalId, id)));
      await tx.delete(groups).where(eq(groups.id, id));
      await this.#audit.record(tx, {
        name: "group.deleted",
        actor,
        targetId: id,
        fields: { name: group.name },
        scope: scopeOf(group.organizationId),
      });
      await this.#reductions?.reduced(tx, { organizationId: group.organizationId, accountId: null });
    });
  }

  async addMember(
    actor: Principal,
    id: string,
    accountId: string,
    expiresAt: Date | null = null,
  ): Promise<void> {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new OrganizationError("expiryInPast", "The expiry must be in the future");
    }
    await this.#database.transaction(async (tx) => {
      const group = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      const [membership] = await tx
        .select({ kind: memberships.kind })
        .from(memberships)
        .innerJoin(accounts, eq(accounts.id, memberships.accountId))
        .where(
          and(
            eq(memberships.organizationId, group.organizationId),
            eq(memberships.accountId, accountId),
            eq(accounts.state, "active"),
            or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
          ),
        );
      if (!membership)
        throw new OrganizationError("notMember", "Groups contain members of their organization");
      await this.#authorization.checkGrant(
        actor,
        {
          scope: "organization",
          organizationId: group.organizationId,
          areas: await this.#authorization.groupAreas(id, tx),
          principal: { kind: "account", id: accountId },
          action: "group.manage",
        },
        { executor: tx },
      );
      const inserted = await tx
        .insert(groupMembers)
        .values({ groupId: id, accountId, expiresAt, createdBy: actorId(actor) })
        .onConflictDoUpdate({
          target: [groupMembers.groupId, groupMembers.accountId],
          set: { expiresAt, expiryRemindedAt: null, updatedAt: new Date() },
        })
        .returning({ accountId: groupMembers.accountId });
      if (inserted.length === 0) return;
      if (actor.type === "account" && actor.id === accountId) {
        await this.#audit.record(tx, {
          name: "group.selfAdded",
          actor,
          targetId: id,
          fields: {
            accountId,
            source: "member",
            importId: null,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          scope: scopeOf(group.organizationId),
        });
        return;
      }
      await this.#audit.record(tx, {
        name: "group.memberAdded",
        actor,
        targetId: id,
        fields: { accountId, expiresAt: expiresAt?.toISOString() ?? null },
        scope: scopeOf(group.organizationId),
      });
    });
  }

  async removeMember(actor: Principal, id: string, accountId: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const group = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      const deleted = await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, id), eq(groupMembers.accountId, accountId)))
        .returning({ accountId: groupMembers.accountId });
      if (deleted.length === 0) return false;
      await this.#audit.record(tx, {
        name: "group.memberRemoved",
        actor,
        targetId: id,
        fields: { accountId, reason: "removed" },
        scope: scopeOf(group.organizationId),
      });
      await this.#reductions?.reduced(tx, { organizationId: group.organizationId, accountId });
      return true;
    });
  }

  async addManager(actor: Principal, id: string, accountId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const group = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      const [membership] = await tx
        .select({ kind: memberships.kind })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, group.organizationId),
            eq(memberships.accountId, accountId),
            or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
          ),
        );
      if (membership?.kind !== "member") {
        throw new OrganizationError("notMember", "Group managers are members of the organization");
      }
      const inserted = await tx
        .insert(groupManagers)
        .values({ groupId: id, accountId })
        .onConflictDoNothing()
        .returning({ accountId: groupManagers.accountId });
      if (inserted.length === 0) return;
      await this.#audit.record(tx, {
        name: "group.managerAdded",
        actor,
        targetId: id,
        fields: { accountId },
        scope: scopeOf(group.organizationId),
      });
    });
  }

  async removeManager(actor: Principal, id: string, accountId: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const group = await this.#lockGroup(tx, id);
      await assertNotManaged(tx, id);
      const deleted = await tx
        .delete(groupManagers)
        .where(and(eq(groupManagers.groupId, id), eq(groupManagers.accountId, accountId)))
        .returning({ accountId: groupManagers.accountId });
      if (deleted.length === 0) return false;
      await this.#audit.record(tx, {
        name: "group.managerRemoved",
        actor,
        targetId: id,
        fields: { accountId },
        scope: scopeOf(group.organizationId),
      });
      return true;
    });
  }
}
