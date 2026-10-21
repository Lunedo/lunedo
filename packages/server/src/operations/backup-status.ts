import { sql } from "drizzle-orm";
import type { BackupStatus } from "../backup/service.js";
import type { Executor } from "../database/database.js";

export interface BackupStatusSource {
  status(): Promise<BackupStatus>;
}

export async function failedBackups(executor: Executor): Promise<number> {
  const result = await executor.execute<{ count: string | number }>(
    sql`select count(*) as count from backup_runs where state = 'failed'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
