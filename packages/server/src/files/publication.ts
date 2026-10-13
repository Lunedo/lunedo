import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

const DRAFT_VERSION = sql`case when a.deleted_at is null then a.current_version_id end`;

export interface DiscardedAttachment {
  attachmentId: string;
  versionId: string | null;
  deleted: boolean;
}

export async function publishAttachments(executor: Executor, itemId: string): Promise<void> {
  await executor.execute(sql`
    update attachment_versions v set published_at = now(), updated_at = now()
    from attachments a
    where a.item_id = ${itemId} and a.deleted_at is null and v.id = a.current_version_id and v.published_at is null`);
  await executor.execute(sql`
    update attachments a set published_version_id = ${DRAFT_VERSION}, updated_at = now()
    where a.item_id = ${itemId} and a.published_version_id is distinct from ${DRAFT_VERSION}`);
}

export async function attachmentDraftChanges(executor: Executor, itemId: string): Promise<number> {
  const result = await executor.execute<{ count: string | number }>(sql`
    select count(*) as count from attachments a
    where a.item_id = ${itemId} and a.published_version_id is distinct from ${DRAFT_VERSION}`);
  return Number(result.rows[0]?.count ?? 0);
}

export async function discardAttachments(
  executor: Executor,
  itemId: string,
  discardedDraftId: string,
  actorId: string | null,
): Promise<void> {
  const changed = await executor.execute<{
    id: string;
    current_version_id: string | null;
    deleted: boolean;
  }>(sql`
    select a.id, a.current_version_id, a.deleted_at is not null as deleted from attachments a
    where a.item_id = ${itemId} and a.published_version_id is not null
      and a.published_version_id is distinct from ${DRAFT_VERSION}
    order by a.id`);
  const recorded: DiscardedAttachment[] = changed.rows.map((row) => ({
    attachmentId: row.id,
    versionId: row.current_version_id,
    deleted: row.deleted,
  }));
  await executor.execute(sql`
    update discarded_drafts set attachments = ${JSON.stringify(recorded)}::jsonb where id = ${discardedDraftId}`);
  const hidden = await executor.execute<{ id: string }>(sql`
    update attachments set deleted_at = now(), deleted_by = ${actorId}, discarded_draft_id = ${discardedDraftId},
      updated_at = now()
    where item_id = ${itemId} and deleted_at is null and published_version_id is null
    returning id`);
  if (hidden.rows.length > 0) {
    await executor.execute(sql`
      update blog_posts set cover_attachment_id = null
      where cover_attachment_id = any(${sql.param(hidden.rows.map((row) => row.id))}::uuid[])`);
  }
  await executor.execute(sql`
    update attachments a set current_version_id = a.published_version_id,
      name = (select v.name from attachment_versions v where v.id = a.published_version_id),
      deleted_at = null, deleted_by = null, updated_at = now()
    where a.item_id = ${itemId} and a.published_version_id is not null
      and a.published_version_id is distinct from ${DRAFT_VERSION}`);
}

export async function restoreDiscardedAttachments(
  executor: Executor,
  itemId: string,
  discardedDraftId: string,
  actorId: string | null,
): Promise<void> {
  await executor.execute(sql`
    update attachments a set deleted_at = null, deleted_by = null, discarded_draft_id = null, updated_at = now()
    where a.discarded_draft_id = ${discardedDraftId} and a.item_id = ${itemId}
      and not exists (
        select 1 from attachments b
        where b.item_id = a.item_id and b.name_key = a.name_key and b.deleted_at is null)`);
  await executor.execute(sql`
    update attachments set discarded_draft_id = null where discarded_draft_id = ${discardedDraftId}`);
  const found = await executor.execute<{ attachments: DiscardedAttachment[] }>(
    sql`select attachments from discarded_drafts where id = ${discardedDraftId}`,
  );
  for (const recorded of found.rows[0]?.attachments ?? []) {
    await executor.execute(sql`
      update attachments a set
        current_version_id = coalesce(
          (select v.id from attachment_versions v where v.id = ${recorded.versionId} and v.attachment_id = a.id),
          a.current_version_id),
        deleted_at = ${recorded.deleted ? sql`now()` : sql`null`},
        deleted_by = ${recorded.deleted ? actorId : null}, updated_at = now()
      where a.id = ${recorded.attachmentId} and a.item_id = ${itemId} and a.published_version_id is not null
        and a.published_version_id is not distinct from ${DRAFT_VERSION}`);
    await executor.execute(sql`
      update attachments a set name = v.name from attachment_versions v
      where a.id = ${recorded.attachmentId} and v.id = a.current_version_id and a.name <> v.name`);
    if (recorded.deleted) {
      await executor.execute(
        sql`update blog_posts set cover_attachment_id = null where cover_attachment_id = ${recorded.attachmentId}`,
      );
    }
  }
}
