import { afterAll, describe, expect, it } from "vitest";
import { createDatabasePool, pingDatabase } from "./database.js";

const url = process.env.PAGEHALL_TEST_DATABASE_URL;

describe("database pool", () => {
  it("fails the ping when the database is unreachable", async () => {
    const pool = createDatabasePool({
      connectionString: "postgres://pagehall:pagehall@127.0.0.1:1/pagehall",
      applicationName: "pagehall-test",
    });
    await expect(pingDatabase(pool)).rejects.toThrow();
    await pool.end();
  });

  describe.skipIf(!url)("against PostgreSQL", () => {
    const pool = createDatabasePool({ connectionString: url ?? "", applicationName: "pagehall-test" });
    afterAll(() => pool.end());

    it("pings the database", async () => {
      await expect(pingDatabase(pool)).resolves.toBeUndefined();
    });
  });
});
