import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import { accounts, instance } from "../accounts/schema.js";
import type { AuditEventInput, AuditEvents, AuditLog } from "../audit/audit-log.js";
import type { AuditEventName } from "../audit/catalog.js";
import { authChallenges, sessions } from "../auth/schema.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
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
import { providerDeactivations } from "../identity/schema.js";
import { responsiblesOf } from "../tokens/service-accounts.js";
import {
  customRoles,
  groupManagers,
  groupMembers,
  groups,
  type MembershipKind,
  memberships,
  roleAssignments,
} from "./access-schema.js";
import { OrganizationError } from "./organizations.js";
import { organizations } from "./schema.js";

export class LastOwnerError extends OrganizationError {
  constructor() {
    super("lastOwner", "The last owner of an organization cannot leave or be removed");
  }
}

export interface Member {
  accountId: string;
  name: string;
  jobTitle: string | null;
  pictureRef: string | null;
  email: string | null;
  accountType: string;
  kind: MembershipKind;
  expiresAt: Date | null;
  responsibleAccountId: string | null;
  roles: { assignmentId: string; role: string; customRoleId: string | null; expiresAt: Date | null }[];
  groups: { id: string; name: string }[];
  twoFactorActive: boolean;
  lastActiveAt: Date | null;
}

type Event = AuditEventInput<AuditEventName>;

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

function actorId(actor: Principal): string | null {
  return actor.type === "account" ? actor.id : null;
}

export async function claimHomeOrganization(
  tx: Transaction,
  accountId: string,
  organizationId: string,
): Promise<Event | null> {
  const claimed = await tx
    .update(accounts)
    .set({ homeOrganizationId: organizationId })
    .where(
      and(eq(accounts.id, accountId), eq(accounts.type, "standard"), isNull(accounts.homeOrganizationId)),
    )
    .returning({ id: accounts.id });
  if (claimed.length === 0) return null;
  return {
    name: "account.organizationAssigned",
    actor: SYSTEM,
    targetId: accountId,
    fields: { organizationId },
    scope: scopeOf(organizationId),
  };
}

export async function lockOrganization(tx: Transaction, organizationId: string): Promise<void> {
  const locked = await tx.execute(sql`select id from organizations where id = ${organizationId} for update`);
  if (locked.rows.length === 0) throw new OrganizationError("notFound", "The organization does not exist");
}

export async function ownerCount(
  tx: Transaction,
  organizationId: string,
  exclude: { accountId?: string; assignmentId?: string } = {},
): Promise<number> {
  const result = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count
    from role_assignments ra
    join accounts a on a.id = ra.principal_id
    join memberships m on m.account_id = a.id and m.organization_id = ra.organization_id
    where ra.organization_id = ${organizationId} and ra.scope = 'organization'
      and ra.principal_kind = 'account' and ra.built_in_role = 'owner'
      and a.state = 'active' and a.type = 'standard' and m.kind = 'member'
      and (m.expires_at is null or m.expires_at > now())
      ${exclude.accountId ? sql`and ra.principal_id <> ${exclude.accountId}` : sql``}
      ${exclude.assignmentId ? sql`and ra.id <> ${exclude.assignmentId}` : sql``}`);
  return result.rows[0]?.count ?? 0;
}

export class MembershipService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #deactivationListeners: ((tx: Transaction, accountId: string) => Promise<void>)[] = [];
  readonly #endListeners: ((tx: Transaction, organizationId: string, accountId: string) => Promise<void>)[] =
    [];

  constructor(options: { database: Database; audit: AuditLog; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
  }

  onDeactivated(listener: (tx: Transaction, accountId: string) => Promise<void>): void {
    this.#deactivationListeners.push(listener);
  }

  onMembershipEnded(
    listener: (tx: Transaction, organizationId: string, accountId: string) => Promise<void>,
  ): void {
    this.#endListeners.push(listener);
  }

  async #ended(tx: Transaction, organizationId: string, accountId: string): Promise<void> {
    for (const listener of this.#endListeners) await listener(tx, organizationId, accountId);
  }

  async list(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<Member>> {
    const sortName = sql<string>`lower(${accounts.name})`;
    const rows = await this.#database
      .select({
        sortName,
        accountId: memberships.accountId,
        name: accounts.name,
        jobTitle: accounts.jobTitle,
        pictureRef: accounts.pictureRef,
        email: accounts.email,
        accountType: accounts.type,
        kind: memberships.kind,
        expiresAt: memberships.expiresAt,
        responsibleAccountId: memberships.responsibleAccountId,
        lastActiveAt: accounts.lastActiveAt,
        twoFactorActive: sql<boolean>`(
          exists (select 1 from totp_credentials t where t.account_id = ${accounts.id} and t.confirmed_at is not null)
          or exists (select 1 from webauthn_credentials w where w.account_id = ${accounts.id}))`,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(accounts.state, "active"),
          or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
          afterKey([sortName, accounts.id], page.after),
          matchesSearch([accounts.name, accounts.email], page.search),
        ),
      )
      .orderBy(sortName, accounts.id)
      .limit(pageLimit(page));
    const result = toPage(
      rows,
      page,
      (row) => [row.sortName, row.accountId],
      ({ sortName: _sortName, ...row }) => row,
    );
    const accountIds = result.items.map((row) => row.accountId);
    if (accountIds.length === 0) return { items: [], next: null };
    const assignments = await this.#database
      .select({
        id: roleAssignments.id,
        accountId: roleAssignments.principalId,
        builtInRole: roleAssignments.builtInRole,
        customRoleId: roleAssignments.customRoleId,
        customRoleName: customRoles.name,
        expiresAt: roleAssignments.expiresAt,
      })
      .from(roleAssignments)
      .leftJoin(customRoles, eq(customRoles.id, roleAssignments.customRoleId))
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.principalKind, "account"),
          inArray(roleAssignments.principalId, accountIds),
          or(isNull(roleAssignments.expiresAt), sql`${roleAssignments.expiresAt} > now()`),
        ),
      )
      .orderBy(roleAssignments.id);
    const groupRows = await this.#database
      .select({ accountId: groupMembers.accountId, id: groups.id, name: groups.name })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groups.organizationId, organizationId),
          inArray(groupMembers.accountId, accountIds),
          or(isNull(groupMembers.expiresAt), sql`${groupMembers.expiresAt} > now()`),
        ),
      )
      .orderBy(sql`lower(${groups.name})`, groups.id);
    return {
      next: result.next,
      items: result.items.map((row) => ({
        ...row,
        twoFactorActive: row.twoFactorActive === true,
        groups: groupRows
          .filter((group) => group.accountId === row.accountId)
          .map((group) => ({ id: group.id, name: group.name })),
        roles: assignments
          .filter((assignment) => assignment.accountId === row.accountId)
          .map((assignment) => ({
            assignmentId: assignment.id,
            role: assignment.builtInRole ?? assignment.customRoleName ?? "",
            customRoleId: assignment.customRoleId,
            expiresAt: assignment.expiresAt,
          })),
      })),
    };
  }

  async add(
    tx: Transaction,
    actor: Principal,
    input: {
      organizationId: string;
      accountId: string;
      kind: MembershipKind;
      expiresAt?: Date | null;
      responsibleAccountId?: string | null;
    },
    options: { collect?: AuditEvents } = {},
  ): Promise<void> {
    if (input.kind !== "guest") {
      const [account] = await tx
        .select({ type: accounts.type })
        .from(accounts)
        .where(eq(accounts.id, input.accountId));
      if (account?.type === "guest" || account?.type === "portal") {
        throw new OrganizationError(
          "guestMembership",
          "Guest and portal accounts can only hold guest memberships",
        );
      }
    }
    const inserted = await tx
      .insert(memberships)
      .values({
        organizationId: input.organizationId,
        accountId: input.accountId,
        kind: input.kind,
        expiresAt: input.expiresAt ?? null,
        responsibleAccountId: input.kind === "guest" ? (input.responsibleAccountId ?? null) : null,
        createdBy: actorId(actor),
      })
      .onConflictDoNothing()
      .returning({ id: memberships.id });
    if (inserted.length === 0) {
      throw new OrganizationError("alreadyMember", "The account is already a member of the organization");
    }
    const event: Event = {
      name: "membership.added",
      actor,
      targetId: input.accountId,
      fields: { kind: input.kind, expiresAt: input.expiresAt?.toISOString() ?? null },
      scope: scopeOf(input.organizationId),
    };
    const events = [event];
    if (input.kind === "member") {
      const assigned = await claimHomeOrganization(tx, input.accountId, input.organizationId);
      if (assigned) events.push(assigned);
    }
    if (options.collect) options.collect.push(...events);
    else await this.#audit.recordMany(tx, events);
  }

  async #checkRank(
    tx: Transaction,
    actor: Principal,
    organizationId: string,
    targetId: string,
  ): Promise<void> {
    await this.#authorization.checkRankOverAccount(actor, organizationId, targetId, {
      executor: tx,
      action: "organization.members.manage",
    });
  }

  async #detach(
    tx: Transaction,
    actor: Principal,
    organizationId: string,
    accountId: string,
    reason: "removed" | "anonymized" = "removed",
  ): Promise<Event[]> {
    const events: Event[] = [];
    const removedAssignments = await tx
      .delete(roleAssignments)
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.principalKind, "account"),
          eq(roleAssignments.principalId, accountId),
        ),
      )
      .returning({
        id: roleAssignments.id,
        builtInRole: roleAssignments.builtInRole,
        customRoleId: roleAssignments.customRoleId,
      });
    for (const assignment of removedAssignments) {
      events.push({
        name: "role.unassigned",
        actor,
        targetId: assignment.id,
        fields: {
          role: assignment.builtInRole ?? assignment.customRoleId ?? "",
          principalKind: "account",
          principalId: accountId,
          reason,
        },
        scope: scopeOf(organizationId),
      });
    }
    const organizationGroups = tx
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.organizationId, organizationId));
    const removedMemberships = await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.accountId, accountId), inArray(groupMembers.groupId, organizationGroups)))
      .returning({ groupId: groupMembers.groupId });
    for (const removed of removedMemberships) {
      events.push({
        name: "group.memberRemoved",
        actor,
        targetId: removed.groupId,
        fields: { accountId, reason },
        scope: scopeOf(organizationId),
      });
    }
    const removedManagers = await tx
      .delete(groupManagers)
      .where(and(eq(groupManagers.accountId, accountId), inArray(groupManagers.groupId, organizationGroups)))
      .returning({ groupId: groupManagers.groupId });
    for (const removed of removedManagers) {
      events.push({
        name: "group.managerRemoved",
        actor,
        targetId: removed.groupId,
        fields: { accountId },
        scope: scopeOf(organizationId),
      });
    }
    events.push(...(await this.#releaseGuests(tx, actor, accountId, organizationId)));
    return events;
  }

  async #releaseGuests(
    tx: Transaction,
    actor: Principal,
    responsibleAccountId: string,
    organizationId?: string,
  ): Promise<Event[]> {
    const released = await tx
      .update(memberships)
      .set({ responsibleAccountId: null, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.responsibleAccountId, responsibleAccountId),
          organizationId ? eq(memberships.organizationId, organizationId) : undefined,
        ),
      )
      .returning({ organizationId: memberships.organizationId, accountId: memberships.accountId });
    const releasedServiceAccounts = await tx.execute<{
      service_account_id: string;
      organization_id: string;
    }>(sql`
      delete from service_account_responsibles r using service_accounts s
      where s.account_id = r.service_account_id and r.account_id = ${responsibleAccountId}
        ${organizationId ? sql`and s.organization_id = ${organizationId}` : sql``}
      returning r.service_account_id, s.organization_id`);
    const remaining = await responsiblesOf(
      tx,
      releasedServiceAccounts.rows.map((row) => row.service_account_id),
    );
    return [
      ...released.map((guest) => ({
        name: "guest.responsibleChanged" as const,
        actor,
        targetId: guest.accountId,
        fields: { responsibleAccountId: null },
        scope: scopeOf(guest.organizationId),
      })),
      ...releasedServiceAccounts.rows.map((row) => ({
        name: "serviceAccount.responsiblesChanged" as const,
        actor,
        targetId: row.service_account_id,
        fields: { responsibleAccountIds: remaining.get(row.service_account_id) ?? [] },
        scope: scopeOf(row.organization_id),
      })),
    ];
  }

  async remove(
    actor: Principal,
    organizationId: string,
    accountId: string,
    reason: "removed" | "left" | "providerRule" = "removed",
    options: { tx?: Transaction; releaseHome?: boolean } = {},
  ): Promise<boolean> {
    const run = async (tx: Transaction) => {
      await lockOrganization(tx, organizationId);
      const [membership] = await tx
        .select({ kind: memberships.kind })
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.accountId, accountId)));
      if (!membership) return false;
      const [account] = await tx
        .select({ home: accounts.homeOrganizationId })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      if (account?.home === organizationId && !options.releaseHome) {
        throw new OrganizationError(
          "homeOrganization",
          "An account cannot leave its home organization; deactivate the account instead",
        );
      }
      if (reason === "removed") await this.#checkRank(tx, actor, organizationId, accountId);
      if (
        (await ownerCount(tx, organizationId)) > 0 &&
        (await ownerCount(tx, organizationId, { accountId })) === 0
      ) {
        throw new LastOwnerError();
      }
      await tx
        .delete(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.accountId, accountId)));
      const events = await this.#detach(tx, actor, organizationId, accountId);
      events.unshift({
        name: "membership.removed",
        actor,
        targetId: accountId,
        fields: { kind: membership.kind, reason },
        scope: scopeOf(organizationId),
      });
      await this.#audit.recordMany(tx, events);
      await this.#ended(tx, organizationId, accountId);
      return true;
    };
    return options.tx ? run(options.tx) : this.#database.transaction(run);
  }

  async endAll(
    tx: Transaction,
    actor: Principal,
    accountId: string,
  ): Promise<{ events: AuditEvents; ended: number }> {
    const held = await tx
      .select({ organizationId: memberships.organizationId, kind: memberships.kind })
      .from(memberships)
      .where(eq(memberships.accountId, accountId))
      .orderBy(asc(memberships.organizationId));
    const events: Event[] = [];
    for (const membership of held) {
      await lockOrganization(tx, membership.organizationId);
      if (
        (await ownerCount(tx, membership.organizationId)) > 0 &&
        (await ownerCount(tx, membership.organizationId, { accountId })) === 0
      ) {
        throw new LastOwnerError();
      }
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, membership.organizationId),
            eq(memberships.accountId, accountId),
          ),
        );
      events.push({
        name: "membership.removed",
        actor,
        targetId: accountId,
        fields: { kind: membership.kind, reason: "anonymized" },
        scope: scopeOf(membership.organizationId),
      });
      events.push(...(await this.#detach(tx, actor, membership.organizationId, accountId, "anonymized")));
      await this.#ended(tx, membership.organizationId, accountId);
    }
    const instanceRoles = await tx
      .delete(roleAssignments)
      .where(and(eq(roleAssignments.principalKind, "account"), eq(roleAssignments.principalId, accountId)))
      .returning({
        id: roleAssignments.id,
        organizationId: roleAssignments.organizationId,
        builtInRole: roleAssignments.builtInRole,
        customRoleId: roleAssignments.customRoleId,
      });
    for (const assignment of instanceRoles) {
      events.push({
        name: "role.unassigned",
        actor,
        targetId: assignment.id,
        fields: {
          role: assignment.builtInRole ?? assignment.customRoleId ?? "",
          principalKind: "account",
          principalId: accountId,
          reason: "anonymized",
        },
        ...(assignment.organizationId ? { scope: scopeOf(assignment.organizationId) } : {}),
      });
    }
    events.push(...(await this.#releaseGuests(tx, actor, accountId)));
    return { events, ended: held.length };
  }

  async expire(organizationId: string, accountId: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const [membership] = await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.accountId, accountId),
            sql`${memberships.expiresAt} <= now()`,
          ),
        )
        .returning({ kind: memberships.kind });
      if (!membership) return false;
      const events = await this.#detach(tx, SYSTEM, organizationId, accountId);
      events.unshift({
        name: "membership.removed",
        actor: SYSTEM,
        targetId: accountId,
        fields: { kind: membership.kind, reason: "expired" },
        scope: scopeOf(organizationId),
      });
      await this.#audit.recordMany(tx, events);
      await this.#ended(tx, organizationId, accountId);
      return true;
    });
  }

  async update(
    actor: Principal,
    organizationId: string,
    accountId: string,
    input: { expiresAt?: Date | null; responsibleAccountId?: string | null },
  ): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.accountId, accountId)))
        .for("update");
      if (!membership) return false;
      await this.#checkRank(tx, actor, organizationId, accountId);
      if (
        input.expiresAt &&
        (await ownerCount(tx, organizationId)) !== (await ownerCount(tx, organizationId, { accountId }))
      ) {
        throw new OrganizationError("ownerExpiry", "The membership of an owner cannot expire");
      }
      if (input.responsibleAccountId !== undefined && membership.kind !== "guest") {
        throw new OrganizationError("notGuest", "Only guests have a responsible person");
      }
      if (input.responsibleAccountId) {
        const [responsible] = await tx
          .select({ kind: memberships.kind })
          .from(memberships)
          .innerJoin(accounts, eq(accounts.id, memberships.accountId))
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.accountId, input.responsibleAccountId),
              eq(accounts.state, "active"),
            ),
          );
        if (responsible?.kind !== "member") {
          throw new OrganizationError(
            "invalidResponsible",
            "The responsible person must be a member of the organization",
          );
        }
      }
      const expiresAt = input.expiresAt === undefined ? membership.expiresAt : input.expiresAt;
      const responsibleAccountId =
        input.responsibleAccountId === undefined
          ? membership.responsibleAccountId
          : input.responsibleAccountId;
      await tx
        .update(memberships)
        .set({ expiresAt, responsibleAccountId, expiryRemindedAt: null, updatedAt: new Date() })
        .where(eq(memberships.id, membership.id));
      await this.#audit.record(tx, {
        name: "membership.updated",
        actor,
        targetId: accountId,
        fields: { expiresAt: expiresAt?.toISOString() ?? null, responsibleAccountId },
        scope: scopeOf(organizationId),
      });
      return true;
    });
  }

  async deactivate(
    actor: Principal,
    accountId: string,
    options: { byProvider?: { providerId: string; state: "disabled" | "deleted" } } = {},
  ): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: accounts.id, state: accounts.state, home: accounts.homeOrganizationId })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (actor.type === "account" && target && actor.id === target.id) {
        throw new OrganizationError("deactivateSelf", "An account cannot deactivate itself");
      }
      if (target?.state !== "active") throw new OrganizationError("notFound", "The account is not active");
      const [owner] = await tx.select({ id: instance.ownerAccountId }).from(instance);
      if (owner?.id === target.id) {
        throw new OrganizationError("instanceOwner", "Transfer the ownership of the instance first");
      }
      if (actor.type === "account") {
        const instanceAreas = await this.#authorization.heldAreas(actor.id, "instance", null, tx);
        const targetInstanceAreas = await this.#authorization.heldAreas(accountId, "instance", null, tx);
        if (Object.keys(targetInstanceAreas).length > 0 && owner?.id !== actor.id) {
          throw new ForbiddenError({
            action: "account.deactivate",
            resource: { type: "account", id: accountId },
            allowed: false,
            grants: [],
            denials: ["ownerOnly"],
          });
        }
        await this.#authorization.checkOwnersOverAccount(actor, target.id, {
          executor: tx,
          action: "account.deactivate",
        });
        if (target.home) {
          const homeOwner = await this.#authorization.isOrganizationOwner(accountId, target.home, tx);
          const instanceAdministrator = instanceAreas.accounts === "manage";
          if (!instanceAdministrator || (homeOwner && owner?.id !== actor.id))
            await this.#checkRank(tx, actor, target.home, accountId);
        }
      }
      const owned = await tx
        .selectDistinct({ organizationId: roleAssignments.organizationId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.principalKind, "account"),
            eq(roleAssignments.principalId, accountId),
            eq(roleAssignments.builtInRole, "owner"),
          ),
        )
        .orderBy(asc(roleAssignments.organizationId));
      for (const { organizationId } of owned) {
        if (!organizationId) continue;
        await lockOrganization(tx, organizationId);
        if ((await ownerCount(tx, organizationId, { accountId })) === 0) throw new LastOwnerError();
      }
      await tx
        .update(accounts)
        .set({ state: "deactivated", updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      await tx.delete(providerDeactivations).where(eq(providerDeactivations.accountId, target.id));
      if (options.byProvider) {
        await tx
          .insert(providerDeactivations)
          .values({ accountId: target.id, providerId: options.byProvider.providerId });
      }
      const ended = await tx
        .delete(sessions)
        .where(eq(sessions.accountId, accountId))
        .returning({ id: sessions.id });
      await tx.delete(authChallenges).where(eq(authChallenges.accountId, accountId));
      const revoked = await tx.execute<{ id: string; organization_id: string | null }>(sql`
        update api_tokens set revoked_at = now(), updated_at = now()
        where account_id = ${accountId} and revoked_at is null
        returning id, organization_id`);
      const events = await this.#releaseGuests(tx, actor, accountId);
      for (const token of revoked.rows) {
        const scope = token.organization_id ?? target.home;
        events.push({
          name: "apiToken.revoked",
          actor,
          targetId: token.id,
          fields: { accountId, reason: "accountDeactivated" },
          ...(scope ? { scope: scopeOf(scope) } : {}),
        });
      }
      events.unshift({
        name: "account.deactivated",
        actor,
        targetId: accountId,
        fields: { endedSessions: ended.length },
        ...(target.home ? { scope: scopeOf(target.home) } : {}),
      });
      if (options.byProvider) {
        events.push({
          name: "account.deactivatedByProvider",
          actor,
          targetId: accountId,
          fields: { providerId: options.byProvider.providerId, state: options.byProvider.state },
        });
      }
      for (const listener of this.#deactivationListeners) await listener(tx, accountId);
      await this.#audit.recordMany(tx, events);
      return ended.length;
    });
  }

  async transferOwnership(actor: Principal, newOwnerId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const [current] = await tx.select({ owner: instance.ownerAccountId }).from(instance).for("update");
      if (!current?.owner || (actor.type === "account" && actor.id !== current.owner)) {
        throw new ForbiddenError({
          action: "instance.ownership.transfer",
          resource: { type: "instance" },
          allowed: false,
          grants: [],
          denials: ["ownerOnly"],
        });
      }
      if (current.owner === newOwnerId) return;
      const [candidate] = await tx
        .execute<{ id: string }>(sql`
        select a.id from accounts a join role_assignments ra
          on ra.principal_id = a.id and ra.principal_kind = 'account' and ra.scope = 'instance'
        where a.id = ${newOwnerId} and a.state = 'active' and a.type = 'standard'
          and ra.built_in_role = 'administrator' and (ra.expires_at is null or ra.expires_at > now())`)
        .then((result) => result.rows);
      if (!candidate) {
        throw new OrganizationError("invalidOwner", "The new owner must be an active instance administrator");
      }
      await tx
        .update(instance)
        .set({ ownerAccountId: newOwnerId, updatedAt: new Date() })
        .where(eq(instance.id, 1));
      const [assignment] = await tx
        .insert(roleAssignments)
        .values({
          scope: "instance",
          principalKind: "account",
          principalId: current.owner,
          builtInRole: "administrator",
          createdBy: actorId(actor),
        })
        .onConflictDoNothing()
        .returning({ id: roleAssignments.id });
      const events: Event[] = [
        {
          name: "instance.ownershipTransferred",
          actor,
          targetId: newOwnerId,
          fields: { previousOwnerId: current.owner },
        },
      ];
      if (assignment) {
        events.push({
          name: "role.assigned",
          actor,
          targetId: assignment.id,
          fields: {
            role: "administrator",
            customRoleId: null,
            principalKind: "account",
            principalId: current.owner,
            expiresAt: null,
          },
        });
      }
      await this.#audit.recordMany(tx, events);
    });
  }

  async organizationExists(id: string): Promise<boolean> {
    const [row] = await this.#database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, id));
    return row !== undefined;
  }
}
