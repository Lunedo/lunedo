import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export const PUSH_OUTBOX_CHANNEL = "lunedo_push_outbox";

export interface PushOutboxEntry {
  recipientId: string;
  organizationId: string | null;
  type: string;
  targetId: string | null;
  actorId: string | null;
  actorCount: number;
  params: unknown;
}

export async function hasPushDevice(executor: Executor, accountId: string): Promise<boolean> {
  const result = await executor.execute(
    sql`select 1 from push_subscriptions where account_id = ${accountId} limit 1`,
  );
  return result.rows.length > 0;
}

export async function queuePush(executor: Executor, entry: PushOutboxEntry): Promise<void> {
  await executor.execute(sql`
    insert into push_outbox (id, recipient_id, organization_id, type, target_id, actor_id, actor_count, params)
    values (${uuidv7()}, ${entry.recipientId}, ${entry.organizationId}, ${entry.type}, ${entry.targetId}, ${entry.actorId},
      ${entry.actorCount}, ${JSON.stringify(entry.params)}::jsonb)`);
  await executor.execute(sql`select pg_notify(${PUSH_OUTBOX_CHANNEL}, '')`);
}
