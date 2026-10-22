import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { defineJob } from "./job-queue.js";
import { PgBossQueue } from "./pg-boss-queue.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Condition not met in time");
}

describe.skipIf(!databaseUrl)("idempotency keys", () => {
  let pool: DatabasePool;
  let database: Database;
  let nodeA: PgBossQueue;
  let nodeB: PgBossQueue;
  let worker: PgBossQueue;

  beforeAll(async () => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
    nodeA = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "producer" });
    nodeB = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "producer" });
    worker = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
    });
  });

  afterAll(async () => {
    for (const queue of [nodeA, nodeB, worker]) await queue?.stop({ timeoutSeconds: 1 });
    await pool?.end();
  });

  function define(options: { retryLimit?: number; retryDelaySeconds?: number } = {}) {
    return defineJob({
      name: `test.idempotency-${randomBytes(4).toString("hex")}`,
      duringMaintenance: "run",
      payload: z.object({ month: z.string() }),
      retryBackoff: false,
      ...options,
    });
  }

  async function jobCount(name: string): Promise<number> {
    const result = await database.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${name}`,
    );
    return result.rows[0]?.count ?? 0;
  }

  it("returns the existing job while it is scheduled", async () => {
    const job = define();
    const options = { idempotencyKey: "2026-10", startAfter: new Date(Date.now() + 60_000) };
    const first = await nodeA.enqueue(job, { month: "2026-10" }, options);
    const second = await nodeB.enqueue(job, { month: "2026-10" }, options);
    expect(second).toBe(first);
    expect(await jobCount(job.name)).toBe(1);
  });

  it("returns the existing job while it is active or waiting for a retry", async () => {
    const job = define({ retryLimit: 3, retryDelaySeconds: 2 });
    let release: () => void = () => {};
    let attempts = 0;
    await worker.work(job, async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new Error("first attempt fails");
      }
    });
    const id = await nodeA.enqueue(job, { month: "2026-10" }, { idempotencyKey: "2026-10" });
    await waitFor(async () => (await nodeA.get(job, id))?.state === "active");
    expect(await nodeB.enqueue(job, { month: "2026-10" }, { idempotencyKey: "2026-10" })).toBe(id);

    release();
    await waitFor(async () => (await nodeA.get(job, id))?.state === "retry");
    expect(await nodeB.enqueue(job, { month: "2026-10" }, { idempotencyKey: "2026-10" })).toBe(id);
    expect(await jobCount(job.name)).toBe(1);
    await waitFor(async () => (await nodeA.get(job, id))?.state === "completed");
  });

  it("accepts the key again after the job completed, failed or was cancelled", async () => {
    const job = define({ retryLimit: 0 });
    let fail = false;
    await worker.work(job, async () => {
      if (fail) throw new Error("failed on purpose");
    });

    const completed = await nodeA.enqueue(job, { month: "2026-09" }, { idempotencyKey: "rotation" });
    await waitFor(async () => (await nodeA.get(job, completed))?.state === "completed");

    fail = true;
    const failed = await nodeA.enqueue(job, { month: "2026-10" }, { idempotencyKey: "rotation" });
    expect(failed).not.toBe(completed);
    await waitFor(async () => (await nodeA.get(job, failed))?.state === "failed");

    const cancelled = await nodeA.enqueue(
      job,
      { month: "2026-11" },
      { idempotencyKey: "rotation", startAfter: new Date(Date.now() + 60_000) },
    );
    expect(cancelled).not.toBe(failed);
    await nodeA.cancel(job, cancelled);

    const next = await nodeA.enqueue(job, { month: "2026-12" }, { idempotencyKey: "rotation" });
    expect(new Set([completed, failed, cancelled, next]).size).toBe(4);
    expect(await jobCount(job.name)).toBe(4);
  });

  it("creates one job when two nodes enqueue the same key at the same moment", async () => {
    const job = define();
    const options = { idempotencyKey: "2026-10", startAfter: new Date(Date.now() + 60_000) };
    await Promise.all([nodeA.register(job), nodeB.register(job)]);
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? nodeA : nodeB).enqueue(job, { month: "2026-10" }, options),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await jobCount(job.name)).toBe(1);
  });

  it("does not limit jobs without a key", async () => {
    const job = define();
    const options = { startAfter: new Date(Date.now() + 60_000) };
    const ids = await Promise.all([
      nodeA.enqueue(job, { month: "a" }, options),
      nodeA.enqueue(job, { month: "b" }, options),
      nodeB.enqueue(job, { month: "c" }, options),
    ]);
    expect(new Set(ids).size).toBe(3);
    expect(await jobCount(job.name)).toBe(3);
  });
});
