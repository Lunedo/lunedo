import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import { createLogger } from "../logging/logger.js";
import type { EncryptedColumn } from "./encrypted-column.js";
import { Encryption } from "./envelope.js";
import { FileKeyProvider } from "./key-provider.js";
import { KeyRingError } from "./key-ring.js";
import { KeyRingHolder } from "./key-ring-holder.js";
import { KeyRotation, rotateDataKeysJob } from "./rotation.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Condition not met in time");
}

describe.skipIf(!databaseUrl)("key rotation", () => {
  let dir: string;
  let pool: DatabasePool;
  let database: Database;
  let queue: PgBossQueue;
  const table = `test_secrets_${randomBytes(4).toString("hex")}`;
  const columns: EncryptedColumn[] = [{ table, idColumn: "id", column: "value" }];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-rotation-"));
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    await database.execute(sql.raw(`create table "${table}" (id uuid primary key, value bytea)`));
    queue = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
    });
  });

  afterAll(async () => {
    await queue?.stop({ timeoutSeconds: 1 });
    await database?.execute(sql.raw(`drop table if exists "${table}"`));
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-wraps every value with the new key version and the values survive", async () => {
    const keyFile = path.join(dir, "master-keys");
    const provider = new FileKeyProvider(keyFile);
    const holder = new KeyRingHolder(provider, logger);
    await holder.reload();
    const encryption = new Encryption(() => holder.ring);

    const values = new Map<string, string>();
    for (let i = 0; i < 450; i++) {
      const id = uuidv7();
      const plaintext = `secret ${i}`;
      values.set(id, plaintext);
      await database.execute(
        sql`insert into ${sql.identifier(table)} (id, value) values (${id}, ${encryption.encrypt(plaintext, `${table}:${id}`)})`,
      );
    }
    await database.execute(sql`insert into ${sql.identifier(table)} (id, value) values (${uuidv7()}, null)`);

    await provider.addVersion();
    const rotation = new KeyRotation({
      database,
      encryption,
      keyRing: holder,
      jobs: queue,
      columns: () => columns,
    });
    await queue.work(rotateDataKeysJob, rotation.run);

    const before = await rotation.status();
    expect(before.valuesByVersion).toEqual({ 1: 450 });

    const readAll = async () => {
      const rows = await database.execute<{ id: string; value: Buffer | null }>(
        sql`select id, value from ${sql.identifier(table)} where value is not null`,
      );
      return rows.rows.map((row) => ({ id: row.id, value: row.value as Buffer }));
    };
    for (const row of (await readAll()).slice(0, 5)) {
      expect(encryption.decryptString(row.value, `${table}:${row.id}`)).toBe(values.get(row.id));
    }

    const started = await rotation.start();
    expect(started.targetVersion).toBe(2);
    expect((await rotation.start()).id).toBe(started.id);

    await waitFor(async () => (await rotation.status()).latest?.status === "completed");
    const after = await rotation.status();
    expect(after.valuesByVersion).toEqual({ 2: 450 });
    expect(after.latest).toMatchObject({ targetVersion: 2, rewrapped: 450 });

    const withoutOldKey = readFileSync(keyFile, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("1:"))
      .join("\n");
    writeFileSync(keyFile, withoutOldKey);
    await holder.reload();
    expect(() => holder.ring.get(1)).toThrow(KeyRingError);
    for (const row of await readAll()) {
      expect(encryption.decryptString(row.value, `${table}:${row.id}`)).toBe(values.get(row.id));
    }
  });
});
