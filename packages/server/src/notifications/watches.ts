import type { WatchState } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import type { NotificationSubject } from "./registry.js";
import { watchAutomaticallySetting } from "./types.js";

export type WatchTarget = { type: "space"; id: string } | { type: "item"; id: string };

export interface OwnWatch {
  state: WatchState;
  keepActionable: boolean;
  automatic: boolean;
}

export interface EffectiveWatch {
  state: WatchState;
  keepActionable: boolean;
  source: "target" | "series" | "space";
}

export interface WatchStatus {
  own: OwnWatch | null;
  effective: EffectiveWatch | null;
}

export interface WatchedEntry {
  target: WatchTarget & { number: number | null };
  state: Exclude<WatchState, "notWatching">;
  keepActionable: boolean;
  automatic: boolean;
  title: string;
  kind: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  spaceType: string;
  updatedAt: Date;
}

export interface WatchChange {
  target: WatchTarget;
  state: WatchState | null;
  keepActionable?: boolean | undefined;
}

const LIST_LIMIT = 500;

interface ChainRow extends Record<string, unknown> {
  account_id: string;
  state: WatchState;
  keep_actionable: boolean;
  automatic: boolean;
  rank: number;
}

function chainRows(subject: NotificationSubject, accounts: SQL): SQL {
  if (subject.itemId) {
    return sql`
      with chain as (
        select t.id as item_id, t.space_id,
          coalesce((select m.series_id from meetings m where m.item_id = t.id),
            (select mt.series_id from meeting_topics mt where mt.item_id = t.id)) as series_id
        from tree_items t where t.id = ${subject.itemId})
      select w.account_id, w.state, w.keep_actionable, w.automatic,
        case when w.item_id = c.item_id then 0 when w.item_id = c.series_id then 1 else 2 end as rank
      from watches w cross join chain c
      where (w.item_id = c.item_id or w.item_id = c.series_id or (w.item_id is null and w.space_id = c.space_id))
        and ${accounts}
      order by w.account_id, rank`;
  }
  return sql`
    select w.account_id, w.state, w.keep_actionable, w.automatic, 2 as rank from watches w
    where w.item_id is null and w.space_id = ${subject.spaceId} and ${accounts}`;
}

const SOURCES = ["target", "series", "space"] as const;

export async function effectiveWatches(
  executor: Executor,
  subject: NotificationSubject,
  accountIds: readonly string[] | null,
): Promise<Map<string, EffectiveWatch>> {
  if (!subject.itemId && !subject.spaceId) return new Map();
  if (accountIds?.length === 0) return new Map();
  const accounts = accountIds ? sql`w.account_id = any(${sql.param([...accountIds])}::uuid[])` : sql`true`;
  const result = await executor.execute<ChainRow>(chainRows(subject, accounts));
  const rows = new Map<string, ChainRow[]>();
  for (const row of result.rows) rows.set(row.account_id, [...(rows.get(row.account_id) ?? []), row]);
  const states = new Map<string, EffectiveWatch>();
  for (const [accountId, chain] of rows) {
    const ordered = [...chain].sort((a, b) => Number(a.rank) - Number(b.rank));
    const row = ordered.find((entry) => !entry.automatic || entry.state === "muted") ?? ordered[0];
    if (!row) continue;
    states.set(accountId, {
      state: row.state,
      keepActionable: row.keep_actionable,
      source: SOURCES[Number(row.rank)] ?? "space",
    });
  }
  return states;
}

function targetColumns(target: WatchTarget): { spaceId: string | null; itemId: string | null } {
  return target.type === "space"
    ? { spaceId: target.id, itemId: null }
    : { spaceId: null, itemId: target.id };
}

function targetCondition(target: WatchTarget): SQL {
  return target.type === "space"
    ? sql`item_id is null and space_id = ${target.id}`
    : sql`item_id = ${target.id}`;
}

export class WatchService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    settings: SettingsService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
  }

  async status(accountId: string, target: WatchTarget): Promise<WatchStatus> {
    const own = await this.#database.execute<{
      state: WatchState;
      keep_actionable: boolean;
      automatic: boolean;
    }>(
      sql`select state, keep_actionable, automatic from watches
        where account_id = ${accountId} and ${targetCondition(target)}`,
    );
    const row = own.rows[0];
    const subject =
      target.type === "space" ? { spaceId: target.id, itemId: null } : { spaceId: null, itemId: target.id };
    const effective = (await effectiveWatches(this.#database, subject, [accountId])).get(accountId) ?? null;
    return {
      own: row ? { state: row.state, keepActionable: row.keep_actionable, automatic: row.automatic } : null,
      effective,
    };
  }

  async set(
    accountId: string,
    target: WatchTarget,
    input: { state: WatchState | null; keepActionable?: boolean | undefined },
  ): Promise<WatchStatus> {
    await this.#database.transaction((tx) => this.#write(tx, accountId, { target, ...input }));
    return this.status(accountId, target);
  }

  async setMany(accountId: string, changes: readonly WatchChange[]): Promise<number> {
    const decide = this.#authorization.batch(accountPrincipal(accountId));
    const decisions = await Promise.all(
      changes.map((change) =>
        decide(change.target.type === "item" ? "item.view" : "space.view", change.target),
      ),
    );
    const allowed = changes.filter((_, index) => decisions[index]?.allowed);
    await this.#database.transaction(async (tx) => {
      for (const change of allowed) await this.#write(tx, accountId, change);
    });
    return allowed.length;
  }

  async #write(tx: Transaction, accountId: string, change: WatchChange): Promise<void> {
    const { target } = change;
    if (change.state === null) {
      await tx.execute(
        sql`delete from watches where account_id = ${accountId} and ${targetCondition(target)}`,
      );
      return;
    }
    const columns = targetColumns(target);
    const keepActionable = change.keepActionable ?? true;
    const conflict =
      target.type === "space"
        ? sql`(account_id, space_id) where item_id is null`
        : sql`(account_id, item_id) where item_id is not null`;
    await tx.execute(sql`
      insert into watches (id, account_id, space_id, item_id, state, keep_actionable, automatic)
      values (gen_random_uuid(), ${accountId}, ${columns.spaceId}, ${columns.itemId}, ${change.state},
        ${keepActionable}, false)
      on conflict ${conflict} do update set state = excluded.state, keep_actionable = excluded.keep_actionable,
        automatic = false, updated_at = now()`);
  }

  async watchAutomatically(
    tx: Transaction,
    accountIds: readonly (string | null)[],
    itemId: string,
  ): Promise<void> {
    const candidates = [...new Set(accountIds.filter((id): id is string => id !== null))];
    if (candidates.length === 0) return;
    const accounts = await tx.execute<{ id: string }>(sql`
      select a.id from accounts a
      where a.id = any(${sql.param(candidates)}::uuid[]) and a.state = 'active'
        and not exists (select 1 from watches w where w.account_id = a.id and w.item_id = ${itemId})`);
    for (const { id } of accounts.rows) {
      if (!(await this.#settings.get(watchAutomaticallySetting, { user: id }, { executor: tx }))) continue;
      await tx.execute(sql`
        insert into watches (id, account_id, item_id, state, automatic)
        values (gen_random_uuid(), ${id}, ${itemId}, 'watching', true)
        on conflict (account_id, item_id) where item_id is not null do nothing`);
    }
  }

  async audience(
    tx: Transaction,
    itemId: string,
    options: {
      exclude?: readonly string[];
      action?: { name: string; resource: { type: string; id: string } };
    } = {},
  ): Promise<string[]> {
    const states = await effectiveWatches(tx, { spaceId: null, itemId }, null);
    const exclude = new Set(options.exclude ?? []);
    const audience: string[] = [];
    for (const [accountId, watch] of [...states].sort(([a], [b]) => a.localeCompare(b))) {
      if (watch.state !== "watching" || exclude.has(accountId)) continue;
      const principal = accountPrincipal(accountId);
      const readable = await this.#authorization.explain(
        principal,
        "item.view",
        { type: "item", id: itemId },
        {
          executor: tx,
          fresh: true,
        },
      );
      if (!readable.allowed) continue;
      if (options.action) {
        const allowed = await this.#authorization.explain(
          principal,
          options.action.name,
          options.action.resource,
          {
            executor: tx,
            fresh: true,
          },
        );
        if (!allowed.allowed) continue;
      }
      audience.push(accountId);
    }
    return audience;
  }

  async list(accountId: string): Promise<WatchedEntry[]> {
    const rows = await this.#database.execute<{
      space_id: string | null;
      item_id: string | null;
      number: string | null;
      state: "watching" | "muted";
      keep_actionable: boolean;
      automatic: boolean;
      title: string;
      kind: string;
      target_space_id: string;
      key: string;
      name: string;
      space_type: string;
      updated_at: Date;
    }>(sql`
      select w.space_id, w.item_id, t.number, w.state, w.keep_actionable, w.automatic, w.updated_at,
        coalesce(t.title, s.name) as title, coalesce(t.kind::text, 'space') as kind, s.id as target_space_id,
        s.key, s.name, s.type::text as space_type
      from watches w
      left join tree_items t on t.id = w.item_id
      join spaces s on s.id = coalesce(t.space_id, w.space_id)
      where w.account_id = ${accountId} and w.state in ('watching', 'muted')
        and (t.id is null or t.trash_entry_id is null) and s.deleted_at is null
      order by w.updated_at desc, w.id desc
      limit ${LIST_LIMIT}`);
    const decide = this.#authorization.batch(accountPrincipal(accountId));
    const targets = rows.rows.map(
      (row): WatchTarget =>
        row.item_id
          ? { type: "item", id: row.item_id }
          : { type: "space", id: row.space_id ?? row.target_space_id },
    );
    const decisions = await Promise.all(
      targets.map((target) => decide(target.type === "item" ? "item.view" : "space.view", target)),
    );
    const entries: WatchedEntry[] = [];
    for (const [index, row] of rows.rows.entries()) {
      const target = targets[index];
      if (!target || !decisions[index]?.allowed) continue;
      entries.push({
        target: { ...target, number: row.number === null ? null : Number(row.number) },
        state: row.state,
        keepActionable: row.keep_actionable,
        automatic: row.automatic,
        title: row.title,
        kind: row.kind,
        spaceId: row.target_space_id,
        spaceKey: row.key,
        spaceName: row.name,
        spaceType: row.space_type,
        updatedAt: new Date(row.updated_at),
      });
    }
    return entries;
  }
}
