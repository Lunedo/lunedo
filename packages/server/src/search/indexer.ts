import { commentText, type DocumentJson, migrateDocument } from "@pagehall/editor-schema";
import { sceneText, validateScene } from "@pagehall/editor-schema/scene";
import { type ContentLanguage, OTHER_CONTENT_LANGUAGE } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Database, Executor } from "../database/database.js";
import { FileTooLargeError } from "../files/files.js";
import type { Logger } from "../logging/logger.js";
import { pageStatusEnabledCondition } from "../spaces/status.js";
import { readerTokens, restrictionIds } from "./access.js";
import type { ContextAccess, IndexedChunk, IndexedItem, ItemAccess, SearchAdapter } from "./adapter.js";
import {
  type ChunkText,
  cleanText,
  documentChunks,
  MAX_CHUNKS_PER_SOURCE,
  splitText,
  textChunks,
} from "./chunks.js";
import { TextExtractor } from "./extraction/extractor.js";
import {
  type ExtractableFormat,
  type ExtractedSection,
  type ExtractionOutcome,
  extractableContentTypes,
  extractableFormat,
} from "./extraction/text.js";
import { contentLanguageOf, TextSearchConfigs } from "./languages.js";

export const SEARCH_CHANGES_CHANNEL = "pagehall_search_changes";

export const EXTRACTOR_VERSION = 1;

const BATCH_SIZE = 50;
const INDEXED_KINDS = sql`('page', 'blogPost', 'meetingTopic', 'whiteboard')`;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;
const BUSY_RETRY_MS = 2000;
const REFUSED_CONTENT_CLASSES = ["22", "54"];

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

export interface AttachmentFiles {
  readAll(fileId: string, maxBytes: number): Promise<Buffer>;
}

interface LoadedItem {
  item: IndexedItem | null;
  incomplete: boolean;
}

function boardChunks(scene: unknown): ChunkText[] {
  const validation = validateScene(scene);
  const chunks = validation.ok ? textChunks(sceneText(validation.scene)) : [];
  return chunks.length > 0 ? chunks : [{ heading: "", anchor: null, body: "" }];
}

function indexable(item: SQL, space: SQL): SQL {
  return sql`(${item}.kind in ${INDEXED_KINDS} and ${item}.trash_entry_id is null and ${space}.deleted_at is null
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

function refusedContent(error: unknown): { code: string } {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === "string" && REFUSED_CONTENT_CLASSES.some((prefix) => code.startsWith(prefix))) {
    return { code };
  }
  throw error;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class SearchIndexer {
  readonly #database: Database;
  readonly #adapter: SearchAdapter;
  readonly #configs: TextSearchConfigs;
  readonly #files: AttachmentFiles | null;
  readonly #extractor: TextExtractor;

  constructor(options: {
    database: Database;
    adapter: SearchAdapter;
    files?: AttachmentFiles | undefined;
    extractor?: TextExtractor | undefined;
  }) {
    this.#database = options.database;
    this.#adapter = options.adapter;
    this.#configs = new TextSearchConfigs(options.database);
    this.#files = options.files ?? null;
    this.#extractor = options.extractor ?? new TextExtractor();
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
          await this.#extractTexts(row.item_id, options);
          const outcome = await this.#indexItem(row.item_id, Number(row.generation));
          if (outcome === "indexed") result.items += 1;
          else if (outcome === "busy") {
            busyItems.add(row.item_id);
            busy = true;
          } else {
            result.failed += 1;
            options.logger?.warn(
              { itemId: row.item_id, error: { code: outcome.code } },
              "An item was refused by the search index; it is left out of search until it changes",
            );
          }
        } catch (error) {
          if (options.signal?.aborted) break;
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
      select id from tree_items where kind in ${INDEXED_KINDS}
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

  async #indexItem(itemId: string, generation: number): Promise<"indexed" | "busy" | { code: string }> {
    return this.#database.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${lockKey("item", itemId)}) as locked`,
      );
      if (!lock.rows[0]?.locked) return "busy";
      const current = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const lockedSpaces = new Set<string>();
      let spaceId = current.rows[0]?.space_id ?? null;
      let loaded: LoadedItem = { item: null, incomplete: false };
      while (spaceId && !lockedSpaces.has(spaceId)) {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(${lockKey("space", spaceId)})`);
        lockedSpaces.add(spaceId);
        loaded = await this.#load(tx, itemId);
        spaceId = loaded.item?.spaceId ?? null;
      }
      const item = loaded.item;
      const refused = item
        ? await tx
            .transaction((savepoint) => this.#adapter.replaceItem(savepoint, item))
            .then(() => null, refusedContent)
        : null;
      if (!item || refused) await this.#adapter.removeItem(tx, itemId);
      await tx.execute(
        sql`delete from search_pending_items where item_id = ${itemId} and generation = ${generation}`,
      );
      if (refused) return refused;
      if (loaded.incomplete) await tx.execute(sql`select search_mark_item(${itemId}, interval '0')`);
      return "indexed";
    });
  }

  async #extractTexts(itemId: string, options: { signal?: AbortSignal; logger?: Logger }): Promise<void> {
    const files = this.#files;
    if (!files) return;
    const pending = await this.#database.execute<{
      id: string;
      size: string | number;
      content_type: string;
    }>(sql`
      select distinct f.id, f.size, f.content_type
      from attachments a join attachment_versions v on v.id = a.published_version_id
      join stored_files f on f.id = v.file_id and f.state = 'ready'
      where a.item_id = ${itemId} and f.content_type = any(${sql.param(extractableContentTypes)}::text[])
        and not exists (select 1 from search_file_texts ft
          where ft.file_id = f.id and ft.extractor_version = ${EXTRACTOR_VERSION})
      order by f.id`);
    for (const file of pending.rows) {
      if (options.signal?.aborted) return;
      const format = extractableFormat(file.content_type);
      if (!format) continue;
      const outcome = await this.#extract(files, file.id, Number(file.size), format, options.signal);
      if (outcome.status === "skipped") {
        options.logger?.warn(
          { fileId: file.id, format, reason: outcome.reason },
          "The text of an attachment could not be extracted; it is found by its name only",
        );
      }
      await this.#storeText(file.id, outcome).catch(async (error: unknown) => {
        const refused = refusedContent(error);
        options.logger?.warn(
          { fileId: file.id, format, error: refused },
          "The extracted text of an attachment was refused; it is found by its name only",
        );
        await this.#storeText(file.id, { status: "skipped", reason: "unreadable" });
      });
    }
  }

  async #storeText(fileId: string, outcome: ExtractionOutcome): Promise<void> {
    const sections =
      outcome.status === "extracted"
        ? outcome.sections.map((section) => ({
            heading: cleanText(section.heading),
            text: cleanText(section.text),
          }))
        : [];
    await this.#database.execute(sql`
      insert into search_file_texts (file_id, extractor_version, state, reason, truncated, sections)
      values (${fileId}, ${EXTRACTOR_VERSION}, ${outcome.status},
        ${outcome.status === "skipped" ? outcome.reason : null},
        ${outcome.status === "extracted" && outcome.truncated}, ${JSON.stringify(sections)}::jsonb)
      on conflict (file_id) do update set extractor_version = excluded.extractor_version, state = excluded.state,
        reason = excluded.reason, truncated = excluded.truncated, sections = excluded.sections,
        updated_at = now()`);
  }

  async #extract(
    files: AttachmentFiles,
    fileId: string,
    size: number,
    format: ExtractableFormat,
    signal: AbortSignal | undefined,
  ): Promise<ExtractionOutcome> {
    const maxBytes = this.#extractor.limits.maxBytes;
    if (size > maxBytes) return { status: "skipped", reason: "tooLarge" };
    const data = await files.readAll(fileId, maxBytes).catch((error: unknown) => {
      if (error instanceof FileTooLargeError) return null;
      throw error;
    });
    if (!data) return { status: "skipped", reason: "tooLarge" };
    return this.#extractor.extract(format, data, signal);
  }

  async #load(executor: Executor, itemId: string): Promise<LoadedItem> {
    const result = await executor.execute<{
      id: string;
      kind: "page" | "blogPost" | "meetingTopic" | "whiteboard";
      mode: "publish" | "live";
      title: string;
      space_id: string;
      organization_id: string | null;
      creator_id: string | null;
      created_at: Date | string;
      content_updated_at: Date | string;
      content_language: string | null;
      translation_of: string | null;
      knowledge_base_language: string | null;
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
      board_scene: unknown;
      board_changed_at: Date | string | null;
      status_id: string | null;
    }>(sql`
      select t.id, t.kind, t.mode, t.title, t.space_id, s.organization_id, t.creator_id, t.created_at,
        t.content_updated_at, t.content_language, t.translation_of,
        (select kb.default_language from knowledge_bases kb where kb.space_id = s.id and s.type = 'knowledgeBase')
          as knowledge_base_language,
        ${indexable(sql`t`, sql`s`)} as indexable,
        ${archived(sql`t`, sql`s`)} as archived, ${readers(sql`t`, sql`s`)} as readers,
        ${restrictionIds(sql`t`)} as restrictions,
        array(select l.label from page_labels l where l.item_id = t.id order by l.label) as labels,
        ${settingValue("space", sql`s.id`, "content.language")} as space_language,
        ${organizationLanguage(sql`s.organization_id`)} as organization_language,
        v.title as version_title, v.document as version_document, v.schema_version as version_schema,
        v.created_at as version_created_at, d.snapshot as live_document, d.schema_version as live_schema,
        d.changed_at as live_changed_at, w.scene as board_scene, w.changed_at as board_changed_at,
        sv.id as status_id
      from tree_items t join spaces s on s.id = t.space_id
      left join page_status_values sv on sv.id = t.status_id and sv.space_id = t.space_id
        and ${pageStatusEnabledCondition(sql`s`)}
      left join page_versions v on v.id = t.published_version_id and t.mode = 'publish'
      left join page_documents d on d.item_id = t.id and t.mode = 'live'
      left join whiteboard_documents w on w.item_id = t.id and t.kind = 'whiteboard'
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row?.indexable) return { item: null, incomplete: false };
    const board = row.kind === "whiteboard";
    const live = row.mode === "live";
    const stored = board ? null : live ? row.live_document : row.version_document;
    const schemaVersion = live ? row.live_schema : row.version_schema;
    if (!board && !live && !stored) return { item: null, incomplete: false };
    const document = stored && schemaVersion ? migrateDocument(stored, schemaVersion) : null;
    const title = live ? row.title : (row.version_title ?? row.title);
    const updatedAt = asDate(
      board
        ? (row.board_changed_at ?? row.content_updated_at)
        : live
          ? (row.live_changed_at ?? row.content_updated_at)
          : (row.version_created_at ?? row.content_updated_at),
    );
    const language: ContentLanguage =
      (row.knowledge_base_language && row.translation_of === null
        ? contentLanguageOf(row.knowledge_base_language)
        : null) ??
      contentLanguageOf(row.content_language) ??
      contentLanguageOf(row.space_language) ??
      contentLanguageOf(row.organization_language) ??
      OTHER_CONTENT_LANGUAGE;
    const topic = row.kind === "meetingTopic";
    const own = {
      title,
      authorId: row.creator_id,
      contentCreatedAt: asDate(row.created_at),
      context: null,
      attachment: null,
    };
    const texts = board
      ? boardChunks(row.board_scene)
      : document
        ? documentChunks(document)
        : [{ heading: "", anchor: null, body: "" }];
    const chunks: IndexedChunk[] = texts.map((chunk, position) => ({
      ...own,
      ...chunk,
      source: "item",
      sourceId: row.id,
      position,
      contentType: row.kind === "meetingTopic" ? "topic" : row.kind,
      contentUpdatedAt: updatedAt,
    }));
    chunks.push(
      ...(topic
        ? await this.#topicUpdates(executor, row.id, chunks.length, own)
        : await this.#decisions(executor, row.id, own)),
    );
    const attachments = topic
      ? { chunks: [], incomplete: false }
      : await this.#attachments(executor, row.id, title);
    chunks.push(...attachments.chunks);
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
          contentType: topic ? "topic" : "comment",
          title,
          ...chunk,
          authorId: comment.author_id,
          contentCreatedAt: asDate(comment.created_at),
          contentUpdatedAt: asDate(comment.updated_at),
          context: null,
          attachment: null,
        });
      });
    }
    return {
      item: {
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
      },
      incomplete: attachments.incomplete,
    };
  }

  async #topicUpdates(
    executor: Executor,
    topicId: string,
    first: number,
    own: { title: string; authorId: string | null; contentCreatedAt: Date },
  ): Promise<IndexedChunk[]> {
    const updates = await executor.execute<{
      meeting_id: string;
      meeting_title: string;
      text: string;
      updated_at: Date | string;
      readers: string[];
      restrictions: string[];
    }>(sql`
      select u.item_id as meeting_id, mt.title as meeting_title, u.text, u.updated_at,
        ${readers(sql`mt`, sql`ms`)} as readers, ${restrictionIds(sql`mt`)} as restrictions
      from meeting_topic_updates u join meetings m on m.item_id = u.item_id
      join tree_items mt on mt.id = u.item_id join spaces ms on ms.id = mt.space_id
      where u.topic_id = ${topicId} and m.state <> 'skipped' and ${indexable(sql`mt`, sql`ms`)}
      order by coalesce(m.starts_at, u.updated_at), u.item_id`);
    const chunks: IndexedChunk[] = [];
    for (const update of updates.rows) {
      const context: ContextAccess = {
        itemId: update.meeting_id,
        readers: update.readers,
        restrictions: update.restrictions,
      };
      for (const chunk of textChunks(update.text)) {
        if (first + chunks.length >= MAX_CHUNKS_PER_SOURCE) return chunks;
        chunks.push({
          ...own,
          source: "item",
          sourceId: topicId,
          position: first + chunks.length,
          contentType: "topic",
          heading: cleanText(update.meeting_title),
          anchor: null,
          body: chunk.body,
          contentUpdatedAt: asDate(update.updated_at),
          context,
          attachment: null,
        });
      }
    }
    return chunks;
  }

  async #decisions(
    executor: Executor,
    itemId: string,
    own: { title: string; authorId: string | null },
  ): Promise<IndexedChunk[]> {
    const decisions = await executor.execute<{
      id: string;
      text: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql`
      select d.id, d.text, d.created_at, d.updated_at from decisions d
      where d.item_id = ${itemId} and d.published and d.text <> ''
      order by d.position, d.id`);
    return decisions.rows.flatMap((decision) =>
      textChunks(decision.text).map((chunk, position) => ({
        ...own,
        ...chunk,
        source: "decision" as const,
        sourceId: decision.id,
        position,
        contentType: "decision" as const,
        contentCreatedAt: asDate(decision.created_at),
        contentUpdatedAt: asDate(decision.updated_at),
        context: null,
        attachment: null,
      })),
    );
  }

  async #attachments(
    executor: Executor,
    itemId: string,
    title: string,
  ): Promise<{ chunks: IndexedChunk[]; incomplete: boolean }> {
    const attachments = await executor.execute<{
      id: string;
      name: string;
      size: string | number;
      content_type: string;
      ready: boolean;
      uploaded_by: string | null;
      created_at: Date | string;
      uploaded_at: Date | string;
      cached: boolean;
      sections: ExtractedSection[] | null;
    }>(sql`
      select a.id, v.name, f.size, f.content_type, f.state = 'ready' as ready, v.uploaded_by, a.created_at,
        v.created_at as uploaded_at, ft.file_id is not null as cached,
        case when ft.state = 'extracted' then ft.sections end as sections
      from attachments a join attachment_versions v on v.id = a.published_version_id
      join stored_files f on f.id = v.file_id
      left join search_file_texts ft on ft.file_id = f.id and ft.extractor_version = ${EXTRACTOR_VERSION}
      where a.item_id = ${itemId}
      order by lower(v.name), a.id`);
    const chunks: IndexedChunk[] = [];
    let incomplete = false;
    for (const attachment of attachments.rows) {
      const extractable = extractableFormat(attachment.content_type) !== null;
      if (extractable && attachment.ready && !attachment.cached && this.#files) incomplete = true;
      const name = cleanText(attachment.name);
      const bodies = (attachment.sections ?? [])
        .flatMap((section) =>
          splitText(cleanText(section.heading ? `${section.heading}\n${section.text}` : section.text)),
        )
        .slice(0, MAX_CHUNKS_PER_SOURCE);
      const metadata = {
        name: attachment.name,
        contentType: attachment.content_type,
        size: Number(attachment.size),
      };
      (bodies.length > 0 ? bodies : [""]).forEach((body, position) => {
        chunks.push({
          source: "attachment",
          sourceId: attachment.id,
          position,
          contentType: "attachment",
          title,
          heading: name,
          anchor: null,
          body,
          authorId: attachment.uploaded_by,
          contentCreatedAt: asDate(attachment.created_at),
          contentUpdatedAt: asDate(attachment.uploaded_at),
          context: null,
          attachment: metadata,
        });
      });
    }
    return { chunks, incomplete };
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
        meeting: boolean;
      }>(sql`
        select t.id, t.space_id, ${indexable(sql`t`, sql`s`)} as indexable, ${archived(sql`t`, sql`s`)} as archived,
          ${readers(sql`t`, sql`s`)} as readers, ${restrictionIds(sql`t`)} as restrictions,
          exists (select 1 from meetings m where m.item_id = t.id) as meeting
        from tree_items t join spaces s on s.id = t.space_id
        where (t.space_id = ${spaceId} and t.kind in ${INDEXED_KINDS})
          or t.id = any(${sql.param(indexed)}::uuid[])`);
      const known = new Set(indexed);
      const updates: ItemAccess[] = [];
      const contexts: ContextAccess[] = [];
      const missing: string[] = [];
      const seen = new Set<string>();
      for (const row of result.rows) {
        seen.add(row.id);
        if (row.space_id !== spaceId && row.indexable) {
          missing.push(row.id);
          continue;
        }
        if (row.meeting) {
          contexts.push({
            itemId: row.id,
            readers: row.indexable ? row.readers : [],
            restrictions: row.restrictions,
          });
        }
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
      await this.#adapter.updateContextAccess(tx, contexts);
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
