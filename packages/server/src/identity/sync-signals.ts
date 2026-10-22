import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";

export const SYNC_RUNS_CHANNEL = "lunedo_sync_runs";

export interface SyncRunSignal {
  providerId: string;
  runId: string;
}

export function parseSyncRunSignal(payload: string): SyncRunSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SyncRunSignal>;
    if (typeof parsed.providerId === "string" && typeof parsed.runId === "string") {
      return { providerId: parsed.providerId, runId: parsed.runId };
    }
  } catch {
    return null;
  }
  return null;
}

export async function signalRun(
  executor: Pick<Database, "execute">,
  providerId: string,
  runId: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_notify(${SYNC_RUNS_CHANNEL}, ${JSON.stringify({ providerId, runId })})`,
  );
}
