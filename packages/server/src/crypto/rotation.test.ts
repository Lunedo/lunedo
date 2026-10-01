import { randomBytes } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import { createLogger } from "../logging/logger.js";
import type { EncryptedColumn } from "./encrypted-column.js";
import type { EncryptedStreamOwner } from "./encrypted-stream.js";
import { Encryption } from "./envelope.js";
import { FileKeyProvider } from "./key-provider.js";
import { KeyRingError } from "./key-ring.js";
import { KeyRingHolder } from "./key-ring-holder.js";
import { KeyRotation, rotateDataKeysJob, rotateMasterKey } from "./rotation.js";
import {
  createDecryptStream,
  createEncryptStream,
  masterStreamKeys,
  STREAM_HEADER_LENGTH,
} from "./stream.js";

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
    await holder.reload({ create: true });
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

describe.skipIf(!databaseUrl)("concurrent key rotations", () => {
  it("end with one consistent key ring and every value stays readable", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-rotation-"));
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    const database = createDatabase(pool);
    const table = `test_secrets_${randomBytes(4).toString("hex")}`;
    const columns: EncryptedColumn[] = [{ table, idColumn: "id", column: "value" }];
    const queue = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
    });
    try {
      await database.execute(sql.raw(`create table "${table}" (id uuid primary key, value bytea)`));
      const keyFile = path.join(dir, "master-keys");
      const node = () => {
        const keyRing = new KeyRingHolder(new FileKeyProvider(keyFile), logger);
        const encryption = new Encryption(() => keyRing.ring);
        const rotation = new KeyRotation({
          database,
          encryption,
          keyRing,
          jobs: queue,
          columns: () => columns,
        });
        return { keyRing, encryption, rotation };
      };
      const [a, b, worker] = [node(), node(), node()];
      for (const holder of [a, b, worker]) await holder.keyRing.reload({ create: true });

      const values = new Map<string, string>();
      for (let i = 0; i < 50; i++) {
        const id = uuidv7();
        values.set(id, `secret ${i}`);
        await database.execute(
          sql`insert into ${sql.identifier(table)} (id, value) values (${id}, ${a.encryption.encrypt(`secret ${i}`, id)})`,
        );
      }
      await queue.work(rotateDataKeysJob, worker.rotation.run);

      const started = await Promise.all([
        rotateMasterKey({ pool, keyRing: a.keyRing, rotation: a.rotation }),
        rotateMasterKey({ pool, keyRing: b.keyRing, rotation: b.rotation }),
      ]);
      expect(started.map((rotation) => rotation.targetVersion).sort()).toEqual([2, 3]);

      const fileVersions = readFileSync(keyFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split(":")[0]);
      expect(fileVersions).toEqual(["1", "2", "3"]);
      for (const holder of [a, b, worker]) await holder.keyRing.reload();
      for (const version of [1, 2, 3]) {
        expect(a.keyRing.ring.get(version).use().equals(b.keyRing.ring.get(version).use())).toBe(true);
      }

      await waitFor(async () => {
        const rows = await database.execute<{ status: string }>(
          sql`select status from key_rotations where id in (${started[0]?.id}, ${started[1]?.id})`,
        );
        return rows.rows.length === 2 && rows.rows.every((row) => row.status === "completed");
      }, 30_000);
      expect((await worker.rotation.status()).valuesByVersion).toMatchObject({ 3: 50 });

      const rows = await database.execute<{ id: string; value: Buffer }>(
        sql`select id, value from ${sql.identifier(table)}`,
      );
      for (const row of rows.rows) {
        expect(b.encryption.decryptString(row.value, row.id)).toBe(values.get(row.id));
      }
    } finally {
      await queue.stop({ timeoutSeconds: 1 });
      await database.execute(sql.raw(`drop table if exists "${table}"`));
      await pool.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!databaseUrl)("key rotation of streams", () => {
  it("re-wraps registered streams and completes only when they are done", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-stream-rotation-"));
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    const database = createDatabase(pool);
    const queue = new PgBossQueue({
      connectionString: databaseUrl,
      database,
      logger,
      role: "worker",
      pollingIntervalSeconds: 0.5,
    });
    try {
      const keyFile = path.join(dir, "master-keys");
      const keyRing = new KeyRingHolder(new FileKeyProvider(keyFile), logger);
      await keyRing.reload({ create: true });
      const streamsDir = path.join(dir, "streams");
      mkdirSync(streamsDir);

      const contents = new Map<string, Buffer>();
      for (let i = 0; i < 5; i++) {
        const data = randomBytes(1000 + i);
        const file = path.join(streamsDir, `stream-${i}`);
        await pipeline(
          Readable.from([data]),
          createEncryptStream(masterStreamKeys(() => keyRing.ring)),
          createWriteStream(file),
        );
        contents.set(file, data);
      }

      const owner: EncryptedStreamOwner = {
        name: "test-files",
        async *streams() {
          for (const name of readdirSync(streamsDir)) {
            const file = path.join(streamsDir, name);
            yield {
              id: name,
              readHeader: async () => readFileSync(file).subarray(0, STREAM_HEADER_LENGTH),
              writeHeader: async (header: Buffer) => {
                const handle = await open(file, "r+");
                try {
                  await handle.write(header, 0, header.length, 0);
                } finally {
                  await handle.close();
                }
              },
            };
          }
        },
      };
      const rotation = new KeyRotation({
        database,
        encryption: new Encryption(() => keyRing.ring),
        keyRing,
        jobs: queue,
        columns: () => [],
        streams: { owners: () => [owner], context: { database, filesDir: dir } },
      });
      await queue.work(rotateDataKeysJob, rotation.run);
      expect((await rotation.status()).valuesByVersion).toEqual({ 1: 5 });

      const started = await rotateMasterKey({ pool, keyRing, rotation });
      await waitFor(async () => {
        const rows = await database.execute<{ status: string }>(
          sql`select status from key_rotations where id = ${started.id}`,
        );
        return rows.rows[0]?.status === "completed";
      });
      expect((await rotation.status()).valuesByVersion).toEqual({ 2: 5 });

      writeFileSync(
        keyFile,
        readFileSync(keyFile, "utf8")
          .split("\n")
          .filter((line) => !line.startsWith("1:"))
          .join("\n"),
      );
      await keyRing.reload();
      for (const [file, data] of contents) {
        const decrypted = await buffer(
          Readable.from([readFileSync(file)]).pipe(createDecryptStream(masterStreamKeys(() => keyRing.ring))),
        );
        expect(decrypted.equals(data)).toBe(true);
      }
    } finally {
      await queue.stop({ timeoutSeconds: 1 });
      await pool.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
