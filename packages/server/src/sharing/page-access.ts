import { uuidv7 } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditEvents, AuditLog } from "../audit/audit-log.js";
import {
  editRestrictionCondition,
  holderCovers,
  holderMatches,
  itemLevel,
  LEVEL_ROLES,
  restrictionHasActiveHolder,
  restrictionListedBy,
  viewRestrictionCondition,
} from "../authorization/item-access.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import {
  type AccessImpact,
  organizationMembership,
  type RoleChange,
  spaceRoleConditionFor,
} from "../authorization/space-access.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { spaceDisplayName } from "../spaces/display-name.js";
import { lockSpaces } from "../spaces/items.js";
import type { PeopleService } from "../spaces/people.js";
import type { SpaceRole, TreeItemKind } from "../spaces/schema.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { spaceKeyFor, spaceNameFor, visibleItem } from "../spaces/visibility.js";
import type { RestrictionKind, ShareRole } from "./schema.js";

export type HolderKind = "account" | "group";

export interface AccessHolder {
  kind: HolderKind;
  id: string;
  name: string | null;
  email: string | null;
  members: number | null;
  active: boolean;
}

export interface PageShareEntry {
  id: string;
  holder: AccessHolder;
  role: ShareRole;
  includeDescendants: boolean;
  spaceRole: SpaceRole | null;
  sharedBy: { id: string; name: string | null } | null;
  createdAt: Date;
}

export interface RestrictionInfo {
  setBy: { id: string; name: string | null } | null;
  setAt: Date;
}

export interface PageAccess {
  itemId: string;
  title: string;
  shares: PageShareEntry[];
  restrictions: {
    view: RestrictionInfo | null;
    edit: RestrictionInfo | null;
    inherited: { itemId: string; title: string | null }[];
    holders: { kind: RestrictionKind; holder: AccessHolder }[];
  };
  linkVisitors: { accountId: string; name: string | null; linkId: string; lastOpenedAt: Date }[];
}

export type AccessChange =
  | {
      action: "share";
      holderKind: HolderKind;
      holderId: string;
      role: ShareRole;
      includeDescendants?: boolean;
    }
  | { action: "changeShare"; shareId: string; role?: ShareRole; includeDescendants?: boolean }
  | { action: "removeShare"; shareId: string }
  | { action: "restrict"; kind: RestrictionKind }
  | { action: "unrestrict"; kind: RestrictionKind }
  | { action: "listHolder"; kind: RestrictionKind; holderKind: HolderKind; holderId: string }
  | { action: "unlistHolder"; kind: RestrictionKind; holderKind: HolderKind; holderId: string };

export interface PageAccessImpact {
  read: AccessImpact;
  edit: AccessImpact;
}

export interface RestrictedPage {
  itemId: string;
  title: string;
  kind: TreeItemKind;
  view: RestrictionInfo | null;
  edit: RestrictionInfo | null;
  orphaned: boolean;
}

export interface SharedWithMe {
  itemId: string;
  title: string;
  kind: TreeItemKind;
  role: ShareRole;
  includeDescendants: boolean;
  sharedBy: { id: string; name: string | null } | null;
  sharedAt: Date;
  spaceKey: string;
  spaceName: string;
}

interface ItemRow {
  id: string;
  space_id: string;
  title: string;
  kind: TreeItemKind;
  organization_id: string | null;
  space_name: string;
  space_key: string;
  [key: string]: unknown;
}

class PreviewRollback extends Error {
  constructor(readonly impact: PageAccessImpact) {
    super("Preview");
  }
}

export interface AccessChangeOptions {
  readonly shareWithActor?: boolean;
}

const IMPACT_LIST_LIMIT = 100;

export interface ShareReach {
  page: boolean;
  uncoveredBelow: number;
}

export class PageAccessService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;
  readonly #afterAccessChange: ((tx: Transaction, spaceId: string) => Promise<void>)[] = [];

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    people: PeopleService;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#people = options.people;
    this.#notifications = options.notifications;
  }

  onAccessChange(listener: (tx: Transaction, spaceId: string) => Promise<void>): void {
    this.#afterAccessChange.push(listener);
  }

  async #item(executor: Executor, itemId: string): Promise<ItemRow> {
    const result = await executor.execute<ItemRow>(sql`
      select t.id, t.space_id, t.title, t.kind, s.organization_id, ${spaceDisplayName(sql`s`)} as space_name, s.key as space_key
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    return row;
  }

  async sharedWith(viewer: Principal, limit = 50): Promise<SharedWithMe[]> {
    const accountId = actorIdOf(viewer);
    if (!accountId) return [];
    const result = await this.#database.execute<{
      id: string;
      title: string;
      kind: TreeItemKind;
      role: ShareRole;
      include_descendants: boolean;
      created_by: string | null;
      shared_by_name: string | null;
      shared_at: Date | string;
      space_key: string;
      space_name: string;
    }>(sql`
      select * from (
        select distinct on (t.id) t.id, t.title, t.kind, ps.role, ps.include_descendants, ps.created_by,
          ${this.#people.visibleName(viewer, sql`sb`)} as shared_by_name, ps.created_at as shared_at,
          ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as space_key,
          ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name
        from page_shares ps
        join tree_items t on t.id = ps.item_id
        join spaces s on s.id = t.space_id
        left join accounts sb on sb.id = ps.created_by
        where ${holderCovers(sql`ps.principal_kind`, sql`ps.principal_id`, sql`${accountId}::uuid`, sql`s.organization_id`)}
          and ps.created_by is distinct from ${accountId}::uuid
          and s.archived_at is null and t.archived_at is null
          and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        order by t.id, ps.created_at desc
      ) shared
      order by shared_at desc, id
      limit ${limit}`);
    return result.rows.map((row) => ({
      itemId: row.id,
      title: row.title,
      kind: row.kind,
      role: row.role,
      includeDescendants: row.include_descendants,
      sharedBy: row.created_by ? { id: row.created_by, name: row.shared_by_name } : null,
      sharedAt: new Date(row.shared_at),
      spaceKey: row.space_key,
      spaceName: row.space_name,
    }));
  }

  async get(viewer: Principal, itemId: string): Promise<PageAccess> {
    const item = await this.#item(this.#database, itemId);
    const shares = await this.#database.execute<{
      id: string;
      principal_kind: HolderKind;
      principal_id: string;
      role: ShareRole;
      include_descendants: boolean;
      created_by: string | null;
      created_at: Date | string;
      name: string | null;
      email: string | null;
      members: string | null;
      active: boolean;
    }>(sql`
      select ps.id, ps.principal_kind, ps.principal_id, ps.role, ps.include_descendants, ps.created_by, ps.created_at,
        case when ps.principal_kind = 'group' then g.name else ${this.#people.visibleName(viewer, sql`a`)} end as name,
        case when ps.principal_kind = 'account' and ${this.#people.colleagueCondition(viewer, sql`a.id`)} then a.email end as email,
        case when ps.principal_kind = 'group' then (select count(*) from group_members gm join accounts ga on ga.id = gm.account_id
          where gm.group_id = g.id and ga.state = 'active' and (gm.expires_at is null or gm.expires_at > now())) end as members,
        case when ps.principal_kind = 'group' then g.id is not null else a.state = 'active' end as active
      from page_shares ps
      left join accounts a on ps.principal_kind = 'account' and a.id = ps.principal_id
      left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
      where ps.item_id = ${itemId}
      order by ps.created_at, ps.id`);
    const spaceRoles = new Map<string, SpaceRole | null>();
    for (const share of shares.rows) {
      if (share.principal_kind !== "account") continue;
      const facts = await this.#authorization.spaceRole(share.principal_id, item.space_id);
      spaceRoles.set(share.principal_id, facts.role);
    }
    const restrictions = await this.#database.execute<{
      item_id: string;
      kind: RestrictionKind;
      set_by: string | null;
      created_at: Date | string;
      title: string;
      visible: boolean;
    }>(sql`
      select r.item_id, r.kind, r.set_by, r.created_at, t.title,
        ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as visible
      from page_restrictions r join tree_items t on t.id = r.item_id join spaces s on s.id = t.space_id
      where r.item_id = any((select path from tree_items where id = ${itemId})::uuid[])
      order by array_position((select path from tree_items where id = ${itemId}), r.item_id)`);
    const holders = await this.#database.execute<{
      kind: RestrictionKind;
      principal_kind: HolderKind;
      principal_id: string;
      name: string | null;
      email: string | null;
      members: string | null;
      active: boolean;
    }>(sql`
      select rh.kind, rh.principal_kind, rh.principal_id,
        case when rh.principal_kind = 'group' then g.name else ${this.#people.visibleName(viewer, sql`a`)} end as name,
        case when rh.principal_kind = 'account' and ${this.#people.colleagueCondition(viewer, sql`a.id`)} then a.email end as email,
        case when rh.principal_kind = 'group' then (select count(*) from group_members gm join accounts ga on ga.id = gm.account_id
          where gm.group_id = g.id and ga.state = 'active' and (gm.expires_at is null or gm.expires_at > now())) end as members,
        case when rh.principal_kind = 'group' then g.id is not null else a.state = 'active' end as active
      from page_restriction_holders rh
      left join accounts a on rh.principal_kind = 'account' and a.id = rh.principal_id
      left join groups g on rh.principal_kind = 'group' and g.id = rh.principal_id
      where rh.item_id = ${itemId}
      order by rh.kind, rh.created_at, rh.principal_id`);
    const visitors = await this.#database.execute<{
      account_id: string;
      name: string | null;
      link_id: string;
      last_opened_at: Date | string;
    }>(sql`
      select la.account_id, ${this.#people.visibleName(viewer, sql`a`)} as name, la.link_id, la.last_opened_at
      from share_link_accesses la join share_links l on l.id = la.link_id join accounts a on a.id = la.account_id
      where l.item_id = ${itemId} and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
        and a.state = 'active'
      order by la.last_opened_at desc limit 200`);
    const names = await this.#people.visibleNames(
      viewer,
      [...shares.rows.map((row) => row.created_by), ...restrictions.rows.map((row) => row.set_by)].filter(
        (id): id is string => id !== null,
      ),
    );
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? null } : null);
    const own = (kind: RestrictionKind): RestrictionInfo | null => {
      const row = restrictions.rows.find((entry) => entry.item_id === itemId && entry.kind === kind);
      return row ? { setBy: person(row.set_by), setAt: new Date(row.created_at) } : null;
    };
    return {
      itemId,
      title: item.title,
      shares: shares.rows.map((row) => ({
        id: row.id,
        holder: {
          kind: row.principal_kind,
          id: row.principal_id,
          name: row.name,
          email: row.email,
          members: row.members === null ? null : Number(row.members),
          active: row.active,
        },
        role: row.role,
        includeDescendants: row.include_descendants,
        spaceRole: row.principal_kind === "account" ? (spaceRoles.get(row.principal_id) ?? null) : null,
        sharedBy: person(row.created_by),
        createdAt: new Date(row.created_at),
      })),
      restrictions: {
        view: own("view"),
        edit: own("edit"),
        inherited: restrictions.rows
          .filter((row) => row.item_id !== itemId && row.kind === "view")
          .map((row) => ({ itemId: row.item_id, title: row.visible ? row.title : null })),
        holders: holders.rows.map((row) => ({
          kind: row.kind,
          holder: {
            kind: row.principal_kind,
            id: row.principal_id,
            name: row.name,
            email: row.email,
            members: row.members === null ? null : Number(row.members),
            active: row.active,
          },
        })),
      },
      linkVisitors: visitors.rows.map((row) => ({
        accountId: row.account_id,
        name: row.name,
        linkId: row.link_id,
        lastOpenedAt: new Date(row.last_opened_at),
      })),
    };
  }

  async preview(
    actor: Principal,
    itemId: string,
    changes: AccessChange[],
    options: AccessChangeOptions = {},
  ): Promise<PageAccessImpact> {
    try {
      await this.#database.transaction(async (tx) => {
        const item = await this.#item(tx, itemId);
        await this.#requireShare(tx, actor, itemId);
        const before = await this.#levels(tx, item, changes);
        await this.#apply(tx, actor, item, changes, { ...options, audit: false });
        const after = await this.#levels(tx, item, changes);
        throw new PreviewRollback(await this.#impact(tx, actor, before, after));
      });
    } catch (error) {
      if (error instanceof PreviewRollback) return error.impact;
      throw error;
    }
    throw new Error("The preview did not finish");
  }

  async change(actor: Principal, itemId: string, changes: AccessChange[]): Promise<PageAccess> {
    if (changes.length === 0) return this.get(actor, itemId);
    const mailIds = await this.#database.transaction((tx) => this.changeWithin(tx, actor, itemId, changes));
    await this.#notifications.dispatch(mailIds);
    return this.get(actor, itemId);
  }

  async changeWithin(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    changes: AccessChange[],
    options: AccessChangeOptions = {},
  ): Promise<string[]> {
    const located = await this.#item(tx, itemId);
    await lockSpaces(tx, [located.space_id]);
    const item = await this.#item(tx, itemId);
    await this.#requireShare(tx, actor, itemId);
    if (actor.type !== "system" && item.kind === "folder") {
      const space = await tx.execute<{ type: string }>(
        sql`select type from spaces where id = ${item.space_id}`,
      );
      if (space.rows[0]?.type === "knowledgeBase") {
        throw new SpaceError(
          "categoryAccessManaged",
          "Who reads and who maintains a category is set in its Access dialog by the space admins",
        );
      }
    }
    const notified = await this.#apply(tx, actor, item, changes, { ...options, audit: true });
    await this.#afterChange(tx, item.space_id, itemId);
    const mailIds: string[] = [];
    for (const entry of notified) {
      const result = await this.#notifications.notify(tx, {
        type: "page.shared",
        recipients: [entry.accountId],
        actor,
        organizationId: item.organization_id,
        targetId: itemId,
        params: {
          itemTitle: item.title,
          itemKind: item.kind === "blogPost" || item.kind === "whiteboard" ? item.kind : "page",
          spaceKey: "",
          role: entry.role,
          includeDescendants: entry.includeDescendants,
        },
      });
      mailIds.push(...result.mailIds);
    }
    return mailIds;
  }

  async #afterChange(tx: Transaction, spaceId: string, itemId: string): Promise<void> {
    await this.clearOrphaned(tx, itemId);
    await signalSpaceChange(tx, { spaceId, kind: "access", itemId });
    for (const listener of this.#afterAccessChange) await listener(tx, spaceId);
  }

  async #requireShare(tx: Transaction, actor: Principal, itemId: string): Promise<void> {
    const decision = await this.#authorization.explain(
      actor,
      "item.share",
      { type: "item", id: itemId },
      { executor: tx, fresh: true },
    );
    if (!decision.allowed) throw new ForbiddenError(decision);
  }

  async #validateHolder(
    tx: Transaction,
    actor: Principal,
    item: ItemRow,
    kind: HolderKind,
    id: string,
  ): Promise<string> {
    if (kind === "account") {
      const account = await tx.execute<{ name: string; type: string; state: string }>(
        sql`select name, type::text as type, state::text as state from accounts where id = ${id}`,
      );
      const row = account.rows[0];
      if (row?.state !== "active" || row.type === "portal" || !(await this.#people.canSee(actor, id, tx))) {
        throw new SpaceError("invalidHolder", "Choose a person you can find in the search");
      }
      return row.name;
    }
    const confidential = await tx.execute<{ confidential: boolean }>(sql`
      select s.confidential from tree_items t join spaces s on s.id = t.space_id where t.id = ${item.id}`);
    if (confidential.rows[0]?.confidential) {
      throw new SpaceError(
        "invalidHolder",
        "In a confidential space, pages are shared with individual people only",
      );
    }
    const group = await tx.execute<{ name: string; organization_id: string }>(
      sql`select name, organization_id from groups where id = ${id}`,
    );
    const row = group.rows[0];
    const organizationId = item.organization_id;
    const allowed =
      row !== undefined &&
      (organizationId === null
        ? actor.type === "system" ||
          (actor.type === "account" &&
            (
              await tx.execute(sql`select 1 from memberships m where m.organization_id = ${row.organization_id}
                and m.account_id = ${actor.id} and m.kind = 'member' and (m.expires_at is null or m.expires_at > now())`)
            ).rows.length > 0)
        : row.organization_id === organizationId);
    if (!allowed || !row) {
      throw new SpaceError("invalidHolder", "Choose a group of the organization the page belongs to");
    }
    return row.name;
  }

  async #apply(
    tx: Transaction,
    actor: Principal,
    item: ItemRow,
    changes: AccessChange[],
    options: AccessChangeOptions & { audit: boolean },
  ): Promise<{ accountId: string; role: ShareRole; includeDescendants: boolean }[]> {
    const events: AuditEvents = [];
    const notified: { accountId: string; role: ShareRole; includeDescendants: boolean }[] = [];
    const base = { spaceId: item.space_id, title: item.title };
    const actorId = actorIdOf(actor);
    for (const change of changes) {
      switch (change.action) {
        case "share": {
          const name = await this.#validateHolder(tx, actor, item, change.holderKind, change.holderId);
          const existing = await tx.execute<{ id: string }>(sql`
            select id from page_shares where item_id = ${item.id} and principal_kind = ${change.holderKind}
              and principal_id = ${change.holderId}`);
          if (existing.rows[0]) {
            throw new SpaceError(
              "alreadyShared",
              "The page is already shared with them; change their access",
            );
          }
          const includeDescendants = change.includeDescendants ?? false;
          if (includeDescendants) await this.requireReach(tx, actor, item.id, change.role, true);
          await tx.execute(sql`
            insert into page_shares (id, item_id, principal_kind, principal_id, role, include_descendants, created_by)
            values (${uuidv7()}, ${item.id}, ${change.holderKind}, ${change.holderId}, ${change.role},
              ${includeDescendants}, ${actorId})`);
          events.push({
            name: "page.shared",
            actor,
            targetId: item.id,
            fields: {
              ...base,
              principalKind: change.holderKind,
              principalId: change.holderId,
              name,
              role: change.role,
              includeDescendants,
            },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          if (change.holderKind === "account" && change.holderId !== actorId) {
            notified.push({ accountId: change.holderId, role: change.role, includeDescendants });
          }
          break;
        }
        case "changeShare": {
          const current = await this.#share(tx, item.id, change.shareId);
          const role = change.role ?? current.role;
          const includeDescendants = change.includeDescendants ?? current.include_descendants;
          if (actorId && (await this.#holds(tx, actorId, current.principal_kind, current.principal_id))) {
            throw new SpaceError(
              "ownShare",
              "You cannot change access you hold yourself or through one of your groups. Ask someone else who can share the page.",
            );
          }
          const widened = includeDescendants && !current.include_descendants;
          const raised = LEVEL_ROLES.indexOf(role) > LEVEL_ROLES.indexOf(current.role);
          if (widened || raised) await this.requireReach(tx, actor, item.id, role, includeDescendants);
          await tx.execute(sql`
            update page_shares set role = ${role}, include_descendants = ${includeDescendants}, updated_at = now()
            where id = ${change.shareId}`);
          events.push({
            name: "page.shareChanged",
            actor,
            targetId: item.id,
            fields: {
              ...base,
              principalKind: current.principal_kind,
              principalId: current.principal_id,
              name: current.name ?? "",
              role,
              includeDescendants,
              previousRole: current.role,
              previousIncludeDescendants: current.include_descendants,
            },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          break;
        }
        case "removeShare": {
          const current = await this.#share(tx, item.id, change.shareId);
          await tx.execute(sql`delete from page_shares where id = ${change.shareId}`);
          events.push({
            name: "page.unshared",
            actor,
            targetId: item.id,
            fields: {
              ...base,
              principalKind: current.principal_kind,
              principalId: current.principal_id,
              name: current.name ?? "",
              role: current.role,
              includeDescendants: current.include_descendants,
            },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          break;
        }
        case "restrict": {
          const inserted = await tx.execute(sql`
            insert into page_restrictions (item_id, kind, set_by) values (${item.id}, ${change.kind}, ${actorId})
            on conflict do nothing returning item_id`);
          if (inserted.rows.length === 0) break;
          if (actorId && options.shareWithActor !== false) {
            await tx.execute(sql`
              insert into page_shares (id, item_id, principal_kind, principal_id, role, created_by)
              values (${uuidv7()}, ${item.id}, 'account', ${actorId}, 'editor', ${actorId})
              on conflict (item_id, principal_kind, principal_id) do update set role = 'editor', updated_at = now()`);
          }
          events.push({
            name: "page.restrictionSet",
            actor,
            targetId: item.id,
            fields: { ...base, kind: change.kind },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          break;
        }
        case "listHolder":
        case "unlistHolder": {
          const name =
            change.holderKind === "account"
              ? await this.#listedAccount(tx, change.holderId)
              : await this.#validateHolder(tx, actor, item, "group", change.holderId);
          if (change.action === "listHolder") {
            const restricted = await tx.execute(sql`
              select 1 from page_restrictions where item_id = ${item.id} and kind = ${change.kind}`);
            if (restricted.rows.length === 0) {
              throw new SpaceError(
                "notRestricted",
                "The page has no restriction of this kind; restrict it first",
              );
            }
            const inserted = await tx.execute(sql`
              insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
              values (${item.id}, ${change.kind}, ${change.holderKind}, ${change.holderId})
              on conflict do nothing returning item_id`);
            if (inserted.rows.length === 0) break;
          } else {
            const removed = await tx.execute(sql`
              delete from page_restriction_holders where item_id = ${item.id} and kind = ${change.kind}
                and principal_kind = ${change.holderKind} and principal_id = ${change.holderId}
              returning item_id`);
            if (removed.rows.length === 0) break;
          }
          events.push({
            name:
              change.action === "listHolder"
                ? "page.restrictionHolderAdded"
                : "page.restrictionHolderRemoved",
            actor,
            targetId: item.id,
            fields: {
              ...base,
              kind: change.kind,
              principalKind: change.holderKind,
              principalId: change.holderId,
              name,
            },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          break;
        }
        case "unrestrict": {
          const removed = await tx.execute(sql`
            delete from page_restrictions where item_id = ${item.id} and kind = ${change.kind} returning item_id`);
          if (removed.rows.length === 0) break;
          events.push({
            name: "page.restrictionRemoved",
            actor,
            targetId: item.id,
            fields: { ...base, kind: change.kind, byAdministrator: false },
            scope: auditScopeOf({ organizationId: item.organization_id }),
          });
          break;
        }
      }
    }
    await this.#checkListed(tx, item.id);
    if (options.audit) await this.#audit.recordMany(tx, events);
    return notified;
  }

  async #listedAccount(tx: Transaction, accountId: string): Promise<string> {
    const account = await tx.execute<{ name: string }>(sql`
      select name from accounts where id = ${accountId} and type <> 'portal' and state in ('active', 'placeholder')
        and merged_into_id is null`);
    const row = account.rows[0];
    if (!row) throw new SpaceError("invalidHolder", "Choose a person you can find in the search");
    return row.name;
  }

  async #checkListed(tx: Transaction, itemId: string): Promise<void> {
    const result = await tx.execute<{ kind: RestrictionKind; listed: boolean }>(sql`
      select r.kind, ${restrictionListedBy(sql`r`, () => sql`true`)} as listed
      from page_restrictions r where r.item_id = ${itemId}`);
    for (const row of result.rows) {
      if (row.listed) continue;
      throw new SpaceError(
        row.kind === "view" ? "restrictionWithoutViewers" : "restrictionWithoutEditors",
        row.kind === "view"
          ? "A restricted page needs at least one person or group who can view it"
          : "A page restricted for editing needs at least one person or group who can edit it",
      );
    }
  }

  async #holds(tx: Transaction, accountId: string, kind: HolderKind, id: string): Promise<boolean> {
    const result = await tx.execute<{ holds: boolean }>(sql`
      select ${holderMatches(sql`${kind}::text`, sql`${id}::uuid`, sql`${accountId}::uuid`)} as holds`);
    return result.rows[0]?.holds === true;
  }

  async reach(
    executor: Executor,
    actor: Principal,
    itemId: string,
    role: ShareRole,
    includeDescendants: boolean,
  ): Promise<ShareReach> {
    if (actor.type === "system") return { page: true, uncoveredBelow: 0 };
    if (actor.type !== "account") return { page: false, uncoveredBelow: 0 };
    const account = sql`${actor.id}::uuid`;
    const covered = sql`(${spaceRoleConditionFor(account, sql`s`, role)}
      and ${viewRestrictionCondition(account, sql`t`, sql`s`)}
      ${role === "editor" ? sql`and ${editRestrictionCondition(account, sql`t`, sql`s`)}` : sql``})`;
    const result = await executor.execute<{ page: boolean; uncovered: number }>(sql`
      select coalesce(bool_or(${covered}) filter (where t.id = ${itemId}), false) as page,
        (count(*) filter (where t.id <> ${itemId} and not ${covered}))::int as uncovered
      from tree_items t join spaces s on s.id = t.space_id
      where ${includeDescendants ? sql`${itemId}::uuid = any(t.path)` : sql`t.id = ${itemId}`}`);
    const row = result.rows[0];
    return { page: row?.page === true, uncoveredBelow: Number(row?.uncovered ?? 0) };
  }

  async requireReach(
    executor: Executor,
    actor: Principal,
    itemId: string,
    role: ShareRole,
    includeDescendants: boolean,
  ): Promise<void> {
    const reach = await this.reach(executor, actor, itemId, role, includeDescendants);
    if (reach.page && reach.uncoveredBelow === 0) return;
    throw new SpaceError(
      "shareBeyondOwnAccess",
      reach.uncoveredBelow > 0
        ? `Your own role in the space does not give you this access to ${reach.uncoveredBelow} pages below. Share only this page, choose a lower role, or ask a space admin.`
        : "Your own role in the space does not give you this access to the page. Choose a lower role or ask a space admin.",
      { uncoveredPages: reach.uncoveredBelow },
    );
  }

  async #share(
    tx: Transaction,
    itemId: string,
    shareId: string,
  ): Promise<{
    principal_kind: HolderKind;
    principal_id: string;
    role: ShareRole;
    include_descendants: boolean;
    name: string | null;
  }> {
    const result = await tx.execute<{
      principal_kind: HolderKind;
      principal_id: string;
      role: ShareRole;
      include_descendants: boolean;
      name: string | null;
    }>(sql`
      select ps.principal_kind, ps.principal_id, ps.role, ps.include_descendants, coalesce(a.name, g.name) as name
      from page_shares ps
      left join accounts a on ps.principal_kind = 'account' and a.id = ps.principal_id
      left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
      where ps.id = ${shareId} and ps.item_id = ${itemId} for update of ps`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("shareNotFound", "This access does not exist anymore");
    return row;
  }

  #candidates(item: ItemRow, changes: AccessChange[]): SQL {
    const groups = changes
      .filter((change) => change.action === "share" && change.holderKind === "group")
      .map((change) => (change.action === "share" ? change.holderId : ""));
    const accounts = changes
      .filter((change) => change.action === "share" && change.holderKind === "account")
      .map((change) => (change.action === "share" ? change.holderId : ""));
    for (const change of changes) {
      if (change.action !== "listHolder" && change.action !== "unlistHolder") continue;
      if (change.holderKind === "account") accounts.push(change.holderId);
      else groups.push(change.holderId);
    }
    return sql`
      select sp.principal_id from space_permissions sp where sp.space_id = ${item.space_id} and sp.principal_kind = 'account'
      union select gm.account_id from space_permissions sp join group_members gm on gm.group_id = sp.principal_id
        where sp.space_id = ${item.space_id} and sp.principal_kind = 'group'
      union select m.account_id from memberships m where m.organization_id = ${item.organization_id}
      union select a.id from accounts a where a.type = 'standard' and exists (select 1 from spaces s
        where s.id = ${item.space_id} and (s.visibility = 'instance' or exists (select 1 from space_permissions ip
          where ip.space_id = s.id and ip.principal_kind = 'instanceUsers')))
      union select ps.principal_id from page_shares ps join tree_items t on t.id = ${item.id}
        where ps.item_id = any(t.path) and ps.principal_kind = 'account'
      union select gm.account_id from page_shares ps join tree_items t on t.id = ${item.id}
        join group_members gm on gm.group_id = ps.principal_id
        where ps.item_id = any(t.path) and ps.principal_kind = 'group'
      union select la.account_id from share_link_accesses la join share_links l on l.id = la.link_id
        where l.item_id = ${item.id}
      union select id from accounts where id = any(${sql.param(accounts)}::uuid[])
      union select account_id from group_members where group_id = any(${sql.param(groups)}::uuid[])`;
  }

  async #levels(tx: Transaction, item: ItemRow, changes: AccessChange[]): Promise<Map<string, number>> {
    const result = await tx.execute<{ id: string; level: number }>(sql`
      select a.id, ${itemLevel(sql`a.id`, sql`t`, sql`s`)} as level
      from accounts a cross join tree_items t join spaces s on s.id = t.space_id
      where t.id = ${item.id} and a.state = 'active' and a.id in (${this.#candidates(item, changes)})`);
    return new Map(result.rows.map((row) => [row.id, Number(row.level)]));
  }

  async #impact(
    tx: Transaction,
    actor: Principal,
    before: Map<string, number>,
    after: Map<string, number>,
  ): Promise<PageAccessImpact> {
    const ids = [...new Set([...before.keys(), ...after.keys()])].filter(
      (id) => (before.get(id) ?? 0) !== (after.get(id) ?? 0),
    );
    const visible = await tx.execute<{ id: string; name: string }>(sql`
      select a.id, a.name from accounts a where a.id = any(${sql.param(ids)}::uuid[])
        and ${this.#people.visibleCondition(actor, sql`a.id`)}
      order by lower(a.name), a.id`);
    const listed = new Map(visible.rows.map((row) => [row.id, row.name]));
    const summarize = (threshold: number): AccessImpact => {
      const has = (level: number | undefined) => (level ?? 0) >= threshold;
      const changed = ids.filter((id) => has(before.get(id)) !== has(after.get(id)));
      const changes: RoleChange[] = [];
      for (const id of [...listed.keys()]) {
        if (!changed.includes(id)) continue;
        changes.push({
          accountId: id,
          name: listed.get(id) ?? "",
          before: LEVEL_ROLES[before.get(id) ?? 0] ?? null,
          after: LEVEL_ROLES[after.get(id) ?? 0] ?? null,
        });
      }
      return {
        gaining: changed.filter((id) => !has(before.get(id))).length,
        losing: changed.filter((id) => has(before.get(id))).length,
        raised: 0,
        lowered: 0,
        changes: changes.slice(0, IMPACT_LIST_LIMIT),
        unlisted: changed.filter((id) => !listed.has(id)).length,
        truncated: changes.length > IMPACT_LIST_LIMIT,
      };
    };
    return { read: summarize(1), edit: summarize(3) };
  }

  async restrictedPages(spaceId: string): Promise<RestrictedPage[]> {
    const result = await this.#database.execute<{
      id: string;
      title: string;
      kind: TreeItemKind;
      restrictions: { kind: RestrictionKind; setBy: string | null; setAt: string; orphaned: boolean }[];
    }>(sql`
      select t.id, t.title, t.kind,
        json_agg(json_build_object('kind', r.kind, 'setBy', r.set_by, 'setAt', r.created_at,
          'orphaned', r.orphaned_at is not null) order by r.kind) as restrictions
      from page_restrictions r join tree_items t on t.id = r.item_id
      where t.space_id = ${spaceId} and t.trash_entry_id is null
      group by t.id, t.title, t.kind
      order by lower(t.title), t.id limit 2000`);
    const names = await this.#people.names(
      result.rows
        .flatMap((row) => row.restrictions.map((entry) => entry.setBy))
        .filter((id): id is string => id !== null),
    );
    const info = (entry: { setBy: string | null; setAt: string } | undefined): RestrictionInfo | null =>
      entry
        ? {
            setBy: entry.setBy ? { id: entry.setBy, name: names.get(entry.setBy) ?? null } : null,
            setAt: new Date(entry.setAt),
          }
        : null;
    return result.rows.map((row) => ({
      itemId: row.id,
      title: row.title,
      kind: row.kind,
      view: info(row.restrictions.find((entry) => entry.kind === "view")),
      edit: info(row.restrictions.find((entry) => entry.kind === "edit")),
      orphaned: row.restrictions.some((entry) => entry.orphaned),
    }));
  }

  async removeRestrictionAsAdministrator(
    actor: Principal,
    spaceId: string,
    itemId: string,
    kind: RestrictionKind,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const decision = await this.#authorization.explain(
        actor,
        "space.manage",
        { type: "space", id: spaceId },
        { executor: tx, fresh: true },
      );
      if (!decision.allowed) throw new ForbiddenError(decision);
      const item = await this.#item(tx, itemId);
      if (item.space_id !== spaceId) throw new SpaceError("itemNotFound", "The page does not exist");
      const removed = await tx.execute(sql`
        delete from page_restrictions where item_id = ${itemId} and kind = ${kind} returning item_id`);
      if (removed.rows.length === 0) {
        throw new SpaceError("restrictionNotFound", "The page is not restricted anymore");
      }
      await this.#audit.record(tx, {
        name: "page.restrictionRemoved",
        actor,
        targetId: itemId,
        fields: { spaceId, title: item.title, kind, byAdministrator: true },
        scope: auditScopeOf({ organizationId: item.organization_id }),
      });
      await this.#afterChange(tx, spaceId, itemId);
    });
  }

  async markOrphanedRestrictions(tx: Transaction, accountId: string): Promise<void> {
    const affected = await tx.execute<{
      item_id: string;
      kind: RestrictionKind;
      title: string;
      space_id: string;
      space_name: string;
      space_key: string;
      organization_id: string | null;
    }>(sql`
      update page_restrictions r set orphaned_at = now(), updated_at = now()
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = r.item_id and r.orphaned_at is null
        and ${restrictionListedBy(sql`r`, (kind, id) => holderMatches(kind, id, sql`${accountId}::uuid`))}
        and not ${restrictionHasActiveHolder(sql`r`, sql`s.organization_id`)}
      returning r.item_id, r.kind, t.title, t.space_id, ${spaceDisplayName(sql`s`)} as space_name, s.key as space_key, s.organization_id`);
    const notified = new Set<string>();
    for (const row of affected.rows) {
      if (notified.has(row.item_id)) continue;
      notified.add(row.item_id);
      const administrators = await this.spaceAdministrators(tx, row.space_id);
      await this.#notifications.notify(tx, {
        type: "restriction.orphaned",
        recipients: administrators,
        organizationId: row.organization_id,
        targetId: row.item_id,
        params: {
          itemTitle: row.title,
          spaceId: row.space_id,
          spaceName: row.space_name,
          spaceKey: row.space_key,
        },
      });
    }
  }

  async afterMembershipEnded(tx: Transaction, organizationId: string, accountId: string): Promise<void> {
    await this.markOrphanedRestrictions(tx, accountId);
    const affected = await tx.execute<{ id: string }>(sql`
      select s.id from spaces s
      where s.organization_id = ${organizationId} and (
        exists (select 1 from space_permissions sp where sp.space_id = s.id
          and sp.principal_kind = 'account' and sp.principal_id = ${accountId})
        or exists (select 1 from page_shares ps join tree_items t on t.id = ps.item_id
          where t.space_id = s.id and ps.principal_kind = 'account' and ps.principal_id = ${accountId})
        or exists (select 1 from share_link_people lp join share_links l on l.id = lp.link_id
          join tree_items t on t.id = l.item_id
          where t.space_id = s.id and lp.principal_kind = 'account' and lp.principal_id = ${accountId})
        or exists (select 1 from share_link_accesses la join share_links l on l.id = la.link_id
          join tree_items t on t.id = l.item_id where t.space_id = s.id and la.account_id = ${accountId}))
      order by s.id`);
    for (const space of affected.rows) {
      await signalSpaceChange(tx, { spaceId: space.id, kind: "access", itemId: null });
    }
  }

  async clearOrphaned(tx: Transaction, itemId: string): Promise<void> {
    await tx.execute(sql`
      update page_restrictions r set orphaned_at = null, updated_at = now()
      where r.item_id = ${itemId} and r.orphaned_at is not null
        and ${restrictionHasActiveHolder(sql`r`, sql`(select s.organization_id from tree_items t join spaces s on s.id = t.space_id where t.id = r.item_id)`)}`);
  }

  async spaceAdministrators(executor: Executor, spaceId: string): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      select a.id from accounts a cross join spaces s
      where s.id = ${spaceId} and a.state = 'active' and ${organizationMembership(sql`s.organization_id`, sql`a.id`)}
        and a.id in (
          select sp.principal_id from space_permissions sp where sp.space_id = s.id and sp.role = 'admin'
            and sp.principal_kind = 'account'
          union select gm.account_id from space_permissions sp join group_members gm on gm.group_id = sp.principal_id
            where sp.space_id = s.id and sp.role = 'admin' and sp.principal_kind = 'group'
              and (gm.expires_at is null or gm.expires_at > now())
          union select m.account_id from space_permissions sp join memberships m on m.organization_id = s.organization_id
            where sp.space_id = s.id and sp.role = 'admin' and sp.principal_kind = 'organizationMembers' and m.kind = 'member'
          union select s.personal_of where s.personal_of is not null)
      limit 200`);
    return result.rows.map((row) => row.id);
  }
}
