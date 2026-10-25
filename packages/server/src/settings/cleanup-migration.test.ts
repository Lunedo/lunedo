import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { INSTANCE_SCOPE_ID } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

const statements = readFileSync(new URL("../../drizzle/0101_settings_cleanup.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe.skipIf(!baseUrl)("moving instance defaults into organizations", () => {
  let test: TestServices;
  const { organization } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function rows(level: string, scopeId: string) {
    const result = await test.pool.query<{ key: string; value: unknown; locked: boolean }>(
      "select key, value, locked from setting_values where level = $1 and scope_id = $2 order by key",
      [level, scopeId],
    );
    return result.rows;
  }

  async function set(level: string, scopeId: string, key: string, value: unknown, locked = false) {
    await test.pool.query(
      `insert into setting_values (id, level, scope_id, key, value, locked)
       values (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [level, scopeId, key, value === null ? null : JSON.stringify(value), locked],
    );
  }

  async function organizationBeforeMigration() {
    const created = await organization();
    await test.pool.query("delete from setting_values where level = 'organization' and scope_id = $1", [
      created.id,
    ]);
    return created;
  }

  async function migrate() {
    for (const statement of statements) await test.pool.query(statement);
  }

  it("makes the accent of the only organization the accent of the instance", async () => {
    const only = await organizationBeforeMigration();
    await set("instance", INSTANCE_SCOPE_ID, "branding.accentColor", "petrol");
    await set("organization", only.id, "branding.accentColor", "violet");
    await migrate();
    expect(await rows("instance", INSTANCE_SCOPE_ID)).toEqual([
      { key: "branding.accentColor", value: "violet", locked: false },
    ]);
    expect(await rows("organization", only.id)).toEqual([]);
  });

  it("copies instance values into every organization without its own value and keeps everything else", async () => {
    const first = await organizationBeforeMigration();
    const second = await organizationBeforeMigration();
    await set("instance", INSTANCE_SCOPE_ID, "locale.dateFormat", "D MMM YYYY", true);
    await set("instance", INSTANCE_SCOPE_ID, "trash.firstStageDays", 60);
    await set("instance", INSTANCE_SCOPE_ID, "notifications.mentions.email", "daily");
    await set("instance", INSTANCE_SCOPE_ID, "locale.language", "de");
    await set("instance", INSTANCE_SCOPE_ID, "auth.passwordMinLength", 14);
    await set("organization", first.id, "locale.dateFormat", "DD.MM.YYYY");
    await set("organization", second.id, "branding.accentColor", "green");
    await migrate();

    expect(await rows("instance", INSTANCE_SCOPE_ID)).toEqual([
      { key: "auth.passwordMinLength", value: 14, locked: false },
      { key: "branding.accentColor", value: "violet", locked: false },
      { key: "locale.language", value: "de", locked: false },
    ]);
    expect(await rows("organization", first.id)).toEqual([
      { key: "locale.dateFormat", value: "DD.MM.YYYY", locked: false },
      { key: "notifications.mentions.email", value: "daily", locked: false },
      { key: "trash.firstStageDays", value: 60, locked: false },
    ]);
    expect(await rows("organization", second.id)).toEqual([
      { key: "locale.dateFormat", value: "D MMM YYYY", locked: true },
      { key: "notifications.mentions.email", value: "daily", locked: false },
      { key: "trash.firstStageDays", value: 60, locked: false },
    ]);
  });
});
