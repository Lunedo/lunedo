import {
  AuditLog,
  createDatabase,
  createDatabasePool,
  createLogger,
  type DatabasePool,
  runMigrations,
} from "@pagehall/server";
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
  testDatabaseBaseUrl,
} from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditLog } from "./audit.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("pagehall audit verify", () => {
  let database: TemporaryDatabase;
  let pool: DatabasePool;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl ?? "", "pagehall_cli_test");
    pool = createDatabasePool({ connectionString: database.url, applicationName: "pagehall-test" });
    await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }) });
  });

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  async function run() {
    const lines: string[] = [];
    const exitCode = await verifyAuditLog(database.url, (line) => lines.push(line));
    return { exitCode, lines };
  }

  it("passes for an empty and an intact log", async () => {
    expect(await run()).toEqual({ exitCode: 0, lines: ["The audit log is empty."] });
    const audit = new AuditLog({ database: createDatabase(pool) });
    for (let i = 0; i < 3; i++) {
      await audit.recordAlone({
        name: "account.passwordChanged",
        targetId: "00000000-0000-7000-8000-000000000001",
        fields: { endedSessions: i },
      });
    }
    expect(await run()).toEqual({ exitCode: 0, lines: ["Audit log of the instance is intact: 3 entries."] });
  });

  it("fails and names the first entry that was changed directly in the database", async () => {
    const { rows } = await pool.query<{ id: string }>("select id from audit_events where sequence = 2");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(`update audit_events set fields = '{"endedSessions": 7}' where sequence = 2`);
      await client.query("commit");
    } finally {
      client.release();
    }
    expect(await run()).toEqual({
      exitCode: 1,
      lines: [
        `Audit log of the instance is broken at entry 2 (${rows[0]?.id}): the content does not match its hash. Intact entries before it: 1.`,
      ],
    });
  });
});
