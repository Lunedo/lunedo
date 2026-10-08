import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import {
  membersCreateGroupsSetting,
  organizationSettingsChain,
  selfServiceOrganizationsSetting,
} from "../organizations/settings.js";
import type { SettingsService } from "../settings/service.js";
import { membersCreateSpacesSetting, personalSpacesSetting } from "../spaces/settings.js";
import { grantsLevel } from "./areas.js";
import type { ActionDefinition, ResourceType, RuleContext } from "./registry.js";

const ALL_MEMBERSHIPS = ["member", "collaborator", "guest"] as const;

function instanceArea(area: ActionDefinition["area"], level: ActionDefinition["level"]): ActionDefinition {
  return { scope: "instance", area, level };
}

function organizationArea(
  area: ActionDefinition["area"],
  level: ActionDefinition["level"],
): ActionDefinition {
  return { scope: "organization", area, level };
}

async function groupOrganization(executor: RuleContext["executor"], id: string): Promise<string | null> {
  const result = await executor.execute<{ organization_id: string }>(
    sql`select organization_id from groups where id = ${id}`,
  );
  return result.rows[0]?.organization_id ?? null;
}

export function resourceTypes(settings: SettingsService): ResourceType[] {
  const instance: ResourceType = {
    type: "instance",
    actions: {
      "instance.organizations.view": instanceArea("organizations", "view"),
      "instance.organizations.manage": instanceArea("organizations", "manage"),
      "instance.organizations.create": { ...instanceArea("organizations", "manage"), rule: "selfService" },
      "instance.accounts.view": instanceArea("accounts", "view"),
      "instance.accounts.manage": instanceArea("accounts", "manage"),
      "instance.roles.view": instanceArea("accounts", "view"),
      "instance.roles.manage": instanceArea("accounts", "manage"),
      "instance.ownership.transfer": { scope: "instance", ownerOnly: true },
      "instance.emergencyRecipients.manage": { scope: "instance", ownerOnly: true },
      "instance.signIn.view": instanceArea("signInAndSecurity", "view"),
      "instance.signIn.manage": instanceArea("signInAndSecurity", "manage"),
      "instance.settings.view": instanceArea("settings", "view"),
      "instance.settings.manage": instanceArea("settings", "manage"),
      "instance.operations.view": instanceArea("operations", "view"),
      "instance.operations.manage": instanceArea("operations", "manage"),
      "instance.audit.view": instanceArea("auditLog", "view"),
      "instance.audit.manage": instanceArea("auditLog", "manage"),
      "instance.breakGlass.request": instanceArea("organizations", "manage"),
      "instance.personalSpaces.view": instanceArea("accounts", "view"),
      "instance.personalSpaces.manage": instanceArea("accounts", "manage"),
      "instance.personalSpace.use": { scope: "instance", rule: "personalSpace" },
      "instance.templates.manage": instanceArea("settings", "manage"),
      "instance.content.view": {
        scope: "instance",
        rule: "activeAccount",
        tokenScope: { area: "spaces", level: "view" },
      },
    },
    rules: {
      selfService: async (context) => {
        const account = await context.executor.execute<{ type: string }>(
          sql`select type from accounts where id = ${context.accountId} and state = 'active'`,
        );
        if (account.rows[0]?.type !== "standard") return false;
        return settings.get(selfServiceOrganizationsSetting, {});
      },
      activeAccount: async (context) => {
        const account = await context.executor.execute<{ id: string }>(
          sql`select id from accounts where id = ${context.accountId} and state = 'active'`,
        );
        return account.rows.length > 0;
      },
      personalSpace: async (context) => {
        const account = await context.executor.execute<{ type: string }>(
          sql`select type from accounts where id = ${context.accountId} and state = 'active'`,
        );
        if (account.rows[0]?.type !== "standard") return false;
        return settings.get(personalSpacesSetting, {});
      },
    },
  };

  const organization: ResourceType = {
    type: "organization",
    actions: {
      "organization.view": { scope: "organization", membership: ALL_MEMBERSHIPS, breakGlass: true },
      "organization.leave": { scope: "organization", membership: ALL_MEMBERSHIPS },
      "organization.update": organizationArea("settings", "manage"),
      "organization.settings.view": organizationArea("settings", "view"),
      "organization.settings.manage": organizationArea("settings", "manage"),
      "organization.members.view": organizationArea("membersAndGroups", "view"),
      "organization.members.manage": organizationArea("membersAndGroups", "manage"),
      "organization.roles.view": organizationArea("membersAndGroups", "view"),
      "organization.roles.manage": organizationArea("membersAndGroups", "manage"),
      "organization.groups.view": organizationArea("membersAndGroups", "view"),
      "organization.groups.create": {
        ...organizationArea("membersAndGroups", "manage"),
        rule: "membersCreateGroups",
      },
      "organization.spaces.view": organizationArea("spaces", "view"),
      "organization.spaces.manage": organizationArea("spaces", "manage"),
      "organization.spaces.create": { ...organizationArea("spaces", "manage"), rule: "membersCreateSpaces" },
      "organization.trash.manage": organizationArea("spaces", "manage"),
      "organization.templates.manage": organizationArea("settings", "manage"),
      "organization.signIn.view": organizationArea("signInAndSecurity", "view"),
      "organization.signIn.manage": organizationArea("signInAndSecurity", "manage"),
      "organization.integrations.view": organizationArea("integrationsAndApi", "view"),
      "organization.integrations.manage": organizationArea("integrationsAndApi", "manage"),
      "organization.audit.view": organizationArea("auditLog", "view"),
    },
    rules: {
      membersCreateGroups: async (context) => {
        if (!context.organizationId) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (facts.membership?.kind !== "member") return false;
        return settings.get(membersCreateGroupsSetting, organizationSettingsChain(context.organizationId));
      },
      membersCreateSpaces: async (context) => {
        if (!context.organizationId) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (facts.membership?.kind !== "member") return false;
        return settings.get(membersCreateSpacesSetting, organizationSettingsChain(context.organizationId));
      },
    },
  };

  const groupManager = async (context: RuleContext) => {
    if (!context.organizationId || !context.resource.id) return false;
    const facts = await context.organizationFacts(context.organizationId);
    return facts.membership !== null && facts.managedGroups.includes(context.resource.id);
  };

  const group: ResourceType = {
    type: "group",
    organizationOf: groupOrganization,
    actions: {
      "group.view": { ...organizationArea("membersAndGroups", "view"), rule: "memberOrManager" },
      "group.manage": { ...organizationArea("membersAndGroups", "manage"), rule: "manager" },
      "group.delete": { ...organizationArea("membersAndGroups", "manage"), rule: "manager" },
    },
    rules: {
      manager: groupManager,
      memberOrManager: async (context) => {
        if (!context.organizationId || !context.resource.id) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (!facts.membership) return false;
        return (
          facts.managedGroups.includes(context.resource.id) ||
          facts.groups.some((candidate) => candidate.id === context.resource.id)
        );
      },
    },
  };

  const account: ResourceType = {
    type: "account",
    actions: {
      "account.deactivate": { ...instanceArea("accounts", "manage"), rule: "homeOrganizationAdministrator" },
      "account.activity.view": { scope: "instance", rule: "self" },
      "account.reactivate": { ...instanceArea("accounts", "manage"), rule: "homeOrganizationAdministrator" },
      "account.sessions.end": {
        ...instanceArea("accounts", "manage"),
        rule: "homeOrganizationAdministrator",
      },
      "account.secondFactor.reset": {
        ...instanceArea("accounts", "manage"),
        rule: "homeOrganizationAdministrator",
      },
      "account.identities.view": {
        ...instanceArea("accounts", "view"),
        rule: "homeOrganizationAdministrator",
      },
      "account.identities.manage": {
        ...instanceArea("accounts", "manage"),
        rule: "homeOrganizationAdministrator",
      },
      "account.homeOrganization.change": {
        ...instanceArea("accounts", "manage"),
        rule: "homeOrganizationAdministrator",
      },
    },
    rules: {
      self: async (context) => context.resource.id === context.accountId,
      homeOrganizationAdministrator: async (context) => {
        if (!context.resource.id) return false;
        const target = await context.executor.execute<{ home_organization_id: string | null }>(
          sql`select home_organization_id from accounts where id = ${context.resource.id}`,
        );
        const home = target.rows[0]?.home_organization_id;
        if (!home) return false;
        const facts = await context.organizationFacts(home);
        return facts.roles.some((role) => grantsLevel(role.areas.membersAndGroups, "manage"));
      },
    },
  };

  const serviceAccount: ResourceType = {
    type: "serviceAccount",
    organizationOf: async (executor, id) => {
      const result = await executor.execute<{ organization_id: string }>(
        sql`select organization_id from service_accounts where account_id = ${id}`,
      );
      return result.rows[0]?.organization_id ?? null;
    },
    actions: {
      "serviceAccount.view": organizationArea("integrationsAndApi", "view"),
      "serviceAccount.manage": organizationArea("integrationsAndApi", "manage"),
    },
  };

  const space: ResourceType = {
    type: "space",
    spaceOf: async (_executor, id) => id,
    actions: {
      "space.view": { scope: "space", spaceRole: "reader", restriction: "present" },
      "space.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "space.manage": { scope: "space", spaceRole: "admin", restriction: "present" },
      "space.trash": { scope: "space", spaceRole: "editor", restriction: "present" },
      "space.delete": { scope: "space", spaceRole: "admin", restriction: "present" },
    },
    restrictions: {
      present: async (executor, id) => {
        const state = await spaceState(executor, id);
        return state?.deleted ? { denial: "inTrash" } : null;
      },
      writable: async (executor, id) => {
        const state = await spaceState(executor, id);
        if (state?.deleted) return { denial: "inTrash" };
        return state?.archived ? { denial: "archived" } : null;
      },
    },
  };

  const item: ResourceType = {
    type: "item",
    spaceOf: async (executor, id) => {
      const result = await executor.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${id}`,
      );
      return result.rows[0]?.space_id ?? null;
    },
    actions: {
      "item.view": { scope: "space", spaceRole: "reader", restriction: "readable" },
      "item.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "item.delete": { scope: "space", spaceRole: "editor", restriction: "present" },
      "item.archive": { scope: "space", spaceRole: "editor", restriction: "present" },
    },
    restrictions: {
      readable: async (executor, id) => {
        const state = await itemState(executor, id);
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished ? { denial: "unpublished", unless: "editor" } : null;
      },
      writable: async (executor, id) => {
        const state = await itemState(executor, id);
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.archived ? { denial: "archived" } : null;
      },
      present: async (executor, id) => {
        const state = await itemState(executor, id);
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.spaceArchived ? { denial: "archived" } : null;
      },
    },
  };

  return [instance, organization, group, account, serviceAccount, space, item];
}

async function spaceState(
  executor: Executor,
  id: string,
): Promise<{ deleted: boolean; archived: boolean } | null> {
  const result = await executor.execute<{ deleted: boolean; archived: boolean }>(sql`
    select deleted_at is not null as deleted, archived_at is not null as archived from spaces where id = ${id}`);
  return result.rows[0] ?? null;
}

async function itemState(
  executor: Executor,
  id: string,
): Promise<{ trashed: boolean; archived: boolean; spaceArchived: boolean; unpublished: boolean } | null> {
  const result = await executor.execute<{
    trashed: boolean;
    archived: boolean;
    space_archived: boolean;
    unpublished: boolean;
  }>(sql`
    select (t.trash_entry_id is not null or s.deleted_at is not null) as trashed,
      (t.archived_root_id is not null or s.archived_at is not null) as archived,
      s.archived_at is not null as space_archived,
      not t.reader_visible as unpublished
    from tree_items t join spaces s on s.id = t.space_id where t.id = ${id}`);
  const row = result.rows[0];
  return row
    ? {
        trashed: row.trashed,
        archived: row.archived,
        spaceArchived: row.space_archived,
        unpublished: row.unpublished,
      }
    : null;
}
