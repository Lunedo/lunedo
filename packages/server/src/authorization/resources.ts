import { type SQL, sql } from "drizzle-orm";
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
  exportEnabledSetting,
  membersCreateConfidentialSpacesSetting,
  membersCreateSpacesSetting,
  personalSpacesSetting,
} from "../spaces/settings.js";
import { grantsLevel } from "./areas.js";
import type {
  ActionDefinition,
  ResourceType,
  Restriction,
  RestrictionResult,
  RuleContext,
} from "./registry.js";

const ALL_MEMBERSHIPS = ["member", "collaborator", "guest"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function managesExports(context: RuleContext, spaceId: string | null): Promise<boolean> {
  if (!spaceId) return false;
  const facts = await context.spaceFacts(spaceId);
  if (facts.account?.type !== "standard" || facts.membership === "guest" || facts.role === null) return false;
  if (facts.role === "admin") return true;
  const result = await context.executor.execute<{ organization_id: string | null; confidential: boolean }>(
    sql`select organization_id, confidential from spaces where id = ${spaceId}`,
  );
  const row = result.rows[0];
  if (!row?.organization_id || row.confidential) return false;
  const organization = await context.organizationFacts(row.organization_id);
  return organization.roles.some((role) => grantsLevel(role.areas.spaces, "manage"));
}

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
  const exportDisabled = async (executor: Executor, spaceId: string): Promise<RestrictionResult | null> => {
    const space = await executor.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    const organizationId = space.rows[0]?.organization_id;
    const enabled = await settings.get(
      exportEnabledSetting,
      { ...(organizationId ? { organization: organizationId } : {}), space: spaceId },
      { executor },
    );
    return enabled ? null : { denial: "exportDisabled" };
  };

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
      "organization.search.manage": {
        scope: "organization",
        membership: ALL_MEMBERSHIPS,
        tokenScope: { area: "spaces", level: "manage" },
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
        const target = await context.executor.execute<{
          home_organization_id: string | null;
          type: string;
          organizations: string[];
        }>(sql`select a.home_organization_id, a.type,
            array(select m.organization_id from memberships m where m.account_id = a.id) as organizations
          from accounts a where a.id = ${context.resource.id}`);
        const row = target.rows[0];
        const managed = async (organizationId: string) =>
          (await context.organizationFacts(organizationId)).roles.some((role) =>
            grantsLevel(role.areas.membersAndGroups, "manage"),
          );
        if (row?.home_organization_id) return managed(row.home_organization_id);
        if (row?.type !== "portal" || row.organizations.length === 0) return false;
        for (const organizationId of row.organizations) if (!(await managed(organizationId))) return false;
        return true;
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
    spaceOf: async (_executor, ids) => new Map(ids.map((id) => [id, id])),
    organizationOf: async (executor, id) => {
      const result = await executor.execute<{ organization_id: string | null }>(
        sql`select organization_id from spaces where id = ${id}`,
      );
      return result.rows[0]?.organization_id ?? null;
    },
    actions: {
      "space.view": { scope: "space", spaceRole: "reader", restriction: "present" },
      "space.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "space.createDraft": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "space.manage": { scope: "space", spaceRole: "admin", restriction: "present" },
      "space.trash": { scope: "space", spaceRole: "editor", restriction: "present" },
      "space.delete": { scope: "space", spaceRole: "admin", restriction: "present" },
      "space.portalAccounts.manage": organizationArea("membersAndGroups", "manage"),
      "space.export": {
        scope: "space",
        spaceRole: "reader",
        rule: "exportManager",
        ruleRequired: true,
        restriction: "exportable",
      },
    },
    rules: {
      exportManager: async (context) =>
        managesExports(
          context,
          context.resource.id && UUID.test(context.resource.id) ? context.resource.id.toLowerCase() : null,
        ),
    },
    restrictions: {
      present: async (executor, ids) => {
        const states = await spaceStates(executor, ids);
        return each(ids, (id) => (states.get(id)?.deleted ? { denial: "inTrash" } : null));
      },
      exportable: async (executor, ids) => {
        const states = await spaceStates(executor, ids);
        return each(ids, (id) => {
          const state = states.get(id);
          if (!state || state.deleted) return { denial: "inTrash" };
          return exportDisabled(executor, id);
        });
      },
      writable: async (executor, ids) => {
        const states = await spaceStates(executor, ids);
        return each(ids, (id) => {
          const state = states.get(id);
          if (state?.deleted) return { denial: "inTrash" };
          return state?.archived ? { denial: "archived" } : null;
        });
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
    spaceOf: (executor, ids) =>
      lookup(executor, sql`select id, space_id as value from tree_items where id = any(${uuids(ids)})`),
    itemOf: async (_executor, ids) => new Map(ids.map((id) => [id, id])),
    actions: {
      "item.view": { scope: "space", spaceRole: "reader", restriction: "readable" },
      "item.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "item.editDraft": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "item.publish": { scope: "space", spaceRole: "editor", restriction: "writable" },
      "item.delete": { scope: "space", spaceRole: "editor", restriction: "present" },
      "item.archive": { scope: "space", spaceRole: "editor", restriction: "present" },
      "item.comment": { scope: "space", spaceRole: "commenter", restriction: "interactive" },
      "item.react": { scope: "space", spaceRole: "reader", restriction: "interactive" },
      "item.pin": { scope: "space", spaceRole: "admin", restriction: "interactive" },
      "item.approveSchedule": { scope: "space", spaceRole: "admin", restriction: "writable" },
      "item.share": { scope: "space", spaceRole: "editor", restriction: "readable" },
      "item.export": { scope: "space", spaceRole: "reader", restriction: "exportable" },
      "item.exportPages": {
        scope: "space",
        spaceRole: "reader",
        rule: "exportManager",
        ruleRequired: true,
        restriction: "exportable",
      },
      "item.transferOwnership": {
        scope: "space",
        spaceRole: "admin",
        rule: "ownerOrOrganizationAdministrator",
        restriction: "writable",
      },
    },
    rules: {
      exportManager: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        const result = await context.executor.execute<{ space_id: string }>(
          sql`select space_id from tree_items where id = ${id.toLowerCase()}`,
        );
        return managesExports(context, result.rows[0]?.space_id ?? null);
      },
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
      readable: byItemState((state) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished ? { denial: "unpublished", unless: "editor" } : null;
      }),
      writable: byItemState(writableItem),
      present: byItemState((state) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.spaceArchived ? { denial: "archived" } : null;
      }),
      interactive: byItemState(interactiveItem),
      exportable: byItemState((state, executor) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        if (state.unpublished) return { denial: "unpublished" };
        return exportDisabled(executor, state.spaceId);
      }),
    },
  };

  const hasRole = async (context: RuleContext, spaceId: string | null, role: SpaceRole) => {
    if (!spaceId) return false;
    const facts = await context.spaceFacts(spaceId);
    return facts.sources.some((source) => grantsSpaceRole(source.role, role));
  };

  const comment: ResourceType = {
    type: "comment",
    spaceOf: commentSpaces,
    itemOf: (executor, ids) =>
      lookup(executor, sql`select id, item_id as value from comments where id = any(${uuids(ids)})`),
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
        const id = context.resource.id ?? "";
        const spaces = UUID.test(id) ? await commentSpaces(context.executor, [id.toLowerCase()]) : new Map();
        return hasRole(context, spaces.get(id.toLowerCase()) ?? null, "commenter");
      },
    },
    restrictions: {
      visible: byCommentState((state) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      }),
      restorable: byCommentState((state) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        if (state.archived) return { denial: "archived" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      }),
      open: byCommentState((state) => {
        if (!state || state.trashed || state.deleted) return { denial: "inTrash" };
        if (state.archived) return { denial: "archived" };
        return state.unpublished || state.hidden ? { denial: "unpublished", unless: "editor" } : null;
      }),
    },
  };

  const task: ResourceType = {
    type: "task",
    spaceOf: (executor, ids) =>
      lookup(
        executor,
        sql`select k.id, t.space_id as value from tasks k join tree_items t on t.id = k.item_id
          where k.id = any(${uuids(ids)})`,
      ),
    itemOf: (executor, ids) =>
      lookup(executor, sql`select id, item_id as value from tasks where id = any(${uuids(ids)})`),
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
      visible: byParentState(
        (executor, ids) =>
          parents(executor, sql`select id, item_id, published from tasks where id = any(${uuids(ids)})`),
        (state, task) => {
          if (!state || state.trashed) return { denial: "inTrash" };
          return state.unpublished || !task?.published ? { denial: "unpublished", unless: "editor" } : null;
        },
      ),
      interactive: byParentState(
        (executor, ids) =>
          parents(executor, sql`select id, item_id, published from tasks where id = any(${uuids(ids)})`),
        interactiveItem,
      ),
    },
  };

  const attachmentParents = (executor: Executor, ids: readonly string[]) =>
    parents(
      executor,
      sql`select id, item_id, published_version_id is not null as published from attachments
        where id = any(${uuids(ids)}) and (deleted_at is null or published_version_id is not null)`,
    );

  const attachment: ResourceType = {
    type: "attachment",
    spaceOf: (executor, ids) =>
      lookup(
        executor,
        sql`select a.id, t.space_id as value from attachments a join tree_items t on t.id = a.item_id
          where a.id = any(${uuids(ids)}) and (a.deleted_at is null or a.published_version_id is not null)`,
      ),
    itemOf: async (executor, ids) =>
      new Map([...(await attachmentParents(executor, ids))].map(([id, parent]) => [id, parent.item_id])),
    actions: {
      "attachment.view": { scope: "space", spaceRole: "reader", restriction: "readable" },
      "attachment.edit": { scope: "space", spaceRole: "editor", restriction: "writable" },
    },
    restrictions: {
      readable: byParentState(attachmentParents, (state, attachment) => {
        if (!state || state.trashed) return { denial: "inTrash" };
        return state.unpublished || !attachment?.published
          ? { denial: "unpublished", unless: "editor" }
          : null;
      }),
      writable: byParentState(attachmentParents, writableItem),
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

  const exportOf: ResourceType = {
    type: "export",
    actions: {
      "export.view": {
        scope: "instance",
        rule: "exportOwner",
        tokenScope: { area: "spaces", level: "view" },
      },
      "export.delete": {
        scope: "instance",
        rule: "exportOwner",
        tokenScope: { area: "spaces", level: "manage" },
      },
      "export.download": {
        scope: "instance",
        rule: "readyExportOwner",
        tokenScope: { area: "spaces", level: "view" },
      },
    },
    rules: {
      exportOwner: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        const result = await context.executor.execute<{ id: string }>(sql`
          select id from exports where id = ${id.toLowerCase()} and account_id = ${context.accountId}`);
        return result.rows.length > 0;
      },
      readyExportOwner: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        const result = await context.executor.execute<{ id: string }>(sql`
          select id from exports where id = ${id.toLowerCase()} and account_id = ${context.accountId}
            and state = 'ready' and expires_at > now()`);
        return result.rows.length > 0;
      },
    },
  };

  const copyOf: ResourceType = {
    type: "copy",
    actions: {
      "copy.view": {
        scope: "instance",
        rule: "copyOwner",
        tokenScope: { area: "spaces", level: "view" },
      },
    },
    rules: {
      copyOwner: async (context) => {
        const id = context.resource.id;
        if (!id || !UUID.test(id)) return false;
        const result = await context.executor.execute<{ id: string }>(sql`
          select id from item_copies where id = ${id.toLowerCase()} and account_id = ${context.accountId}`);
        return result.rows.length > 0;
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
    exportOf,
    copyOf,
  ];
}

type Decided = RestrictionResult | null;

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

async function lookup(executor: Executor, query: SQL): Promise<Map<string, string>> {
  const result = await executor.execute<{ id: string; value: string }>(query);
  return new Map(result.rows.map((row) => [row.id, row.value]));
}

async function each(
  ids: readonly string[],
  decide: (id: string) => Decided | Promise<Decided>,
): Promise<Map<string, RestrictionResult>> {
  const restricted = new Map<string, RestrictionResult>();
  for (const id of ids) {
    const result = await decide(id);
    if (result) restricted.set(id, result);
  }
  return restricted;
}

interface ItemState {
  spaceId: string;
  trashed: boolean;
  archived: boolean;
  spaceArchived: boolean;
  unpublished: boolean;
}

function writableItem(state: ItemState | undefined): Decided {
  if (!state || state.trashed) return { denial: "inTrash" };
  return state.archived ? { denial: "archived" } : null;
}

function interactiveItem(state: ItemState | undefined): Decided {
  if (!state || state.trashed) return { denial: "inTrash" };
  if (state.archived) return { denial: "archived" };
  return state.unpublished ? { denial: "unpublished", unless: "editor" } : null;
}

function byItemState(
  decide: (state: ItemState | undefined, executor: Executor) => Decided | Promise<Decided>,
): Restriction {
  return async (executor, ids) => {
    const states = await itemStates(executor, ids);
    return each(ids, (id) => decide(states.get(id), executor));
  };
}

interface Parent {
  item_id: string;
  published: boolean;
}

async function parents(executor: Executor, query: SQL): Promise<Map<string, Parent>> {
  const result = await executor.execute<Parent & { id: string; [key: string]: unknown }>(query);
  return new Map(result.rows.map((row) => [row.id, { item_id: row.item_id, published: row.published }]));
}

function byParentState(
  load: (executor: Executor, ids: readonly string[]) => Promise<Map<string, Parent>>,
  decide: (state: ItemState | undefined, parent: Parent | undefined) => Decided,
): Restriction {
  return async (executor, ids) => {
    const found = await load(executor, ids);
    const states = await itemStates(executor, [
      ...new Set([...found.values()].map((parent) => parent.item_id)),
    ]);
    return each(ids, (id) => {
      const parent = found.get(id);
      return decide(parent ? states.get(parent.item_id) : undefined, parent);
    });
  };
}

function commentSpaces(executor: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  return lookup(
    executor,
    sql`select c.id, t.space_id as value from comments c join tree_items t on t.id = c.item_id
      where c.id = any(${uuids(ids)})`,
  );
}

async function commentAuthor(executor: Executor, id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const result = await executor.execute<{ author_id: string | null }>(
    sql`select author_id from comments where id = ${id.toLowerCase()} and deleted_at is null`,
  );
  return result.rows[0]?.author_id ?? null;
}

interface CommentState {
  trashed: boolean;
  archived: boolean;
  unpublished: boolean;
  hidden: boolean;
  deleted: boolean;
}

function byCommentState(decide: (state: CommentState | undefined) => Decided): Restriction {
  return async (executor, ids) => {
    const result = await executor.execute<CommentState & { id: string; [key: string]: unknown }>(sql`
      select c.id, (t.trash_entry_id is not null or s.deleted_at is not null) as trashed,
        (t.archived_root_id is not null or s.archived_at is not null or s.quarantined) as archived,
        not t.reader_visible as unpublished,
        (r.quote is not null and not r.quote_public) as hidden,
        c.deleted_at is not null as deleted
      from comments c join comments r on r.id = coalesce(c.parent_id, c.id)
      join tree_items t on t.id = c.item_id join spaces s on s.id = t.space_id
      where c.id = any(${uuids(ids)})`);
    const states = new Map(result.rows.map((row) => [row.id, row]));
    return each(ids, (id) => decide(states.get(id)));
  };
}

async function spaceStates(
  executor: Executor,
  ids: readonly string[],
): Promise<Map<string, { deleted: boolean; archived: boolean }>> {
  const result = await executor.execute<{ id: string; deleted: boolean; archived: boolean }>(sql`
    select id, deleted_at is not null as deleted, (archived_at is not null or quarantined) as archived
    from spaces where id = any(${uuids(ids)})`);
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function itemStates(executor: Executor, ids: readonly string[]): Promise<Map<string, ItemState>> {
  if (ids.length === 0) return new Map();
  const result = await executor.execute<{
    id: string;
    space_id: string;
    trashed: boolean;
    archived: boolean;
    space_archived: boolean;
    unpublished: boolean;
  }>(sql`
    select t.id, t.space_id, (t.trash_entry_id is not null or s.deleted_at is not null) as trashed,
      (t.archived_root_id is not null or s.archived_at is not null or s.quarantined) as archived,
      (s.archived_at is not null or s.quarantined) as space_archived,
      not t.reader_visible as unpublished
    from tree_items t join spaces s on s.id = t.space_id where t.id = any(${uuids(ids)})`);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        spaceId: row.space_id,
        trashed: row.trashed,
        archived: row.archived,
        spaceArchived: row.space_archived,
        unpublished: row.unpublished,
      },
    ]),
  );
}
