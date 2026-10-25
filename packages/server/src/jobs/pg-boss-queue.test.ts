import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { currentRequestContext, runWithRequestContext } from "../observability/request-context.js";
import { defineJob, type JobDefinition, type JobFinishedEvent } from "./job-queue.js";
import { PgBossQueue, queueCounts } from "./pg-boss-queue.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

function uniqueName(action: string) {
  return `test.${action}-${randomBytes(4).toString("hex")}`;
}

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Condition not met in time");
}

describe("defineJob", () => {
  it("requires module-qualified names", () => {
    expect(() => defineJob({ name: "nomodule", duringMaintenance: "run", payload: z.object({}) })).toThrow(
      "<module>.<action>",
    );
  });
});

describe.skipIf(!databaseUrl)("PgBossQueue", () => {
  let pool: DatabasePool;
  let database: Database;
  let worker: PgBossQueue;
  let producer: PgBossQueue;
  const finished: JobFinishedEvent[] = [];

  beforeAll(async () => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
    worker = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
      onJobFinished: (event) => finished.push(event),
    });
    producer = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "producer" });
    await worker.start();
    await producer.start();
  });

  afterAll(async () => {
    await producer?.stop({ timeoutSeconds: 1 });
    await worker?.stop({ timeoutSeconds: 1 });
    await pool?.end();
  });

  function define(action: string, options: Partial<JobDefinition<{ value: number }>> = {}) {
    return defineJob({
      name: uniqueName(action),
      duringMaintenance: "run",
      payload: z.object({ value: z.number() }),
      ...options,
    });
  }

  it("runs enqueued jobs in the worker and reports progress", async () => {
    const job = define("progress");
    const seen: number[] = [];
    await worker.work(job, async ({ payload, reportProgress }) => {
      seen.push(payload.value);
      await reportProgress(1, 2, "halfway");
      await reportProgress(2, 2, "done");
    });
    const id = await producer.enqueue(job, { value: 7 });
    const info = await waitFor(async () => {
      const current = await producer.get(job, id);
      return current?.state === "completed" ? current : undefined;
    });
    expect(seen).toEqual([7]);
    expect(info.progress).toEqual({ done: 2, total: 2, message: "done" });
    expect(finished.find((event) => event.name === job.name)?.state).toBe("completed");
  });

  it("holds jobs that wait during maintenance and runs them when it ends", async () => {
    const waiting = define("maintenance-wait", { duringMaintenance: "wait" });
    const running = define("maintenance-run", { duringMaintenance: "run" });
    const before = define("maintenance-before", { duringMaintenance: "wait" });
    const seen: string[] = [];
    await worker.work(before, async () => {
      seen.push("before");
    });
    await worker.pauseForMaintenance(true);
    try {
      await worker.work(waiting, async () => {
        seen.push("waiting");
      });
      await worker.work(running, async () => {
        seen.push("running");
      });
      const ids = {
        waiting: await producer.enqueue(waiting, { value: 1 }),
        running: await producer.enqueue(running, { value: 1 }),
        before: await producer.enqueue(before, { value: 1 }),
      };
      await waitFor(async () => (await producer.get(running, ids.running))?.state === "completed");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(seen).toEqual(["running"]);
      expect((await producer.get(waiting, ids.waiting))?.state).toBe("created");
      expect((await producer.get(before, ids.before))?.state).toBe("created");
    } finally {
      await worker.pauseForMaintenance(false);
    }
    await waitFor(async () => seen.length === 3);
    expect([...seen].sort()).toEqual(["before", "running", "waiting"]);
  });

  it("validates payloads before enqueueing", async () => {
    const job = define("validation");
    await expect(producer.enqueue(job, { value: "x" } as never)).rejects.toThrow();
  });

  it("retries failed attempts until they succeed", async () => {
    const job = define("retry", { retryLimit: 3, retryDelaySeconds: 1, retryBackoff: false });
    let attempts = 0;
    await worker.work(job, async ({ retryCount }) => {
      attempts += 1;
      if (retryCount < 2) throw new Error(`attempt ${retryCount} failed`);
    });
    const id = await producer.enqueue(job, { value: 1 });
    const info = await waitFor(async () => {
      const current = await producer.get(job, id);
      return current?.state === "completed" ? current : undefined;
    }, 20_000);
    expect(attempts).toBe(3);
    expect(info.retryCount).toBe(2);
  });

  it("keeps jobs that exhausted their retries for inspection and can retry them", async () => {
    const job = define("failing", { retryLimit: 0 });
    let succeed = false;
    await worker.work(job, async () => {
      if (!succeed) throw new Error("upstream unavailable");
    });
    const id = await producer.enqueue(job, { value: 1 });
    await waitFor(async () => (await producer.get(job, id))?.state === "failed");
    const failed = await producer.listFailed(job);
    expect(failed.map((info) => info.id)).toEqual([id]);
    expect(failed[0]?.error).toBe("upstream unavailable");

    succeed = true;
    await producer.retry(job, id);
    await waitFor(async () => (await producer.get(job, id))?.state === "completed");
  });

  it("starts delayed jobs only after their start time", async () => {
    const job = define("delayed");
    const ran: Date[] = [];
    await worker.work(job, async () => {
      ran.push(new Date());
    });
    const startAfter = new Date(Date.now() + 2000);
    const id = await producer.enqueue(job, { value: 1 }, { startAfter });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await producer.get(job, id))?.state).toBe("created");
    await waitFor(async () => (await producer.get(job, id))?.state === "completed");
    expect(ran[0]?.getTime()).toBeGreaterThanOrEqual(startAfter.getTime() - 50);
  });

  it("registers and removes recurring schedules", async () => {
    const job = define("recurring");
    await producer.schedule(job, "0 3 * * *", { value: 1 }, { key: "nightly", timeZone: "Europe/Vienna" });
    const schedules = () =>
      database.execute<{ cron: string; timezone: string }>(
        sql`select cron, timezone from pgboss.schedule where name = ${job.name}`,
      );
    expect((await schedules()).rows).toEqual([{ cron: "0 3 * * *", timezone: "Europe/Vienna" }]);
    await producer.unschedule(job, "nightly");
    expect((await schedules()).rows).toEqual([]);
  });

  it("aborts a running job when it is cancelled", async () => {
    const job = define("cancel");
    let aborted = false;
    await worker.work(job, async ({ reportProgress, signal }) => {
      for (let step = 0; step < 100 && !signal.aborted; step++) {
        await reportProgress(step, 100);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      aborted = signal.aborted;
    });
    const id = await producer.enqueue(job, { value: 1 });
    await waitFor(async () => ((await producer.get(job, id))?.progress?.done ?? 0) > 0);
    await producer.cancel(job, id);
    await waitFor(async () => aborted);
    expect((await producer.get(job, id))?.state).toBe("cancelled");
  });

  it("runs handlers with the request ID, client address and user agent of the enqueueing request", async () => {
    const job = define("context");
    const contexts: unknown[] = [];
    await worker.work(job, async () => {
      contexts.push(currentRequestContext());
    });
    const id = await runWithRequestContext(
      { requestId: "req-123", clientIp: "203.0.113.9", userAgent: "Agent/1", actor: { type: "anonymous" } },
      () => producer.enqueue(job, { value: 1 }),
    );
    await waitFor(async () => (await producer.get(job, id))?.state === "completed");
    expect(contexts).toEqual([{ requestId: "req-123", clientIp: "203.0.113.9", userAgent: "Agent/1" }]);
  });

  it("does not let the producer role run jobs", async () => {
    await expect(producer.work(define("producer"), async () => {})).rejects.toThrow("Only the worker role");
  });

  it("counts jobs per queue without the queue's internal queues", async () => {
    const job = define("counts");
    await producer.register(job);
    const counts = await producer.counts();
    expect(Object.keys(counts[job.name] ?? {}).sort()).toEqual([
      "active",
      "deferred",
      "failed",
      "oldestQueuedAt",
      "queued",
    ]);
    expect(counts[job.name]?.oldestQueuedAt).toBeNull();
    expect(Object.keys(counts).filter((name) => name.startsWith("__pgboss__"))).toEqual([]);
  });

  it("names when the oldest waiting job of a queue was queued", async () => {
    const job = define("oldest");
    await producer.register(job);
    const before = Date.now();
    await producer.enqueue(job, { value: 1 });
    const oldest = (await producer.counts())[job.name]?.oldestQueuedAt;
    expect(oldest).toBeInstanceOf(Date);
    expect(Math.abs((oldest?.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });
});

describe.skipIf(!databaseUrl)("graceful shutdown", () => {
  let pool: DatabasePool;
  let database: Database;

  beforeAll(() => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  function newWorker(): PgBossQueue {
    return new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
    });
  }

  it("lets running jobs finish within the timeout", async () => {
    const queue = newWorker();
    const job = defineJob({ name: uniqueName("finish"), duringMaintenance: "run", payload: z.object({}) });
    let started = false;
    await queue.work(job, async () => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    const id = await queue.enqueue(job, {});
    await waitFor(async () => started);
    await queue.stop({ timeoutSeconds: 10 });

    const check = newWorker();
    expect((await check.get(job, id))?.state).toBe("completed");
    await check.stop({ timeoutSeconds: 1 });
  });

  it("hands jobs back to the queue when they do not finish in time", async () => {
    const queue = newWorker();
    const job = defineJob({
      name: uniqueName("handback"),
      duringMaintenance: "run",
      payload: z.object({}),
      retryLimit: 2,
    });
    let started = false;
    let aborted = false;
    await queue.work(job, async ({ signal }) => {
      started = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          resolve();
        });
      });
    });
    const id = await queue.enqueue(job, {});
    await waitFor(async () => started);
    await queue.stop({ timeoutSeconds: 1 });

    const check = newWorker();
    const info = await check.get(job, id);
    expect(aborted).toBe(true);
    expect(info?.state).toBe("retry");
    await check.stop({ timeoutSeconds: 1 });
  });
});

describe("queue counts", () => {
  it("counts jobs planned for later as planned, not as waiting", () => {
    expect(
      queueCounts({ readyCount: 2, blockedCount: 1, activeCount: 1, deferredCount: 518, failedCount: 0 }),
    ).toEqual({ queued: 3, active: 1, deferred: 518, failed: 0 });
  });
});
