import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import type { AccessReductions } from "../authorization/access-reductions.js";
import type { Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { groupMembers, groups, memberships, roleAssignments } from "../organizations/access-schema.js";
import type { HomeOrganizationService } from "../organizations/home.js";
import { claimHomeOrganization, type MembershipService } from "../organizations/memberships.js";
import type { RoleService } from "../organizations/roles.js";
import { type ProviderGroup, plainText } from "./adapter.js";
import {
  identities,
  identityGroups,
  identityProviders,
  managedGroups,
  mappingRules,
  providerGrants,
  providerGroups,
  providerSyncRuns,
} from "./schema.js";
import { withheldRoles } from "./withheld.js";

export type SyncChangeKind =
  | "membershipAdded"
  | "membershipRemoved"
  | "roleAdded"
  | "roleRemoved"
  | "groupMemberAdded"
  | "groupMemberRemoved"
  | "groupRenamed"
  | "profileUpdated"
  | "accountDeactivated"
  | "accountReactivated"
  | "homeOrganizationChanged"
  | "accountCreated"
  | "groupCreated"
  | "groupDeleted";

export interface SyncChange {
  kind: SyncChangeKind;
  accountId: string | null;
  organizationId: string | null;
  detail: string | null;
}

export type SyncWarningKind =
  | "missingGroup"
  | "grantRefused"
  | "removalRefused"
  | "accountFailed"
  | "deactivationRefused"
  | "memberUnknown"
  | "deactivationLimit"
  | "noAccountsFound";

export interface SyncWarning {
  kind: SyncWarningKind;
  accountId: string | null;
  ruleId: string | null;
  detail: string | null;
}

export interface SyncReport {
  changes: SyncChange[];
  warnings: SyncWarning[];
  mailIds: string[];
}

export function emptyReport(): SyncReport {
  return { changes: [], warnings: [], mailIds: [] };
}

type RoleKey = { builtIn: "owner" | "administrator" | "securityAuditor" } | { customRoleId: string };

interface DesiredGrant {
  key: string;
  kind: "membership" | "role" | "groupMember";
  organizationId: string | null;
  role: RoleKey | null;
  groupId: string | null;
  home: number | null;
}

function roleKey(role: RoleKey): string {
  return "builtIn" in role ? role.builtIn : `custom:${role.customRoleId}`;
}

function message(error: unknown): string {
  return plainText(error instanceof Error ? error.message : String(error));
}

const GROUP_NAME_MAX = 100;

export async function synchronizedGroupName(
  executor: Executor,
  organizationId: string,
  name: string,
  providerName: string,
  exceptGroupId: string | null,
): Promise<string | null> {
  for (const candidate of [name, `${name} (${providerName})`]) {
    const trimmed = candidate.slice(0, GROUP_NAME_MAX);
    const [taken] = await executor
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.organizationId, organizationId),
          sql`lower(${groups.name}) = lower(${trimmed})`,
          exceptGroupId ? sql`${groups.id} <> ${exceptGroupId}` : sql`true`,
        ),
      );
    if (!taken) return trimmed;
  }
  return null;
}

export class GroupMappingService {
  readonly #roles: RoleService;
  readonly #memberships: MembershipService;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService | undefined;
  readonly #home: HomeOrganizationService | undefined;
  readonly #reductions: AccessReductions | undefined;

  constructor(options: {
    roles: RoleService;
    memberships: MembershipService;
    audit: AuditLog;
    notifications?: NotificationService;
    home?: HomeOrganizationService;
    reductions?: AccessReductions;
  }) {
    this.#roles = options.roles;
    this.#memberships = options.memberships;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#home = options.home;
    this.#reductions = options.reductions;
  }

  async dispatch(mailIds: readonly string[]): Promise<void> {
    if (mailIds.length > 0) await this.#notifications?.dispatch([...mailIds]);
  }

  async groupReadFailed(tx: Transaction, identityId: string, accountId: string): Promise<string[]> {
    await tx.update(identities).set({ groupsReadFailedAt: new Date() }).where(eq(identities.id, identityId));
    const withheld = await withheldRoles(tx, accountId);
    if (withheld.length === 0 || !this.#notifications) return [];
    const [identity] = await tx
      .select({ notifiedAt: identities.groupsWithheldNotifiedAt })
      .from(identities)
      .where(eq(identities.id, identityId));
    if (identity?.notifiedAt) return [];
    await tx
      .update(identities)
      .set({ groupsWithheldNotifiedAt: new Date() })
      .where(eq(identities.id, identityId));
    const [account] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    const result = await this.#notifications.notify(tx, {
      type: "account.rolesWithheld",
      recipients: await instanceAdministratorIds(tx),
      organizationId: null,
      targetId: accountId,
      params: {
        accountName: account?.name ?? "",
        providerName: withheld[0]?.providerName ?? "",
        roles: withheld.length,
      },
    });
    return result.mailIds;
  }

  async recordGroups(
    tx: Transaction,
    providerId: string,
    identityId: string,
    groups: readonly ProviderGroup[],
    report: SyncReport,
  ): Promise<void> {
    const unique = [...new Map(groups.map((group) => [group.id, group])).values()];
    const ids: string[] = [];
    for (const group of unique) {
      const [existing] = await tx
        .select({ id: providerGroups.id, name: providerGroups.name })
        .from(providerGroups)
        .where(and(eq(providerGroups.providerId, providerId), eq(providerGroups.externalId, group.id)))
        .for("update");
      if (existing) {
        ids.push(existing.id);
        const renamed = group.name !== null && group.name !== existing.name;
        if (renamed) {
          report.changes.push({
            kind: "groupRenamed",
            accountId: null,
            organizationId: null,
            detail: `${existing.name ?? group.id} → ${group.name}`,
          });
        }
        await tx
          .update(providerGroups)
          .set({
            ...(renamed ? { name: group.name } : {}),
            missingSince: null,
            seenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(providerGroups.id, existing.id));
        if (renamed && group.name) await this.renameManagedGroups(tx, existing.id, group.name, report);
        continue;
      }
      const [inserted] = await tx
        .insert(providerGroups)
        .values({ providerId, externalId: group.id, name: group.name, seenAt: new Date() })
        .onConflictDoUpdate({
          target: [providerGroups.providerId, providerGroups.externalId],
          set: { missingSince: null, seenAt: new Date(), updatedAt: new Date() },
        })
        .returning({ id: providerGroups.id });
      if (inserted) ids.push(inserted.id);
    }
    await tx
      .delete(identityGroups)
      .where(
        and(
          eq(identityGroups.identityId, identityId),
          ids.length > 0 ? notInArray(identityGroups.groupId, ids) : sql`true`,
        ),
      );
    if (ids.length > 0) {
      await tx
        .insert(identityGroups)
        .values(ids.map((groupId) => ({ identityId, groupId })))
        .onConflictDoNothing();
    }
    await tx
      .update(identities)
      .set({ groupsReadAt: new Date(), groupsReadFailedAt: null, groupsWithheldNotifiedAt: null })
      .where(eq(identities.id, identityId));
  }

  async renameManagedGroups(
    tx: Transaction,
    providerGroupId: string,
    name: string,
    report: SyncReport,
  ): Promise<void> {
    const managed = await tx
      .select({
        id: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        description: groups.description,
        providerName: identityProviders.name,
      })
      .from(managedGroups)
      .innerJoin(groups, eq(groups.id, managedGroups.groupId))
      .innerJoin(identityProviders, eq(identityProviders.id, managedGroups.providerId))
      .where(eq(managedGroups.providerGroupId, providerGroupId))
      .for("update", { of: groups });
    for (const group of managed) {
      const next = await synchronizedGroupName(tx, group.organizationId, name, group.providerName, group.id);
      if (!next || next === group.name) continue;
      await tx.update(groups).set({ name: next, updatedAt: new Date() }).where(eq(groups.id, group.id));
      await this.#audit.record(tx, {
        name: "group.updated",
        actor: SYSTEM,
        targetId: group.id,
        fields: { name: next, description: group.description, previous: { name: group.name } },
        scope: { type: "organization", id: group.organizationId },
      });
      report.changes.push({
        kind: "groupRenamed",
        accountId: null,
        organizationId: group.organizationId,
        detail: `${group.name} → ${next}`,
      });
    }
  }

  async applyAtSignIn(
    tx: Transaction,
    link: {
      providerId: string;
      identityId: string;
      accountId: string;
      groups: readonly ProviderGroup[] | null;
      groupsFailed?: boolean;
    },
    mailIds: string[] = [],
  ): Promise<SyncReport> {
    const report = emptyReport();
    if (link.groups !== null)
      await this.recordGroups(tx, link.providerId, link.identityId, link.groups, report);
    else if (link.groupsFailed)
      mailIds.push(...(await this.groupReadFailed(tx, link.identityId, link.accountId)));
    await this.reconcile(tx, link.accountId, report);
    mailIds.push(...report.mailIds);
    if (report.warnings.length > 0) {
      await tx.insert(providerSyncRuns).values({
        providerId: link.providerId,
        trigger: "signIn",
        status: "warnings",
        finishedAt: new Date(),
        changes: report.changes,
        warnings: report.warnings,
      });
    }
    return report;
  }

  async groupsOf(executor: Executor, identityId: string): Promise<ProviderGroup[]> {
    return executor
      .select({ id: providerGroups.externalId, name: providerGroups.name })
      .from(identityGroups)
      .innerJoin(providerGroups, eq(providerGroups.id, identityGroups.groupId))
      .where(eq(identityGroups.identityId, identityId));
  }

  async homeOrganizationFor(
    executor: Executor,
    providerId: string,
    externalGroupIds: readonly string[],
  ): Promise<string | null> {
    if (externalGroupIds.length === 0) return null;
    const [rule] = await executor
      .select({ organizationId: mappingRules.organizationId })
      .from(mappingRules)
      .innerJoin(providerGroups, eq(providerGroups.id, mappingRules.groupId))
      .where(
        and(
          eq(mappingRules.providerId, providerId),
          eq(mappingRules.homeOrganization, true),
          isNull(providerGroups.missingSince),
          inArray(providerGroups.externalId, [...externalGroupIds]),
        ),
      )
      .orderBy(asc(mappingRules.position), asc(mappingRules.id))
      .limit(1);
    return rule?.organizationId ?? null;
  }

  async #desired(executor: Executor, accountId: string, without?: string): Promise<DesiredGrant[]> {
    const rows = await executor
      .select({
        target: mappingRules.target,
        organizationId: mappingRules.organizationId,
        builtInRole: mappingRules.builtInRole,
        customRoleId: mappingRules.customRoleId,
        lunedoGroupId: mappingRules.lunedoGroupId,
        homeOrganization: mappingRules.homeOrganization,
        position: mappingRules.position,
      })
      .from(identities)
      .innerJoin(identityGroups, eq(identityGroups.identityId, identities.id))
      .innerJoin(
        providerGroups,
        and(eq(providerGroups.id, identityGroups.groupId), isNull(providerGroups.missingSince)),
      )
      .innerJoin(
        mappingRules,
        and(eq(mappingRules.groupId, providerGroups.id), eq(mappingRules.providerId, identities.providerId)),
      )
      .where(
        and(eq(identities.accountId, accountId), without ? ne(identities.providerId, without) : undefined),
      );
    const desired = new Map<string, DesiredGrant>();
    for (const row of rows) {
      const role: RoleKey | null = row.builtInRole
        ? { builtIn: row.builtInRole as "owner" | "administrator" | "securityAuditor" }
        : row.customRoleId
          ? { customRoleId: row.customRoleId }
          : null;
      if (row.target === "instance") {
        if (!role) continue;
        const key = `role:instance:${roleKey(role)}`;
        desired.set(key, { key, kind: "role", organizationId: null, role, groupId: null, home: null });
        continue;
      }
      const organizationId = row.organizationId ?? "";
      const membership = `membership:${organizationId}`;
      const earlier = desired.get(membership)?.home ?? null;
      const home = row.homeOrganization
        ? earlier === null
          ? row.position
          : Math.min(earlier, row.position)
        : earlier;
      desired.set(membership, {
        key: membership,
        kind: "membership",
        organizationId,
        role: null,
        groupId: null,
        home,
      });
      if (role) {
        const key = `role:${organizationId}:${roleKey(role)}`;
        desired.set(key, { key, kind: "role", organizationId, role, groupId: null, home: null });
      }
      if (row.lunedoGroupId) {
        const key = `group:${row.lunedoGroupId}`;
        desired.set(key, {
          key,
          kind: "groupMember",
          organizationId,
          role: null,
          groupId: row.lunedoGroupId,
          home: null,
        });
      }
    }
    return [...desired.values()];
  }

  async reconcile(tx: Transaction, accountId: string, report: SyncReport): Promise<void> {
    const [account] = await tx
      .select({ state: accounts.state, type: accounts.type, home: accounts.homeOrganizationId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update");
    if (account?.state !== "active") return;
    const current = await tx.select().from(providerGrants).where(eq(providerGrants.accountId, accountId));
    const currentKeys = new Set(current.map((grant) => grant.key));
    let desired = await this.#desired(tx, accountId);
    if (account.type !== "standard") {
      for (const grant of desired.filter((item) => !currentKeys.has(item.key))) {
        report.warnings.push({
          kind: "grantRefused",
          accountId,
          ruleId: null,
          detail: `${grant.key}: Rules grant nothing to ${account.type} accounts`,
        });
      }
      desired = [];
    }
    const desiredKeys = new Set(desired.map((grant) => grant.key));
    const order = { membership: 0, role: 1, groupMember: 2 } as const;
    const rank = (grant: DesiredGrant) => grant.home ?? Number.MAX_SAFE_INTEGER;
    if (account.home === null) await this.#claimHome(tx, accountId, desired, rank);
    for (const grant of desired.sort((a, b) => order[a.kind] - order[b.kind] || rank(a) - rank(b))) {
      if (currentKeys.has(grant.key)) continue;
      try {
        await tx.transaction(async (savepoint) => {
          await this.#grant(savepoint, accountId, grant, report);
        });
      } catch (error) {
        report.warnings.push({
          kind: "grantRefused",
          accountId,
          ruleId: null,
          detail: `${grant.key}: ${message(error)}`,
        });
      }
    }
    const [{ home } = { home: null }] = await tx
      .select({ home: accounts.homeOrganizationId })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    const removal = { groupMember: 0, role: 1, membership: 2 } as const;
    for (const grant of current
      .filter((item) => !desiredKeys.has(item.key))
      .sort((a, b) => removal[a.kind] - removal[b.kind])) {
      try {
        await tx.transaction(async (savepoint) => {
          await this.#revoke(savepoint, accountId, home, grant, report);
        });
      } catch (error) {
        report.warnings.push({
          kind: "removalRefused",
          accountId,
          ruleId: null,
          detail: `${grant.key}: ${message(error)}`,
        });
      }
    }
  }

  async #claimHome(
    tx: Transaction,
    accountId: string,
    desired: DesiredGrant[],
    rank: (grant: DesiredGrant) => number,
  ): Promise<void> {
    const held = await tx
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(and(eq(memberships.accountId, accountId), eq(memberships.kind, "member")))
      .orderBy(asc(memberships.createdAt), asc(memberships.id));
    if (held.length === 0) return;
    const heldIds = new Set(held.map((row) => row.organizationId));
    const preferred = desired
      .filter((grant) => grant.kind === "membership" && grant.home !== null)
      .sort((a, b) => rank(a) - rank(b))
      .find((grant) => heldIds.has(grant.organizationId ?? ""));
    const organizationId = preferred?.organizationId ?? held[0]?.organizationId;
    if (!organizationId) return;
    const event = await claimHomeOrganization(tx, accountId, organizationId);
    if (event) await this.#audit.record(tx, event);
  }

  async #grant(tx: Transaction, accountId: string, grant: DesiredGrant, report: SyncReport): Promise<void> {
    if (grant.kind === "membership" && grant.organizationId) {
      const [existing] = await tx
        .select({ kind: memberships.kind })
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, grant.organizationId), eq(memberships.accountId, accountId)),
        );
      if (existing) return;
      await this.#memberships.add(tx, SYSTEM, {
        organizationId: grant.organizationId,
        accountId,
        kind: "member",
      });
      await this.#record(tx, accountId, grant, null);
      report.changes.push({
        kind: "membershipAdded",
        accountId,
        organizationId: grant.organizationId,
        detail: null,
      });
      return;
    }
    if (grant.kind === "role" && grant.role) {
      const scope = grant.organizationId ? "organization" : "instance";
      const [existing] = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.scope, scope),
            grant.organizationId
              ? eq(roleAssignments.organizationId, grant.organizationId)
              : isNull(roleAssignments.organizationId),
            eq(roleAssignments.principalKind, "account"),
            eq(roleAssignments.principalId, accountId),
            "builtIn" in grant.role
              ? eq(roleAssignments.builtInRole, grant.role.builtIn)
              : eq(roleAssignments.customRoleId, grant.role.customRoleId),
          ),
        );
      if (existing) return;
      const assignment = await this.#roles.assign(
        SYSTEM,
        {
          scope,
          organizationId: grant.organizationId,
          role: grant.role,
          principal: { kind: "account", id: accountId },
        },
        { tx },
      );
      await this.#record(tx, accountId, grant, assignment.id);
      report.changes.push({
        kind: "roleAdded",
        accountId,
        organizationId: grant.organizationId,
        detail: assignment.role,
      });
      return;
    }
    if (grant.kind === "groupMember" && grant.groupId) {
      const inserted = await tx
        .insert(groupMembers)
        .values({ groupId: grant.groupId, accountId })
        .onConflictDoNothing()
        .returning({ accountId: groupMembers.accountId });
      if (inserted.length === 0) return;
      await this.#audit.record(tx, {
        name: "group.memberAdded",
        actor: SYSTEM,
        targetId: grant.groupId,
        fields: { accountId, expiresAt: null },
        ...(grant.organizationId
          ? { scope: { type: "organization" as const, id: grant.organizationId } }
          : {}),
      });
      await this.#record(tx, accountId, grant, null);
      report.changes.push({
        kind: "groupMemberAdded",
        accountId,
        organizationId: grant.organizationId,
        detail: grant.groupId,
      });
    }
  }

  async #record(tx: Transaction, accountId: string, grant: DesiredGrant, roleAssignmentId: string | null) {
    await tx
      .insert(providerGrants)
      .values({
        accountId,
        kind: grant.kind,
        key: grant.key,
        organizationId: grant.organizationId,
        roleAssignmentId,
        groupId: grant.groupId,
      })
      .onConflictDoNothing();
  }

  async #revoke(
    tx: Transaction,
    accountId: string,
    home: string | null,
    grant: typeof providerGrants.$inferSelect,
    report: SyncReport,
  ): Promise<void> {
    const forget = () => tx.delete(providerGrants).where(eq(providerGrants.id, grant.id));
    if (grant.kind === "groupMember" && grant.groupId) {
      const removed = await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, grant.groupId), eq(groupMembers.accountId, accountId)))
        .returning({ accountId: groupMembers.accountId });
      if (removed.length > 0) {
        await this.#audit.record(tx, {
          name: "group.memberRemoved",
          actor: SYSTEM,
          targetId: grant.groupId,
          fields: { accountId, reason: "providerRule" },
          ...(grant.organizationId
            ? { scope: { type: "organization" as const, id: grant.organizationId } }
            : {}),
        });
        await this.#reductions?.reduced(tx, { organizationId: grant.organizationId, accountId });
        report.changes.push({
          kind: "groupMemberRemoved",
          accountId,
          organizationId: grant.organizationId,
          detail: grant.groupId,
        });
      }
      await forget();
      return;
    }
    if (grant.kind === "role" && grant.roleAssignmentId) {
      const removed = await this.#roles.unassign(
        SYSTEM,
        grant.organizationId ? "organization" : "instance",
        grant.organizationId,
        grant.roleAssignmentId,
        { tx, reason: "providerRule" },
      );
      if (removed) {
        report.changes.push({
          kind: "roleRemoved",
          accountId,
          organizationId: grant.organizationId,
          detail: grant.key.split(":").slice(2).join(":"),
        });
      }
      await forget();
      return;
    }
    if (grant.kind === "membership" && grant.organizationId) {
      const organizationId = grant.organizationId;
      const [current] = await tx
        .select({ home: accounts.homeOrganizationId })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      const wasHome = (current?.home ?? home) === organizationId;
      const keep = (wasHome && !this.#home) || (await this.#holdsOtherAccess(tx, organizationId, accountId));
      if (!keep) {
        const removed = await this.#memberships.remove(SYSTEM, organizationId, accountId, "providerRule", {
          tx,
          releaseHome: wasHome,
        });
        if (removed) {
          report.changes.push({ kind: "membershipRemoved", accountId, organizationId, detail: null });
        }
        if (removed && wasHome && this.#home) {
          report.mailIds.push(
            ...(await this.#home.moveAfterLoss(tx, SYSTEM, accountId, organizationId, "providerRule")),
          );
          const [moved] = await tx
            .select({ home: accounts.homeOrganizationId })
            .from(accounts)
            .where(eq(accounts.id, accountId));
          report.changes.push({
            kind: "homeOrganizationChanged",
            accountId,
            organizationId: moved?.home ?? null,
            detail: organizationId,
          });
        }
      }
      await forget();
      return;
    }
    await forget();
  }

  async #holdsOtherAccess(tx: Transaction, organizationId: string, accountId: string): Promise<boolean> {
    const result = await tx.execute(sql`
      select 1 from role_assignments
      where organization_id = ${organizationId} and principal_kind = 'account' and principal_id = ${accountId}
      union all
      select 1 from group_members gm join groups g on g.id = gm.group_id
      where g.organization_id = ${organizationId} and gm.account_id = ${accountId}
      limit 1`);
    return result.rows.length > 0;
  }

  async withdrawnWithout(
    executor: Executor,
    providerId: string,
    accountIds: readonly string[],
  ): Promise<number> {
    if (accountIds.length === 0) return 0;
    const kept = await executor
      .select({ groupId: managedGroups.groupId })
      .from(managedGroups)
      .where(eq(managedGroups.providerId, providerId));
    const keptGroups = new Set(kept.map((row) => row.groupId));
    let withdrawn = 0;
    for (const accountId of new Set(accountIds)) {
      const remaining = new Set(
        (await this.#desired(executor, accountId, providerId)).map((grant) => grant.key),
      );
      const current = await executor
        .select({ key: providerGrants.key, kind: providerGrants.kind, groupId: providerGrants.groupId })
        .from(providerGrants)
        .where(eq(providerGrants.accountId, accountId));
      withdrawn += current.filter(
        (grant) =>
          !remaining.has(grant.key) && !(grant.kind === "groupMember" && keptGroups.has(grant.groupId ?? "")),
      ).length;
    }
    return withdrawn;
  }

  async releaseGroups(tx: Transaction, providerId: string, providerName: string): Promise<number> {
    const managed = await tx
      .select({ groupId: managedGroups.groupId })
      .from(managedGroups)
      .where(eq(managedGroups.providerId, providerId));
    const groupIds = managed.map((row) => row.groupId);
    if (groupIds.length === 0) return 0;
    await tx.update(groups).set({ formerProvider: providerName }).where(inArray(groups.id, groupIds));
    await tx
      .delete(providerGrants)
      .where(and(eq(providerGrants.kind, "groupMember"), inArray(providerGrants.groupId, groupIds)));
    await tx.delete(managedGroups).where(inArray(managedGroups.groupId, groupIds));
    return groupIds.length;
  }

  async accountsHolding(executor: Executor, groupId: string): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ accountId: identities.accountId })
      .from(identityGroups)
      .innerJoin(identities, eq(identities.id, identityGroups.identityId))
      .where(eq(identityGroups.groupId, groupId));
    return rows.map((row) => row.accountId);
  }

  async accountsWithGrants(executor: Executor): Promise<string[]> {
    const rows = await executor.selectDistinct({ accountId: providerGrants.accountId }).from(providerGrants);
    return rows.map((row) => row.accountId);
  }
}
