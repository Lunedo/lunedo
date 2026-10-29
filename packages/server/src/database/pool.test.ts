import { afterAll, describe, expect, it } from "vitest";
import { createDatabasePool, type PoolAcquireEvent, pingDatabase } from "./pool.js";

const url = process.env.LUNEDO_TEST_DATABASE_URL;

describe("database pool", () => {
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
