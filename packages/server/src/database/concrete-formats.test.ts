import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { runMigrations } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const MIGRATION = "0012_concrete_formats";
const SETTINGS_CLEANUP = "0101_settings_cleanup";
const INSTANCE = "00000000-0000-0000-0000-000000000000";

function foldersBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lunedo-migrations-"));
  cpSync(migrations, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!baseUrl)("the migration to concrete formats", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    if (folder) rmSync(folder, { recursive: true, force: true });
    pool = undefined;
    database = undefined;
    folder = undefined;
  });

  it("keeps every format people saw while the formats were automatic", async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test" });
    folder = foldersBefore(MIGRATION);
    await runMigrations(pool, { logger, folder });

    const german = randomUUID();
    const english = randomUUID();
    await pool.query(
      `insert into organizations (id, name, slug) values ($1, 'German team', 'german-team'), ($2, 'English team', 'english-team')`,
      [german, english],
    );
    const account = async (home: string | null) => {
      const id = randomUUID();
      await pool?.query(
        `insert into accounts (id, type, state, name, home_organization_id) values ($1, 'standard', 'active', 'Person', $2)`,
        [id, home],
      );
      return id;
    };
    const inheritsGerman = await account(german);
    const prefersEnglish = await account(german);
    const keepsAuto = await account(english);
    const chooseOwn = await account(null);
    const set = async (level: string, scope: string, key: string, value: unknown, locked = false) => {
      await pool?.query(
        `insert into setting_values (id, level, scope_id, key, value, locked) values ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), level, scope, key, JSON.stringify(value), locked],
      );
    };
    await set("organization", german, "locale.language", "de");
    await set("user", prefersEnglish, "locale.language", "en");
    await set("user", keepsAuto, "locale.timeFormat", "auto");
    await set("user", chooseOwn, "locale.dateFormat", "YYYY-MM-DD");

    rmSync(folder, { recursive: true, force: true });
    folder = foldersBefore(SETTINGS_CLEANUP);
    await runMigrations(pool, { logger, folder });

    const value = async (level: string, scope: string, key: string) => {
      const result = await pool?.query<{ value: unknown }>(
        "select value from setting_values where level = $1 and scope_id = $2 and key = $3",
        [level, scope, key],
      );
      return result?.rows[0]?.value;
    };
    const effective = async (account: string, home: string | null, key: string) =>
      (await value("user", account, key)) ??
      (home ? await value("organization", home, key) : undefined) ??
      (await value("instance", INSTANCE, key));

    expect(await value("instance", INSTANCE, "locale.dateFormat")).toBe("MM/DD/YYYY");
    expect(await value("instance", INSTANCE, "locale.firstDayOfWeek")).toBe("sunday");
    expect(await value("organization", german, "locale.dateFormat")).toBe("DD.MM.YYYY");
    expect(await value("organization", german, "locale.numberFormat")).toBe("de-DE");
    expect(await value("organization", english, "locale.dateFormat")).toBeUndefined();

    expect(await effective(inheritsGerman, german, "locale.dateFormat")).toBe("DD.MM.YYYY");
    expect(await value("user", inheritsGerman, "locale.dateFormat")).toBeUndefined();
    expect(await effective(prefersEnglish, german, "locale.dateFormat")).toBe("MM/DD/YYYY");
    expect(await effective(prefersEnglish, german, "locale.timeFormat")).toBe("12h");
    expect(await value("user", keepsAuto, "locale.timeFormat")).toBe("12h");
    expect(await effective(chooseOwn, null, "locale.dateFormat")).toBe("YYYY-MM-DD");
    expect(await effective(chooseOwn, null, "locale.timeFormat")).toBe("12h");

    const remaining = await pool.query("select 1 from setting_values where value = '\"auto\"'::jsonb");
    expect(remaining.rows).toHaveLength(0);
  });

  it("follows a locked instance language", async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test" });
    folder = foldersBefore(MIGRATION);
    await runMigrations(pool, { logger, folder });
    const person = randomUUID();
    await pool.query(
      `insert into accounts (id, type, state, name) values ($1, 'standard', 'active', 'Person')`,
      [person],
    );
    await pool.query(
      `insert into setting_values (id, level, scope_id, key, value, locked) values
        ($1, 'instance', $3, 'locale.language', '"de"', true),
        ($2, 'user', $4, 'locale.language', '"en"', false)`,
      [randomUUID(), randomUUID(), INSTANCE, person],
    );

    rmSync(folder, { recursive: true, force: true });
    folder = foldersBefore(SETTINGS_CLEANUP);
    await runMigrations(pool, { logger, folder });

    const rows = await pool.query<{ level: string; value: unknown }>(
      "select level, value from setting_values where key = 'locale.dateFormat' order by level",
    );
    expect(rows.rows).toEqual([{ level: "instance", value: "DD.MM.YYYY" }]);
  });
});
