import { randomBytes } from "node:crypto";
import { createDatabasePool, loadConfig } from "@pagehall/server";
import {
  createMigratedDatabase,
  type TemporaryDatabase,
  testDatabaseBaseUrl,
} from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maintenance } from "./maintenance.js";

const baseUrl = testDatabaseBaseUrl();
const DATABASE_HOOK_TIMEOUT_MS = 60_000;

describe.skipIf(!baseUrl)("pagehall maintenance", () => {
  let database: TemporaryDatabase;

  beforeAll(async () => {
    database = await createMigratedDatabase(baseUrl ?? "", "pagehall_cli_maintenance_test");
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  async function run(command: Parameters<typeof maintenance>[1]): Promise<string[]> {
    const config = loadConfig({
      PAGEHALL_DATABASE_URL: database.url,
      PAGEHALL_MASTER_KEYS: `1:${randomBytes(32).toString("base64")}`,
    });
    const written: string[] = [];
    await maintenance(config, command, (line) => written.push(line));
    return written;
  }

  it("switches maintenance on and off for scripts and records it as done by the system", async () => {
    expect(await run({ action: "status" })).toEqual(["Maintenance mode is off. Everyone can make changes."]);
    const on = await run({ action: "on", message: "Update to 1.5", blockSignIn: true });
    expect(on[0]).toMatch(/^Maintenance mode is on since \d{4}-.*The instance is read-only\.$/);
    expect(on.slice(1)).toEqual([
      "Signing in is paused for everyone except instance administrators.",
      "Message: Update to 1.5",
    ]);
    expect(await run({ action: "off" })).toEqual(["Maintenance mode is off. Everyone can make changes."]);

    const pool = createDatabasePool({
      connectionString: database.url,
      applicationName: "pagehall-test",
    });
    try {
      const events = await pool.query<{ name: string; actor_type: string }>(
        "select name, actor_type from audit_events where name like 'maintenance.%' order by sequence",
      );
      expect(events.rows).toEqual([
        { name: "maintenance.started", actor_type: "system" },
        { name: "maintenance.ended", actor_type: "system" },
      ]);
    } finally {
      await pool.end();
    }
  });
});
