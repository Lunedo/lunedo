import { type MappingRuleInput, mappingRuleInputSchema } from "@pagehall/shared";
import { and, asc, count, eq, ilike, inArray, max, or, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import { customRoles, groups } from "../organizations/access-schema.js";
import { lockOrganization } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import type { RoleService } from "../organizations/roles.js";
import { organizations } from "../organizations/schema.js";
import type { IdentityProviderAdapter, ProviderDefinition } from "./adapter.js";
import { emptyReport, type GroupMappingService, type SyncReport, synchronizedGroupName } from "./groups.js";
import type { IdentityProviderService } from "./providers.js";
import {
  identities,
  identityGroups,
  identityProviders,
  managedGroups,
  mappingRules,
  providerGroups,
} from "./schema.js";

export interface MappingRule {
  id: string;
  providerId: string;
  position: number;
  group: { id: string; name: string | null; missing: boolean };
  target: "organization" | "instance";
  organization: { id: string; name: string } | null;
  role: { builtIn: string } | { customRoleId: string; name: string } | null;
  synchronizedGroup: { id: string; name: string } | null;
  homeOrganization: boolean;
  accounts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderGroupMatch {
  id: string;
  name: string | null;
  members: number | null;
  accounts: number;
  mapped: boolean;
}

export interface RulePreview {
  members: number | null;
  accounts: number;
  sample: { id: string; name: string }[];
  withoutAccount: number | null;
}

const SAMPLE_SIZE = 10;
const SEARCH_LIMIT = 25;

export class MappingRuleService {
  readonly #database: Database;
  readonly #providers: IdentityProviderService;
  readonly #adapters: Map<string, IdentityProviderAdapter>;
  readonly #roles: RoleService;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #mapping: GroupMappingService;

  constructor(options: {
    database: Database;
    providers: IdentityProviderService;
    adapters: IdentityProviderAdapter[];
    roles: RoleService;
    authorization: AuthorizationService;
    audit: AuditLog;
    mapping: GroupMappingService;
  }) {
    this.#database = options.database;
    this.#providers = options.providers;
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.type, adapter]));
    this.#roles = options.roles;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#mapping = options.mapping;
  }

  async #provider(providerId: string): Promise<ProviderDefinition> {
    await this.#providers.get(providerId);
    const loaded = await this.#providers.definition(providerId);
    if (!loaded) throw new OrganizationError("notFound", "The identity provider does not exist");
    return loaded.provider;
  }

  async list(providerId: string): Promise<MappingRule[]> {
    await this.#providers.get(providerId);
    return this.#rules(this.#database, providerId);
  }

  async #rules(
    executor: Database | Transaction,
    providerId: string,
    ruleId?: string,
  ): Promise<MappingRule[]> {
    const rows = await executor
      .select({
        id: mappingRules.id,
        providerId: mappingRules.providerId,
        position: mappingRules.position,
        groupId: providerGroups.id,
        externalId: providerGroups.externalId,
        groupName: providerGroups.name,
        missingSince: providerGroups.missingSince,
        target: mappingRules.target,
        organizationId: mappingRules.organizationId,
        organizationName: organizations.name,
        builtInRole: mappingRules.builtInRole,
        customRoleId: mappingRules.customRoleId,
        customRoleName: customRoles.name,
        synchronizedGroupId: mappingRules.pagehallGroupId,
        synchronizedGroupName: groups.name,
        homeOrganization: mappingRules.homeOrganization,
        createdAt: mappingRules.createdAt,
        updatedAt: mappingRules.updatedAt,
        accounts: sql<number>`(select count(distinct ${identities.accountId})::int from ${identityGroups}
          join ${identities} on ${identities.id} = ${identityGroups.identityId}
          where ${identityGroups.groupId} = ${providerGroups.id})`,
      })
      .from(mappingRules)
      .innerJoin(providerGroups, eq(providerGroups.id, mappingRules.groupId))
      .leftJoin(organizations, eq(organizations.id, mappingRules.organizationId))
      .leftJoin(customRoles, eq(customRoles.id, mappingRules.customRoleId))
      .leftJoin(groups, eq(groups.id, mappingRules.pagehallGroupId))
      .where(and(eq(mappingRules.providerId, providerId), ruleId ? eq(mappingRules.id, ruleId) : undefined))
      .orderBy(asc(mappingRules.position), asc(mappingRules.id));
    return rows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      position: row.position,
      group: { id: row.externalId, name: row.groupName, missing: row.missingSince !== null },
      target: row.target,
      organization:
        row.organizationId && row.organizationName
          ? { id: row.organizationId, name: row.organizationName }
          : null,
      role: row.builtInRole
        ? { builtIn: row.builtInRole }
        : row.customRoleId
          ? { customRoleId: row.customRoleId, name: row.customRoleName ?? "" }
          : null,
      synchronizedGroup:
        row.synchronizedGroupId && row.synchronizedGroupName
          ? { id: row.synchronizedGroupId, name: row.synchronizedGroupName }
          : null,
      homeOrganization: row.homeOrganization,
      accounts: Number(row.accounts),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  #parse(input: unknown): MappingRuleInput {
    const parsed = mappingRuleInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrganizationError("invalidInput", "The mapping rule is not valid", {
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    return parsed.data;
  }

  async #authorize(tx: Transaction, actor: Principal, input: MappingRuleInput): Promise<void> {
    if (input.target === "instance") {
      if ("builtIn" in input.role && input.role.builtIn === "owner") {
        throw new OrganizationError("roleNotAssignable", "The instance owner is not a role");
      }
      await this.#roles.checkGrantable(actor, "instance", null, input.role, tx);
      return;
    }
    await this.#authorization.require(
      actor,
      "organization.members.manage",
      { type: "organization", id: input.organizationId },
      { executor: tx },
    );
    if (input.role)
      await this.#roles.checkGrantable(actor, "organization", input.organizationId, input.role, tx);
  }

  async #providerGroup(
    tx: Transaction,
    providerId: string,
    group: { id: string; name: string | null },
  ): Promise<{ id: string; name: string | null }> {
    const [row] = await tx
      .insert(providerGroups)
      .values({ providerId, externalId: group.id, name: group.name })
      .onConflictDoUpdate({
        target: [providerGroups.providerId, providerGroups.externalId],
        set: { updatedAt: new Date(), ...(group.name ? { name: group.name } : {}) },
      })
      .returning({ id: providerGroups.id, name: providerGroups.name });
    if (!row) throw new Error("The provider group was not stored");
    return row;
  }

  async #synchronizedGroup(
    tx: Transaction,
    actor: Principal,
    providerId: string,
    providerGroup: { id: string; name: string | null },
    externalId: string,
    organizationId: string,
  ): Promise<string> {
    const [existing] = await tx
      .select({ groupId: managedGroups.groupId })
      .from(managedGroups)
      .innerJoin(groups, eq(groups.id, managedGroups.groupId))
      .where(
        and(eq(managedGroups.providerGroupId, providerGroup.id), eq(groups.organizationId, organizationId)),
      );
    if (existing) return existing.groupId;
    await lockOrganization(tx, organizationId);
    const [provider] = await tx
      .select({ name: identityProviders.name })
      .from(identityProviders)
      .where(eq(identityProviders.id, providerId));
    const name = await synchronizedGroupName(
      tx,
      organizationId,
      providerGroup.name ?? externalId,
      provider?.name ?? "",
      null,
    );
    if (!name) throw new OrganizationError("groupNameTaken", "A group with this name exists already");
    const [group] = await tx
      .insert(groups)
      .values({
        organizationId,
        name,
        description: "",
        createdBy: actor.type === "account" ? actor.id : null,
      })
      .returning({ id: groups.id });
    if (!group) throw new Error("The group was not created");
    await tx
      .insert(managedGroups)
      .values({ groupId: group.id, providerId, providerGroupId: providerGroup.id });
    await this.#audit.record(tx, {
      name: "group.created",
      actor,
      targetId: group.id,
      fields: { name },
      scope: { type: "organization", id: organizationId },
    });
    return group.id;
  }

  async #values(tx: Transaction, actor: Principal, provider: ProviderDefinition, input: MappingRuleInput) {
    const providerGroup = await this.#providerGroup(tx, provider.id, input.group);
    const role = input.role;
    if (role && "customRoleId" in role) {
      const [custom] = await tx
        .select({ id: customRoles.id })
        .from(customRoles)
        .where(
          and(
            eq(customRoles.id, role.customRoleId),
            input.target === "instance"
              ? eq(customRoles.scope, "instance")
              : and(
                  eq(customRoles.scope, "organization"),
                  eq(customRoles.organizationId, input.organizationId),
                ),
          ),
        );
      if (!custom) throw new OrganizationError("roleNotFound", "The role does not exist at this level");
    }
    const pagehallGroupId =
      input.target === "organization" && input.synchronizedGroup
        ? await this.#synchronizedGroup(
            tx,
            actor,
            provider.id,
            providerGroup,
            input.group.id,
            input.organizationId,
          )
        : null;
    return {
      groupId: providerGroup.id,
      target: input.target,
      organizationId: input.target === "organization" ? input.organizationId : null,
      builtInRole: role && "builtIn" in role ? role.builtIn : null,
      customRoleId: role && "customRoleId" in role ? role.customRoleId : null,
      pagehallGroupId,
      homeOrganization: input.target === "organization" ? input.homeOrganization : false,
    };
  }

  #fields(rule: MappingRule) {
    return {
      providerId: rule.providerId,
      group: rule.group.id,
      groupName: rule.group.name,
      target: rule.target,
      organizationId: rule.organization?.id ?? null,
      role: rule.role ? ("builtIn" in rule.role ? rule.role.builtIn : rule.role.name) : null,
      synchronizedGroupId: rule.synchronizedGroup?.id ?? null,
      homeOrganization: rule.homeOrganization,
    };
  }

  #scope(organizationId: string | null) {
    return organizationId ? { scope: { type: "organization" as const, id: organizationId } } : {};
  }

  async #reconcileHolders(tx: Transaction, groupIds: string[]): Promise<SyncReport> {
    const report = emptyReport();
    const holders = new Set<string>();
    for (const groupId of groupIds) {
      for (const accountId of await this.#mapping.accountsHolding(tx, groupId)) holders.add(accountId);
    }
    for (const accountId of [...holders].sort()) await this.#mapping.reconcile(tx, accountId, report);
    return report;
  }

  async create(actor: Principal, providerId: string, input: unknown): Promise<MappingRule> {
    const parsed = this.#parse(input);
    const provider = await this.#provider(providerId);
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select 1 from identity_providers where id = ${provider.id} for update`);
      await this.#authorize(tx, actor, parsed);
      const values = await this.#values(tx, actor, provider, parsed);
      const [last] = await tx
        .select({ position: max(mappingRules.position) })
        .from(mappingRules)
        .where(eq(mappingRules.providerId, provider.id));
      const [row] = await tx
        .insert(mappingRules)
        .values({ providerId: provider.id, position: (last?.position ?? 0) + 1, ...values })
        .returning({ id: mappingRules.id });
      if (!row) throw new Error("The rule was not stored");
      const [rule] = await this.#rules(tx, provider.id, row.id);
      if (!rule) throw new Error("The rule was not stored");
      await this.#audit.record(tx, {
        name: "mappingRule.created",
        actor,
        targetId: rule.id,
        fields: this.#fields(rule),
        ...this.#scope(rule.organization?.id ?? null),
      });
      await this.#reconcileHolders(tx, [values.groupId]);
      return rule;
    });
  }

  async #existing(tx: Transaction, providerId: string, ruleId: string): Promise<MappingRule> {
    await tx.execute(
      sql`select 1 from mapping_rules where id = ${ruleId} and provider_id = ${providerId} for update`,
    );
    const [rule] = await this.#rules(tx, providerId, ruleId);
    if (!rule) throw new OrganizationError("notFound", "The mapping rule does not exist");
    return rule;
  }

  #inputOf(rule: MappingRule): MappingRuleInput {
    const role = rule.role
      ? "builtIn" in rule.role
        ? { builtIn: rule.role.builtIn as "owner" | "administrator" | "securityAuditor" }
        : { customRoleId: rule.role.customRoleId }
      : null;
    if (rule.target === "instance") {
      return {
        target: "instance",
        group: { id: rule.group.id, name: rule.group.name },
        role: role ?? { builtIn: "administrator" },
      };
    }
    return {
      target: "organization",
      group: { id: rule.group.id, name: rule.group.name },
      organizationId: rule.organization?.id ?? "",
      role,
      synchronizedGroup: rule.synchronizedGroup !== null,
      homeOrganization: rule.homeOrganization,
    };
  }

  async update(actor: Principal, providerId: string, ruleId: string, input: unknown): Promise<MappingRule> {
    const parsed = this.#parse(input);
    const provider = await this.#provider(providerId);
    return this.#database.transaction(async (tx) => {
      const previous = await this.#existing(tx, provider.id, ruleId);
      await this.#authorize(tx, actor, this.#inputOf(previous));
      await this.#authorize(tx, actor, parsed);
      const [previousGroup] = await tx
        .select({ groupId: mappingRules.groupId })
        .from(mappingRules)
        .where(eq(mappingRules.id, ruleId));
      const values = await this.#values(tx, actor, provider, parsed);
      await tx
        .update(mappingRules)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(mappingRules.id, ruleId));
      const [rule] = await this.#rules(tx, provider.id, ruleId);
      if (!rule) throw new Error("The rule was not stored");
      await this.#audit.record(tx, {
        name: "mappingRule.updated",
        actor,
        targetId: rule.id,
        fields: { ...this.#fields(rule), previous: this.#fields(previous) },
        ...this.#scope(rule.organization?.id ?? null),
      });
      await this.#reconcileHolders(tx, [values.groupId, ...(previousGroup ? [previousGroup.groupId] : [])]);
      return rule;
    });
  }

  async remove(actor: Principal, providerId: string, ruleId: string): Promise<void> {
    const provider = await this.#provider(providerId);
    await this.#database.transaction(async (tx) => {
      const previous = await this.#existing(tx, provider.id, ruleId);
      await this.#authorize(tx, actor, this.#inputOf(previous));
      const [row] = await tx
        .delete(mappingRules)
        .where(eq(mappingRules.id, ruleId))
        .returning({ groupId: mappingRules.groupId, pagehallGroupId: mappingRules.pagehallGroupId });
      if (row?.pagehallGroupId) {
        const [stillUsed] = await tx
          .select({ value: count() })
          .from(mappingRules)
          .where(eq(mappingRules.pagehallGroupId, row.pagehallGroupId));
        if (Number(stillUsed?.value ?? 0) === 0) {
          await tx.delete(managedGroups).where(eq(managedGroups.groupId, row.pagehallGroupId));
        }
      }
      await this.#audit.record(tx, {
        name: "mappingRule.removed",
        actor,
        targetId: ruleId,
        fields: this.#fields(previous),
        ...this.#scope(previous.organization?.id ?? null),
      });
      if (row) await this.#reconcileHolders(tx, [row.groupId]);
    });
  }

  async reorder(actor: Principal, providerId: string, ruleIds: string[]): Promise<MappingRule[]> {
    const provider = await this.#provider(providerId);
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select 1 from identity_providers where id = ${provider.id} for update`);
      const rules = await this.#rules(tx, provider.id);
      const known = new Set(rules.map((rule) => rule.id));
      if (
        ruleIds.length !== known.size ||
        ruleIds.some((id) => !known.has(id)) ||
        new Set(ruleIds).size !== ruleIds.length
      ) {
        throw new OrganizationError("invalidInput", "The order must name every rule of the provider once");
      }
      for (const rule of rules) await this.#authorize(tx, actor, this.#inputOf(rule));
      for (const [index, id] of ruleIds.entries()) {
        await tx
          .update(mappingRules)
          .set({ position: index + 1, updatedAt: new Date() })
          .where(eq(mappingRules.id, id));
      }
      const reordered = await this.#rules(tx, provider.id);
      for (const rule of reordered) {
        const before = rules.find((entry) => entry.id === rule.id);
        if (before?.position === rule.position) continue;
        await this.#audit.record(tx, {
          name: "mappingRule.updated",
          actor,
          targetId: rule.id,
          fields: { ...this.#fields(rule), previous: before ? this.#fields(before) : null },
          ...this.#scope(rule.organization?.id ?? null),
        });
      }
      return reordered;
    });
  }

  async searchGroups(providerId: string, query: string): Promise<ProviderGroupMatch[]> {
    const provider = await this.#provider(providerId);
    const loaded = await this.#providers.definition(provider.id);
    const adapter = this.#adapters.get(provider.type);
    const term = query.trim();
    let matches: { id: string; name: string | null; members: number | null }[];
    if (adapter?.hasDirectory?.(provider) && adapter.searchGroups && term !== "") {
      matches = await adapter.searchGroups(provider, loaded?.credentials ?? [], term);
    } else {
      const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
      matches = (
        await this.#database
          .select({ id: providerGroups.externalId, name: providerGroups.name })
          .from(providerGroups)
          .where(
            and(
              eq(providerGroups.providerId, provider.id),
              term === ""
                ? undefined
                : or(
                    ilike(providerGroups.name, `%${escaped}%`),
                    ilike(providerGroups.externalId, `%${escaped}%`),
                  ),
            ),
          )
          .orderBy(asc(providerGroups.name), asc(providerGroups.externalId))
          .limit(SEARCH_LIMIT)
      ).map((row) => ({ ...row, members: null }));
    }
    if (matches.length === 0) return [];
    const known = await this.#database
      .select({
        externalId: providerGroups.externalId,
        accounts: sql<number>`count(distinct ${identities.accountId})::int`,
        mapped: sql<boolean>`exists (select 1 from ${mappingRules} where ${mappingRules.groupId} = ${providerGroups.id})`,
      })
      .from(providerGroups)
      .leftJoin(identityGroups, eq(identityGroups.groupId, providerGroups.id))
      .leftJoin(identities, eq(identities.id, identityGroups.identityId))
      .where(
        and(
          eq(providerGroups.providerId, provider.id),
          inArray(
            providerGroups.externalId,
            matches.map((match) => match.id),
          ),
        ),
      )
      .groupBy(providerGroups.id);
    return matches.map((match) => {
      const entry = known.find((item) => item.externalId === match.id);
      return { ...match, accounts: Number(entry?.accounts ?? 0), mapped: entry?.mapped === true };
    });
  }

  async preview(providerId: string, externalGroupId: string): Promise<RulePreview> {
    const provider = await this.#provider(providerId);
    const loaded = await this.#providers.definition(provider.id);
    const adapter = this.#adapters.get(provider.type);
    const members =
      adapter?.hasDirectory?.(provider) && adapter.countMembers
        ? await adapter.countMembers(provider, loaded?.credentials ?? [], externalGroupId)
        : null;
    const holders = this.#database
      .selectDistinct({ id: accounts.id, name: accounts.name })
      .from(providerGroups)
      .innerJoin(identityGroups, eq(identityGroups.groupId, providerGroups.id))
      .innerJoin(identities, eq(identities.id, identityGroups.identityId))
      .innerJoin(accounts, eq(accounts.id, identities.accountId))
      .where(and(eq(providerGroups.providerId, provider.id), eq(providerGroups.externalId, externalGroupId)));
    const all = await holders;
    const sample = [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, SAMPLE_SIZE);
    return {
      members,
      accounts: all.length,
      sample,
      withoutAccount: members === null ? null : Math.max(members - all.length, 0),
    };
  }
}
