import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import {
  membersCreateGroupsSetting,
  organizationSettingsChain,
  selfServiceOrganizationsSetting,
} from "../organizations/settings.js";
import type { SettingsService } from "../settings/service.js";
import { isFormerSpaceAdministrator } from "../spaces/former-administrators.js";
import { grantsSpaceRole } from "../spaces/roles.js";
import type { SpaceRole } from "../spaces/schema.js";
import {
  membersCreateConfidentialSpacesSetting,
  membersCreateSpacesSetting,
  personalSpacesSetting,
} from "../spaces/settings.js";
import { grantsLevel } from "./areas.js";
import type { ActionDefinition, ResourceType, RestrictionResult, RuleContext } from "./registry.js";

const ALL_MEMBERSHIPS = ["member", "collaborator", "guest"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      "organization.search": {
        scope: "organization",
        membership: ALL_MEMBERSHIPS,
        tokenScope: { area: "spaces", level: "view" },
      },
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
      "organization.spaces.createConfidential": {
        ...organizationArea("spaces", "manage"),
        rule: "membersCreateConfidentialSpaces",
      },
      "organization.trash.manage": organizationArea("spaces", "manage"),
      "organization.templates.manage": organizationArea("settings", "manage"),
      "organization.blog.pin": organizationArea("spaces", "manage"),
      "organization.signIn.view": organizationArea("signInAndSecurity", "view"),
      "organization.signIn.manage": organizationArea("signInAndSecurity", "manage"),
      "organization.integrations.view": organizationArea("integrationsAndApi", "view"),
      "organization.integrations.manage": organizationArea("integrationsAndApi", "manage"),
      "organization.audit.view": organizationArea("auditLog", "view"),
      "organization.access.view": organizationArea("spaces", "view"),
      "organization.imports.manage": organizationArea("spaces", "manage"),
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
      membersCreateConfidentialSpaces: async (context) => {
        if (!context.organizationId) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (facts.membership?.kind !== "member") return false;
        const chain = organizationSettingsChain(context.organizationId);
        return (
          (await settings.get(membersCreateSpacesSetting, chain)) &&
          settings.get(membersCreateConfidentialSpacesSetting, chain)
        );
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

  const deletedSpace: ResourceType = {
    type: "deletedSpace",
    actions: {
      "deletedSpace.restore": { scope: "instance", rule: "formerAdministrator" },
    },
    rules: {
      formerAdministrator: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        return isFormerSpaceAdministrator(context.executor, id.toLowerCase(), context.accountId);
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
    itemOf: async (_executor, id) => id,
    actions: {
      "item.view": { scope: "space", spaceRole: "reader", restriction: "readable" },
      "item.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "item.delete": { scope: "space", spaceRole: "editor", restriction: "present" },
      "item.archive": { scope: "space", spaceRole: "editor", restriction: "present" },
      "item.comment": { scope: "space", spaceRole: "commenter", restriction: "interactive" },
      "item.react": { scope: "space", spaceRole: "reader", restriction: "interactive" },
      "item.pin": { scope: "space", spaceRole: "admin", restriction: "interactive" },
      "item.approveSchedule": { scope: "space", spaceRole: "admin", restriction: "writable" },
      "item.share": { scope: "space", spaceRole: "editor", restriction: "readable" },
      "item.transferOwnership": {
        scope: "space",
        spaceRole: "admin",
        rule: "ownerOrOrganizationAdministrator",
        restriction: "writable",
      },
    },
    rules: {
      ownerOrOrganizationAdministrator: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        const result = await context.executor.execute<{
          owner_id: string | null;
          space_id: string;
          organization_id: string | null;
          confidential: boolean;
        }>(sql`
          select t.owner_id, t.space_id, s.organization_id, s.confidential
          from tree_items t join spaces s on s.id = t.space_id where t.id = ${id.toLowerCase()}`);
        const row = result.rows[0];
        if (!row) return false;
        if (row.owner_id === context.accountId) return true;
        if (row.confidential || !row.organization_id) return false;
        const organization = await context.organizationFacts(row.organization_id);
        if (!organization.roles.some((role) => grantsLevel(role.areas.spaces, "manage"))) return false;
        return (await context.spaceFacts(row.space_id)).role !== null;
      },
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
      interactive: async (executor, id) => interactiveItem(await itemState(executor, id)),
    },
  };

  const hasRole = async (context: RuleContext, spaceId: string | null, role: SpaceRole) => {
    if (!spaceId) return false;
    const facts = await context.spaceFacts(spaceId);
    return facts.sources.some((source) => grantsSpaceRole(source.role, role));
  };

  const comment: ResourceType = {
    type: "comment",
    spaceOf: commentSpace,
    itemOf: async (executor, id) => {
      const result = await executor.execute<{ item_id: string }>(
        sql`select item_id from comments where id = ${id}`,
      );
      return result.rows[0]?.item_id ?? null;
    },
    actions: {
      "comment.view": { scope: "space", spaceRole: "reader", restriction: "visible" },
      "comment.reply": { scope: "space", spaceRole: "commenter", restriction: "open" },
      "comment.resolve": { scope: "space", spaceRole: "commenter", restriction: "open" },
      "comment.react": { scope: "space", spaceRole: "reader", restriction: "open" },
      "comment.update": {
        scope: "space",
        spaceRole: "commenter",
        rule: "author",
        ruleRequired: true,
        restriction: "open",
      },
      "comment.delete": {
        scope: "space",
        spaceRole: "admin",
        rule: "authorWhoComments",
        restriction: "open",
      },
      "comment.restore": { scope: "space", spaceRole: "commenter", restriction: "restorable" },
    },
    rules: {
      author: async (context) =>
        (await commentAuthor(context.executor, context.resource.id)) === context.accountId,
      authorWhoComments: async (context) => {
        if ((await commentAuthor(context.executor, context.resource.id)) !== context.accountId) return false;
        return hasRole(context, await commentSpace(context.executor, context.resource.id ?? ""), "commenter");
      },
    },
    restrictions: {
      visible: async (executor, id) => {
        const state = await commentState(executor, id);
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      },
      restorable: async (executor, id) => {
        const state = await commentState(executor, id);
        if (!state || state.trashed) return { denial: "inTrash" };
        if (state.archived) return { denial: "archived" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      },
      open: async (executor, id) => {
        const state = await commentState(executor, id);
        if (!state || state.trashed || state.deleted) return { denial: "inTrash" };
        if (state.archived) return { denial: "archived" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      },
    },
  };

  const task: ResourceType = {
    type: "task",
    spaceOf: async (executor, id) => {
      const result = await executor.execute<{ space_id: string }>(
        sql`select t.space_id from tasks k join tree_items t on t.id = k.item_id where k.id = ${id}`,
      );
      return result.rows[0]?.space_id ?? null;
    },
    itemOf: async (executor, id) => {
      const result = await executor.execute<{ item_id: string }>(
        sql`select item_id from tasks where id = ${id}`,
      );
      return result.rows[0]?.item_id ?? null;
    },
    actions: {
      "task.view": { scope: "space", spaceRole: "reader", restriction: "visible" },
      "task.update": { scope: "space", spaceRole: "editor", rule: "assignee", restriction: "interactive" },
    },
    rules: {
      assignee: async (context) => {
        const result = await context.executor.execute<{ space_id: string }>(sql`
          select t.space_id from tasks k join tree_items t on t.id = k.item_id
          where k.id = ${context.resource.id ?? ""} and k.published and k.assignee_id = ${context.accountId}`);
        return hasRole(context, result.rows[0]?.space_id ?? null, "reader");
      },
    },
    restrictions: {
      visible: async (executor, id) => {
        const result = await executor.execute<{ item_id: string; published: boolean }>(
          sql`select item_id, published from tasks where id = ${id}`,
        );
        const row = result.rows[0];
        const state = row ? await itemState(executor, row.item_id) : null;
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished || !row?.published ? { denial: "unpublished", unless: "editor" } : null;
      },
      interactive: async (executor, id) => {
        const result = await executor.execute<{ item_id: string }>(
          sql`select item_id from tasks where id = ${id}`,
        );
        const itemId = result.rows[0]?.item_id;
        return interactiveItem(itemId ? await itemState(executor, itemId) : null);
      },
    },
  };

  const attachmentItem = async (executor: Executor, id: string): Promise<string | null> => {
    const result = await executor.execute<{ item_id: string }>(
      sql`select item_id from attachments where id = ${id} and (deleted_at is null or published_version_id is not null)`,
    );
    return result.rows[0]?.item_id ?? null;
  };
  const viaItem =
    (restriction: (executor: Executor, id: string) => Promise<RestrictionResult | null>) =>
    async (executor: Executor, id: string): Promise<RestrictionResult | null> => {
      const itemId = await attachmentItem(executor, id);
      return itemId ? restriction(executor, itemId) : { denial: "inTrash" };
    };

  const attachment: ResourceType = {
    type: "attachment",
    spaceOf: async (executor, id) => {
      const result = await executor.execute<{ space_id: string }>(sql`
        select t.space_id from attachments a join tree_items t on t.id = a.item_id
        where a.id = ${id} and (a.deleted_at is null or a.published_version_id is not null)`);
      return result.rows[0]?.space_id ?? null;
    },
    itemOf: attachmentItem,
    actions: {
      "attachment.view": { scope: "space", spaceRole: "reader", restriction: "readable" },
      "attachment.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
    },
    restrictions: {
      readable: async (executor, id) => {
        const result = await executor.execute<{ item_id: string; published: boolean }>(sql`
          select item_id, published_version_id is not null as published from attachments
          where id = ${id} and (deleted_at is null or published_version_id is not null)`);
        const row = result.rows[0];
        const state = row ? await itemState(executor, row.item_id) : null;
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished || !row?.published ? { denial: "unpublished", unless: "editor" } : null;
      },
      writable: viaItem(async (executor, itemId) => {
        const state = await itemState(executor, itemId);
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.archived ? { denial: "archived" } : null;
      }),
    },
  };

  const importingAdministrator = async (context: RuleContext): Promise<boolean> => {
    if (!context.organizationId) return false;
    const facts = await context.organizationFacts(context.organizationId);
    return facts.roles.some((role) => grantsLevel(role.areas.spaces, "manage"));
  };

  const importOf: ResourceType = {
    type: "import",
    organizationOf: async (executor, id) => {
      if (!UUID.test(id)) return null;
      const result = await executor.execute<{ organization_id: string }>(
        sql`select organization_id from imports where id = ${id.toLowerCase()}`,
      );
      return result.rows[0]?.organization_id ?? null;
    },
    actions: {
      "import.view": { scope: "organization", rule: "importViewer" },
      "import.manage": { scope: "organization", rule: "importer" },
      "import.resolve": { scope: "organization", rule: "importResolver" },
      "import.takeOver": { scope: "organization", rule: "heldForAdministrator" },
    },
    rules: {
      importViewer: async (context) => {
        if (!context.organizationId || !context.resource.id) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (facts.membership?.kind !== "member") return false;
        const result = await context.executor.execute<{
          importer: boolean;
          reviewer: boolean;
          accepted: boolean;
        }>(sql`
          select i.importer_id = ${context.accountId} as importer,
            exists (select 1 from import_reviewers r where r.import_id = i.id and r.account_id = ${context.accountId})
              as reviewer,
            i.state = 'accepted' or (i.target_space_id is not null and i.state in ('running', 'review', 'superseded'))
              as accepted
          from imports i where i.id = ${context.resource.id.toLowerCase()}`);
        const row = result.rows[0];
        if (!row) return false;
        return row.reviewer || ((row.importer || row.accepted) && (await importingAdministrator(context)));
      },
      importResolver: async (context) => {
        if (!context.organizationId || !context.resource.id) return false;
        const facts = await context.organizationFacts(context.organizationId);
        if (facts.membership?.kind !== "member") return false;
        const result = await context.executor.execute<{ importer: boolean; accepted: boolean }>(sql`
          select i.importer_id = ${context.accountId} as importer,
            i.state = 'accepted' or (i.target_space_id is not null and i.state in ('running', 'review'))
              as accepted
          from imports i where i.id = ${context.resource.id.toLowerCase()}`);
        const row = result.rows[0];
        if (!row || !(row.importer || row.accepted)) return false;
        return importingAdministrator(context);
      },
      importer: async (context) => {
        if (!context.organizationId || !context.resource.id) return false;
        const result = await context.executor.execute<{ importer_id: string }>(
          sql`select importer_id from imports where id = ${context.resource.id.toLowerCase()}`,
        );
        if (result.rows[0]?.importer_id !== context.accountId) return false;
        return importingAdministrator(context);
      },
      heldForAdministrator: async (context) => {
        if (!context.organizationId || !context.resource.id) return false;
        const result = await context.executor.execute<{ state: string }>(
          sql`select state from imports where id = ${context.resource.id.toLowerCase()}`,
        );
        if (result.rows[0]?.state !== "held") return false;
        return importingAdministrator(context);
      },
    },
  };

  return [
    instance,
    organization,
    group,
    account,
    serviceAccount,
    space,
    deletedSpace,
    item,
    comment,
    task,
    attachment,
    importOf,
  ];
}

function interactiveItem(state: Awaited<ReturnType<typeof itemState>>): RestrictionResult | null {
  if (!state || state.trashed) return { denial: "inTrash" };
  if (state.archived) return { denial: "archived" };
  return state.unpublished ? { denial: "unpublished", unless: "editor" } : null;
}

async function commentSpace(executor: Executor, id: string): Promise<string | null> {
  const result = await executor.execute<{ space_id: string }>(
    sql`select t.space_id from comments c join tree_items t on t.id = c.item_id where c.id = ${id}`,
  );
  return result.rows[0]?.space_id ?? null;
}

async function commentAuthor(executor: Executor, id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const result = await executor.execute<{ author_id: string | null }>(
    sql`select author_id from comments where id = ${id.toLowerCase()} and deleted_at is null`,
  );
  return result.rows[0]?.author_id ?? null;
}

async function commentState(
  executor: Executor,
  id: string,
): Promise<{
  trashed: boolean;
  archived: boolean;
  unpublished: boolean;
  hidden: boolean;
  deleted: boolean;
} | null> {
  const result = await executor.execute<{
    trashed: boolean;
    archived: boolean;
    unpublished: boolean;
    hidden: boolean;
    deleted: boolean;
  }>(sql`
    select (t.trash_entry_id is not null or s.deleted_at is not null) as trashed,
      (t.archived_root_id is not null or s.archived_at is not null or s.quarantined) as archived,
      not t.reader_visible as unpublished,
      (r.quote is not null and not r.quote_public) as hidden,
      c.deleted_at is not null as deleted
    from comments c join comments r on r.id = coalesce(c.parent_id, c.id)
    join tree_items t on t.id = c.item_id join spaces s on s.id = t.space_id
    where c.id = ${id}`);
  return result.rows[0] ?? null;
}

async function spaceState(
  executor: Executor,
  id: string,
): Promise<{ deleted: boolean; archived: boolean } | null> {
  const result = await executor.execute<{ deleted: boolean; archived: boolean }>(sql`
    select deleted_at is not null as deleted, (archived_at is not null or quarantined) as archived from spaces where id = ${id}`);
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
      (t.archived_root_id is not null or s.archived_at is not null or s.quarantined) as archived,
      (s.archived_at is not null or s.quarantined) as space_archived,
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
