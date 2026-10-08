import {
  containsAnchor,
  type DocumentJson,
  extractInlineCommentThreads,
  extractMentions,
  isValidAnchor,
  type TextAnchor,
  type ValidationProblem,
  validateComment,
  withInlineComment,
} from "@pagehall/editor-schema";
import { applyDocument, documentFromYDoc } from "@pagehall/editor-schema/yjs";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { API_ORIGIN, MERGE_ORIGIN, migrated, type PageDocumentService } from "../spaces/documents.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { ContentActivity } from "./content.js";
import type { ReactionService, ReactionSummary } from "./reactions.js";

export const MAX_COMMENTS_PER_PAGE = 2000;
export const COMMENT_RESTORE_MINUTES = 60;
export const MAX_MENTION_CHECKS = 20;

export class CommentInvalidError extends Error {
  override name = "CommentInvalidError";

  constructor(readonly problems: ValidationProblem[]) {
    super("The comment does not match the comment schema");
  }
}

export interface CommentPerson {
  id: string;
  name: string | null;
}

export interface Comment {
  id: string;
  itemId: string;
  parentId: string | null;
  author: CommentPerson | null;
  body: DocumentJson | null;
  deleted: boolean;
  createdAt: Date;
  editedAt: Date | null;
  reactions: ReactionSummary[];
}

export interface CommentList {
  threads: CommentThread[];
  people: Record<string, string>;
}

export interface CommentThread extends Comment {
  quote: string | null;
  anchor: "page" | "inline" | "detached";
  resolvedAt: Date | null;
  resolvedBy: CommentPerson | null;
  replies: Comment[];
}

type CommentRow = {
  id: string;
  item_id: string;
  parent_id: string | null;
  author_id: string | null;
  body: unknown;
  quote: string | null;
  quote_prefix: string | null;
  quote_suffix: string | null;
  detached_at: Date | string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  edited_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
};

interface LockedComment {
  id: string;
  itemId: string;
  parentId: string | null;
  authorId: string | null;
  quote: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  hasBody: boolean;
  spaceId: string;
  organizationId: string | null;
  title: string;
}

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function validBody(body: unknown): DocumentJson {
  const validation = validateComment(body);
  if (!validation.ok) throw new CommentInvalidError(validation.problems);
  return validation.document;
}

export class CommentService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #documents: PageDocumentService;
  readonly #people: PeopleService;
  readonly #activity: ContentActivity;
  readonly #reactions: ReactionService;
  readonly #audit: AuditLog;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    documents: PageDocumentService;
    people: PeopleService;
    activity: ContentActivity;
    reactions: ReactionService;
    audit: AuditLog;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#documents = options.documents;
    this.#people = options.people;
    this.#activity = options.activity;
    this.#reactions = options.reactions;
    this.#audit = options.audit;
  }

  async list(viewer: Principal, itemId: string): Promise<CommentList> {
    const result = await this.#database.execute<CommentRow>(sql`
      select c.id, c.item_id, c.parent_id, c.author_id, c.body, c.quote, c.quote_prefix, c.quote_suffix, c.detached_at,
        c.resolved_at, c.resolved_by,
        c.edited_at, c.deleted_at, c.created_at
      from comments c join comments r on r.id = coalesce(c.parent_id, c.id)
      join tree_items t on t.id = c.item_id join spaces s on s.id = t.space_id
      where c.item_id = ${itemId}
        and (r.quote is null or r.quote_public or ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`, "editor")})
      order by c.created_at, c.id
      limit ${MAX_COMMENTS_PER_PAGE}`);
    const rows = result.rows;
    const anchored = await this.#anchoredForViewer(viewer, itemId);
    const names = await this.#people.visibleNames(
      viewer,
      rows.flatMap((row) => [row.author_id, row.resolved_by].filter((id): id is string => id !== null)),
    );
    const person = (id: string | null): CommentPerson | null =>
      id ? { id, name: names.get(id) ?? null } : null;
    const reactions = await this.#reactions.forComments(
      viewer,
      itemId,
      rows.map((row) => row.id),
    );
    const toComment = (row: CommentRow): Comment => ({
      id: row.id,
      itemId: row.item_id,
      parentId: row.parent_id,
      author: row.deleted_at ? null : person(row.author_id),
      body: row.deleted_at ? null : (row.body as DocumentJson),
      deleted: row.deleted_at !== null,
      createdAt: new Date(row.created_at),
      editedAt: row.deleted_at ? null : date(row.edited_at),
      reactions: row.deleted_at ? [] : (reactions.get(row.id) ?? []),
    });
    const replies = new Map<string, Comment[]>();
    for (const row of rows) {
      if (!row.parent_id || row.deleted_at) continue;
      replies.set(row.parent_id, [...(replies.get(row.parent_id) ?? []), toComment(row)]);
    }
    const threads: CommentThread[] = rows
      .filter((row) => row.parent_id === null && (!row.deleted_at || (replies.get(row.id)?.length ?? 0) > 0))
      .map((row) => ({
        ...toComment(row),
        quote: row.quote,
        anchor:
          row.quote === null
            ? "page"
            : (anchored ? anchored(row) : row.detached_at === null)
              ? "inline"
              : "detached",
        resolvedAt: date(row.resolved_at),
        resolvedBy: person(row.resolved_by),
        replies: replies.get(row.id) ?? [],
      }));
    const mentioned = [
      ...new Set(
        threads.flatMap((thread) =>
          [thread, ...thread.replies].flatMap((entry) => (entry.body ? extractMentions(entry.body) : [])),
        ),
      ),
    ];
    const people =
      mentioned.length === 0
        ? []
        : (
            await this.#database.execute<{ id: string; name: string }>(sql`
              select a.id, a.name from accounts a
              where a.id = any(${sql.param(mentioned)}::uuid[]) and ${this.#people.visibleCondition(viewer, sql`a.id`)}`)
          ).rows;
    return { threads, people: Object.fromEntries(people.map((person) => [person.id, person.name])) };
  }

  async #anchoredForViewer(
    viewer: Principal,
    itemId: string,
  ): Promise<((row: CommentRow) => boolean) | null> {
    const result = await this.#database.execute<{
      editor: boolean;
      mode: string;
      version_document: unknown;
      version_schema: number | null;
      snapshot: unknown;
      snapshot_schema: number;
    }>(sql`
      select ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`, "editor")} as editor, t.mode,
        v.document as version_document, v.schema_version as version_schema, d.snapshot,
        d.schema_version as snapshot_schema
      from tree_items t join spaces s on s.id = t.space_id join page_documents d on d.item_id = t.id
      left join page_versions v on v.id = t.published_version_id
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row || row.editor) return null;
    const readable =
      row.mode === "live"
        ? migrated(row.snapshot, row.snapshot_schema)
        : row.version_schema === null
          ? null
          : migrated(row.version_document, row.version_schema);
    if (!readable) return () => false;
    const marked = new Set(extractInlineCommentThreads(readable).keys());
    return (comment) =>
      marked.has(comment.id) ||
      containsAnchor(readable, {
        exact: comment.quote ?? "",
        prefix: comment.quote_prefix ?? "",
        suffix: comment.quote_suffix ?? "",
      });
  }

  async get(viewer: Principal, commentId: string): Promise<CommentThread | Comment | null> {
    const located = await this.#database.execute<{ item_id: string; root: string }>(
      sql`select item_id, coalesce(parent_id, id) as root from comments where id = ${commentId}`,
    );
    const row = located.rows[0];
    if (!row) return null;
    const { threads } = await this.list(viewer, row.item_id);
    const thread = threads.find((candidate) => candidate.id === row.root);
    if (!thread) return null;
    return thread.id === commentId
      ? thread
      : (thread.replies.find((reply) => reply.id === commentId) ?? null);
  }

  async #lock(tx: Transaction, commentId: string): Promise<LockedComment> {
    const result = await tx.execute<{
      id: string;
      item_id: string;
      parent_id: string | null;
      author_id: string | null;
      quote: string | null;
      deleted_at: Date | string | null;
      deleted_by: string | null;
      has_body: boolean;
      space_id: string;
      organization_id: string | null;
      title: string;
    }>(sql`
      select c.id, c.item_id, c.parent_id, c.author_id, c.quote, c.deleted_at, c.deleted_by,
        c.body is not null as has_body, t.space_id,
        s.organization_id, t.title
      from comments c join tree_items t on t.id = c.item_id join spaces s on s.id = t.space_id
      where c.id = ${commentId} for update of c`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("commentNotFound", "The comment does not exist");
    return {
      id: row.id,
      itemId: row.item_id,
      parentId: row.parent_id,
      authorId: row.author_id,
      quote: row.quote,
      deletedAt: date(row.deleted_at),
      deletedBy: row.deleted_by,
      hasBody: row.has_body,
      spaceId: row.space_id,
      organizationId: row.organization_id,
      title: row.title,
    };
  }

  async #count(tx: Transaction, itemId: string): Promise<void> {
    const count = await tx.execute<{ count: string }>(
      sql`select count(*) as count from comments where item_id = ${itemId}`,
    );
    if (Number(count.rows[0]?.count ?? 0) >= MAX_COMMENTS_PER_PAGE) {
      throw new SpaceError("tooManyComments", `A page can have up to ${MAX_COMMENTS_PER_PAGE} comments`);
    }
  }

  async create(
    actor: Principal,
    itemId: string,
    input: { body: unknown; anchor?: TextAnchor | undefined },
  ): Promise<string> {
    const body = validBody(input.body);
    const actorId = actorIdOf(actor);
    const anchor = input.anchor;
    if (anchor && !isValidAnchor(anchor)) {
      throw new SpaceError(
        "invalidAnchor",
        "Select up to 1000 characters of text in one paragraph to comment on",
      );
    }
    return this.#database.transaction(async (tx) => {
      const located = await tx.execute<{ space_id: string; kind: string }>(
        sql`select space_id, kind from tree_items where id = ${itemId}`,
      );
      const item = located.rows[0];
      if (!item || (item.kind !== "page" && item.kind !== "blogPost")) {
        throw new SpaceError("itemNotFound", "The page does not exist");
      }
      await this.#count(tx, itemId);
      const id = uuidv7();
      if (!anchor) {
        await tx.execute(sql`
          insert into comments (id, item_id, author_id, body) values (${id}, ${itemId}, ${actorId}, ${JSON.stringify(body)}::jsonb)`);
      } else {
        await this.#anchor(tx, actor, itemId, id, anchor, body);
      }
      await this.#activity.commentMentions(tx, itemId, id, body, actorId);
      await signalSpaceChange(tx, { spaceId: item.space_id, kind: "comments", itemId });
      return id;
    });
  }

  async #anchor(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    id: string,
    anchor: TextAnchor,
    body: DocumentJson,
  ): Promise<void> {
    const actorId = actorIdOf(actor);
    const page = await tx.execute<{
      state: Buffer;
      mode: string;
      space_id: string;
      version_document: unknown;
      version_schema: number | null;
    }>(sql`
      select d.state, t.mode, t.space_id, v.document as version_document, v.schema_version as version_schema
      from page_documents d join tree_items t on t.id = d.item_id
      left join page_versions v on v.id = t.published_version_id
      where d.item_id = ${itemId} for update of d`);
    const row = page.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state), MERGE_ORIGIN);
    const draft = documentFromYDoc(doc) as DocumentJson;
    const readable =
      row.mode === "live"
        ? draft
        : row.version_schema === null
          ? null
          : migrated(row.version_document, row.version_schema);
    const quotePublic = readable !== null && containsAnchor(readable, anchor);
    const editor = (
      await this.#authorization.explain(actor, "item.edit", { type: "item", id: itemId }, { executor: tx })
    ).allowed;
    if (!quotePublic && !(editor && containsAnchor(draft, anchor))) {
      doc.destroy();
      throw new SpaceError("anchorNotFound", "The selected text changed in the meantime; select it again");
    }
    const marked = withInlineComment(draft, anchor, id);
    await tx.execute(sql`
      insert into comments (id, item_id, author_id, body, quote, quote_prefix, quote_suffix, quote_public, detached_at)
      values (${id}, ${itemId}, ${actorId}, ${JSON.stringify(body)}::jsonb, ${anchor.exact}, ${anchor.prefix},
        ${anchor.suffix}, ${quotePublic}, ${marked ? null : sql`now()`})`);
    if (marked) {
      applyDocument(doc, marked, API_ORIGIN);
      await this.#documents.storeLocked(tx, itemId, doc, null);
    }
    doc.destroy();
  }

  async reply(actor: Principal, commentId: string, input: { body: unknown }): Promise<string> {
    const body = validBody(input.body);
    const actorId = actorIdOf(actor);
    return this.#database.transaction(async (tx) => {
      const parent = await this.#lock(tx, commentId);
      const rootId = parent.parentId ?? parent.id;
      await this.#count(tx, parent.itemId);
      const id = uuidv7();
      await tx.execute(sql`
        insert into comments (id, item_id, parent_id, author_id, body)
        values (${id}, ${parent.itemId}, ${rootId}, ${actorId}, ${JSON.stringify(body)}::jsonb)`);
      await this.#activity.commentMentions(tx, parent.itemId, id, body, actorId);
      await signalSpaceChange(tx, { spaceId: parent.spaceId, kind: "comments", itemId: parent.itemId });
      return id;
    });
  }

  async update(actor: Principal, commentId: string, input: { body: unknown }): Promise<void> {
    const body = validBody(input.body);
    await this.#database.transaction(async (tx) => {
      const comment = await this.#lock(tx, commentId);
      if (comment.deletedAt) throw new SpaceError("commentNotFound", "The comment does not exist");
      await tx.execute(sql`
        update comments set body = ${JSON.stringify(body)}::jsonb, edited_at = now(), updated_at = now()
        where id = ${commentId}`);
      await this.#activity.commentMentions(tx, comment.itemId, commentId, body, actorIdOf(actor));
      await signalSpaceChange(tx, { spaceId: comment.spaceId, kind: "comments", itemId: comment.itemId });
    });
  }

  async delete(actor: Principal, commentId: string): Promise<void> {
    const actorId = actorIdOf(actor);
    await this.#database.transaction(async (tx) => {
      const comment = await this.#lock(tx, commentId);
      if (comment.deletedAt) return;
      await tx.execute(sql`
        update comments set deleted_at = now(), deleted_by = ${actorId}, updated_at = now()
        where id = ${commentId}`);
      await tx.execute(
        sql`delete from content_mentions where comment_id = ${commentId} and notified_at is null`,
      );
      if (actorId !== comment.authorId) {
        await this.#audit.record(tx, {
          name: "comment.deletedByModerator",
          actor,
          targetId: comment.itemId,
          fields: {
            spaceId: comment.spaceId,
            title: comment.title,
            commentId,
            authorId: comment.authorId,
          },
          scope: auditScopeOf(comment),
        });
      }
      await signalSpaceChange(tx, { spaceId: comment.spaceId, kind: "comments", itemId: comment.itemId });
    });
  }

  async restore(actor: Principal, commentId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const comment = await this.#lock(tx, commentId);
      if (!comment.deletedAt || !comment.hasBody || comment.deletedBy !== actorIdOf(actor)) {
        throw new SpaceError("commentNotFound", "The comment does not exist");
      }
      if (comment.deletedAt.getTime() < Date.now() - COMMENT_RESTORE_MINUTES * 60_000) {
        throw new SpaceError("restoreExpired", "A deleted comment can be restored within an hour");
      }
      await tx.execute(sql`
        update comments set deleted_at = null, deleted_by = null, updated_at = now() where id = ${commentId}`);
      await signalSpaceChange(tx, { spaceId: comment.spaceId, kind: "comments", itemId: comment.itemId });
    });
  }

  async resolve(actor: Principal, commentId: string, resolved: boolean): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const comment = await this.#lock(tx, commentId);
      if (comment.parentId !== null || comment.quote === null) {
        throw new SpaceError("notInlineComment", "Only inline comments can be resolved");
      }
      await tx.execute(sql`
        update comments set resolved_at = ${resolved ? sql`coalesce(resolved_at, now())` : null},
          resolved_by = ${resolved ? actorIdOf(actor) : null}, updated_at = now()
        where id = ${commentId}`);
      await signalSpaceChange(tx, { spaceId: comment.spaceId, kind: "comments", itemId: comment.itemId });
    });
  }

  async removeDeletedBodies(): Promise<number> {
    const result = await this.#database.execute(sql`
      update comments set body = null
      where deleted_at < now() - make_interval(mins => ${COMMENT_RESTORE_MINUTES}) and body is not null`);
    return result.rowCount ?? 0;
  }

  async mentionAccess(
    viewer: Principal,
    itemId: string,
    accountIds: string[],
  ): Promise<{ accountId: string; hasAccess: boolean }[]> {
    const visible = await this.#people.visibleNames(viewer, accountIds.slice(0, MAX_MENTION_CHECKS));
    const access: { accountId: string; hasAccess: boolean }[] = [];
    for (const accountId of visible.keys()) {
      const decision = await this.#authorization.explain(accountPrincipal(accountId), "item.view", {
        type: "item",
        id: itemId,
      });
      access.push({ accountId, hasAccess: decision.allowed });
    }
    return access;
  }

  async itemOf(commentId: string): Promise<string | null> {
    const result = await this.#database.execute<{ item_id: string }>(
      sql`select item_id from comments where id = ${commentId}`,
    );
    return result.rows[0]?.item_id ?? null;
  }
}
