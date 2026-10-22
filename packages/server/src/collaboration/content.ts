import {
  type DocumentJson,
  editorSchemaVersion,
  extractDecisions,
  extractInlineCommentThreads,
  extractMentions,
  extractTasks,
  extractTopicUpdates,
  migrateDocument,
  type NodeJson,
  normalizeDecisionIds,
  normalizeTaskIds,
} from "@lunedo/editor-schema";
import { uuidv7 } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { ChatChannelService } from "../chat/channels.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { ReviewService } from "../knowledge-bases/reviews.js";
import type { NotificationService } from "../notifications/service.js";
import type { WatchService } from "../notifications/watches.js";
import { syncReusableContent } from "../spaces/properties.js";
import { signalSpaceChange } from "../spaces/signals.js";

function idsOf(type: string, node: NodeJson, ids: Set<string> = new Set()): Set<string> {
  if (node.type === type && typeof node.attrs?.id === "string") ids.add(node.attrs.id);
  for (const child of node.content ?? []) idsOf(type, child, ids);
  return ids;
}

type Normalize = (
  doc: DocumentJson,
  options: { newId: () => string; taken?: (id: string) => boolean },
) => DocumentJson | null;

async function claimIds(
  tx: Transaction,
  itemId: string,
  document: DocumentJson,
  kind: { node: string; table: SQL; normalize: Normalize },
): Promise<DocumentJson | null> {
  const takenElsewhere = async (ids: string[]) => {
    if (ids.length === 0) return new Set<string>();
    const taken = await tx.execute<{ id: string }>(sql`
      select id from ${kind.table} where id = any(${sql.param(ids)}::uuid[]) and item_id <> ${itemId}`);
    return new Set(taken.rows.map((row) => row.id));
  };
  let taken = await takenElsewhere([...idsOf(kind.node, document)]);
  let current = kind.normalize(document, { newId: uuidv7, taken: (id) => taken.has(id) }) ?? document;
  const ids = [...idsOf(kind.node, current)];
  if (ids.length > 0) {
    await tx.execute(sql`
      insert into ${kind.table} (id, item_id) select unnest(${sql.param(ids)}::uuid[]), ${itemId}
      on conflict (id) do nothing`);
    taken = await takenElsewhere(ids);
    if (taken.size > 0) {
      current = kind.normalize(current, { newId: uuidv7, taken: (id) => taken.has(id) }) ?? current;
      const fresh = [...idsOf(kind.node, current)].filter((id) => !ids.includes(id));
      await tx.execute(sql`
        insert into ${kind.table} (id, item_id) select unnest(${sql.param(fresh)}::uuid[]), ${itemId}
        on conflict (id) do nothing`);
    }
  }
  return current === document ? null : current;
}

export async function claimTaskIds(
  tx: Transaction,
  itemId: string,
  document: DocumentJson,
): Promise<DocumentJson | null> {
  const tasks = await claimIds(tx, itemId, document, {
    node: "taskItem",
    table: sql`tasks`,
    normalize: normalizeTaskIds,
  });
  const decisions = await claimIds(tx, itemId, tasks ?? document, {
    node: "decision",
    table: sql`decisions`,
    normalize: normalizeDecisionIds,
  });
  return decisions ?? tasks;
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

export async function syncDecisions(
  tx: Transaction,
  itemId: string,
  document: DocumentJson,
): Promise<string[]> {
  const decisions = extractDecisions(document);
  const ids = decisions.map((decision) => decision.id);
  let published: string[] = [];
  if (decisions.length > 0) {
    await tx.execute(sql`
      insert into decisions (id, item_id) select unnest(${sql.param(ids)}::uuid[]), ${itemId}
      on conflict (id) do nothing`);
    const hidden = await tx.execute<{ id: string }>(sql`
      select id from decisions where id = any(${sql.param(ids)}::uuid[]) and item_id = ${itemId} and not published`);
    published = hidden.rows.map((row) => row.id);
    await tx.execute(sql`
      update decisions d set published = true, topic_id = topic.id, statement = s.statement, text = s.text,
        position = s.position, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(decisions)}::jsonb)
        as s(id uuid, "topicId" uuid, statement jsonb, text text, position int)
      left join tree_items topic on topic.id = s."topicId" and topic.kind = 'meetingTopic'
      where d.id = s.id and d.item_id = ${itemId}`);
  }
  await tx.execute(sql`
    update decisions set published = false, updated_at = now()
    where item_id = ${itemId} and published and not (id = any(${sql.param(ids)}::uuid[]))`);
  return published;
}

async function syncTopicUpdates(tx: Transaction, itemId: string, document: DocumentJson): Promise<void> {
  const meeting = await tx.execute<{ series_id: string }>(
    sql`select series_id from meetings where item_id = ${itemId}`,
  );
  const seriesId = meeting.rows[0]?.series_id;
  if (!seriesId) return;
  const updates = extractTopicUpdates(document).filter((update) =>
    update.content.some((node) => node.type !== "paragraph" || (node.content ?? []).length > 0),
  );
  const topics = updates.map((update) => update.topicId);
  if (updates.length > 0) {
    await tx.execute(sql`
      insert into meeting_topic_updates (topic_id, item_id, content, text, position)
      select s."topicId", ${itemId}, s.content, s.text, s.position
      from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        as s("topicId" uuid, content jsonb, text text, position int)
      join meeting_topics mt on mt.item_id = s."topicId" and mt.series_id = ${seriesId}
      on conflict (topic_id, item_id) do update set content = excluded.content, text = excluded.text,
        position = excluded.position, updated_at = now()
      where meeting_topic_updates.content is distinct from excluded.content
        or meeting_topic_updates.position is distinct from excluded.position`);
  }
  await tx.execute(sql`
    delete from meeting_topic_updates
    where item_id = ${itemId} and not (topic_id = any(${sql.param(topics)}::uuid[]))`);
  await tx.execute(sql`
    update meeting_topics mt set last_update_at = (
      select max(u.updated_at) from meeting_topic_updates u join meetings m on m.item_id = u.item_id
      where u.topic_id = mt.item_id and m.state <> 'skipped')
    where mt.series_id = ${seriesId}`);
}

export async function publishTasks(
  tx: Transaction,
  itemId: string,
  document: DocumentJson,
  actorId: string | null = null,
): Promise<void> {
  const tasks = extractTasks(document);
  const ids = tasks.map((task) => task.id);
  if (tasks.length > 0) {
    await tx.execute(sql`
      insert into tasks (id, item_id) select unnest(${sql.param(ids)}::uuid[]), ${itemId}
      on conflict (id) do nothing`);
    await tx.execute(sql`
      update tasks k set published = true, assignee_id = coalesce(a.merged_into_id, a.id), due_date = s."dueDate"::date, text = s.text,
        position = s.position, updated_at = now(),
        assigned_by_id = case when k.assignee_id is distinct from coalesce(a.merged_into_id, a.id)
          or k.notified_assignee_id is distinct from coalesce(a.merged_into_id, a.id)
          then ${actorId} else k.assigned_by_id end
      from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb)
        as s(id uuid, assignee uuid, "dueDate" text, text text, position int)
      left join accounts a on a.id = s.assignee
      where k.id = s.id and k.item_id = ${itemId}`);
  }
  await tx.execute(sql`
    update tasks set published = false, updated_at = now()
    where item_id = ${itemId} and published and not (id = any(${sql.param(ids)}::uuid[]))`);
}

interface ItemFacts {
  title: string;
  kind: "page" | "blogPost" | "meetingTopic" | "whiteboard";
  spaceId: string;
  spaceKey: string;
  organizationId: string | null;
}

export class ContentActivity {
  readonly #database: Database;
  readonly #notifications: NotificationService;
  readonly #authorization: AuthorizationService;
  readonly #watches: WatchService;
  #chat: ChatChannelService | undefined;
  #reviews: ReviewService | undefined;

  constructor(options: {
    database: Database;
    notifications: NotificationService;
    authorization: AuthorizationService;
    watches: WatchService;
  }) {
    this.#database = options.database;
    this.#notifications = options.notifications;
    this.#authorization = options.authorization;
    this.#watches = options.watches;
  }

  useChat(chat: ChatChannelService): void {
    this.#chat = chat;
  }

  useReviews(reviews: ReviewService): void {
    this.#reviews = reviews;
  }

  async revealed(tx: Transaction, itemIds: readonly string[]): Promise<void> {
    if (itemIds.length > 0) await this.deliver(tx, itemIds);
  }

  async readerContentChanged(
    tx: Transaction,
    itemId: string,
    document: DocumentJson,
    actorId: string | null,
    notify = true,
  ): Promise<void> {
    await publishTasks(tx, itemId, document, actorId);
    const decided = await syncDecisions(tx, itemId, document);
    if (notify) await this.#chat?.decisionsRecorded(tx, itemId, decided);
    await syncTopicUpdates(tx, itemId, document);
    await syncReusableContent(tx, itemId, document);
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
        select m.id, ${itemId}, coalesce(a.merged_into_id, a.id), ${actorId}
        from unnest(${sql.param(mentioned.map(() => uuidv7()))}::uuid[], ${sql.param(mentioned)}::uuid[]) as m(id, account_id)
        join accounts a on a.id = m.account_id
        on conflict do nothing`);
    }
    await tx.execute(sql`
      delete from content_mentions where item_id = ${itemId} and comment_id is null and notified_at is null
        and not (account_id = any(select coalesce(a.merged_into_id, a.id) from accounts a
          where a.id = any(${sql.param(mentioned)}::uuid[])))`);
    if (notify) await this.deliver(tx, [itemId]);
  }

  async commentMentions(
    tx: Transaction,
    itemId: string,
    commentId: string,
    body: DocumentJson,
    actorId: string | null,
  ): Promise<string[]> {
    const mentioned = extractMentions(body).filter((id) => id !== actorId);
    if (mentioned.length > 0) {
      await tx.execute(sql`
        insert into content_mentions (id, item_id, comment_id, account_id, actor_id)
        select m.id, ${itemId}, ${commentId}, coalesce(a.merged_into_id, a.id), ${actorId}
        from unnest(${sql.param(mentioned.map(() => uuidv7()))}::uuid[], ${sql.param(mentioned)}::uuid[]) as m(id, account_id)
        join accounts a on a.id = m.account_id
        on conflict do nothing`);
    }
    await tx.execute(sql`
      delete from content_mentions where comment_id = ${commentId} and notified_at is null
        and not (account_id = any(select coalesce(a.merged_into_id, a.id) from accounts a
          where a.id = any(${sql.param(mentioned)}::uuid[])))`);
    await this.deliver(tx, [itemId]);
    return mentioned;
  }

  async created(tx: Transaction, itemId: string, actorId: string | null): Promise<void> {
    await this.#watches.watchAutomatically(tx, [actorId], itemId);
  }

  async #readable(tx: Transaction, itemId: string): Promise<ItemFacts | null> {
    const shown = await tx.execute<{ shown: boolean }>(sql`
      select t.reader_visible and t.trash_entry_id is null as shown from tree_items t where t.id = ${itemId}`);
    if (!shown.rows[0]?.shown) return null;
    return this.#facts(tx, itemId);
  }

  async versionCreated(tx: Transaction, itemId: string, version: number): Promise<void> {
    const created = await tx.execute<{ created_by: string | null; contributors: string[] }>(sql`
      select created_by, contributors from page_versions where item_id = ${itemId} and number = ${version}
      union all
      select created_by, contributors from whiteboard_versions where item_id = ${itemId} and number = ${version}`);
    const row = created.rows[0];
    if (!row) return;
    const actorId = row.created_by;
    const actors = [...new Set([...(actorId ? [actorId] : []), ...row.contributors])];
    await this.#watches.watchAutomatically(tx, actors, itemId);
    await this.#reviews?.sourceChanged(tx, itemId);
    const item = await this.#readable(tx, itemId);
    if (!item) return;
    await this.#chat?.versionCreated(tx, itemId, version, actorId ?? actors[0] ?? null);
    const recipients = await this.#watches.audience(tx, itemId);
    if (recipients.length === 0) return;
    const actor = actorId ?? actors[0] ?? null;
    await this.#notifications.notify(tx, {
      type: "content.changed",
      recipients,
      organizationId: item.organizationId,
      targetId: itemId,
      actor: actor ? accountPrincipal(actor) : null,
      contributors: actors,
      params: { itemTitle: item.title, itemKind: item.kind, spaceKey: item.spaceKey, version },
    });
  }

  async commented(
    tx: Transaction,
    itemId: string,
    commentId: string,
    actorId: string | null,
    mentioned: readonly string[],
  ): Promise<void> {
    await this.#watches.watchAutomatically(tx, [actorId], itemId);
    await this.#chat?.commented(tx, itemId, commentId, actorId);
    const item = await this.#facts(tx, itemId);
    if (!item) return;
    const recipients = await this.#watches.audience(tx, itemId, {
      exclude: mentioned,
      action: { name: "comment.view", resource: { type: "comment", id: commentId } },
    });
    if (recipients.length === 0) return;
    await this.#notifications.notify(tx, {
      type: "comment.created",
      recipients,
      organizationId: item.organizationId,
      targetId: itemId,
      actor: actorId ? accountPrincipal(actorId) : null,
      params: { itemTitle: item.title, itemKind: item.kind, spaceKey: item.spaceKey, commentId },
    });
  }

  async statusChanged(
    tx: Transaction,
    itemId: string,
    input: { actorId: string | null; status: { builtIn: string | null; name: string | null } | null },
  ): Promise<void> {
    const item = await this.#readable(tx, itemId);
    if (!item) return;
    await this.#chat?.contentEvent(tx, "pageStatusChanged", itemId, {
      actorId: input.actorId,
      data: { statusBuiltIn: input.status?.builtIn ?? null, statusName: input.status?.name ?? null },
    });
    const recipients = await this.#watches.audience(tx, itemId);
    if (recipients.length === 0) return;
    await this.#notifications.notify(tx, {
      type: "page.statusChanged",
      recipients,
      organizationId: item.organizationId,
      targetId: itemId,
      actor: input.actorId ? accountPrincipal(input.actorId) : null,
      params: {
        itemTitle: item.title,
        itemKind: item.kind,
        spaceKey: item.spaceKey,
        statusBuiltIn: input.status?.builtIn ?? null,
        statusName: input.status?.name ?? null,
      },
    });
  }

  async ownerChanged(
    tx: Transaction,
    itemId: string,
    input: { actorId: string | null; ownerId: string },
  ): Promise<void> {
    await this.#watches.watchAutomatically(tx, [input.ownerId], itemId);
    const item = await this.#facts(tx, itemId);
    if (!item) return;
    const watchers = await this.#watches.audience(tx, itemId);
    const owner = (await this.#may(tx, input.ownerId, "item.view", { type: "item", id: itemId }))
      ? [input.ownerId]
      : [];
    const recipients = [...new Set([...owner, ...watchers])];
    if (recipients.length === 0) return;
    await this.#notifications.notify(tx, {
      type: "ownership.transferred",
      recipients,
      organizationId: item.organizationId,
      targetId: itemId,
      actor: input.actorId ? accountPrincipal(input.actorId) : null,
      params: {
        itemTitle: item.title,
        itemKind: item.kind,
        spaceKey: item.spaceKey,
        ownerId: input.ownerId,
      },
    });
  }

  async #facts(executor: Executor, itemId: string): Promise<ItemFacts | null> {
    const result = await executor.execute<{
      title: string;
      kind: "page" | "blogPost" | "meetingTopic" | "whiteboard";
      space_id: string;
      key: string;
      organization_id: string | null;
    }>(sql`
      select t.title, t.kind, t.space_id, s.key, s.organization_id
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind in ('page', 'blogPost', 'meetingTopic', 'whiteboard')`);
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
      assigned_by_id: string | null;
      text: string;
      due_date: string | null;
    }>(sql`
      select k.id, k.item_id, k.assignee_id, k.assigned_by_id, k.text, k.due_date::text as due_date from tasks k
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
        actor: task.assigned_by_id ? accountPrincipal(task.assigned_by_id) : null,
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
