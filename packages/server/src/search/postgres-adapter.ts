import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { liveAccessCondition, type SearchViewer, storedAccessCondition } from "./access.js";
import {
  type AdapterFacets,
  type AdapterHit,
  type AdapterResult,
  type AdapterSearch,
  type ContextAccess,
  EXCERPT_END,
  EXCERPT_START,
  type IndexedChunk,
  type IndexedItem,
  type ItemAccess,
  type SearchAdapter,
} from "./adapter.js";
import { lastTerm, type ParsedQuery, type QueryAtom } from "./query.js";

const MIN_TYPO_LENGTH = 4;
const TYPO_SIMILARITY = 0.5;
const TYPO_ALTERNATIVES = 3;
const FACET_LIMIT = 20;
const EXCERPT_OPTIONS = `StartSel=${EXCERPT_START}, StopSel=${EXCERPT_END}, MaxWords=30, MinWords=12, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "`;

interface QueryParts {
  match: SQL;
  score: SQL;
  excerpt: SQL;
  corrections: Map<string, string>;
}

interface Expansions {
  alternatives: Map<string, string[]>;
  corrections: Map<string, string>;
}

function prefixWord(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, "");
}

function weighted(chunk: IndexedChunk): { first: string; second: string; labels: boolean } {
  if (chunk.source === "item") return { first: chunk.title, second: chunk.heading, labels: true };
  if (chunk.source === "attachment") {
    const name = chunk.attachment?.name ?? chunk.heading;
    return { first: `${name} ${name.replace(/[^\p{L}\p{N}]+/gu, " ")}`, second: "", labels: false };
  }
  return { first: "", second: chunk.heading, labels: false };
}

export class PostgresSearchAdapter implements SearchAdapter {
  async replaceItem(executor: Executor, item: IndexedItem): Promise<void> {
    await executor.execute(sql`delete from search_chunks where item_id = ${item.itemId}`);
    if (item.chunks.length === 0) return;
    const rows = item.chunks.map((chunk) => ({
      id: uuidv7(),
      ...weighted(chunk),
      source: chunk.source,
      source_id: chunk.sourceId,
      position: chunk.position,
      content_type: chunk.contentType,
      title: chunk.title,
      heading: chunk.heading,
      anchor: chunk.anchor,
      body: chunk.body,
      author_id: chunk.authorId,
      content_created_at: chunk.contentCreatedAt.toISOString(),
      content_updated_at: chunk.contentUpdatedAt.toISOString(),
      context_item_id: chunk.context?.itemId ?? null,
      context_readers: chunk.context?.readers ?? null,
      context_restrictions: chunk.context?.restrictions ?? [],
      attachment: chunk.attachment,
    }));
    const config = sql`${item.config}::regconfig`;
    await executor.execute(sql`
      insert into search_chunks (id, organization_id, space_id, item_id, source, source_id, position, content_type,
        title, heading, anchor, body, labels, status, language, config, author_id, content_created_at,
        content_updated_at, archived, readers, restrictions, context_item_id, context_readers, context_restrictions,
        attachment, document)
      select c.id, ${item.organizationId}, ${item.spaceId}, ${item.itemId}, c.source::search_source, c.source_id,
        c.position, c.content_type, c.title, c.heading, c.anchor, c.body, ${sql.param(item.labels)}::text[],
        ${item.status}, ${item.language}, ${item.config}, c.author_id, c.content_created_at, c.content_updated_at,
        ${item.archived}, ${sql.param(item.readers)}::text[], ${sql.param(item.restrictions)}::uuid[],
        c.context_item_id, c.context_readers, c.context_restrictions, c.attachment,
        setweight(to_tsvector(${config}, c.first), 'A')
          || setweight(to_tsvector(${config}, c.second), 'B')
          || setweight(to_tsvector(${config},
            case when c.labels then array_to_string(${sql.param(item.labels)}::text[], ' ') else '' end), 'C')
          || setweight(to_tsvector(${config}, c.body), 'D')
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as c(id uuid, source text, source_id uuid,
        position integer, content_type text, title text, heading text, anchor text, body text, author_id uuid,
        content_created_at timestamptz, content_updated_at timestamptz, context_item_id uuid, context_readers text[],
        context_restrictions uuid[], attachment jsonb, first text, second text, labels boolean)`);
    if (item.organizationId === null) return;
    await executor.execute(sql`
      insert into search_terms (organization_id, word)
      select distinct ${item.organizationId}::uuid, word from (
        select unnest(tsvector_to_array(to_tsvector('simple', c.title || ' ' || c.heading || ' ' || c.body))) as word
        from search_chunks c where c.item_id = ${item.itemId}) words
      where length(word) between ${MIN_TYPO_LENGTH} and 40 and word ~ '^[[:alpha:]]+$'
      order by word
      on conflict (organization_id, word) do nothing`);
  }

  async removeItem(executor: Executor, itemId: string): Promise<void> {
    await executor.execute(sql`delete from search_chunks where item_id = ${itemId}`);
  }

  async updateAccess(executor: Executor, updates: ItemAccess[]): Promise<void> {
    if (updates.length === 0) return;
    const rows = updates.map((update) => ({
      item_id: update.itemId,
      space_id: update.spaceId,
      readers: update.readers,
      restrictions: update.restrictions,
      archived: update.archived,
    }));
    await executor.execute(sql`
      update search_chunks c
      set space_id = u.space_id, readers = u.readers, restrictions = u.restrictions, archived = u.archived,
        updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        as u(item_id uuid, space_id uuid, readers text[], restrictions uuid[], archived boolean)
      where c.item_id = u.item_id and (c.space_id <> u.space_id or c.readers <> u.readers
        or c.restrictions <> u.restrictions or c.archived <> u.archived)`);
  }

  async updateContextAccess(executor: Executor, contexts: ContextAccess[]): Promise<void> {
    if (contexts.length === 0) return;
    const rows = contexts.map((context) => ({
      item_id: context.itemId,
      readers: context.readers,
      restrictions: context.restrictions,
    }));
    await executor.execute(sql`
      update search_chunks c
      set context_readers = u.readers, context_restrictions = u.restrictions, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as u(item_id uuid, readers text[], restrictions uuid[])
      where c.context_item_id = u.item_id and (c.context_readers is distinct from u.readers
        or c.context_restrictions <> u.restrictions)`);
  }

  async indexedItemsOfSpace(executor: Executor, spaceId: string): Promise<string[]> {
    const result = await executor.execute<{ item_id: string }>(
      sql`select distinct item_id from search_chunks where space_id = ${spaceId}`,
    );
    return result.rows.map((row) => row.item_id);
  }

  async search(executor: Executor, request: AdapterSearch): Promise<AdapterResult> {
    const { viewer, filters } = request;
    const parts = await this.#queryParts(executor, request);
    if (parts === "nothing")
      return {
        hits: [],
        total: 0,
        hasMore: false,
        facets: request.facets ? emptyFacets() : null,
        corrections: new Map(),
      };

    const conditions: SQL[] = [...visibleChunkConditions(viewer), parts.match];
    if (!filters.includeArchived) conditions.push(sql`not c.archived`);
    if (filters.spaceIds) conditions.push(sql`t.space_id = any(${sql.param(filters.spaceIds)}::uuid[])`);
    if (filters.contentTypes.length > 0) {
      conditions.push(sql`c.content_type = any(${sql.param(filters.contentTypes)}::text[])`);
    }
    if (filters.labels.length > 0) conditions.push(sql`c.labels && ${sql.param(filters.labels)}::text[]`);
    if (filters.authorIds) conditions.push(sql`c.author_id = any(${sql.param(filters.authorIds)}::uuid[])`);
    if (filters.statusIds.length > 0)
      conditions.push(sql`c.status = any(${sql.param(filters.statusIds)}::text[])`);
    if (filters.updatedAfter)
      conditions.push(sql`c.content_updated_at >= ${filters.updatedAfter.toISOString()}`);
    if (filters.updatedBefore)
      conditions.push(sql`c.content_updated_at < ${filters.updatedBefore.toISOString()}`);

    const visible = sql`${sql.param(request.visibleSpaceIds)}::uuid[]`;
    const first = request.firstSpaceId ? sql`(b.space_id = ${request.firstSpaceId}::uuid) desc, ` : sql``;
    const order =
      request.sort === "newest"
        ? sql`${first}b.content_updated_at desc, b.source_id desc`
        : sql`${first}b.score desc, b.source_id desc`;
    const after = request.after
      ? request.sort === "newest"
        ? sql`and (b.content_updated_at, b.source_id) < (${request.after.updatedAt}::timestamptz, ${request.after.sourceId}::uuid)`
        : sql`and (b.score, b.source_id) < (${request.after.score}::float8, ${request.after.sourceId}::uuid)`
      : sql``;
    const facets = request.facets
      ? sql`jsonb_build_object(
          'contentTypes', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', n) order by n desc, value)
            from (select content_type as value, count(*) as n from best group by 1) f), '[]'::jsonb),
          'spaces', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', n) order by n desc, value)
            from (select case when space_id = any(${visible}) then space_id end as value, count(*) as n
              from best group by 1) f), '[]'::jsonb),
          'labels', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', n) order by n desc, value)
            from (select label as value, count(*) as n from best, unnest(labels) as label
              group by 1 order by 2 desc, 1 limit ${FACET_LIMIT}) f), '[]'::jsonb),
          'authors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', n) order by n desc, value)
            from (select author_id as value, count(*) as n from best where author_id is not null
              group by 1 order by 2 desc, 1 limit ${FACET_LIMIT}) f), '[]'::jsonb),
          'statuses', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', n) order by n desc, value)
            from (select status as value, count(*) as n from best where status is not null group by 1) f), '[]'::jsonb))`
      : sql`null::jsonb`;

    const result = await executor.execute<{
      total: string;
      hits: (Omit<AdapterHit, "score"> & { score: number | string })[] | null;
      facets: AdapterFacets | null;
    }>(sql`
      with matched as (
        select c.id, c.source, c.source_id, c.item_id, t.space_id, c.content_type, c.title, c.heading, c.anchor,
          c.labels, c.status, c.author_id, c.archived, c.attachment, c.content_updated_at, c.position,
          (${parts.score})::float8 as score
        from search_chunks c
        join tree_items t on t.id = c.item_id
        join spaces s on s.id = t.space_id
        left join search_pending_spaces p on p.space_id = c.space_id
        where ${sql.join(conditions, sql` and `)}
      ),
      best as (
        select distinct on (source, source_id) * from matched order by source, source_id, score desc, position
      ),
      page as (
        select b.* from best b where true ${after} order by ${order} limit ${request.limit + 1}
      )
      select (select count(*) from best) as total, ${facets} as facets,
        (select jsonb_agg(jsonb_build_object(
          'source', b.source, 'sourceId', b.source_id, 'itemId', b.item_id, 'spaceId', b.space_id,
          'contentType', b.content_type, 'title', b.title, 'heading', b.heading, 'anchor', b.anchor,
          'excerpt', ${parts.excerpt}, 'labels', b.labels, 'status', b.status, 'authorId', b.author_id,
          'archived', b.archived, 'attachment', b.attachment, 'score', b.score, 'contentUpdatedAt', b.content_updated_at) order by ${order})
          from page b join search_chunks bc on bc.id = b.id) as hits`);
    const row = result.rows[0];
    const hits = (row?.hits ?? []).map((hit) => ({ ...hit, score: Number(hit.score) }));
    return {
      hits: hits.slice(0, request.limit),
      total: Number(row?.total ?? 0),
      hasMore: hits.length > request.limit,
      facets: row?.facets ?? null,
      corrections: parts.corrections,
    };
  }

  async #queryParts(executor: Executor, request: AdapterSearch): Promise<QueryParts | "nothing"> {
    const { query } = request;
    const plainExcerpt = sql`left(bc.body, 240)`;
    if (query.clauses.length === 0 && query.excluded.length === 0) {
      return { match: sql`true`, score: sql`0`, excerpt: plainExcerpt, corrections: new Map() };
    }
    const configs = await this.#configs(executor, request.viewer);
    if (configs.length === 0) return "nothing";
    const prefix = request.prefixLastTerm ? lastTerm(query) : null;
    const expansions = await this.#expansions(executor, request.viewer, configs, query, prefix);
    const perConfig = configs.map((config) => ({
      config,
      full: tsquery(sql`${config}::regconfig`, query, expansions.alternatives, prefix),
      exact: tsquery(sql`${config}::regconfig`, query, new Map(), prefix),
    }));
    const byConfig = (column: SQL, expression: (entry: (typeof perConfig)[number]) => SQL) =>
      sql`(case ${column} ${sql.join(
        perConfig.map((entry) => sql`when ${entry.config} then ${expression(entry)}`),
        sql` `,
      )} end)`;
    return {
      match: sql`(${sql.join(
        perConfig.map((entry) => sql`(c.config = ${entry.config} and c.document @@ ${entry.full})`),
        sql` or `,
      )})`,
      score: byConfig(
        sql`c.config`,
        (entry) =>
          sql`ts_rank(c.document, ${entry.full}, 1) + case when c.document @@ ${entry.exact} then 0.05 else 0 end`,
      ),
      excerpt: sql`coalesce(nullif(${byConfig(
        sql`bc.config`,
        (entry) => sql`ts_headline(${entry.config}::regconfig, bc.body, ${entry.full}, ${EXCERPT_OPTIONS})`,
      )}, ''), ${plainExcerpt})`,
      corrections: request.suggest ? expansions.corrections : new Map(),
    };
  }

  async #configs(executor: Executor, viewer: SearchViewer): Promise<string[]> {
    const scopes = [sql`organization_id = ${viewer.organizationId}::uuid`];
    if (viewer.personalTokens.length > 0) scopes.push(sql`organization_id is null`);
    const configs = new Set<string>();
    for (const scope of scopes) {
      const result = await executor.execute<{ config: string }>(sql`
        with recursive found(config) as (
          (select config from search_chunks where ${scope} order by config limit 1)
          union all
          select (select c.config from search_chunks c
            where ${scope} and c.config > found.config order by c.config limit 1)
          from found where found.config is not null
        )
        select config from found where config is not null`);
      for (const row of result.rows) configs.add(row.config);
    }
    return [...configs].sort();
  }

  async #expansions(
    executor: Executor,
    viewer: SearchViewer,
    configs: string[],
    query: ParsedQuery,
    prefix: QueryAtom | null,
  ): Promise<Expansions> {
    const terms = [
      ...new Set(
        query.clauses
          .flat()
          .filter((atom) => atom.kind === "term" && atom !== prefix)
          .map((atom) => atom.text.toLowerCase())
          .filter((term) => term.length >= MIN_TYPO_LENGTH && /^\p{L}+$/u.test(term)),
      ),
    ];
    if (terms.length === 0) return { alternatives: new Map(), corrections: new Map() };
    const visibleWord = (word: SQL) => sql`exists (select 1 from search_chunks c
      join tree_items t on t.id = c.item_id
      join spaces s on s.id = t.space_id
      left join search_pending_spaces p on p.space_id = c.space_id
      where ${sql.join(visibleChunkConditions(viewer), sql` and `)} and (${sql.join(
        configs.map(
          (config) =>
            sql`(c.config = ${config} and c.document @@ plainto_tsquery(${config}::regconfig, ${word}))`,
        ),
        sql` or `,
      )}))`;
    const result = await executor.execute<{ term: string; known: boolean; words: string[] }>(sql`
      select q.term, ${visibleWord(sql`q.term`)} as known,
        array(select w.word from search_terms w
          where w.organization_id = ${viewer.organizationId} and w.word % q.term and w.word <> q.term
            and similarity(w.word, q.term) >= ${TYPO_SIMILARITY} and ${visibleWord(sql`w.word`)}
          order by similarity(w.word, q.term) desc, w.word limit ${TYPO_ALTERNATIVES}) as words
      from unnest(${sql.param(terms)}::text[]) as q(term)`);
    const alternatives = new Map<string, string[]>();
    const corrections = new Map<string, string>();
    for (const row of result.rows) {
      alternatives.set(row.term, row.words);
      const best = row.words[0];
      if (!row.known && best) corrections.set(row.term, best);
    }
    return { alternatives, corrections };
  }
}

function visibleChunkConditions(viewer: SearchViewer): SQL[] {
  const organization = sql`${viewer.organizationId}::uuid`;
  const personal = viewer.personalTokens.length > 0;
  return [
    personal
      ? sql`(c.organization_id = ${organization} or c.organization_id is null)`
      : sql`c.organization_id = ${organization}`,
    personal
      ? sql`(s.organization_id = ${organization} or s.organization_id is null)`
      : sql`s.organization_id = ${organization}`,
    sql`s.deleted_at is null`,
    sql`t.trash_entry_id is null`,
    sql`((p.space_id is null and c.space_id = t.space_id and ${storedAccessCondition(viewer, sql`c`)})
      or ((p.space_id is not null or c.space_id <> t.space_id)
        and ${liveAccessCondition(viewer, sql`c`, sql`t`, sql`s`)}))`,
  ];
}

function atomQuery(config: SQL, atom: QueryAtom, expansions: Map<string, string[]>, prefix: boolean): SQL {
  if (atom.kind === "phrase") return sql`phraseto_tsquery(${config}, ${atom.text})`;
  const word = prefixWord(atom.text);
  if (prefix && word.length > 0) return sql`to_tsquery(${config}, ${`${word}:*`})`;
  const base = sql`plainto_tsquery(${config}, ${atom.text})`;
  const alternatives = expansions.get(atom.text.toLowerCase()) ?? [];
  if (alternatives.length === 0) return base;
  return sql`(${base} || ${sql.join(
    alternatives.map((alternative) => sql`plainto_tsquery(${config}, ${alternative})`),
    sql` || `,
  )})`;
}

function tsquery(
  config: SQL,
  query: ParsedQuery,
  expansions: Map<string, string[]>,
  prefix: QueryAtom | null,
): SQL {
  const parts = [
    ...query.clauses.map(
      (clause) =>
        sql`(${sql.join(
          clause.map((atom) => atomQuery(config, atom, expansions, atom === prefix)),
          sql` || `,
        )})`,
    ),
    ...query.excluded.map((atom) => sql`(!! ${atomQuery(config, atom, new Map(), false)})`),
  ];
  return sql`(${sql.join(parts, sql` && `)})`;
}

function emptyFacets(): AdapterFacets {
  return { contentTypes: [], spaces: [], labels: [], authors: [], statuses: [] };
}
