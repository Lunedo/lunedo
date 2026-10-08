import {
  type DocumentJson,
  editorSchemaVersion,
  extractInlineCommentThreads,
  extractMentions,
  extractTasks,
  migrateDocument,
  type NodeJson,
  normalizeTaskIds,
} from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { accountPrincipal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { signalSpaceChange } from "../spaces/signals.js";

function taskIds(node: NodeJson, ids: Set<string> = new Set()): Set<string> {
  if (node.type === "taskItem" && typeof node.attrs?.id === "string") ids.add(node.attrs.id);
  for (const child of node.content ?? []) taskIds(child, ids);
  return ids;
}

export async function claimTaskIds(
  tx: Transaction,
  itemId: string,
  document: DocumentJson,
): Promise<DocumentJson | null> {
  const takenElsewhere = async (ids: string[]) => {
    if (ids.length === 0) return new Set<string>();
    const taken = await tx.execute<{ id: string }>(sql`
      select id from tasks where id = any(${sql.param(ids)}::uuid[]) and item_id <> ${itemId}`);
    return new Set(taken.rows.map((row) => row.id));
  };
  let taken = await takenElsewhere([...taskIds(document)]);
  let current = normalizeTaskIds(document, { newId: uuidv7, taken: (id) => taken.has(id) }) ?? document;
  const ids = [...taskIds(current)];
  if (ids.length > 0) {
    await tx.execute(sql`
      insert into tasks (id, item_id) select unnest(${sql.param(ids)}::uuid[]), ${itemId}
      on conflict (id) do nothing`);
    taken = await takenElsewhere(ids);
    if (taken.size > 0) {
      current = normalizeTaskIds(current, { newId: uuidv7, taken: (id) => taken.has(id) }) ?? current;
      const fresh = [...taskIds(current)].filter((id) => !ids.includes(id));
      await tx.execute(sql`
        insert into tasks (id, item_id) select unnest(${sql.param(fresh)}::uuid[]), ${itemId}
        on conflict (id) do nothing`);
    }
  }
  return current === document ? null : current;
}

async function publishedThreads(executor: Executor, itemId: string): Promise<Set<string>> {
  const result = await executor.execute<{
    mode: string;
    document: unknown;
    schema_version: number | null;
  }>(sql`
    select t.mode, v.document, v.schema_version from tree_items t
    left join page_versions v on v.id = t.published_version_id where t.id = ${itemId}`);
  const row = result.rows[0];
  if (row?.mode !== "publish" || row.schema_version === null) return new Set();
  return new Set(
    extractInlineCommentThreads(
      row.schema_version < editorSchemaVersion
        ? migrateDocument(row.document as DocumentJson, row.schema_version)
        : (row.document as DocumentJson),
    ).keys(),
  );
}

export async function syncCommentAnchors(
  tx: Transaction,
  itemId: string,
  current: DocumentJson,
): Promise<void> {
  const roots = await tx.execute<{ id: string; detached: boolean; space_id: string }>(sql`
    select c.id, c.detached_at is not null as detached, t.space_id
    from comments c join tree_items t on t.id = c.item_id
    where c.item_id = ${itemId} and c.parent_id is null and c.quote is not null`);
  if (roots.rows.length === 0) return;
  const anchored = new Set([
    ...extractInlineCommentThreads(current).keys(),
    ...(await publishedThreads(tx, itemId)),
  ]);
  const detach = roots.rows.filter((row) => !row.detached && !anchored.has(row.id)).map((row) => row.id);
  const attach = roots.rows.filter((row) => row.detached && anchored.has(row.id)).map((row) => row.id);
  if (detach.length > 0) {
    await tx.execute(
      sql`update comments set detached_at = now() where id = any(${sql.param(detach)}::uuid[])`,
    );
  }
  if (attach.length > 0) {
    await tx.execute(
      sql`update comments set detached_at = null where id = any(${sql.param(attach)}::uuid[])`,
    );
  }
  const spaceId = roots.rows[0]?.space_id;
  if (spaceId && detach.length + attach.length > 0) {
    await signalSpaceChange(tx, { spaceId, kind: "comments", itemId });
  }
}

interface ItemFacts {
  title: string;
  kind: "page" | "blogPost";
  spaceId: string;
  spaceKey: string;
  organizationId: string | null;
}

export class ContentActivity {
  readonly #database: Database;
  readonly #notifications: NotificationService;
  readonly #authorization: AuthorizationService;

  constructor(options: {
    database: Database;
    notifications: NotificationService;
    authorization: AuthorizationService;
  }) {
    this.#database = options.database;
    this.#notifications = options.notifications;
    this.#authorization = options.authorization;
  }

  async revealed(tx: Transaction, itemIds: readonly string[]): Promise<void> {
    if (itemIds.length > 0) await this.deliver(tx, itemIds);
  }

  async readerContentChanged(
    tx: Transaction,
    itemId: string,
    document: DocumentJson,
    actorId: string | null,
  ): Promise<void> {
    const tasks = extractTasks(document);
    const ids = tasks.map((task) => task.id);
    if (tasks.length > 0) {
      await tx.execute(sql`
        insert into tasks (id, item_id) select unnest(${sql.param(ids)}::uuid[]), ${itemId}
        on conflict (id) do nothing`);
      await tx.execute(sql`
        update tasks k set published = true, assignee_id = a.id, due_date = s."dueDate"::date, text = s.text,
          position = s.position, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb)
          as s(id uuid, assignee uuid, "dueDate" text, text text, position int)
        left join accounts a on a.id = s.assignee
        where k.id = s.id and k.item_id = ${itemId}`);
    }
    await tx.execute(sql`
      update tasks set published = false, updated_at = now()
      where item_id = ${itemId} and published and not (id = any(${sql.param(ids)}::uuid[]))`);
    const threads = [...extractInlineCommentThreads(document).keys()];
    if (threads.length > 0) {
      await tx.execute(sql`
        update comments set quote_public = true
        where item_id = ${itemId} and id = any(${sql.param(threads)}::uuid[]) and not quote_public`);
    }
    const mentioned = extractMentions(document);
    if (mentioned.length > 0) {
      await tx.execute(sql`
        insert into content_mentions (id, item_id, account_id, actor_id)
        select m.id, ${itemId}, a.id, ${actorId}
        from unnest(${sql.param(mentioned.map(() => uuidv7()))}::uuid[], ${sql.param(mentioned)}::uuid[]) as m(id, account_id)
        join accounts a on a.id = m.account_id
        on conflict do nothing`);
    }
    await tx.execute(sql`
      delete from content_mentions where item_id = ${itemId} and comment_id is null and notified_at is null
        and not (account_id = any(${sql.param(mentioned)}::uuid[]))`);
    await this.deliver(tx, [itemId]);
  }

  async commentMentions(
    tx: Transaction,
    itemId: string,
    commentId: string,
    body: DocumentJson,
    actorId: string | null,
  ): Promise<void> {
    const mentioned = extractMentions(body).filter((id) => id !== actorId);
    if (mentioned.length > 0) {
      await tx.execute(sql`
        insert into content_mentions (id, item_id, comment_id, account_id, actor_id)
        select m.id, ${itemId}, ${commentId}, a.id, ${actorId}
        from unnest(${sql.param(mentioned.map(() => uuidv7()))}::uuid[], ${sql.param(mentioned)}::uuid[]) as m(id, account_id)
        join accounts a on a.id = m.account_id
        on conflict do nothing`);
    }
    await tx.execute(sql`
      delete from content_mentions where comment_id = ${commentId} and notified_at is null
        and not (account_id = any(${sql.param(mentioned)}::uuid[]))`);
    await this.deliver(tx, [itemId]);
  }

  async #facts(executor: Executor, itemId: string): Promise<ItemFacts | null> {
    const result = await executor.execute<{
      title: string;
      kind: "page" | "blogPost";
      space_id: string;
      key: string;
      organization_id: string | null;
    }>(sql`
      select t.title, t.kind, t.space_id, s.key, s.organization_id
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    return row
      ? {
          title: row.title,
          kind: row.kind,
          spaceId: row.space_id,
          spaceKey: row.key,
          organizationId: row.organization_id,
        }
      : null;
  }

  async #may(tx: Transaction, accountId: string, action: string, resource: { type: string; id: string }) {
    return (
      await this.#authorization.explain(accountPrincipal(accountId), action, resource, { executor: tx })
    ).allowed;
  }

  async deliver(tx: Transaction, itemIds: readonly string[]): Promise<number> {
    const items = sql`${sql.param([...itemIds])}::uuid[]`;
    const mentions = await tx.execute<{
      id: string;
      item_id: string;
      comment_id: string | null;
      account_id: string;
      actor_id: string | null;
    }>(sql`
      select m.id, m.item_id, m.comment_id, m.account_id, m.actor_id from content_mentions m
      join tree_items t on t.id = m.item_id
      where m.notified_at is null and t.trash_entry_id is null
        and (m.comment_id is not null or t.reader_visible)
        and m.item_id = any(${items})
      order by m.created_at
      for update of m`);
    const assignments = await tx.execute<{
      id: string;
      item_id: string;
      assignee_id: string;
      text: string;
      due_date: string | null;
    }>(sql`
      select k.id, k.item_id, k.assignee_id, k.text, k.due_date::text as due_date from tasks k
      join tree_items t on t.id = k.item_id
      where k.published and k.assignee_id is not null
        and k.notified_assignee_id is distinct from k.assignee_id and t.trash_entry_id is null and t.reader_visible
        and k.item_id = any(${items})
      order by k.updated_at
      for update of k`);
    const facts = new Map<string, ItemFacts | null>();
    const factsOf = async (id: string) => {
      if (!facts.has(id)) facts.set(id, await this.#facts(tx, id));
      return facts.get(id) ?? null;
    };
    let delivered = 0;
    for (const mention of mentions.rows) {
      await tx.execute(sql`update content_mentions set notified_at = now() where id = ${mention.id}`);
      const item = await factsOf(mention.item_id);
      if (
        !item ||
        !(await this.#may(tx, mention.account_id, "item.view", { type: "item", id: mention.item_id }))
      ) {
        continue;
      }
      if (
        mention.comment_id &&
        !(await this.#may(tx, mention.account_id, "comment.view", {
          type: "comment",
          id: mention.comment_id,
        }))
      ) {
        continue;
      }
      await this.#notifications.notify(tx, {
        type: "content.mentioned",
        recipients: [mention.account_id],
        organizationId: item.organizationId,
        targetId: mention.item_id,
        actor: mention.actor_id ? accountPrincipal(mention.actor_id) : null,
        params: {
          itemTitle: item.title,
          itemKind: item.kind,
          spaceKey: item.spaceKey,
          commentId: mention.comment_id,
        },
      });
      delivered += 1;
    }
    for (const task of assignments.rows) {
      await tx.execute(sql`update tasks set notified_assignee_id = assignee_id where id = ${task.id}`);
      const item = await factsOf(task.item_id);
      if (
        !item ||
        !(await this.#may(tx, task.assignee_id, "item.view", { type: "item", id: task.item_id }))
      ) {
        continue;
      }
      await this.#notifications.notify(tx, {
        type: "task.assigned",
        recipients: [task.assignee_id],
        organizationId: item.organizationId,
        targetId: task.item_id,
        params: {
          itemTitle: item.title,
          itemKind: item.kind,
          spaceKey: item.spaceKey,
          taskId: task.id,
          taskText: task.text,
          dueDate: task.due_date,
        },
      });
      delivered += 1;
    }
    return delivered;
  }
}
