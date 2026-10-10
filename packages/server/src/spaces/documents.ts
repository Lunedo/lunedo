import {
  type ChildPagesRequest,
  childPagesRequest,
  type DecisionReportRequest,
  type DocumentJson,
  editorSchemaVersion,
  emptyDocument,
  extractDecisions,
  extractMentions,
  extractPageLinks,
  extractTasks,
  extractTopicUpdates,
  type ListedAttachment,
  type ListedPage,
  MAX_CHILD_PAGE_DEPTH,
  migrateDocument,
  type NodeJson,
  type PageReportRequest,
  type ReportedDecision,
  type ReportedPage,
  renderMarkdown,
  slugify,
  type ValidationProblem,
  validateDocument,
} from "@pagehall/editor-schema";
import { applyDocument, documentFromYDoc, migrateYDoc, yDocFromDocument } from "@pagehall/editor-schema/yjs";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { type ContentActivity, claimTaskIds, syncCommentAnchors } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { actorIdOf, SpaceError } from "./common.js";
import type { PeopleService } from "./people.js";
import type { PageMode } from "./schema.js";
import { signalDocumentChange, signalSpaceChange } from "./signals.js";
import { publishedFor, spaceKeyFor, spaceNameFor, visibleItem } from "./visibility.js";

export const LABEL_MAX_LENGTH = 100;
export const MAX_LABELS_PER_PAGE = 100;
export const MERGE_ORIGIN = "pagehall:merge";
export const API_ORIGIN = "pagehall:api";
export const NORMALIZE_ORIGIN = "pagehall:normalize";

export class DocumentInvalidError extends Error {
  override name = "DocumentInvalidError";

  constructor(readonly problems: ValidationProblem[]) {
    super("The document does not match the editor schema");
  }
}

export interface PageSnapshot {
  itemId: string;
  document: DocumentJson;
  schemaVersion: number;
  revision: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ReadablePage {
  itemId: string;
  title: string;
  document: DocumentJson;
  schemaVersion: number;
  revision: number;
  updatedAt: Date;
  updatedBy: string | null;
  version: number | null;
}

export interface PageReferences {
  people: Record<string, string>;
  pages: Record<
    string,
    { title: string; spaceKey: string; kind: string; accessible: boolean; inTrash: boolean }
  >;
  topics: Record<string, { title: string; status: "open" | "closed" }>;
}

export interface Backlink {
  itemId: string;
  title: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
}

export function encodeState(doc: Y.Doc): Buffer {
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

export async function insertInitialDocument(
  tx: Transaction,
  itemId: string,
  actorId: string | null,
  content?: unknown,
): Promise<void> {
  let document: DocumentJson = emptyDocument();
  if (content !== undefined) {
    const validation = validateDocument(content);
    if (!validation.ok) throw new DocumentInvalidError(validation.problems);
    document = (await claimTaskIds(tx, itemId, validation.document)) ?? validation.document;
  }
  const state = encodeState(yDocFromDocument(document));
  await tx.execute(sql`
    insert into page_documents (item_id, state, snapshot, schema_version, updated_by)
    values (${itemId}, ${state}, ${JSON.stringify(document)}::jsonb, ${editorSchemaVersion}, ${actorId})`);
}

export async function recordClient(
  executor: Executor,
  itemId: string,
  clientId: number,
  accountId: string,
): Promise<void> {
  await executor.execute(sql`
    insert into collaboration_clients (item_id, client_id, account_id) values (${itemId}, ${clientId}, ${accountId})
    on conflict do nothing`);
}

export function pagePath(spaceKey: string, itemId: string, title: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${itemId}/${slugify(title)}`;
}

export const MAX_LISTED_CHILD_PAGES = 500;

const childPagesDefaults = { pageId: null, depth: null, sort: "tree", reverse: false };

export interface PageListings {
  childPages: ReadonlyMap<string, readonly ListedPage[]>;
  attachments: readonly ListedAttachment[] | null;
  pageReports?: ReadonlyMap<string, readonly ReportedPage[]>;
  decisionReports?: ReadonlyMap<string, readonly ReportedDecision[]>;
}

export function reportKey(request: PageReportRequest | DecisionReportRequest): string {
  return JSON.stringify(Object.entries(request).sort(([left], [right]) => left.localeCompare(right)));
}

interface MutablePage {
  title: string;
  href: string;
  children: MutablePage[];
}

export function childPagesKey(request: ChildPagesRequest): string {
  return JSON.stringify([request.pageId, request.depth, request.sort, request.reverse]);
}

export function blocksOfType(node: NodeJson, type: string): NodeJson[] {
  return [
    ...(node.type === type ? [node] : []),
    ...(node.content ?? []).flatMap((child) => blocksOfType(child, type)),
  ];
}

export function containsBlock(document: DocumentJson, type: string): boolean {
  return blocksOfType(document, type).length > 0;
}

export function renderPageMarkdown(
  document: DocumentJson,
  references: PageReferences,
  listings?: PageListings,
): string {
  return renderMarkdown(document, {
    ...(listings
      ? {
          childPages: (request: ChildPagesRequest) => listings.childPages.get(childPagesKey(request)) ?? [],
          attachmentList: () => listings.attachments,
          attachment: (id: string) => ({ href: `/api/v1/attachments/${id}/content` }),
          pageReport: (request: PageReportRequest) => listings.pageReports?.get(reportKey(request)) ?? [],
          decisionReport: (request: DecisionReportRequest) =>
            listings.decisionReports?.get(reportKey(request)) ?? [],
        }
      : {}),
    mention: (id) => {
      const name = references.people[id];
      return name ? { name } : null;
    },
    pageLink: (link) => {
      if (!link.pageId) return null;
      const page = references.pages[link.pageId];
      if (page?.inTrash) return { href: "", title: page.title, accessible: false, inTrash: true };
      return page?.accessible
        ? { href: pagePath(page.spaceKey, link.pageId, page.title), title: page.title, accessible: true }
        : { href: "", title: "", accessible: false };
    },
  });
}

export function migrated(document: unknown, schemaVersion: number): DocumentJson {
  return schemaVersion < editorSchemaVersion
    ? migrateDocument(document as DocumentJson, schemaVersion)
    : (document as DocumentJson);
}

export async function recomputeLinks(tx: Transaction, itemId: string, document: DocumentJson): Promise<void> {
  const targets = [
    ...new Set(
      extractPageLinks(document)
        .map((link) => link.pageId)
        .filter((id): id is string => id !== null && id !== itemId),
    ),
  ];
  await tx.execute(sql`delete from page_links where source_item_id = ${itemId}`);
  if (targets.length > 0) {
    await tx.execute(sql`
      insert into page_links (source_item_id, target_item_id)
      select ${itemId}, id from tree_items where id = any(${sql.param(targets)}::uuid[])
      on conflict do nothing`);
  }
}

export function normalizeLabel(label: string): string {
  const value = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/-+/g, "-");
  if (value.length === 0 || value.length > LABEL_MAX_LENGTH) {
    throw new SpaceError(
      "invalidLabel",
      `A label needs 1 to ${LABEL_MAX_LENGTH} letters, digits, dots, dashes or underscores`,
    );
  }
  return value;
}

export class PageDocumentService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #activity: ContentActivity;
  readonly #origin: string;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    activity: ContentActivity;
    origin: string;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#activity = options.activity;
    this.#origin = options.origin;
  }

  get origin(): string {
    return this.#origin;
  }

  async snapshot(itemId: string): Promise<PageSnapshot | null> {
    const result = await this.#database.execute<{
      snapshot: unknown;
      schema_version: number;
      revision: number;
      updated_at: Date | string;
      updated_by: string | null;
    }>(sql`
      select d.snapshot, d.schema_version, d.revision, d.updated_at, d.updated_by
      from page_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      itemId,
      document: migrated(row.snapshot, row.schema_version),
      schemaVersion: editorSchemaVersion,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by,
    };
  }

  async readable(itemId: string): Promise<ReadablePage | null> {
    const result = await this.#database.execute<{
      mode: PageMode;
      title: string;
      snapshot: unknown;
      schema_version: number;
      revision: number;
      updated_at: Date | string;
      updated_by: string | null;
      version_number: number | null;
      version_title: string | null;
      version_document: unknown;
      version_schema: number | null;
      version_revision: number | null;
      version_at: Date | string | null;
      version_by: string | null;
    }>(sql`
      select t.mode, t.title, d.snapshot, d.schema_version, d.revision, d.updated_at, d.updated_by,
        v.number as version_number, v.title as version_title, v.document as version_document,
        v.schema_version as version_schema, v.revision as version_revision, v.created_at as version_at,
        v.created_by as version_by
      from tree_items t join page_documents d on d.item_id = t.id
      left join page_versions v on v.id = t.published_version_id
      where t.id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    if (!row) return null;
    if (row.mode === "publish") {
      if (row.version_number === null || row.version_schema === null || row.version_at === null) return null;
      return {
        itemId,
        title: row.version_title ?? row.title,
        document: migrated(row.version_document, row.version_schema),
        schemaVersion: editorSchemaVersion,
        revision: Number(row.version_revision),
        updatedAt: new Date(row.version_at),
        updatedBy: row.version_by,
        version: row.version_number,
      };
    }
    return {
      itemId,
      title: row.title,
      document: migrated(row.snapshot, row.schema_version),
      schemaVersion: editorSchemaVersion,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by,
      version: row.version_number,
    };
  }

  async state(itemId: string, executor: Executor = this.#database): Promise<Uint8Array | null> {
    return (await this.stored(itemId, executor))?.state ?? null;
  }

  async stored(
    itemId: string,
    executor: Executor = this.#database,
  ): Promise<{ state: Uint8Array; schemaVersion: number } | null> {
    const result = await executor.execute<{ state: Buffer; schema_version: number }>(
      sql`select state, schema_version from page_documents where item_id = ${itemId}`,
    );
    const row = result.rows[0];
    return row ? { state: new Uint8Array(row.state), schemaVersion: row.schema_version } : null;
  }

  async afterInsert(tx: Transaction, itemId: string, actorId: string | null): Promise<void> {
    const result = await tx.execute<{ snapshot: unknown; schema_version: number }>(sql`
      select d.snapshot, d.schema_version from page_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId} and t.mode = 'live'`);
    const row = result.rows[0];
    if (row) {
      await this.#activity.readerContentChanged(
        tx,
        itemId,
        migrated(row.snapshot, row.schema_version),
        actorId,
      );
    }
  }

  async store(itemId: string, doc: Y.Doc, options: { actorId: string | null }): Promise<number> {
    return this.#database.transaction((tx) => this.#store(tx, itemId, doc, options.actorId));
  }

  async storeLocked(tx: Transaction, itemId: string, doc: Y.Doc, actorId: string | null): Promise<number> {
    return this.#store(tx, itemId, doc, actorId);
  }

  async #store(tx: Transaction, itemId: string, doc: Y.Doc, actorId: string | null): Promise<number> {
    await tx.execute(sql`select item_id from page_documents where item_id = ${itemId} for update`);
    const locked = await tx.execute<{
      state: Buffer;
      space_id: string;
      mode: PageMode;
      schema_version: number;
    }>(sql`
      select d.state, t.space_id, t.mode, d.schema_version from page_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId}`);
    const row = locked.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    Y.applyUpdate(doc, new Uint8Array(row.state), MERGE_ORIGIN);
    migrateYDoc(doc, row.schema_version, NORMALIZE_ORIGIN);
    const validation = validateDocument(documentFromYDoc(doc));
    if (!validation.ok) throw new DocumentInvalidError(validation.problems);
    let document = validation.document;
    const claimed = await claimTaskIds(tx, itemId, document);
    if (claimed) {
      applyDocument(doc, claimed, NORMALIZE_ORIGIN);
      document = claimed;
    }
    const revision = await tx.execute<{ revision: number }>(sql`
      update page_documents set state = ${encodeState(doc)}, snapshot = ${JSON.stringify(document)}::jsonb,
        schema_version = ${editorSchemaVersion}, revision = revision + 1, updated_by = ${actorId}, updated_at = now(),
        changed_at = now()
      where item_id = ${itemId}
      returning revision`);
    const live = row.mode === "live";
    if (live) {
      await tx.execute(sql`update tree_items set content_updated_at = now() where id = ${itemId}`);
      await recomputeLinks(tx, itemId, document);
    }
    await syncCommentAnchors(tx, itemId, document);
    if (live) await this.#activity.readerContentChanged(tx, itemId, document, actorId);
    const stored = Number(revision.rows[0]?.revision ?? 0);
    await signalSpaceChange(tx, { spaceId: row.space_id, kind: live ? "page" : "draft", itemId });
    await signalDocumentChange(tx, { itemId, revision: stored, origin: this.#origin });
    return stored;
  }

  async replace(actor: Principal, itemId: string, input: unknown): Promise<PageSnapshot> {
    const validation = validateDocument(input);
    if (!validation.ok) throw new DocumentInvalidError(validation.problems);
    await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<{ state: Buffer }>(sql`
        select d.state from page_documents d join tree_items t on t.id = d.item_id
        where d.item_id = ${itemId} and t.kind in ('page', 'blogPost') for update of d`);
      const row = locked.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(row.state), MERGE_ORIGIN);
      applyDocument(doc, validation.document, API_ORIGIN);
      const actorId = actorIdOf(actor);
      if (actorId) await recordClient(tx, itemId, doc.clientID, actorId);
      await this.#store(tx, itemId, doc, actorId);
    });
    const snapshot = await this.snapshot(itemId);
    if (!snapshot) throw new SpaceError("itemNotFound", "The page does not exist");
    return snapshot;
  }

  async editLocked(
    tx: Transaction,
    itemId: string,
    change: (document: DocumentJson) => DocumentJson | null,
    actorId: string | null,
  ): Promise<boolean> {
    const locked = await tx.execute<{ state: Buffer; schema_version: number }>(sql`
      select d.state, d.schema_version from page_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId} and t.kind = 'page' for update of d`);
    const row = locked.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state), MERGE_ORIGIN);
    migrateYDoc(doc, row.schema_version, NORMALIZE_ORIGIN);
    const next = change(documentFromYDoc(doc) as DocumentJson);
    if (!next) return false;
    const validation = validateDocument(next);
    if (!validation.ok) throw new DocumentInvalidError(validation.problems);
    applyDocument(doc, validation.document, API_ORIGIN);
    if (actorId) await recordClient(tx, itemId, doc.clientID, actorId);
    await this.#store(tx, itemId, doc, actorId);
    return true;
  }

  async resolveTitleLinks(
    actor: Principal,
    itemId: string,
    target: { spaceId: string; title: string; pageId: string },
  ): Promise<void> {
    const snapshot = await this.snapshot(itemId);
    if (!snapshot) return;
    const title = target.title.trim().toLowerCase();
    let changed = false;
    const rewrite = (node: unknown): unknown => {
      if (node === null || typeof node !== "object") return node;
      const value = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
      if (
        value.type === "pageLink" &&
        value.attrs?.pageId === null &&
        value.attrs.spaceId === target.spaceId &&
        typeof value.attrs.title === "string" &&
        value.attrs.title.trim().toLowerCase() === title
      ) {
        changed = true;
        return { ...value, attrs: { ...value.attrs, pageId: target.pageId } };
      }
      return value.content ? { ...value, content: value.content.map(rewrite) } : value;
    };
    const document = rewrite(snapshot.document);
    if (changed) await this.replace(actor, itemId, document);
  }

  async references(viewer: Principal, document: DocumentJson): Promise<PageReferences> {
    const mentions = [
      ...new Set([
        ...extractMentions(document),
        ...extractTasks(document).flatMap((task) => (task.assignee ? [task.assignee] : [])),
      ]),
    ];
    const pageIds = [
      ...new Set(
        extractPageLinks(document)
          .map((link) => link.pageId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const people =
      mentions.length === 0
        ? []
        : (
            await this.#database.execute<{ id: string; name: string }>(
              sql`select a.id, coalesce(m.name, a.name) as name from accounts a
                left join accounts m on m.id = a.merged_into_id
                where a.id = any(${sql.param(mentions)}::uuid[])
                  and ${this.#people.visibleCondition(viewer, sql`coalesce(m.id, a.id)`)}`,
            )
          ).rows;
    const pages =
      pageIds.length === 0
        ? []
        : (
            await this.#database.execute<{
              id: string;
              title: string;
              kind: string;
              key: string;
              accessible: boolean;
              in_trash: boolean;
            }>(sql`
              select t.id, t.title, t.kind::text as kind, s.key,
                ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)} as accessible,
                (t.trash_entry_id is not null and ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)}
                  and ${publishedFor(this.#authorization, viewer, sql`t`, sql`s`)}) as in_trash
              from tree_items t join spaces s on s.id = t.space_id
              where t.id = any(${sql.param(pageIds)}::uuid[])`)
          ).rows;
    const topicIds = [
      ...new Set([
        ...extractTopicUpdates(document).map((update) => update.topicId),
        ...extractDecisions(document).flatMap((decision) => (decision.topicId ? [decision.topicId] : [])),
      ]),
    ];
    const topics =
      topicIds.length === 0
        ? []
        : (
            await this.#database.execute<{ id: string; title: string; status: "open" | "closed" }>(sql`
              select t.id, t.title, mt.status from tree_items t join spaces s on s.id = t.space_id
              join meeting_topics mt on mt.item_id = t.id
              where t.id = any(${sql.param(topicIds)}::uuid[])
                and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`)
          ).rows;
    return {
      topics: Object.fromEntries(
        topics.map((topic) => [topic.id, { title: topic.title, status: topic.status }]),
      ),
      people: Object.fromEntries(people.map((person) => [person.id, person.name])),
      pages: Object.fromEntries(
        pageIds.map((id) => {
          const page = pages.find((candidate) => candidate.id === id);
          if (page?.in_trash) {
            return [
              id,
              { title: page.title, spaceKey: "", kind: page.kind, accessible: false, inTrash: true },
            ];
          }
          return [
            id,
            page?.accessible
              ? { title: page.title, spaceKey: page.key, kind: page.kind, accessible: true, inTrash: false }
              : { title: "", spaceKey: "", kind: "page", accessible: false, inTrash: false },
          ];
        }),
      ),
    };
  }

  async childPages(
    viewer: Principal,
    itemId: string,
    document: DocumentJson,
  ): Promise<Map<string, readonly ListedPage[]>> {
    const result = new Map<string, readonly ListedPage[]>();
    for (const block of blocksOfType(document, "childPages")) {
      const request = childPagesRequest({ attrs: { ...childPagesDefaults, ...block.attrs } });
      const key = childPagesKey(request);
      if (!result.has(key)) result.set(key, await this.#childTree(viewer, request.pageId ?? itemId, request));
    }
    return result;
  }

  async #childTree(viewer: Principal, rootId: string, request: ChildPagesRequest): Promise<ListedPage[]> {
    const root = await this.#database.execute<{ id: string }>(sql`
      select t.id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${rootId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    if (root.rows.length === 0) return [];
    const order =
      request.sort === "title"
        ? sql`lower(t.title)`
        : request.sort === "created"
          ? sql`t.created_at`
          : request.sort === "modified"
            ? sql`t.content_updated_at`
            : sql`t.position`;
    const direction = request.reverse ? sql`desc` : sql`asc`;
    const roots: MutablePage[] = [];
    const listed = new Map<string, MutablePage>();
    let parents = [rootId];
    let budget = MAX_LISTED_CHILD_PAGES;
    for (
      let level = 1;
      level <= (request.depth ?? MAX_CHILD_PAGE_DEPTH) && parents.length > 0 && budget > 0;
      level += 1
    ) {
      const rows = await this.#database.execute<{
        id: string;
        parent_id: string;
        title: string;
        key: string;
      }>(sql`
        select t.id, t.parent_id, t.title, s.key from tree_items t
        join tree_items p on p.id = t.parent_id join spaces s on s.id = t.space_id
        where t.parent_id = any(${sql.param(parents)}::uuid[]) and t.kind = 'page'
          and t.archived_root_id is not distinct from p.archived_root_id
          and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        order by ${order} ${direction}, t.position, t.id
        limit ${budget}`);
      budget -= rows.rows.length;
      parents = [];
      for (const row of rows.rows) {
        const page: MutablePage = {
          title: row.title,
          href: pagePath(row.key, row.id, row.title),
          children: [],
        };
        listed.set(row.id, page);
        parents.push(row.id);
        const parent = listed.get(row.parent_id);
        if (parent) parent.children.push(page);
        else roots.push(page);
      }
    }
    return roots;
  }

  async backlinks(viewer: Principal, itemId: string): Promise<Backlink[]> {
    const result = await this.#database.execute<{
      id: string;
      title: string;
      space_id: string;
      key: string;
      name: string;
    }>(sql`
      select t.id, t.title, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as name
      from page_links l join tree_items t on t.id = l.source_item_id join spaces s on s.id = t.space_id
      where l.target_item_id = ${itemId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by lower(t.title), t.id
      limit 500`);
    return result.rows.map((row) => ({
      itemId: row.id,
      title: row.title,
      spaceId: row.space_id,
      spaceKey: row.key,
      spaceName: row.name,
    }));
  }

  async labels(itemId: string, executor: Executor = this.#database): Promise<string[]> {
    const result = await executor.execute<{ label: string }>(
      sql`select label from page_labels where item_id = ${itemId} order by label`,
    );
    return result.rows.map((row) => row.label);
  }

  async addLabel(actor: Principal, itemId: string, label: string): Promise<string[]> {
    const value = normalizeLabel(label);
    return this.#database.transaction(async (tx) => {
      const item = await tx.execute<{ space_id: string; kind: string }>(
        sql`select space_id, kind from tree_items where id = ${itemId} for update`,
      );
      const row = item.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
      const count = await tx.execute<{ count: string }>(
        sql`select count(*) as count from page_labels where item_id = ${itemId}`,
      );
      if (Number(count.rows[0]?.count ?? 0) >= MAX_LABELS_PER_PAGE) {
        throw new SpaceError("tooManyLabels", `A page can have up to ${MAX_LABELS_PER_PAGE} labels`);
      }
      await tx.execute(sql`
        insert into page_labels (item_id, label, created_by) values (${itemId}, ${value}, ${actorIdOf(actor)})
        on conflict do nothing`);
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "page", itemId });
      return this.labels(itemId, tx);
    });
  }

  async removeLabel(itemId: string, label: string): Promise<string[]> {
    return this.#database.transaction(async (tx) => {
      const item = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const row = item.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
      await tx.execute(
        sql`delete from page_labels where item_id = ${itemId} and label = ${label.trim().toLowerCase()}`,
      );
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "page", itemId });
      return this.labels(itemId, tx);
    });
  }

  async labelSuggestions(viewer: Principal, spaceId: string, query: string): Promise<string[]> {
    const term = query.trim().toLowerCase();
    const pattern = `${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const result = await this.#database.execute<{ label: string }>(sql`
      select l.label from page_labels l
      join tree_items t on t.id = l.item_id
      join spaces s on s.id = t.space_id
      where s.organization_id is not distinct from (select organization_id from spaces where id = ${spaceId})
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${term ? sql`and l.label like ${pattern}` : sql``}
      group by l.label
      order by count(*) desc, l.label
      limit 20`);
    return result.rows.map((row) => row.label);
  }

  async pagesWithLabel(
    viewer: Principal,
    spaceId: string,
    label: string,
  ): Promise<{ itemId: string; title: string; contentUpdatedAt: Date }[]> {
    const result = await this.#database.execute<{
      id: string;
      title: string;
      content_updated_at: Date | string;
    }>(sql`
      select t.id, t.title, t.content_updated_at from page_labels l join tree_items t on t.id = l.item_id
      join spaces s on s.id = t.space_id
      where t.space_id = ${spaceId} and l.label = ${label.trim().toLowerCase()}
        and t.archived_root_id is null and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by lower(t.title), t.id limit 1000`);
    return result.rows.map((row) => ({
      itemId: row.id,
      title: row.title,
      contentUpdatedAt: new Date(row.content_updated_at),
    }));
  }
}
