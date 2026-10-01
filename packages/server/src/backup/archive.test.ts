import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurationForBackup } from "../config/backup-view.js";
import { DecryptionError } from "../crypto/envelope.js";
import { KeyRingError, SecretKey } from "../crypto/key-ring.js";
import { backupStreamKeys, createEncryptStream } from "../crypto/stream.js";
import { createLogger } from "../logging/logger.js";
import { BackupError, createBackup, isSafeRelativePath, restoreBackup, verifyBackup } from "./archive.js";
import type { DatabaseArchiver } from "./postgres.js";

const logger = createLogger({ service: "test", level: "silent" });

class FakeDatabase implements DatabaseArchiver {
  restored: Buffer | undefined;
  cleared = false;

  constructor(
    readonly content: Buffer,
    public empty = true,
  ) {}

  dump(): Readable {
    return Readable.from([this.content]);
  }

  async restore(dump: Readable): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of dump) chunks.push(chunk as Buffer);
    this.restored = Buffer.concat(chunks);
  }

  async isEmpty(): Promise<boolean> {
    return this.empty;
  }

  async clear(): Promise<void> {
    this.cleared = true;
    this.empty = true;
  }
}

let dir: string;
let backupKey: SecretKey;
let filesDir: string;
let archivePath: string;
const databaseDump = Buffer.from("PGDMP fake database dump with marker-database-content");
const schemaVersion = "0000_foundation";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pagehall-backup-"));
  backupKey = new SecretKey(randomBytes(32));
  filesDir = path.join(dir, "files");
  archivePath = path.join(dir, "backup.phbak");
  await mkdir(path.join(filesDir, "attachments", "2026"), { recursive: true });
  await writeFile(path.join(filesDir, "attachments", "2026", "report.pdf"), "marker-file-content");
  await writeFile(path.join(filesDir, "logo.png"), randomBytes(2 * 1024 * 1024));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function create(database = new FakeDatabase(databaseDump)) {
  return createBackup({
    output: archivePath,
    backupKey,
    database,
    filesDir,
    config: { "environment.json": '{"PAGEHALL_HOST":"0.0.0.0"}\n' },
    pagehallVersion: "1.0.0",
    schemaVersion,
    logger,
  });
}

async function restoreInto(target: string, database: FakeDatabase, options: { force?: boolean } = {}) {
  return restoreBackup({
    input: archivePath,
    backupKey,
    database,
    filesDir: target,
    configDir: path.join(dir, "restored-config"),
    force: options.force ?? false,
    knownSchemaVersions: [schemaVersion],
    logger,
  });
}

describe("backups", () => {
  it("contain the database, files and configuration with a manifest", async () => {
    const created = await create();
    expect(created.entries.map((entry) => entry.path)).toEqual([
      "database.dump",
      "files/attachments/2026/report.pdf",
      "files/logo.png",
      "config/environment.json",
    ]);
    const verified = await verifyBackup({ input: archivePath, backupKey });
    expect(verified).toEqual(created);
    expect(verified).toMatchObject({ format: 1, pagehallVersion: "1.0.0", schemaVersion });
  });

  it("are encrypted", async () => {
    await create();
    const raw = await readFile(archivePath);
    expect(raw.subarray(0, 3).toString()).toBe("PHS");
    expect(raw.includes("marker-file-content")).toBe(false);
    expect(raw.includes("marker-database-content")).toBe(false);
    expect(raw.includes("report.pdf")).toBe(false);
  });

  it("restore into an empty instance with identical content", async () => {
    await create();
    const database = new FakeDatabase(Buffer.alloc(0));
    const target = path.join(dir, "restored-files");
    await restoreInto(target, database);
    expect(database.restored?.equals(databaseDump)).toBe(true);
    expect(await readFile(path.join(target, "attachments", "2026", "report.pdf"), "utf8")).toBe(
      "marker-file-content",
    );
    expect(
      (await readFile(path.join(target, "logo.png"))).equals(await readFile(path.join(filesDir, "logo.png"))),
    ).toBe(true);
    expect(await readFile(path.join(dir, "restored-config", "environment.json"), "utf8")).toContain(
      "PAGEHALL_HOST",
    );
  });

  it("refuse to overwrite a non-empty database or file store without force", async () => {
    await create();
    await expect(
      restoreInto(path.join(dir, "empty"), new FakeDatabase(Buffer.alloc(0), false)),
    ).rejects.toThrow("the database is not empty");
    await expect(restoreInto(filesDir, new FakeDatabase(Buffer.alloc(0)))).rejects.toThrow(
      "the file store is not empty",
    );

    const target = path.join(dir, "occupied");
    await mkdir(target);
    await writeFile(path.join(target, "stale.txt"), "old");
    const database = new FakeDatabase(Buffer.alloc(0), false);
    await restoreInto(target, database, { force: true });
    expect(database.cleared).toBe(true);
    expect((await readdir(target)).sort()).toEqual(["attachments", "logo.png"]);
  });

  it("refuse backups with a schema version this version does not know", async () => {
    await create();
    await expect(
      restoreBackup({
        input: archivePath,
        backupKey,
        database: new FakeDatabase(Buffer.alloc(0)),
        filesDir: path.join(dir, "target"),
        force: false,
        knownSchemaVersions: ["0000_other"],
        logger,
      }),
    ).rejects.toThrow("does not know");
  });

  it("cannot be read with a different backup key", async () => {
    await create();
    await expect(
      verifyBackup({ input: archivePath, backupKey: new SecretKey(randomBytes(32)) }),
    ).rejects.toThrow(KeyRingError);
  });

  it("detect tampering and truncation", async () => {
    await create();
    const raw = await readFile(archivePath);
    const tampered = Buffer.from(raw);
    const middle = Math.floor(raw.length / 2);
    tampered[middle] = (tampered[middle] ?? 0) ^ 0x01;
    await writeFile(archivePath, tampered);
    await expect(verifyBackup({ input: archivePath, backupKey })).rejects.toThrow(DecryptionError);

    await writeFile(archivePath, raw);
    await truncate(archivePath, raw.length - 100);
    await expect(verifyBackup({ input: archivePath, backupKey })).rejects.toThrow();
  });

  it("reject archives with paths outside the file store", async () => {
    const pack = tar.pack();
    const writing = pipeline(
      pack,
      createGzip(),
      createEncryptStream(backupStreamKeys(backupKey)),
      createWriteStream(archivePath),
    );
    pack.entry({ name: "files/../../escape.txt" }, "x");
    pack.finalize();
    await writing;
    await expect(verifyBackup({ input: archivePath, backupKey })).rejects.toThrow(BackupError);
  });

  it("reject archives without a manifest", async () => {
    const pack = tar.pack();
    const writing = pipeline(
      pack,
      createGzip(),
      createEncryptStream(backupStreamKeys(backupKey)),
      createWriteStream(archivePath),
    );
    pack.entry({ name: "database.dump" }, "x");
    pack.finalize();
    await writing;
    await expect(verifyBackup({ input: archivePath, backupKey })).rejects.toThrow("no manifest");
  });
});

describe("isSafeRelativePath", () => {
  it.each(["a", "a/b.txt", "attachments/2026/x.pdf"])("accepts %s", (name) => {
    expect(isSafeRelativePath(name)).toBe(true);
  });

  it.each(["", "/etc/passwd", "../x", "a/../../x", "a/./b", "a//b", "a\\b", "a\0b"])("rejects %j", (name) => {
    expect(isSafeRelativePath(name)).toBe(false);
  });
});

describe("configurationForBackup", () => {
  it("removes key settings and masks secret values", async () => {
    const configFile = path.join(dir, "pagehall.json");
    await writeFile(
      configFile,
      JSON.stringify({
        PAGEHALL_API_PORT: 4000,
        PAGEHALL_BACKUP_KEY: "backup-secret",
        PAGEHALL_MASTER_KEYS: "1:x",
      }),
    );
    const files = configurationForBackup({
      PAGEHALL_CONFIG_FILE: configFile,
      PAGEHALL_DATABASE_URL: "postgres://u:db-secret@h/d",
      PAGEHALL_METRICS_TOKEN_FILE: "/run/secrets/metrics",
      PAGEHALL_MASTER_KEYS_PATH: "/secrets/master-keys",
      PAGEHALL_LOG_LEVEL: "debug",
    });
    const all = Object.values(files).join("\n");
    expect(all).not.toContain("backup-secret");
    expect(all).not.toContain("1:x");
    expect(all).not.toContain("db-secret");
    expect(all).not.toContain("master-keys");
    expect(JSON.parse(files["environment.json"] ?? "{}")).toEqual({
      PAGEHALL_CONFIG_FILE: configFile,
      PAGEHALL_LOG_LEVEL: "debug",
      PAGEHALL_DATABASE_URL: "[set]",
      PAGEHALL_METRICS_TOKEN_FILE: "/run/secrets/metrics",
    });
    expect(JSON.parse(files["pagehall.json"] ?? "{}")).toEqual({ PAGEHALL_API_PORT: 4000 });
  });
});
