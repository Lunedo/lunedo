import { commentText, type DocumentJson, migrateDocument } from "@pagehall/editor-schema";
import { type ContentLanguage, OTHER_CONTENT_LANGUAGE } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Database, Executor } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import { pageStatusEnabledCondition } from "../spaces/status.js";
import { readerTokens, restrictionIds } from "./access.js";
import type { IndexedChunk, IndexedItem, ItemAccess, SearchAdapter } from "./adapter.js";
import { documentChunks, textChunks } from "./chunks.js";
import { contentLanguageOf, TextSearchConfigs } from "./languages.js";

export const SEARCH_CHANGES_CHANNEL = "pagehall_search_changes";

const BATCH_SIZE = 50;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;
const BUSY_RETRY_MS = 2000;

export interface IndexState {
  building: boolean;
  done: number;
  total: number;
  pendingItems: number;
}

export interface DrainResult {
  items: number;
  spaces: number;
  failed: number;
  nextDueAt: Date | null;
}

function indexable(item: SQL, space: SQL): SQL {
  return sql`(${item}.kind in ('page', 'blogPost') and ${item}.trash_entry_id is null and ${space}.deleted_at is null
    and (${item}.mode = 'live' or ${item}.published_version_id is not null))`;
}

function archived(item: SQL, space: SQL): SQL {
  return sql`(${item}.archived_root_id is not null or ${space}.archived_at is not null or ${space}.quarantined)`;
}

function readers(item: SQL, space: SQL): SQL {
  return sql`(case when ${item}.reader_visible then ${readerTokens(item, space, "reader")}
    else ${readerTokens(item, space, "editor")} end)`;
}

function settingValue(level: string, scope: SQL | null, key: string): SQL {
  return sql`(select v.value #>> '{}' from setting_values v
    where v.level = ${level} and v.key = ${key} and v.value is not null ${scope ? sql`and v.scope_id = ${scope}` : sql``}
    limit 1)`;
}

function organizationLanguage(organization: SQL): SQL {
  const instance = settingValue("instance", null, "locale.language");
  return sql`(case when exists (select 1 from setting_values v
      where v.level = 'instance' and v.key = 'locale.language' and v.locked)
    then coalesce(${instance}, 'en')
    else coalesce(${settingValue("organization", organization, "locale.language")}, ${instance}, 'en') end)`;
}

function lockKey(kind: "item" | "space", id: string): SQL {
  return sql`hashtextextended(${`pagehall.search.${kind}:${id}`}, 0)`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class SearchIndexer {
  readonly #database: Database;
  readonly #adapter: SearchAdapter;
  readonly #configs: TextSearchConfigs;

  constructor(options: { database: Database; adapter: SearchAdapter }) {
    this.#database = options.database;
    this.#adapter = options.adapter;
    this.#configs = new TextSearchConfigs(options.database);
  }

  async drain(options: { signal?: AbortSignal; logger?: Logger } = {}): Promise<DrainResult> {
    const result: DrainResult = { items: 0, spaces: 0, failed: 0, nextDueAt: null };
    const busySpaces = new Set<string>();
    let busy = false;
    while (!options.signal?.aborted) {
      const spaces = await this.#database.execute<{ space_id: string; generation: number }>(sql`
        select space_id, generation from search_pending_spaces
        where space_id <> all(${sql.param([...busySpaces])}::uuid[])
        order by created_at, space_id limit ${BATCH_SIZE}`);
      if (spaces.rows.length === 0) break;
      for (const row of spaces.rows) {
        if (options.signal?.aborted) break;
        if (await this.#refreshSpace(row.space_id, Number(row.generation))) result.spaces += 1;
        else {
          busySpaces.add(row.space_id);
          busy = true;
        }
      }
    }
    const busyItems = new Set<string>();
    while (!options.signal?.aborted) {
      const items = await this.#database.execute<{
        item_id: string;
        generation: number;
        attempts: number;
      }>(sql`
        select item_id, generation, attempts from search_pending_items
        where due_at <= now() and item_id <> all(${sql.param([...busyItems])}::uuid[])
        order by due_at, item_id limit ${BATCH_SIZE}`);
      if (items.rows.length === 0) break;
      for (const row of items.rows) {
        if (options.signal?.aborted) break;
        try {
          if (await this.#indexItem(row.item_id, Number(row.generation))) result.items += 1;
          else {
            busyItems.add(row.item_id);
            busy = true;
          }
        } catch (error) {
          result.failed += 1;
          busyItems.add(row.item_id);
          options.logger?.warn(
            {
              itemId: row.item_id,
              error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
            },
            "Indexing an item for search failed",
          );
          await this.#postpone(row.item_id, Number(row.generation), Number(row.attempts));
        }
      }
    }
    await this.#database.execute(sql`
      update search_index_state set building_since = null, updated_at = now()
      where building_since is not null and not exists (select 1 from search_pending_items i
        where i.created_at <= search_index_state.building_since and i.attempts = 0)`);
    const next = await this.#database.execute<{ due_at: Date | string | null }>(
      sql`select min(due_at) as due_at from search_pending_items`,
    );
    const due = next.rows[0]?.due_at;
    const retryBusy = busy ? new Date(Date.now() + BUSY_RETRY_MS) : null;
    const candidates = [due ? asDate(due) : null, retryBusy].filter((date): date is Date => date !== null);
    result.nextDueAt =
      candidates.length > 0 ? new Date(Math.min(...candidates.map((date) => date.getTime()))) : null;
    return result;
  }

  async requestRebuild(executor: Executor = this.#database): Promise<number> {
    const marked = await executor.execute<{ item_id: string }>(sql`
      insert into search_pending_items (item_id)
      select id from tree_items where kind in ('page', 'blogPost')
      on conflict (item_id) do update set generation = search_pending_items.generation + 1, due_at = now(),
        attempts = 0, updated_at = now()
      returning item_id`);
    await executor.execute(sql`
      insert into search_pending_spaces (space_id) select id from spaces
      on conflict (space_id) do update set generation = search_pending_spaces.generation + 1, updated_at = now()`);
    await executor.execute(sql`
      insert into search_index_state (id, building_since, build_total) values (1, now(), ${marked.rows.length})
      on conflict (id) do update set building_since = now(), build_total = excluded.build_total, updated_at = now()`);
    await executor.execute(sql`select pg_notify(${SEARCH_CHANGES_CHANNEL}, '')`);
    return marked.rows.length;
  }

  async state(executor: Executor = this.#database): Promise<IndexState> {
    const result = await executor.execute<{
      building_since: Date | string | null;
      build_total: number;
      remaining: string;
      pending: string;
    }>(sql`
      select st.building_since, st.build_total,
        (select count(*) from search_pending_items i
          where st.building_since is not null and i.created_at <= st.building_since and i.attempts = 0)
          as remaining,
        (select count(*) from search_pending_items) as pending
      from search_index_state st where st.id = 1`);
    const row = result.rows[0];
    const total = Number(row?.build_total ?? 0);
    const building = Boolean(row?.building_since);
    return {
      building,
      total: building ? total : 0,
      done: building ? Math.max(0, total - Number(row?.remaining ?? 0)) : 0,
      pendingItems: Number(row?.pending ?? 0),
    };
  }

  async #postpone(itemId: string, generation: number, attempts: number): Promise<void> {
    const delay = Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** attempts);
    await this.#database.execute(sql`
      update search_pending_items set attempts = attempts + 1, due_at = now() + make_interval(secs => ${delay}),
        updated_at = now()
      where item_id = ${itemId} and generation = ${generation}`);
  }

  async #indexItem(itemId: string, generation: number): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${lockKey("item", itemId)}) as locked`,
      );
      if (!lock.rows[0]?.locked) return false;
      const current = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const lockedSpaces = new Set<string>();
      let spaceId = current.rows[0]?.space_id ?? null;
      let item: IndexedItem | null = null;
      while (spaceId && !lockedSpaces.has(spaceId)) {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(${lockKey("space", spaceId)})`);
        lockedSpaces.add(spaceId);
        item = await this.#load(tx, itemId);
        spaceId = item?.spaceId ?? null;
      }
      if (item) await this.#adapter.replaceItem(tx, item);
      else await this.#adapter.removeItem(tx, itemId);
      await tx.execute(
        sql`delete from search_pending_items where item_id = ${itemId} and generation = ${generation}`,
      );
      return true;
    });
  }

  async #load(executor: Executor, itemId: string): Promise<IndexedItem | null> {
    const result = await executor.execute<{
      id: string;
      kind: "page" | "blogPost";
      mode: "publish" | "live";
      title: string;
      space_id: string;
      organization_id: string | null;
      creator_id: string | null;
      created_at: Date | string;
      content_updated_at: Date | string;
      content_language: string | null;
      indexable: boolean;
      archived: boolean;
      readers: string[];
      restrictions: string[];
      labels: string[];
      space_language: string | null;
      organization_language: string;
      version_title: string | null;
      version_document: DocumentJson | null;
      version_schema: number | null;
      version_created_at: Date | string | null;
      live_document: DocumentJson | null;
      live_schema: number | null;
      live_changed_at: Date | string | null;
      status_id: string | null;
    }>(sql`
      select t.id, t.kind, t.mode, t.title, t.space_id, s.organization_id, t.creator_id, t.created_at,
        t.content_updated_at, t.content_language, ${indexable(sql`t`, sql`s`)} as indexable,
        ${archived(sql`t`, sql`s`)} as archived, ${readers(sql`t`, sql`s`)} as readers,
        ${restrictionIds(sql`t`)} as restrictions,
        array(select l.label from page_labels l where l.item_id = t.id order by l.label) as labels,
        ${settingValue("space", sql`s.id`, "content.language")} as space_language,
        ${organizationLanguage(sql`s.organization_id`)} as organization_language,
        v.title as version_title, v.document as version_document, v.schema_version as version_schema,
        v.created_at as version_created_at, d.snapshot as live_document, d.schema_version as live_schema,
        d.changed_at as live_changed_at, sv.id as status_id
      from tree_items t join spaces s on s.id = t.space_id
      left join page_status_values sv on sv.id = t.status_id and ${pageStatusEnabledCondition(sql`s`)}
      left join page_versions v on v.id = t.published_version_id and t.mode = 'publish'
      left join page_documents d on d.item_id = t.id and t.mode = 'live'
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row?.indexable) return null;
    const live = row.mode === "live";
    const stored = live ? row.live_document : row.version_document;
    const schemaVersion = live ? row.live_schema : row.version_schema;
    if (!live && !stored) return null;
    const document = stored && schemaVersion ? migrateDocument(stored, schemaVersion) : null;
    const title = live ? row.title : (row.version_title ?? row.title);
    const updatedAt = asDate(
      live
        ? (row.live_changed_at ?? row.content_updated_at)
        : (row.version_created_at ?? row.content_updated_at),
    );
    const language: ContentLanguage =
      contentLanguageOf(row.content_language) ??
      contentLanguageOf(row.space_language) ??
      contentLanguageOf(row.organization_language) ??
      OTHER_CONTENT_LANGUAGE;
    const chunks: IndexedChunk[] = (
      document ? documentChunks(document) : [{ heading: "", anchor: null, body: "" }]
    ).map((chunk, position) => ({
      source: "item",
      sourceId: row.id,
      position,
      contentType: row.kind,
      title,
      ...chunk,
      authorId: row.creator_id,
      contentCreatedAt: asDate(row.created_at),
      contentUpdatedAt: updatedAt,
    }));
    const comments = await executor.execute<{
      id: string;
      body: DocumentJson;
      author_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql`
      select c.id, c.body, c.author_id, c.created_at, coalesce(c.edited_at, c.created_at) as updated_at
      from comments c join comments r on r.id = coalesce(c.parent_id, c.id)
      where c.item_id = ${itemId} and c.deleted_at is null and c.body is not null
        and (r.quote is null or r.quote_public)
      order by c.created_at, c.id`);
    for (const comment of comments.rows) {
      textChunks(commentText(comment.body)).forEach((chunk, position) => {
        chunks.push({
          source: "comment",
          sourceId: comment.id,
          position,
          contentType: "comment",
          title,
          ...chunk,
          authorId: comment.author_id,
          contentCreatedAt: asDate(comment.created_at),
          contentUpdatedAt: asDate(comment.updated_at),
        });
      });
    }
    return {
      itemId: row.id,
      spaceId: row.space_id,
      organizationId: row.organization_id,
      readers: row.readers,
      restrictions: row.restrictions,
      archived: row.archived,
      labels: row.labels,
      status: row.status_id,
      language,
      config: await this.#configs.configFor(language),
      chunks,
    };
  }

  async #refreshSpace(spaceId: string, generation: number): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${lockKey("space", spaceId)}) as locked`,
      );
      if (!lock.rows[0]?.locked) return false;
      const indexed = await this.#adapter.indexedItemsOfSpace(tx, spaceId);
      const result = await tx.execute<{
        id: string;
        space_id: string;
        indexable: boolean;
        archived: boolean;
        readers: string[];
        restrictions: string[];
      }>(sql`
        select t.id, t.space_id, ${indexable(sql`t`, sql`s`)} as indexable, ${archived(sql`t`, sql`s`)} as archived,
          ${readers(sql`t`, sql`s`)} as readers, ${restrictionIds(sql`t`)} as restrictions
        from tree_items t join spaces s on s.id = t.space_id
        where (t.space_id = ${spaceId} and t.kind in ('page', 'blogPost'))
          or t.id = any(${sql.param(indexed)}::uuid[])`);
      const known = new Set(indexed);
      const updates: ItemAccess[] = [];
      const missing: string[] = [];
      const seen = new Set<string>();
      for (const row of result.rows) {
        seen.add(row.id);
        if (!row.indexable) {
          if (known.has(row.id)) await this.#adapter.removeItem(tx, row.id);
          continue;
        }
        if (!known.has(row.id)) {
          missing.push(row.id);
          continue;
        }
        updates.push({
          itemId: row.id,
          spaceId: row.space_id,
          readers: row.readers,
          restrictions: row.restrictions,
          archived: row.archived,
        });
      }
      for (const itemId of indexed) if (!seen.has(itemId)) await this.#adapter.removeItem(tx, itemId);
      await this.#adapter.updateAccess(tx, updates);
      if (missing.length > 0) {
        await tx.execute(sql`
          insert into search_pending_items (item_id) select unnest(${sql.param(missing)}::uuid[])
          on conflict (item_id) do update set generation = search_pending_items.generation + 1,
            due_at = least(search_pending_items.due_at, excluded.due_at), updated_at = now()`);
      }
      await tx.execute(
        sql`delete from search_pending_spaces where space_id = ${spaceId} and generation = ${generation}`,
      );
      return true;
    });
  }
}
