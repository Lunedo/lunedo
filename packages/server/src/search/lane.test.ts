import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { SearchBusyError, SearchLane, type SearchLaneObserver, SearchTimeoutError } from "./lane.js";

const databaseUrl = inject("databaseUrl");

describe.skipIf(!databaseUrl)("search lane", () => {
  const pools: DatabasePool[] = [];

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });

  function lane(
    options: { slots?: number; waitMs?: number; timeoutMs?: number; observer?: SearchLaneObserver } = {},
  ) {
    const pool = createDatabasePool({
      connectionString: databaseUrl,
      applicationName: "lunedo-search-test",
      max: 2,
      connectionTimeoutMillis: options.waitMs ?? 300,
      settings: { max_parallel_workers_per_gather: 0, statement_timeout: options.timeoutMs ?? 5000 },
    });
    pools.push(pool);
    const busy: number[] = [];
    const created = new SearchLane({
      pool,
      slots: options.slots ?? 1,
      waitMs: options.waitMs ?? 300,
      ...(options.observer ? { observer: options.observer } : {}),
      sleep: async (ms) => {
        busy.push(pool.totalCount - pool.idleCount);
        await delay(ms);
      },
    });
    return { lane: created, pool, busy };
  }

  function holding(target: SearchLane) {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const done = target.run(async () => {
      started();
      await released;
      return "first";
    });
    return { running, release, done };
  }

  it("shares its slots across processes and answers busy only after the deadline", async () => {
    const first = lane();
    const second = lane({ waitMs: 300 });
    const held = holding(first.lane);
    await held.running;
    const started = performance.now();
    await expect(second.lane.run(async () => "second")).rejects.toBeInstanceOf(SearchBusyError);
    expect(performance.now() - started).toBeGreaterThanOrEqual(200);
    expect(second.busy.length).toBeGreaterThan(1);
    expect(second.busy.every((checkedOut) => checkedOut === 0)).toBe(true);
    held.release();
    await expect(held.done).resolves.toBe("first");
    await expect(second.lane.run(async () => "second")).resolves.toBe("second");
  });

  it("runs as many searches at once as it has slots", async () => {
    const first = lane({ slots: 2 });
    const second = lane({ slots: 2 });
    const held = holding(first.lane);
    await held.running;
    await expect(second.lane.run(async () => "beside")).resolves.toBe("beside");
    held.release();
    await held.done;
  });

  it("frees the slot when the search fails", async () => {
    const first = lane();
    const second = lane();
    await expect(
      first.lane.run(async () => {
        throw new Error("search failed");
      }),
    ).rejects.toThrow("search failed");
    await expect(second.lane.run(async () => "after error")).resolves.toBe("after error");
  });

  it("cancels a statement that runs longer than the timeout and frees the slot", async () => {
    const slow = lane({ timeoutMs: 100 });
    const next = lane();
    await expect(
      slow.lane.run((executor) => executor.execute(sql`select pg_sleep(2)`)),
    ).rejects.toBeInstanceOf(SearchTimeoutError);
    await expect(next.lane.run(async () => "after timeout")).resolves.toBe("after timeout");
  });

  it("runs the search without parallel workers and reports waits, use and rejections", async () => {
    const events: string[] = [];
    const observer: SearchLaneObserver = {
      waited: () => events.push("waited"),
      rejected: () => events.push("rejected"),
      using: (change) => events.push(change > 0 ? "start" : "end"),
    };
    const first = lane({ observer });
    const setting = await first.lane.run((executor) =>
      executor.execute<{ value: string }>(
        sql`select current_setting('max_parallel_workers_per_gather') as value`,
      ),
    );
    expect(setting.rows[0]?.value).toBe("0");
    const held = holding(first.lane);
    await held.running;
    await expect(lane({ observer, waitMs: 100 }).lane.run(async () => null)).rejects.toBeInstanceOf(
      SearchBusyError,
    );
    held.release();
    await held.done;
    expect(events).toEqual(["waited", "start", "end", "waited", "start", "rejected", "end"]);
  });
});
