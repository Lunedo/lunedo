import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  createDatabasePool,
  IDLE_CONNECTION_MS,
  MAX_PREPARED_PARAMETERS,
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

    async function withClient(run: (client: PoolClient) => Promise<void>) {
      const one = createDatabasePool({ connectionString: url ?? "", applicationName: "lunedo-test", max: 1 });
      const client = await one.connect();
      try {
        await run(client);
      } finally {
        client.release();
        await one.end();
      }
    }

    async function preparedStatements(client: PoolClient) {
      const result = await client.query<{ statement: string }>(
        "select statement from pg_prepared_statements where name like 'lunedo%' order by statement",
      );
      return result.rows.map((row) => row.statement);
    }

    it("prepares a parameterized statement from its second use and leaves others alone", async () => {
      await withClient(async (client) => {
        for (const value of [1, 2, 3]) {
          const result = await client.query<{ value: number }>("select $1::int + 1 as value", [value]);
          expect(result.rows[0]?.value).toBe(value + 1);
        }
        await client.query({ text: "select $1::text as once", values: ["once"] });
        await client.query("select 1");
        await client.query("begin; select 2; commit");
        const many = Array.from({ length: MAX_PREPARED_PARAMETERS + 1 }, (_, index) => `$${index + 1}::int`);
        for (let round = 0; round < 3; round++) {
          await client.query(
            `select ${many.join(" + ")} as total`,
            many.map(() => 1),
          );
        }
        expect(await preparedStatements(client)).toEqual(["select $1::int + 1 as value"]);
      });
    });

    it("keeps at most the limit per connection and releases the least recently used", async () => {
      await withClient(async (client) => {
        const text = (index: number) => `select $1::int + ${index} as value`;
        for (let index = 0; index < MAX_PREPARED_STATEMENTS + 5; index++) {
          for (let round = 0; round < 2; round++) {
            const result = await client.query<{ value: number }>(text(index), [1]);
            expect(result.rows[0]?.value).toBe(index + 1);
          }
        }
        const kept = await preparedStatements(client);
        expect(kept).toHaveLength(MAX_PREPARED_STATEMENTS);
        expect(kept).not.toContain(text(0));
        expect(kept).toContain(text(MAX_PREPARED_STATEMENTS + 4));
        for (let round = 0; round < 3; round++) {
          expect((await client.query<{ value: number }>(text(0), [1])).rows[0]?.value).toBe(1);
        }
        expect(await preparedStatements(client)).toContain(text(0));
      });
    });

    it("never breaks an open transaction when it forgets a statement the server never prepared", async () => {
      await withClient(async (client) => {
        const broken = "select $1::int as value from table_that_does_not_exist";
        for (let round = 0; round < 2; round++) await expect(client.query(broken, [1])).rejects.toThrow();
        await client.query("begin");
        for (let index = 0; index < MAX_PREPARED_STATEMENTS; index++) {
          for (let round = 0; round < 2; round++) {
            await client.query(`select $1::int + ${index} as value`, [1]);
          }
        }
        expect((await client.query<{ one: number }>("select 1 as one")).rows[0]?.one).toBe(1);
        await client.query("commit");
        expect(await preparedStatements(client)).toHaveLength(MAX_PREPARED_STATEMENTS);
      });
    });

    it("keeps answering when a statement is released inside a failed transaction", async () => {
      await withClient(async (client) => {
        const text = (index: number) => `select $1::int + ${index} as value`;
        for (let index = 0; index < MAX_PREPARED_STATEMENTS; index++) {
          for (let round = 0; round < 2; round++) await client.query(text(index), [1]);
        }
        await client.query("begin");
        await expect(client.query("select $1::int / 0", [1])).rejects.toThrow();
        await client.query(text(MAX_PREPARED_STATEMENTS), [1]).catch(() => null);
        await client.query(text(MAX_PREPARED_STATEMENTS), [1]).catch(() => null);
        await client.query("rollback");
        for (let index = 0; index <= MAX_PREPARED_STATEMENTS; index++) {
          for (let round = 0; round < 2; round++) {
            expect((await client.query<{ value: number }>(text(index), [1])).rows[0]?.value).toBe(index + 1);
          }
        }
      });
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
