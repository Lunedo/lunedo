import { type SQL, sql } from "drizzle-orm";
import { LEVEL_ROLES, permissionLevel } from "../authorization/item-access.js";
import type { AccessImpact, RoleChange } from "../authorization/space-access.js";
import type { Executor } from "../database/database.js";

const IMPACT_LIST_LIMIT = 100;

export interface LevelChange {
  accountId: string;
  itemId: string;
  before: number;
  after: number;
}

type Levels = Map<string, Map<string, number>>;

export async function representativeItems(executor: Executor, itemId: string): Promise<string[]> {
  const below = sql`t.path[array_position(t.path, ${itemId}::uuid):]`;
  const result = await executor.execute<{ id: string }>(sql`
    with recursive down as (
      select id, 0 as depth from tree_items where id = ${itemId}
      union all
      select t.id, down.depth + 1 from tree_items t join down on t.parent_id = down.id
    )
    select id from (
      select distinct on (signature) id, depth from (
        select t.id, d.depth, concat_ws('|',
          coalesce((select string_agg(r.item_id::text, ',' order by r.item_id) from page_restrictions r
            where r.kind = 'view' and r.item_id = any(${below})), ''),
          coalesce((select string_agg(distinct ps.item_id::text, ',') from page_shares ps
            where ps.include_descendants and ps.item_id <> t.id and ps.item_id = any(${below})), ''),
          case when exists (select 1 from page_shares ps where ps.item_id = t.id)
            or exists (select 1 from share_links sl where sl.item_id = t.id)
            or exists (select 1 from page_restrictions r where r.item_id = t.id and r.kind = 'edit')
            then t.id::text else '' end) as signature
        from down d join tree_items t on t.id = d.id
      ) signed
      order by signature, depth, id
    ) representatives
    order by depth, id`);
  return result.rows.map((row) => row.id);
}

export async function candidateAccounts(
  executor: Executor,
  scope: { itemId: string; parentId: string | null; spaceIds: string[] },
  items: string[],
): Promise<string[]> {
  const spaces = sql`${sql.param(scope.spaceIds)}::uuid[]`;
  const pages = sql`(select unnest(path) from tree_items where id = ${scope.itemId}
    union select unnest(path) from tree_items where id = ${scope.parentId}
    union select unnest(${sql.param(items)}::uuid[]))`;
  const result = await executor.execute<{ id: string }>(sql`
    select sp.principal_id as id from space_permissions sp
      where sp.space_id = any(${spaces}) and sp.principal_kind = 'account'
    union select gm.account_id from space_permissions sp join group_members gm on gm.group_id = sp.principal_id
      where sp.space_id = any(${spaces}) and sp.principal_kind = 'group'
    union select m.account_id from memberships m join spaces s on s.organization_id = m.organization_id
      where s.id = any(${spaces})
    union select a.id from accounts a where a.type = 'standard' and exists (select 1 from spaces s
      where s.id = any(${spaces}) and (s.visibility = 'instance' or exists (select 1 from space_permissions ip
        where ip.space_id = s.id and ip.principal_kind = 'instanceUsers')))
    union select ps.principal_id from page_shares ps where ps.principal_kind = 'account' and ps.item_id in ${pages}
    union select gm.account_id from page_shares ps join group_members gm on gm.group_id = ps.principal_id
      where ps.principal_kind = 'group' and ps.item_id in ${pages}
    union select la.account_id from share_link_accesses la join share_links l on l.id = la.link_id
      where l.item_id = any(${sql.param(items)}::uuid[])`);
  return result.rows.map((row) => row.id);
}

export async function accessLevels(executor: Executor, items: string[], accounts: string[]): Promise<Levels> {
  const result = await executor.execute<{ account_id: string; item_id: string; level: number }>(sql`
    select a.id as account_id, t.id as item_id, ${permissionLevel(sql`a.id`, sql`t`, sql`s`)} as level
    from accounts a cross join tree_items t join spaces s on s.id = t.space_id
    where t.id = any(${sql.param(items)}::uuid[]) and a.state = 'active'
      and a.id = any(${sql.param(accounts)}::uuid[])`);
  const levels: Levels = new Map();
  for (const row of result.rows) {
    const entry = levels.get(row.account_id) ?? new Map<string, number>();
    entry.set(row.item_id, Number(row.level));
    levels.set(row.account_id, entry);
  }
  return levels;
}

export function levelChanges(items: string[], before: Levels, after: Levels): LevelChange[] {
  const changes: LevelChange[] = [];
  const accounts = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const accountId of accounts) {
    for (const itemId of items) {
      const was = before.get(accountId)?.get(itemId) ?? 0;
      const is = after.get(accountId)?.get(itemId) ?? 0;
      if (was !== is) changes.push({ accountId, itemId, before: was, after: is });
    }
  }
  return changes;
}

export function changeParts(changes: LevelChange[]): string[] {
  return changes
    .map((change) => `${change.accountId}:${change.itemId}:${change.before}:${change.after}`)
    .sort();
}

export async function summarizeChanges(
  executor: Executor,
  changes: LevelChange[],
  listable: (account: SQL) => SQL,
): Promise<AccessImpact> {
  const byAccount = new Map<string, LevelChange[]>();
  for (const change of changes) {
    byAccount.set(change.accountId, [...(byAccount.get(change.accountId) ?? []), change]);
  }
  const ids = [...byAccount.keys()];
  const visible = await executor.execute<{ id: string; name: string }>(sql`
    select a.id, a.name from accounts a where a.id = any(${sql.param(ids)}::uuid[]) and ${listable(sql`a.id`)}
    order by lower(a.name), a.id`);
  const gains = (entry: LevelChange[]) => entry.some((change) => change.before === 0);
  const loses = (entry: LevelChange[]) => entry.some((change) => change.after === 0);
  const shown = (entry: LevelChange[]): LevelChange =>
    entry.find((change) => change.before === 0) ??
    entry.find((change) => change.after === 0) ??
    (entry[0] as LevelChange);
  const listed: RoleChange[] = [];
  for (const row of visible.rows) {
    const change = shown(byAccount.get(row.id) ?? []);
    listed.push({
      accountId: row.id,
      name: row.name,
      before: LEVEL_ROLES[change.before] ?? null,
      after: LEVEL_ROLES[change.after] ?? null,
    });
  }
  const entries = [...byAccount.values()];
  const steady = entries.filter((entry) => !gains(entry) && !loses(entry));
  return {
    gaining: entries.filter(gains).length,
    losing: entries.filter(loses).length,
    raised: steady.filter((entry) => shown(entry).after > shown(entry).before).length,
    lowered: steady.filter((entry) => shown(entry).after < shown(entry).before).length,
    changes: listed.slice(0, IMPACT_LIST_LIMIT),
    unlisted: ids.length - visible.rows.length,
    truncated: listed.length > IMPACT_LIST_LIMIT,
  };
}
