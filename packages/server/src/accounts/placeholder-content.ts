import { sql } from "drizzle-orm";
import type { Transaction } from "../database/database.js";

export interface MovedContent {
  readonly items: number;
  readonly comments: number;
  readonly mentions: number;
  readonly tasks: number;
  readonly reactions: number;
  readonly restrictions: number;
  readonly spaceRoles: number;
}

const SHARE_ROLES = sql`array['reader', 'commenter', 'editor']`;
const SPACE_ROLES = sql`array['reader', 'commenter', 'editor', 'admin']`;

export async function movePlaceholderContent(
  tx: Transaction,
  placeholderId: string,
  accountId: string,
): Promise<MovedContent> {
  const from = sql`${placeholderId}::uuid`;
  const to = sql`${accountId}::uuid`;
  const items = await tx.execute(sql`update tree_items set creator_id = ${to} where creator_id = ${from}`);
  await tx.execute(sql`update tree_items set owner_id = ${to} where owner_id = ${from}`);
  await tx.execute(sql`update page_documents set updated_by = ${to} where updated_by = ${from}`);
  await tx.execute(sql`update page_versions set created_by = ${to} where created_by = ${from}`);
  await tx.execute(sql`
    update page_versions set contributors = array(
      select distinct unnest(array_replace(contributors, ${from}, ${to})))
    where ${from} = any(contributors)`);
  await tx.execute(sql`update attachments set created_by = ${to} where created_by = ${from}`);
  await tx.execute(sql`update attachment_versions set uploaded_by = ${to} where uploaded_by = ${from}`);
  await tx.execute(sql`update page_labels set created_by = ${to} where created_by = ${from}`);
  const comments = await tx.execute(sql`update comments set author_id = ${to} where author_id = ${from}`);
  await tx.execute(sql`update comments set resolved_by = ${to} where resolved_by = ${from}`);
  await tx.execute(sql`update comments set deleted_by = ${to} where deleted_by = ${from}`);
  await tx.execute(sql`
    delete from reactions r where r.account_id = ${from} and exists (
      select 1 from reactions o where o.account_id = ${to} and o.item_id = r.item_id
        and o.comment_id is not distinct from r.comment_id and o.emoji = r.emoji)`);
  const reactions = await tx.execute(sql`update reactions set account_id = ${to} where account_id = ${from}`);
  await tx.execute(sql`
    delete from content_mentions m where m.account_id = ${from} and exists (
      select 1 from content_mentions o where o.account_id = ${to} and o.item_id = m.item_id
        and o.comment_id is not distinct from m.comment_id)`);
  const mentions = await tx.execute(
    sql`update content_mentions set account_id = ${to} where account_id = ${from}`,
  );
  await tx.execute(sql`update content_mentions set actor_id = ${to} where actor_id = ${from}`);
  const tasks = await tx.execute(sql`
    update tasks set
      notified_assignee_id = case when assignee_id = ${from} or notified_assignee_id = ${from} then ${to}
        else notified_assignee_id end,
      assignee_id = case when assignee_id = ${from} then ${to} else assignee_id end
    where assignee_id = ${from} or notified_assignee_id = ${from}`);
  await tx.execute(sql`update tasks set status_changed_by = ${to} where status_changed_by = ${from}`);
  await tx.execute(sql`update task_status_changes set actor_id = ${to} where actor_id = ${from}`);
  await tx.execute(sql`
    update page_shares o set role = p.role, updated_at = now()
    from page_shares p
    where p.principal_kind = 'account' and p.principal_id = ${from}
      and o.principal_kind = 'account' and o.principal_id = ${to} and o.item_id = p.item_id
      and array_position(${SHARE_ROLES}, p.role::text) > array_position(${SHARE_ROLES}, o.role::text)`);
  const restrictions = await tx.execute<{ item_id: string }>(sql`
    select distinct item_id from page_shares where principal_kind = 'account' and principal_id = ${from}`);
  await tx.execute(sql`
    delete from page_shares p where p.principal_kind = 'account' and p.principal_id = ${from}
      and exists (select 1 from page_shares o where o.item_id = p.item_id
        and o.principal_kind = 'account' and o.principal_id = ${to})`);
  await tx.execute(sql`
    update page_shares set principal_id = ${to}, updated_at = now()
    where principal_kind = 'account' and principal_id = ${from}`);
  await tx.execute(sql`update page_restrictions set set_by = ${to} where set_by = ${from}`);
  await tx.execute(sql`
    update space_permissions o set role = p.role, updated_at = now()
    from space_permissions p
    where p.principal_kind = 'account' and p.principal_id = ${from}
      and o.principal_kind = 'account' and o.principal_id = ${to} and o.space_id = p.space_id
      and array_position(${SPACE_ROLES}, p.role::text) > array_position(${SPACE_ROLES}, o.role::text)`);
  const spaceRoles = await tx.execute(sql`
    select 1 from space_permissions where principal_kind = 'account' and principal_id = ${from}`);
  await tx.execute(sql`
    delete from space_permissions p where p.principal_kind = 'account' and p.principal_id = ${from}
      and exists (select 1 from space_permissions o where o.space_id = p.space_id
        and o.principal_kind = 'account' and o.principal_id = ${to})`);
  await tx.execute(sql`
    update space_permissions set principal_id = ${to}, updated_at = now()
    where principal_kind = 'account' and principal_id = ${from}`);
  await tx.execute(sql`update import_grants set account_id = ${to} where account_id = ${from}`);
  await tx.execute(sql`update account_external_ids set account_id = ${to} where account_id = ${from}`);
  return {
    items: items.rowCount ?? 0,
    comments: comments.rowCount ?? 0,
    mentions: mentions.rowCount ?? 0,
    tasks: tasks.rowCount ?? 0,
    reactions: reactions.rowCount ?? 0,
    restrictions: restrictions.rows.length,
    spaceRoles: spaceRoles.rows.length,
  };
}
