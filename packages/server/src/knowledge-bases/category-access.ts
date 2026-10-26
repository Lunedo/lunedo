import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { holderMatches } from "../authorization/item-access.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { AccessImpact, RoleChange } from "../authorization/space-access.js";
import type { Database, Transaction } from "../database/database.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import {
  accessLevels,
  candidateAccounts,
  levelChanges,
  representativeItems,
  summarizeChanges,
} from "../spaces/move-impact.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { visibleItem } from "../spaces/visibility.js";

export const MAX_CATEGORY_GROUPS = 50;

export interface CategoryGroup {
  id: string;
  name: string;
}

export interface CategoryAccess {
  itemId: string;
  parentId: string | null;
  title: string;
  readable: boolean;
  responsibleGroups: CategoryGroup[] | null;
  inheritedResponsibleGroups: CategoryGroup[] | null;
  visibleTo: CategoryGroup[] | null;
  visibleToPeople: number;
  inheritedVisibleTo: CategoryGroup[] | null;
  articles: number;
  subcategories: number;
  mine: boolean;
  writable: boolean;
}

export interface CategoryAccessChange {
  responsibleGroupIds: readonly string[];
  visibleGroupIds: readonly string[] | null;
}

export interface CategoryAccessEffect {
  articles: number;
  widening: boolean;
  losingWrite: RoleChange[];
  losingWriteCount: number;
  losingRead: number;
  gainingRead: number;
  publicPortalLosesAccess: boolean;
  unlisted: number;
}

type CategoryRow = {
  item_id: string;
  parent_id: string | null;
  title: string;
  path: string[];
  readable: boolean;
  responsible: CategoryGroup[] | null;
  visible: CategoryGroup[] | null;
  visible_people: number;
  articles: number;
  subcategories: number;
  mine: boolean;
};

class Rollback extends Error {
  constructor(readonly effect: CategoryAccessEffect) {
    super("rollback");
  }
}

function sameSet(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function visibilityWidens(before: readonly string[] | null, after: readonly string[] | null): boolean {
  if (before === null) return false;
  if (after === null) return true;
  return after.some((id) => !before.includes(id));
}

function normalized(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}

export class CategoryAccessService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    people: PeopleService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#people = options.people;
  }

  async #requireKnowledgeBase(actor: Principal, spaceId: string, action: "space.view" | "space.manage") {
    const space = await this.#database.execute<{
      organization_id: string | null;
      type: string;
      name: string;
    }>(sql`select organization_id, type, name from spaces where id = ${spaceId} and deleted_at is null`);
    const row = space.rows[0];
    const visible = await this.#authorization.explain(actor, "space.view", { type: "space", id: spaceId });
    if (!row || !visible.allowed) throw new SpaceError("spaceNotFound", "The space does not exist");
    if (row.type !== "knowledgeBase")
      throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    if (action === "space.manage") {
      const decision = await this.#authorization.explain(actor, "space.manage", {
        type: "space",
        id: spaceId,
      });
      if (!decision.allowed) {
        throw new SpaceError(
          "categoryAccessForSpaceAdmins",
          "Only space admins of the knowledge base change who is responsible for a category and who sees it",
        );
      }
    }
    return { organizationId: row.organization_id, name: row.name };
  }

  #rows(actor: Principal, spaceId: string, manages: boolean, only: string | null): SQL {
    const account = actor.type === "account" ? sql`${actor.id}::uuid` : sql`null::uuid`;
    const readable = visibleItem(this.#authorization, actor, sql`t`, sql`s`);
    const groupsOf = (
      table: SQL,
      filter: SQL,
    ) => sql`(select json_agg(json_build_object('id', g.id, 'name', g.name)
      order by lower(g.name), g.id) from ${table} join groups g on g.id = x.group_id where ${filter})`;
    return sql`
      select t.id as item_id, t.parent_id, t.title, t.path, ${readable} as readable,
        case when exists (select 1 from category_responsibilities cr where cr.item_id = t.id)
          then coalesce(${groupsOf(sql`category_responsible_groups x`, sql`x.item_id = t.id`)}, '[]'::json) end as responsible,
        case when exists (select 1 from page_restrictions r where r.item_id = t.id and r.kind = 'view')
          then coalesce(${groupsOf(
            sql`(select principal_id as group_id, item_id from page_restriction_holders
              where kind = 'view' and principal_kind = 'group') x`,
            sql`x.item_id = t.id`,
          )}, '[]'::json) end as visible,
        (select count(*)::int from page_restriction_holders h
          where h.item_id = t.id and h.kind = 'view' and h.principal_kind = 'account') as visible_people,
        (select count(*)::int from tree_items a join spaces sa on sa.id = a.space_id
          where a.space_id = t.space_id and a.kind = 'page' and t.id = any(a.path) and a.trash_entry_id is null
            and a.translation_of is null
            and (${manages} or ${visibleItem(this.#authorization, actor, sql`a`, sql`sa`)})) as articles,
        (select count(*)::int from tree_items c join spaces sc on sc.id = c.space_id
          where c.parent_id = t.id and c.kind = 'folder' and c.trash_entry_id is null
            and (${manages} or ${visibleItem(this.#authorization, actor, sql`c`, sql`sc`)})) as subcategories,
        (exists (select 1 from category_responsibilities cr where cr.item_id = any(t.path))
          and not exists (select 1 from category_responsibilities cr where cr.item_id = any(t.path)
            and not exists (select 1 from category_responsible_groups cg where cg.item_id = cr.item_id
              and ${holderMatches(sql`'group'`, sql`cg.group_id`, account)}))) as mine
      from tree_items t join spaces s on s.id = t.space_id
      where t.space_id = ${spaceId} and t.kind = 'folder' and t.trash_entry_id is null
        and t.archived_root_id is null
        ${only ? sql`and t.id = ${only}` : sql``}
        and (${manages} or ${readable})
      order by cardinality(t.path), t.position`;
  }

  async list(actor: Principal, spaceId: string, executor: Database | Transaction = this.#database) {
    await this.#requireKnowledgeBase(actor, spaceId, "space.view");
    const manages = (await this.#authorization.explain(actor, "space.manage", { type: "space", id: spaceId }))
      .allowed;
    const result = await executor.execute<CategoryRow>(this.#rows(actor, spaceId, manages, null));
    return this.#entries(actor, result.rows);
  }

  async #entries(actor: Principal, rows: CategoryRow[]): Promise<CategoryAccess[]> {
    const byId = new Map(rows.map((row) => [row.item_id, row]));
    const writable = await this.#authorization.explainMany(
      actor,
      "item.edit",
      rows.map((row) => ({ type: "item", id: row.item_id })),
    );
    const inherited = (row: CategoryRow, field: "responsible" | "visible") => {
      for (const id of [...row.path].reverse()) {
        if (id === row.item_id) continue;
        const ancestor = byId.get(id);
        if (ancestor?.[field]) return ancestor[field];
      }
      return null;
    };
    return rows.map((row, index) => ({
      itemId: row.item_id,
      parentId: row.parent_id,
      title: row.title,
      readable: row.readable,
      responsibleGroups: row.responsible,
      inheritedResponsibleGroups: inherited(row, "responsible"),
      visibleTo: row.visible,
      visibleToPeople: Number(row.visible_people),
      inheritedVisibleTo: inherited(row, "visible"),
      articles: Number(row.articles),
      subcategories: Number(row.subcategories),
      mine: row.mine,
      writable: writable[index]?.allowed === true,
    }));
  }

  async #category(tx: Transaction, spaceId: string, itemId: string) {
    const found = await tx.execute<{ title: string; path: string[] }>(sql`
      select title, path from tree_items
      where id = ${itemId} and space_id = ${spaceId} and kind = 'folder' and trash_entry_id is null
        and archived_root_id is null
      for update`);
    const row = found.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The category does not exist");
    return row;
  }

  async #current(tx: Transaction, itemId: string) {
    const responsibility = await tx.execute<{ group_id: string | null }>(sql`
      select cg.group_id from category_responsibilities cr
      left join category_responsible_groups cg on cg.item_id = cr.item_id
      where cr.item_id = ${itemId}`);
    const visibility = await tx.execute<{ principal_id: string | null }>(sql`
      select h.principal_id from page_restrictions r
      left join page_restriction_holders h on h.item_id = r.item_id and h.kind = r.kind and h.principal_kind = 'group'
      where r.item_id = ${itemId} and r.kind = 'view'`);
    const ids = (rows: { id: string | null }[]) =>
      rows.length === 0 ? null : normalized(rows.flatMap((row) => (row.id ? [row.id] : [])));
    return {
      responsible: ids(responsibility.rows.map((row) => ({ id: row.group_id }))),
      visible: ids(visibility.rows.map((row) => ({ id: row.principal_id }))),
    };
  }

  async #validate(
    tx: Transaction,
    organizationId: string | null,
    path: string[],
    itemId: string,
    change: CategoryAccessChange,
  ) {
    const responsible = normalized(change.responsibleGroupIds);
    const visible = change.visibleGroupIds === null ? null : normalized(change.visibleGroupIds);
    if (responsible.length > MAX_CATEGORY_GROUPS || (visible?.length ?? 0) > MAX_CATEGORY_GROUPS) {
      throw new SpaceError("tooManyGroups", `Choose up to ${MAX_CATEGORY_GROUPS} groups`);
    }
    if (visible !== null && visible.length === 0) {
      throw new SpaceError("categoryGroupsMissing", "Choose at least one group that may read the category");
    }
    const wanted = [...new Set([...responsible, ...(visible ?? [])])];
    if (wanted.length > 0) {
      const known = await tx.execute<{ id: string }>(sql`
        select id from groups where id = any(${sql.param(wanted)}::uuid[])
          and organization_id is not distinct from ${organizationId}`);
      if (known.rows.length !== wanted.length) {
        throw new SpaceError("invalidHolder", "Choose groups of the organization of the knowledge base");
      }
    }
    const ancestors = path.filter((id) => id !== itemId);
    const nearest = async (query: SQL) => {
      const rows = await tx.execute<{ item_id: string; group_id: string | null }>(query);
      const byItem = new Map<string, string[]>();
      for (const row of rows.rows) {
        byItem.set(row.item_id, [
          ...(byItem.get(row.item_id) ?? []),
          ...(row.group_id ? [row.group_id] : []),
        ]);
      }
      for (const id of [...ancestors].reverse()) {
        const groups = byItem.get(id);
        if (groups) return groups;
      }
      return null;
    };
    const ids = sql`${sql.param(ancestors)}::uuid[]`;
    const parentResponsible = await nearest(sql`
      select cr.item_id, cg.group_id from category_responsibilities cr
      left join category_responsible_groups cg on cg.item_id = cr.item_id where cr.item_id = any(${ids})`);
    const parentVisible = await nearest(sql`
      select r.item_id, h.principal_id as group_id from page_restrictions r
      left join page_restriction_holders h on h.item_id = r.item_id and h.kind = 'view' and h.principal_kind = 'group'
      where r.kind = 'view' and r.item_id = any(${ids})`);
    const widens = (own: string[] | null, parent: string[] | null) =>
      own !== null && own.length > 0 && parent !== null && own.some((id) => !parent.includes(id));
    if (widens(responsible, parentResponsible) || widens(visible, parentVisible)) {
      throw new SpaceError(
        "categoryWidensParent",
        "A subcategory can only name groups of the category above it. Choose among those groups or change the category above.",
      );
    }
    return { responsible, visible };
  }

  async #apply(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    next: { responsible: string[]; visible: string[] | null },
  ) {
    const actorId = actorIdOf(actor);
    if (next.responsible.length === 0) {
      await tx.execute(sql`delete from category_responsibilities where item_id = ${itemId}`);
    } else {
      await tx.execute(sql`
        insert into category_responsibilities (item_id, set_by) values (${itemId}, ${actorId})
        on conflict (item_id) do update set set_by = excluded.set_by, updated_at = now()`);
      await tx.execute(sql`delete from category_responsible_groups where item_id = ${itemId}
        and group_id <> all(${sql.param(next.responsible)}::uuid[])`);
      await tx.execute(sql`
        insert into category_responsible_groups (item_id, group_id)
        select ${itemId}, unnest(${sql.param(next.responsible)}::uuid[]) on conflict do nothing`);
    }
    if (next.visible === null) {
      await tx.execute(sql`delete from page_restrictions where item_id = ${itemId} and kind = 'view'`);
    } else {
      await tx.execute(sql`
        insert into page_restrictions (item_id, kind, set_by) values (${itemId}, 'view', ${actorId})
        on conflict (item_id, kind) do update set set_by = excluded.set_by, orphaned_at = null, updated_at = now()`);
      await tx.execute(sql`delete from page_restriction_holders where item_id = ${itemId} and kind = 'view'
        and not (principal_kind = 'group' and principal_id = any(${sql.param(next.visible)}::uuid[]))`);
      await tx.execute(sql`
        insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
        select ${itemId}, 'view', 'group', unnest(${sql.param(next.visible)}::uuid[]) on conflict do nothing`);
    }
  }

  async #effect(
    tx: Transaction,
    actor: Principal,
    spaceId: string,
    itemId: string,
    before: { responsible: string[] | null; visible: string[] | null },
    next: { responsible: string[]; visible: string[] | null },
  ): Promise<CategoryAccessEffect> {
    const items = await representativeItems(tx, itemId);
    const accounts = await candidateAccounts(tx, { itemId, parentId: null, spaceIds: [spaceId] }, items);
    const levelsBefore = await accessLevels(tx, items, accounts);
    await this.#apply(tx, actor, itemId, next);
    const changes = levelChanges(items, levelsBefore, await accessLevels(tx, items, accounts));
    const impact: AccessImpact = await summarizeChanges(tx, changes, (account) =>
      this.#people.visibleCondition(actor, account),
    );
    const losingWriteAccounts = new Set(
      changes.filter((change) => change.before === 3 && change.after < 3).map((change) => change.accountId),
    );
    const articles = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items where kind = 'page' and trash_entry_id is null
        and translation_of is null and ${itemId}::uuid = any(path)`);
    const audience = await tx.execute<{ audience: string | null }>(
      sql`select audience from spaces where id = ${spaceId}`,
    );
    return {
      articles: Number(articles.rows[0]?.count ?? 0),
      widening: visibilityWidens(before.visible, next.visible),
      losingWrite: impact.changes.filter((change) => losingWriteAccounts.has(change.accountId)),
      losingWriteCount: losingWriteAccounts.size,
      losingRead: impact.losing,
      gainingRead: impact.gaining,
      publicPortalLosesAccess:
        audience.rows[0]?.audience === "public" && before.visible === null && next.visible !== null,
      unlisted: impact.unlisted,
    };
  }

  async preview(actor: Principal, spaceId: string, itemId: string, change: CategoryAccessChange) {
    const space = await this.#requireKnowledgeBase(actor, spaceId, "space.manage");
    try {
      await this.#database.transaction(async (tx) => {
        const category = await this.#category(tx, spaceId, itemId);
        const before = await this.#current(tx, itemId);
        const next = await this.#validate(tx, space.organizationId, category.path, itemId, change);
        throw new Rollback(await this.#effect(tx, actor, spaceId, itemId, before, next));
      });
    } catch (error) {
      if (error instanceof Rollback) return error.effect;
      throw error;
    }
    throw new Error("The category preview did not finish");
  }

  async change(
    actor: Principal,
    spaceId: string,
    itemId: string,
    change: CategoryAccessChange & { confirmWidening?: boolean | undefined },
  ): Promise<CategoryAccess> {
    const space = await this.#requireKnowledgeBase(actor, spaceId, "space.manage");
    await this.#database.transaction(async (tx) => {
      const category = await this.#category(tx, spaceId, itemId);
      const before = await this.#current(tx, itemId);
      const next = await this.#validate(tx, space.organizationId, category.path, itemId, change);
      if (sameSet(before.responsible ?? [], next.responsible) && sameSet(before.visible, next.visible))
        return;
      const widened = visibilityWidens(before.visible, next.visible);
      const articles = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count from tree_items where kind = 'page' and trash_entry_id is null
          and translation_of is null and ${itemId}::uuid = any(path)`);
      const count = Number(articles.rows[0]?.count ?? 0);
      if (widened && change.confirmWidening !== true) {
        throw new SpaceError(
          "categoryVisibilityWidening",
          "More people will be able to read the articles of this category. Confirm the change to apply it.",
          { articles: count },
        );
      }
      await this.#apply(tx, actor, itemId, next);
      await this.#audit.record(tx, {
        name: "knowledgeBase.categoryAccessChanged",
        actor,
        targetId: itemId,
        fields: {
          spaceId,
          title: category.title,
          responsibleGroupIds: next.responsible,
          previousResponsibleGroupIds: before.responsible ?? [],
          visibleGroupIds: next.visible,
          previousVisibleGroupIds: before.visible,
          widened,
          articles: count,
        },
        scope: auditScopeOf({ organizationId: space.organizationId }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId });
    });
    const result = await this.#database.execute<CategoryRow>(this.#rows(actor, spaceId, true, itemId));
    const entry = (await this.#entries(actor, result.rows))[0];
    if (!entry) throw new SpaceError("itemNotFound", "The category does not exist");
    return entry;
  }
}
