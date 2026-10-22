import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import { hasRestoredMarker, removeRestoredMarker } from "./restore-marker.js";

export async function pauseBackupsAfterRestore(
  filesDir: string,
  database: Database,
  logger: Logger,
): Promise<void> {
  if (!(await hasRestoredMarker(filesDir))) return;
  await database.execute(sql`
    insert into backup_state (singleton, restored_at) values (true, now())
    on conflict (singleton) do update set restored_at = now(), updated_at = now()`);
  await removeRestoredMarker(filesDir);
  logger.warn(
    "This instance was restored from a backup. Scheduled backups, the monthly test restore and retention are paused until an instance administrator confirms the backup target",
  );
}
