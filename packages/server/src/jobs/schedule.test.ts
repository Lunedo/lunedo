import { randomBytes } from "node:crypto";
import { TestClock } from "pg-boss";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { defineJob } from "./job-queue.js";
import { PgBossQueue } from "./pg-boss-queue.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!databaseUrl)("recurring jobs", () => {
  let pool: DatabasePool;
  let database: Database;
  let clock: TestClock;
  let queue: PgBossQueue;

  beforeEach(async () => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    clock = new TestClock(Date.now());
    queue = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
      clock,
    });
    await queue.start();
  });

  afterEach(async () => {
    await queue?.stop({ timeoutSeconds: 1 });
    await pool?.end();
  });

  async function advanceUntil(check: () => boolean, minutes: number) {
    for (let step = 0; step < minutes * 12 && !check(); step++) {
      await clock.tick(5_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  function define() {
    return defineJob({
      name: `test.schedule-${randomBytes(4).toString("hex")}`,
      payload: z.object({ source: z.string() }),
    });
  }

  it("runs every schedule of the same job", async () => {
    const job = define();
    const sources: string[] = [];
    await queue.work(job, async ({ payload }) => {
      sources.push(payload.source);
    });
    await queue.schedule(job, "* * * * *", { source: "first" }, { key: "first" });
    await queue.schedule(job, "* * * * *", { source: "second" }, { key: "second" });

    await advanceUntil(() => sources.includes("first") && sources.includes("second"), 3);
    expect(new Set(sources)).toEqual(new Set(["first", "second"]));
  });

  it("runs a recurring job more than once", async () => {
    const job = define();
    let runs = 0;
    await queue.work(job, async () => {
      runs += 1;
    });
    await queue.schedule(job, "* * * * *", { source: "minutely" });

    await advanceUntil(() => runs >= 2, 5);
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
