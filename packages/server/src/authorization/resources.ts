import { sql } from "drizzle-orm";
import {
  membersCreateGroupsSetting,
  organizationSettingsChain,
  selfServiceOrganizationsSetting,
} from "../organizations/settings.js";
import type { SettingsService } from "../settings/service.js";
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
      "instance.signIn.view": instanceArea("signInAndSecurity", "view"),
      "instance.signIn.manage": instanceArea("signInAndSecurity", "manage"),
      "instance.settings.view": instanceArea("settings", "view"),
      "instance.settings.manage": instanceArea("settings", "manage"),
      "instance.operations.view": instanceArea("operations", "view"),
      "instance.operations.manage": instanceArea("operations", "manage"),
      "instance.audit.view": instanceArea("auditLog", "view"),
      "instance.audit.manage": instanceArea("auditLog", "manage"),
      "instance.breakGlass.request": instanceArea("organizations", "manage"),
    },
    rules: {
      selfService: async (context) => {
        const account = await context.executor.execute<{ type: string }>(
          sql`select type from accounts where id = ${context.accountId} and state = 'active'`,
        );
        if (account.rows[0]?.type !== "standard") return false;
        return settings.get(selfServiceOrganizationsSetting, {});
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

  return [instance, organization, group, account, serviceAccount];
}
