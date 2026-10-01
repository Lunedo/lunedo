import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurationForBackup } from "../config/backup-view.js";
import { DecryptionError } from "../crypto/envelope.js";
import { formatKeyEntry, type KeyRing, keyFingerprint, parseKeyRing } from "../crypto/key-ring.js";
import { createLogger } from "../logging/logger.js";
import {
  BackupError,
  createBackup,
  isSafeRelativePath,
  openBackupArchive,
  readBackupHeader,
  restoreBackup,
  verifyBackup,
} from "./archive.js";
import type { DatabaseArchiver } from "./postgres.js";
import {
  checkRestoreComplete,
  IncompleteRestoreError,
  RESTORE_MARKER,
  RESTORE_STAGING,
  writeRestoreMarker,
} from "./restore-marker.js";

const logger = createLogger({ service: "test", level: "silent" });

class FakeDatabase implements DatabaseArchiver {
  restored: Buffer | undefined;
  replacedExisting: boolean | undefined;
  /** Fails the restore after this many bytes, like a connection lost in the middle of it. */
  failAfter: number | undefined;

  constructor(
    readonly content: Buffer,
    public empty = true,
  ) {}

  dump(): Readable {
    return Readable.from([this.content]);
  }

  async restore(dump: Readable, options: { replaceExisting: boolean }): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of dump) {
      chunks.push(chunk as Buffer);
      size += (chunk as Buffer).length;
      if (this.failAfter !== undefined && size > this.failAfter) {
        throw new Error("connection to the database lost");
      }
    }
    this.restored = Buffer.concat(chunks);
    this.replacedExisting = options.replaceExisting;
    this.empty = false;
  }

  async isEmpty(): Promise<boolean> {
    return this.empty;
  }
}

const ring = (...entries: [number, Buffer][]): KeyRing =>
  parseKeyRing(entries.map(([version, key]) => formatKeyEntry(version, key)).join("\n"));

let dir: string;
let key1: Buffer;
let backupKeys: KeyRing;
let masterKeys: KeyRing;
let filesDir: string;
let archivePath: string;
const databaseDump = Buffer.from("PGDMP fake database dump with marker-database-content");
const schemaVersion = "0000_foundation";
const knownSchemaVersions = [schemaVersion];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pagehall-backup-"));
  key1 = randomBytes(32);
  backupKeys = ring([1, key1]);
  masterKeys = ring([1, randomBytes(32)]);
  filesDir = path.join(dir, "files");
  archivePath = path.join(dir, "backup.phbak");
  await mkdir(path.join(filesDir, "attachments", "2026"), { recursive: true });
  await writeFile(path.join(filesDir, "attachments", "2026", "report.pdf"), "marker-file-content");
  await writeFile(path.join(filesDir, "logo.png"), randomBytes(2 * 1024 * 1024));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function requiredMasterKeys(keys: KeyRing = masterKeys) {
  return keys.versions.map((version) => ({
    version,
    fingerprint: keyFingerprint("master", keys.get(version)),
  }));
}

async function create(options: { schemaVersion?: string; keys?: KeyRing; masterKeys?: KeyRing } = {}) {
  return createBackup({
    output: archivePath,
    backupKeys: options.keys ?? backupKeys,
    masterKeys: requiredMasterKeys(options.masterKeys),
    database: new FakeDatabase(databaseDump),
    filesDir,
    config: { "environment.json": '{"PAGEHALL_HOST":"0.0.0.0"}\n' },
    pagehallVersion: "1.0.0",
    schemaVersion: options.schemaVersion ?? schemaVersion,
    logger,
  });
}

function restoreInto(
  target: string,
  database: DatabaseArchiver,
  options: { force?: boolean; masterKeys?: KeyRing | null } = {},
) {
  return restoreBackup({
    input: archivePath,
    backupKeys,
    knownSchemaVersions,
    masterKeys: options.masterKeys === undefined ? masterKeys : options.masterKeys,
    database,
    filesDir: target,
    configDir: path.join(dir, "restored-config"),
    force: options.force ?? false,
    logger,
  });
}

/** Replaces everything after the header with garbage, to prove that a check runs before data is read. */
async function destroyData() {
  const { bytes } = await readBackupHeader(archivePath);
  await writeFile(archivePath, Buffer.concat([bytes, randomBytes(64)]));
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
    const verified = await verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions });
    expect(verified).toEqual(created);
  });

  it("start with a readable, unencrypted header", async () => {
    const created = await create();
    const { header, bytes } = await readBackupHeader(archivePath);
    expect(bytes.subarray(0, 4).toString()).toBe("PHBK");
    expect(bytes.readUInt16BE(4)).toBe(1);
    expect(header).toEqual({
      pagehallVersion: "1.0.0",
      schemaVersion,
      createdAt: created.createdAt,
      key: { version: 1, fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) },
      masterKeys: [{ version: 1, fingerprint: keyFingerprint("master", masterKeys.get(1)) }],
      cipher: "AES-256-GCM",
      chunkSize: 65536,
    });
  });

  it("encrypt everything after the header", async () => {
    await create();
    const raw = await readFile(archivePath);
    const { bytes } = await readBackupHeader(archivePath);
    const body = raw.subarray(bytes.length);
    expect(body.subarray(0, 3).toString()).toBe("PHS");
    for (const marker of ["marker-file-content", "marker-database-content", "report.pdf"]) {
      expect(raw.includes(marker)).toBe(false);
    }
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
    expect(database.replacedExisting).toBe(true);
    expect((await readdir(target)).sort()).toEqual(["attachments", "logo.png"]);
  });

  it("stay readable after a new backup key version is added", async () => {
    await create();
    const rotated = ring([1, key1], [2, randomBytes(32)]);
    await expect(
      verifyBackup({ input: archivePath, backupKeys: rotated, knownSchemaVersions }),
    ).resolves.toBeTruthy();
  });

  it("detect tampering and truncation of the encrypted data", async () => {
    await create();
    const raw = await readFile(archivePath);
    const tampered = Buffer.from(raw);
    const middle = Math.floor(raw.length / 2);
    tampered[middle] = (tampered[middle] ?? 0) ^ 0x01;
    await writeFile(archivePath, tampered);
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      DecryptionError,
    );

    await writeFile(archivePath, raw);
    await truncate(archivePath, raw.length - 100);
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow();
  });
});

describe("the backup header", () => {
  it("is authenticated: a modified header fails decryption", async () => {
    const created = await create();
    const raw = await readFile(archivePath);
    const original = Buffer.from(created.createdAt);
    const changed = Buffer.from(
      created.createdAt.replace(/\d(?=Z$)/, (digit) => String((Number(digit) + 1) % 10)),
    );
    const offset = raw.indexOf(original);
    expect(offset).toBeGreaterThan(0);
    changed.copy(raw, offset);
    await writeFile(archivePath, raw);
    expect((await readBackupHeader(archivePath)).header.createdAt).toBe(changed.toString());
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      DecryptionError,
    );
  });

  it("refuses an unknown format version before reading data", async () => {
    await create();
    const raw = await readFile(archivePath);
    raw.writeUInt16BE(2, 4);
    await writeFile(archivePath, raw);
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      "The backup uses format version 2, which this Pagehall version cannot read.",
    );
  });

  it("refuses files that are not backups", async () => {
    await writeFile(archivePath, "not a backup");
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      "is not a Pagehall backup",
    );
  });

  it("refuses a backup from a newer schema version before reading data", async () => {
    await create({ schemaVersion: "0099_future" });
    await destroyData();
    for (const run of [
      () => verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions }),
      () => restoreInto(path.join(dir, "target"), new FakeDatabase(Buffer.alloc(0))),
    ]) {
      await expect(run()).rejects.toThrow(
        "The backup was created by Pagehall 1.0.0 with schema version 0099_future, which is newer than this Pagehall version supports. Update Pagehall to version 1.0.0 or newer and run the command again.",
      );
    }
  });

  it("reports a missing backup key version before reading data", async () => {
    await create({ keys: ring([1, key1], [2, randomBytes(32)]) });
    await destroyData();
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      /^The backup is encrypted with backup key version 2 \(fingerprint [0-9a-f]{16}\), which is not configured\. Add this key version to PAGEHALL_BACKUP_KEY/,
    );
  });

  it("reports a different key under the same version before reading data", async () => {
    await create({ keys: ring([1, randomBytes(32)]) });
    await destroyData();
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      /but the configured key version 1 has fingerprint/,
    );
  });
});

describe("interrupted restores", () => {
  let target: string;

  beforeEach(async () => {
    await create();
    target = path.join(dir, "instance");
    await mkdir(target);
    await writeFile(path.join(target, "stale.txt"), "old");
  });

  function failingDatabase() {
    const database = new FakeDatabase(Buffer.alloc(0), false);
    database.failAfter = 10;
    return database;
  }

  it("leave the instance unchanged when the database restore fails", async () => {
    const database = failingDatabase();
    await expect(restoreInto(target, database, { force: true })).rejects.toThrow(
      "connection to the database lost",
    );
    expect(database.restored).toBeUndefined();
    expect(await readdir(target)).toEqual(["stale.txt"]);
    await expect(checkRestoreComplete(target)).resolves.toBeUndefined();
  });

  it("keep the marker when the restore fails after the database commit, until a restore completes", async () => {
    const configDir = path.join(dir, "restored-config");
    await writeFile(configDir, "a file where the configuration directory should be");
    const database = new FakeDatabase(Buffer.alloc(0), false);
    await expect(restoreInto(target, database, { force: true })).rejects.toThrow(
      /^The database was restored, but the restore did not complete: .*run again with --force.$/,
    );
    expect(database.restored?.equals(databaseDump)).toBe(true);
    expect((await readdir(target)).sort()).toEqual([RESTORE_MARKER, RESTORE_STAGING, "stale.txt"].sort());
    const refused = await checkRestoreComplete(target).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(IncompleteRestoreError);
    expect((refused as Error).message).toContain(`The restore of the backup ${archivePath}, started at `);
    expect((refused as Error).message).toContain(`pagehall backup restore --input ${archivePath} --force`);

    await rm(configDir);
    await restoreInto(target, database, { force: true });
    expect((await readdir(target)).sort()).toEqual(["attachments", "logo.png"]);
    await expect(checkRestoreComplete(target)).resolves.toBeUndefined();
  });

  it("keep the marker of an earlier incomplete restore when the next one fails early", async () => {
    await writeRestoreMarker(target, "earlier.phbak");
    await expect(restoreInto(target, failingDatabase(), { force: true })).rejects.toThrow(
      "connection to the database lost",
    );
    await expect(checkRestoreComplete(target)).rejects.toThrow(IncompleteRestoreError);
  });

  it("ignore what an interrupted restore left in the file store", async () => {
    await rm(path.join(target, "stale.txt"));
    await writeRestoreMarker(target, "earlier.phbak");
    await mkdir(path.join(target, RESTORE_STAGING, "attachments"), { recursive: true });
    await writeFile(path.join(target, RESTORE_STAGING, "attachments", "partial.bin"), "partial");

    await restoreInto(target, new FakeDatabase(Buffer.alloc(0)));
    expect((await readdir(target)).sort()).toEqual(["attachments", "logo.png"]);
    expect(await readdir(path.join(target, "attachments"))).toEqual(["2026"]);
  });

  it("are left out of backups", async () => {
    await writeRestoreMarker(filesDir, "earlier.phbak");
    await mkdir(path.join(filesDir, RESTORE_STAGING));
    await writeFile(path.join(filesDir, RESTORE_STAGING, "partial.bin"), "partial");
    const created = await create();
    expect(created.entries.map((entry) => entry.path)).toEqual([
      "database.dump",
      "files/attachments/2026/report.pdf",
      "files/logo.png",
      "config/environment.json",
    ]);
  });
});

describe("master keys", () => {
  it("are listed in the header without revealing them", async () => {
    await create();
    const { bytes } = await readBackupHeader(archivePath);
    expect(bytes.includes(masterKeys.get(1).use())).toBe(false);
    expect(bytes.includes(masterKeys.get(1).use().toString("base64"))).toBe(false);
  });

  it("are not needed to verify a backup", async () => {
    await create();
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).resolves.toBeTruthy();
  });

  it("must be available before a restore writes anything", async () => {
    await create({ masterKeys: ring([1, masterKeys.get(1).use()], [2, randomBytes(32)]) });
    await destroyData();
    const target = path.join(dir, "target");
    const database = new FakeDatabase(Buffer.alloc(0));
    await expect(restoreInto(target, database)).rejects.toThrow(
      /^The backup contains data encrypted with master key version 2 \(fingerprint [0-9a-f]{16}\), which is not available on this instance\. Copy the master key ring of the instance the backup comes from/,
    );
    await expect(restoreInto(target, database, { masterKeys: null })).rejects.toThrow(
      "which is not available",
    );
    expect(database.restored).toBeUndefined();
    await expect(readdir(target)).rejects.toThrow();
  });

  it("must be the same keys, not only the same versions", async () => {
    await create({ masterKeys: ring([1, randomBytes(32)]) });
    await destroyData();
    await expect(restoreInto(path.join(dir, "target"), new FakeDatabase(Buffer.alloc(0)))).rejects.toThrow(
      /but master key version 1 of this instance has fingerprint [0-9a-f]{16}/,
    );
  });
});

describe("archive entries", () => {
  async function craft(entries: { name: string; type?: string; linkname?: string; content?: string }[]) {
    const { pack, finished } = openBackupArchive({
      output: archivePath,
      backupKeys,
      masterKeys: [],
      pagehallVersion: "1.0.0",
      schemaVersion,
    });
    for (const entry of entries) {
      pack.entry(
        { name: entry.name, type: entry.type as never, linkname: entry.linkname },
        entry.content ?? "",
      );
    }
    pack.finalize();
    await finished;
  }

  it.each([
    ["a symbolic link", { name: "files/link", type: "symlink", linkname: "/etc/passwd" }],
    ["a hard link", { name: "files/hard", type: "link", linkname: "files/other" }],
    ["a device file", { name: "files/tty", type: "character-device" }],
    ["a device file", { name: "files/disk", type: "block-device" }],
    ["a named pipe", { name: "files/pipe", type: "fifo" }],
    ["a directory", { name: "files/dir/", type: "directory" }],
  ])("rejects %s", async (kind, entry) => {
    await craft([entry]);
    await expect(restoreInto(path.join(dir, "target"), new FakeDatabase(Buffer.alloc(0)))).rejects.toThrow(
      `is ${kind}`,
    );
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["an absolute path inside the file store", "files//etc/passwd"],
    ["a parent reference", "files/../../escape.txt"],
    ["an unknown location", "elsewhere/file.txt"],
  ])("rejects %s", async (_case, name) => {
    await craft([{ name, content: "x" }]);
    await expect(restoreInto(path.join(dir, "target"), new FakeDatabase(Buffer.alloc(0)))).rejects.toThrow(
      "is outside the restore targets",
    );
  });

  it("rejects an archive without a manifest", async () => {
    await craft([{ name: "database.dump", content: "x" }]);
    await expect(verifyBackup({ input: archivePath, backupKeys, knownSchemaVersions })).rejects.toThrow(
      "no manifest",
    );
  });

  it("writes nothing when an entry is rejected", async () => {
    await craft([
      { name: "files/ok.txt", content: "ok" },
      { name: "files/link", type: "symlink", linkname: "/etc/passwd" },
    ]);
    const target = path.join(dir, "target");
    await expect(restoreInto(target, new FakeDatabase(Buffer.alloc(0)))).rejects.toThrow(BackupError);
    expect(await readdir(target)).toEqual([]);
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
