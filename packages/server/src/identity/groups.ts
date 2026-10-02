import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Executor, Transaction } from "../database/database.js";
import { groupMembers, groups, memberships, roleAssignments } from "../organizations/access-schema.js";
import type { MembershipService } from "../organizations/memberships.js";
import type { RoleService } from "../organizations/roles.js";
import type { ProviderGroup } from "./adapter.js";
import {
  identities,
  identityGroups,
  identityProviders,
  managedGroups,
  mappingRules,
  providerGrants,
  providerGroups,
} from "./schema.js";

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
  | "accountReactivated";

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
  | "deactivationRefused";

export interface SyncWarning {
  kind: SyncWarningKind;
  accountId: string | null;
  ruleId: string | null;
  detail: string | null;
}

export interface SyncReport {
  changes: SyncChange[];
  warnings: SyncWarning[];
}

export function emptyReport(): SyncReport {
  return { changes: [], warnings: [] };
}

type RoleKey = { builtIn: "owner" | "administrator" | "securityAuditor" } | { customRoleId: string };

interface DesiredGrant {
  key: string;
  kind: "membership" | "role" | "groupMember";
  organizationId: string | null;
  role: RoleKey | null;
  groupId: string | null;
}

function roleKey(role: RoleKey): string {
  return "builtIn" in role ? role.builtIn : `custom:${role.customRoleId}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  constructor(options: { roles: RoleService; memberships: MembershipService; audit: AuditLog }) {
    this.#roles = options.roles;
    this.#memberships = options.memberships;
    this.#audit = options.audit;
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
            updatedAt: new Date(),
          })
          .where(eq(providerGroups.id, existing.id));
        if (renamed && group.name) await this.renameManagedGroups(tx, existing.id, group.name, report);
        continue;
      }
      const [inserted] = await tx
        .insert(providerGroups)
        .values({ providerId, externalId: group.id, name: group.name })
        .onConflictDoUpdate({
          target: [providerGroups.providerId, providerGroups.externalId],
          set: { missingSince: null, updatedAt: new Date() },
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
    },
  ): Promise<SyncReport> {
    const report = emptyReport();
    if (link.groups !== null)
      await this.recordGroups(tx, link.providerId, link.identityId, link.groups, report);
    await this.reconcile(tx, link.accountId, report);
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

  async #desired(tx: Transaction, accountId: string): Promise<DesiredGrant[]> {
    const rows = await tx
      .select({
        target: mappingRules.target,
        organizationId: mappingRules.organizationId,
        builtInRole: mappingRules.builtInRole,
        customRoleId: mappingRules.customRoleId,
        pagehallGroupId: mappingRules.pagehallGroupId,
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
      .where(eq(identities.accountId, accountId));
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
        desired.set(key, { key, kind: "role", organizationId: null, role, groupId: null });
        continue;
      }
      const organizationId = row.organizationId ?? "";
      const membership = `membership:${organizationId}`;
      desired.set(membership, {
        key: membership,
        kind: "membership",
        organizationId,
        role: null,
        groupId: null,
      });
      if (role) {
        const key = `role:${organizationId}:${roleKey(role)}`;
        desired.set(key, { key, kind: "role", organizationId, role, groupId: null });
      }
      if (row.pagehallGroupId) {
        const key = `group:${row.pagehallGroupId}`;
        desired.set(key, {
          key,
          kind: "groupMember",
          organizationId,
          role: null,
          groupId: row.pagehallGroupId,
        });
      }
    }
    return [...desired.values()];
  }

  async reconcile(tx: Transaction, accountId: string, report: SyncReport): Promise<void> {
    const [account] = await tx
      .select({ state: accounts.state, home: accounts.homeOrganizationId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update");
    if (account?.state !== "active") return;
    const desired = await this.#desired(tx, accountId);
    const current = await tx.select().from(providerGrants).where(eq(providerGrants.accountId, accountId));
    const currentKeys = new Set(current.map((grant) => grant.key));
    const desiredKeys = new Set(desired.map((grant) => grant.key));
    const order = { membership: 0, role: 1, groupMember: 2 } as const;
    for (const grant of desired.sort((a, b) => order[a.kind] - order[b.kind])) {
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
    const removal = { groupMember: 0, role: 1, membership: 2 } as const;
    for (const grant of current
      .filter((item) => !desiredKeys.has(item.key))
      .sort((a, b) => removal[a.kind] - removal[b.kind])) {
      try {
        await tx.transaction(async (savepoint) => {
          await this.#revoke(savepoint, accountId, account.home, grant, report);
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
      const keep = home === organizationId || (await this.#holdsOtherAccess(tx, organizationId, accountId));
      if (!keep) {
        const removed = await this.#memberships.remove(SYSTEM, organizationId, accountId, "providerRule", {
          tx,
        });
        if (removed) {
          report.changes.push({ kind: "membershipRemoved", accountId, organizationId, detail: null });
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
