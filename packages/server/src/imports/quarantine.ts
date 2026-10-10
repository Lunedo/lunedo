import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "../database/database.js";
import { insertPage } from "../spaces/items.js";
import { signalSpaceChange } from "../spaces/signals.js";

const PURGE_BATCH = 500;

export async function createQuarantineSpace(
  tx: Transaction,
  input: {
    organizationId: string;
    name: string;
    key: string;
    importerId: string;
    readers: readonly string[];
  },
): Promise<{ spaceId: string; overviewId: string }> {
  const spaceId = uuidv7();
  await tx.execute(sql`delete from space_key_aliases where key = ${input.key}`);
  await tx.execute(sql`
    insert into spaces (id, organization_id, key, name, visibility, discoverable, quarantined, created_by)
    values (${spaceId}, ${input.organizationId}, ${input.key}, ${input.name}, 'private', false, true, ${input.importerId})`);
  await setQuarantineReaders(tx, spaceId, input.importerId, [input.importerId, ...input.readers]);
  const overviewId = await insertPage(tx, {
    spaceId,
    parentId: null,
    title: input.name,
    actorId: input.importerId,
    mode: "publish",
    published: false,
  });
  await tx.execute(sql`update spaces set overview_item_id = ${overviewId} where id = ${spaceId}`);
  await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
  return { spaceId, overviewId };
}

export async function setQuarantineReaders(
  tx: Transaction,
  spaceId: string,
  actorId: string,
  accountIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(accountIds)];
  await tx.execute(sql`
    delete from space_permissions where space_id = ${spaceId}
      and not (principal_kind = 'account' and principal_id = any(${sql.param(wanted)}::uuid[]))`);
  for (const accountId of wanted) {
    await tx.execute(sql`
      insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
      values (${uuidv7()}, ${spaceId}, 'account', ${accountId}, 'reader', ${actorId})
      on conflict do nothing`);
  }
  await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
}

export async function purgeQuarantineSpace(
  database: Database,
  spaceId: string,
  signal?: AbortSignal,
  onProgress?: (removed: number) => Promise<void>,
): Promise<void> {
  let removed = 0;
  for (;;) {
    signal?.throwIfAborted();
    const count = await database.transaction(async (tx) => {
      const leaves = await tx.execute<{ id: string }>(sql`
        select t.id from tree_items t join spaces s on s.id = t.space_id
        where t.space_id = ${spaceId} and s.quarantined
          and not exists (select 1 from tree_items c where c.parent_id = t.id)
        limit ${PURGE_BATCH}`);
      const ids = leaves.rows.map((row) => row.id);
      if (ids.length === 0) return 0;
      await tx.execute(sql`update spaces set overview_item_id = null where id = ${spaceId}
        and overview_item_id = any(${sql.param(ids)}::uuid[])`);
      await tx.execute(sql`
        delete from tree_items where kind = 'link' and link_item_id = any(${sql.param(ids)}::uuid[])
          and not (id = any(${sql.param(ids)}::uuid[]))`);
      await tx.execute(sql`delete from tree_items where id = any(${sql.param(ids)}::uuid[])`);
      return ids.length;
    });
    if (count === 0) break;
    removed += count;
    await onProgress?.(removed);
  }
  await database.transaction(async (tx) => {
    await tx.execute(sql`delete from setting_values where level = 'space' and scope_id = ${spaceId}`);
    await tx.execute(sql`delete from spaces where id = ${spaceId} and quarantined`);
  });
}
