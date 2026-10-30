import { afterAll, describe, expect, it } from "vitest";
import {
  createDatabasePool,
  IDLE_CONNECTION_MS,
  MAX_PREPARED_STATEMENTS,
  type PoolAcquireEvent,
  pingDatabase,
} from "./pool.js";

const url = process.env.LUNEDO_TEST_DATABASE_URL;

describe("database pool", () => {
  it("keeps idle connections for minutes, so their prepared statements survive pauses in the load", async () => {
    const pool = createDatabasePool({
      connectionString: "postgres://lunedo:lunedo@127.0.0.1:1/lunedo",
      applicationName: "lunedo-test",
    });
    expect(pool.options.idleTimeoutMillis).toBe(IDLE_CONNECTION_MS);
    expect(IDLE_CONNECTION_MS).toBeGreaterThanOrEqual(60_000);
    await pool.end();
  });

  it("fails the ping when the database is unreachable", async () => {
    const pool = createDatabasePool({
      connectionString: "postgres://lunedo:lunedo@127.0.0.1:1/lunedo",
      applicationName: "lunedo-test",
    });
    await expect(pingDatabase(pool)).rejects.toThrow();
    await pool.end();
  });

  it("reports a failed connection attempt without marking it as a timeout", async () => {
    const events: PoolAcquireEvent[] = [];
    const pool = createDatabasePool({
      connectionString: "postgres://lunedo:lunedo@127.0.0.1:1/lunedo",
      applicationName: "lunedo-test",
      onAcquire: (event) => events.push(event),
    });
    await expect(pool.query("select 1")).rejects.toThrow();
    await pool.end();
    expect(events).toHaveLength(1);
    expect(events[0]?.timedOut).toBe(false);
  });

  describe.skipIf(!url)("against PostgreSQL", () => {
    const pool = createDatabasePool({ connectionString: url ?? "", applicationName: "lunedo-test" });
    afterAll(() => pool.end());

    it("pings the database", async () => {
      await expect(pingDatabase(pool)).resolves.toBeUndefined();
    });

    it("prepares parameterized statements once per connection and leaves others alone", async () => {
      const one = createDatabasePool({ connectionString: url ?? "", applicationName: "lunedo-test", max: 1 });
      const client = await one.connect();
      try {
        for (const value of [1, 2, 3]) {
          const result = await client.query<{ value: number }>("select $1::int + 1 as value", [value]);
          expect(result.rows[0]?.value).toBe(value + 1);
        }
        await client.query({ text: "select $1::text as word", values: ["kept"] });
        await client.query("select 1");
        await client.query("begin; select 2; commit");
        const prepared = await client.query<{ statement: string }>(
          "select statement from pg_prepared_statements where name like 'lunedo%' order by statement",
        );
        expect(prepared.rows.map((row) => row.statement)).toEqual([
          "select $1::int + 1 as value",
          "select $1::text as word",
        ]);
      } finally {
        client.release();
        await one.end();
      }
    });

    it("stops preparing new statements at the limit and keeps answering", async () => {
      const one = createDatabasePool({ connectionString: url ?? "", applicationName: "lunedo-test", max: 1 });
      const client = await one.connect();
      try {
        for (let index = 0; index < MAX_PREPARED_STATEMENTS + 5; index++) {
          const result = await client.query<{ value: number }>(`select $1::int + ${index} as value`, [1]);
          expect(result.rows[0]?.value).toBe(index + 1);
        }
        const count = await client.query<{ count: string }>(
          "select count(*) from pg_prepared_statements where name like 'lunedo%'",
        );
        expect(Number(count.rows[0]?.count)).toBe(MAX_PREPARED_STATEMENTS);
      } finally {
        client.release();
        await one.end();
      }
    });

    it("turns off just-in-time compilation on every connection", async () => {
      const two = createDatabasePool({ connectionString: url ?? "", applicationName: "lunedo-test", max: 2 });
      const first = await two.connect();
      const second = await two.connect();
      for (const client of [first, second]) {
        const result = await client.query<{ jit: string }>("show jit");
        expect(result.rows[0]?.jit).toBe("off");
        client.release();
      }
      await two.end();
    });

    it("reports how long a query waited for a free connection", async () => {
      const events: PoolAcquireEvent[] = [];
      const small = createDatabasePool({
        connectionString: url ?? "",
        applicationName: "lunedo-test",
        max: 1,
        onAcquire: (event) => events.push(event),
      });
      const held = await small.connect();
      const waiting = small.query("select 1");
      await new Promise((resolve) => setTimeout(resolve, 150));
      held.release();
      await waiting;
      await small.end();
      expect(events).toHaveLength(2);
      expect(events[1]?.seconds).toBeGreaterThan(0.1);
      expect(events.every((event) => !event.timedOut)).toBe(true);
    });
  });
});
