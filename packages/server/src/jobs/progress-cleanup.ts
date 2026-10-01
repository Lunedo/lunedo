import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/database.js";
import { defineJob } from "./job-queue.js";

/** Removes progress rows whose job the queue has deleted after its retention period. */
export const cleanupJobProgressJob = defineJob({
  name: "jobs.cleanup-progress",
  payload: z.object({}),
  retryLimit: 2,
});

export const CLEANUP_JOB_PROGRESS_SCHEDULE = "17 * * * *";

export async function cleanupJobProgress(database: Database): Promise<number> {
  const result = await database.execute(
    sql`delete from job_progress progress
        where not exists (select 1 from pgboss.job job where job.id = progress.job_id)`,
  );
  return result.rowCount ?? 0;
}
