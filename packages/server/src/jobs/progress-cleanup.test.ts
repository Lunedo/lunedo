import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { defineJob } from "./job-queue.js";
import { PgBossQueue } from "./pg-boss-queue.js";
import { cleanupJobProgress } from "./progress-cleanup.js";
import { jobProgress } from "./schema.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!databaseUrl)("cleanupJobProgress", () => {
  let pool: DatabasePool;
  let database: Database;
  let queue: PgBossQueue;

  beforeAll(async () => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
    queue = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "producer" });
  });

  afterAll(async () => {
    await queue?.stop({ timeoutSeconds: 1 });
    await pool?.end();
  });

  it("removes progress rows of jobs the queue has deleted and keeps the others", async () => {
    const job = defineJob({
      name: `test.cleanup-${randomBytes(4).toString("hex")}`,
      duringMaintenance: "run",
      payload: z.object({}),
    });
    const existing = await queue.enqueue(job, {}, { startAfter: new Date(Date.now() + 60_000) });
    const deleted = randomUUID();
    await database.insert(jobProgress).values([
      { jobId: existing, queue: job.name, done: 1 },
      { jobId: deleted, queue: job.name, done: 5 },
    ]);

    expect(await cleanupJobProgress(database)).toBeGreaterThanOrEqual(1);
    const remaining = await database
      .select({ jobId: jobProgress.jobId })
      .from(jobProgress)
      .where(eq(jobProgress.queue, job.name));
    expect(remaining.map((row) => row.jobId)).toEqual([existing]);

    await database.execute(sql`delete from pgboss.job where id = ${existing}`);
    await cleanupJobProgress(database);
    expect(await database.select().from(jobProgress).where(eq(jobProgress.queue, job.name))).toEqual([]);
  });
});
