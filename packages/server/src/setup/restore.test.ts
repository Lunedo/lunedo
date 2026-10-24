import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { BlockList } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup } from "../backup/archive.js";
import { backupName } from "../backup/naming.js";
import type { DatabaseArchiver } from "../backup/postgres.js";
import { FileKeyProvider } from "../crypto/key-provider.js";
import { formatKeyEntry, type KeyRing, keyFingerprint, parseKeyRing } from "../crypto/key-ring.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { createLogger } from "../logging/logger.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { parseKeyInput, RESTART_CHANNEL, SetupRestoreService, type StartRestoreInput } from "./restore.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const schemaVersion = "0000_foundation";

class FakeDatabase implements DatabaseArchiver {
  restored: Buffer | undefined;

  constructor(readonly content: Buffer) {}

  dump(): Readable {
    return Readable.from([this.content]);
  }

  async restore(dump: Readable): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of dump) chunks.push(chunk as Buffer);
    this.restored = Buffer.concat(chunks);
  }

  async isEmpty(): Promise<boolean> {
    return false;
  }
}

const ring = (key: Buffer): KeyRing => parseKeyRing(formatKeyEntry(1, key));

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The restore did not finish");
}

describe("reading keys pasted into the restore", () => {
  it("accepts a key ring, a line of the key file and the whole key file", () => {
    const key = randomBytes(32);
    const entry = formatKeyEntry(1, key);
    const file = `# Lunedo keys\nLUNEDO_MASTER_KEYS=${formatKeyEntry(2, randomBytes(32))}\nLUNEDO_BACKUP_KEY=${entry}\n`;
    expect(parseKeyInput(entry, "LUNEDO_BACKUP_KEY").versions).toEqual([1]);
    expect(parseKeyInput(file, "LUNEDO_BACKUP_KEY").get(1).use().equals(key)).toBe(true);
    expect(parseKeyInput(file, "LUNEDO_MASTER_KEYS").versions).toEqual([2]);
    expect(parseKeyInput(key.toString("base64"), "LUNEDO_BACKUP_KEY").versions).toEqual([1]);
    expect(() => parseKeyInput("not a key", "LUNEDO_BACKUP_KEY")).toThrow();
  });
});

describe.skipIf(!baseUrl)("restoring a backup during the setup", () => {
  let test: TestServices;
  let dir: string;
  let backupDir: string;
  let filesDir: string;
  let secretsDir: string;
  let backupKey: Buffer;
  let masterKey: Buffer;
  let database: FakeDatabase;
  let migrate: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let notified: string[];
  let keyRing: KeyRingHolder;
  let service: SetupRestoreService;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lunedo-setup-restore-"));
    backupDir = path.join(dir, "backups");
    filesDir = path.join(dir, "files");
    secretsDir = path.join(dir, "secrets");
    await mkdir(backupDir, { recursive: true });
    await mkdir(path.join(dir, "source", "attachments"), { recursive: true });
    await mkdir(filesDir, { recursive: true });
    await writeFile(path.join(dir, "source", "attachments", "report.pdf"), "restored-file-content");
    await writeFile(path.join(filesDir, "left-from-the-setup.txt"), "old");
    backupKey = randomBytes(32);
    masterKey = randomBytes(32);
    await createBackup({
      output: path.join(backupDir, "lunedo-2026-10-23.ldbak"),
      stagingDir: path.join(dir, "staging"),
      backupKeys: ring(backupKey),
      masterKeys: [{ version: 1, fingerprint: keyFingerprint("master", ring(masterKey).get(1)) }],
      database: new FakeDatabase(Buffer.from("PGDMP restored database")),
      filesDir: path.join(dir, "source"),
      config: {},
      lunedoVersion: "1.0.3",
      schemaVersion,
      logger,
    });
    database = new FakeDatabase(Buffer.alloc(0));
    migrate = vi.fn<() => Promise<void>>(async () => {});
    notified = [];
    keyRing = new KeyRingHolder(new FileKeyProvider(path.join(secretsDir, "master-keys")), logger);
    await keyRing.reload({ create: true });
    service = new SetupRestoreService({
      backupDir,
      workDir: path.join(dir, "work"),
      filesDir,
      databaseUrl: "postgres://unused",
      policy: { allowedNetworks: new BlockList(), resolve: async () => [] },
      keys: {
        provider: "file",
        masterKeysPath: path.join(secretsDir, "master-keys"),
        backupKeysPath: path.join(secretsDir, "backup-keys"),
      },
      keyRing,
      pool: {
        query: async (_text: string, values: string[]) => {
          if (values?.[0] === RESTART_CHANNEL) notified.push(values[1] ?? "");
          return { rows: [] };
        },
      } as never,
      database: test.database,
      knownSchemaVersions: [schemaVersion],
      migrate,
      archiver: () => database,
      logger,
    });
  });

  const keys = () => ({
    backupKey: `LUNEDO_BACKUP_KEY=${formatKeyEntry(1, backupKey)}`,
    masterKeys: `# Lunedo keys\nLUNEDO_MASTER_KEYS=${formatKeyEntry(1, masterKey)}\n`,
  });

  it("lists the backups of the backup directory with their header", async () => {
    await writeFile(path.join(backupDir, "broken.ldbak"), "not a backup");
    await writeFile(path.join(backupDir, "notes.txt"), "ignored");
    const listed = await service.listDirectory();
    expect(listed.directory).toBe(await realpath(backupDir));
    expect(listed.freeBytes).toBeGreaterThan(0);
    expect(listed.backups).toEqual([
      expect.objectContaining({
        name: "lunedo-2026-10-23.ldbak",
        lunedoVersion: "1.0.3",
        scope: "all",
        readable: true,
      }),
      expect.objectContaining({ name: "broken.ldbak", readable: false }),
    ]);
    await expect(service.listDirectory("relative/path")).rejects.toMatchObject({
      code: "directoryNotReadable",
    });
    await expect(service.listDirectory(path.join(dir, "missing"))).rejects.toMatchObject({
      code: "directoryNotReadable",
    });
  });

  it("restores database, files and keys, pauses the backups and asks every process to restart", async () => {
    const token = await service.start({
      source: { type: "directory", name: "lunedo-2026-10-23.ldbak" },
      ...keys(),
    });
    const status = await until(
      () => service.status(token),
      (value) => value?.state !== "running",
    );
    expect(status).toMatchObject({
      state: "done",
      backup: "lunedo-2026-10-23.ldbak",
      failure: null,
      steps: [
        { id: "verify", state: "done" },
        { id: "database", state: "done" },
        { id: "files", state: "done" },
        { id: "migrations", state: "done" },
      ],
    });
    expect(database.restored?.toString()).toBe("PGDMP restored database");
    expect(await readFile(path.join(filesDir, "attachments", "report.pdf"), "utf8")).toBe(
      "restored-file-content",
    );
    await expect(readFile(path.join(filesDir, "left-from-the-setup.txt"))).rejects.toThrow();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(keyRing.ring.get(1).use().equals(masterKey)).toBe(true);
    expect(
      parseKeyRing(await readFile(path.join(secretsDir, "backup-keys"), "utf8"))
        .get(1)
        .use()
        .equals(backupKey),
    ).toBe(true);
    const paused = await test.pool.query("select restored_at from backup_state where singleton");
    expect(paused.rows[0]?.restored_at).not.toBeNull();
    expect(notified).toEqual(["restored"]);
    expect(await service.status("someone-elses-token-0000000000000000000000")).toBeNull();
  });

  it("stops before anything is replaced when the backup key does not fit", async () => {
    const token = await service.start({
      source: { type: "directory", name: "lunedo-2026-10-23.ldbak" },
      ...keys(),
      backupKey: formatKeyEntry(1, randomBytes(32)),
    } satisfies StartRestoreInput);
    const status = await until(
      () => service.status(token),
      (value) => value?.state !== "running",
    );
    expect(status).toMatchObject({ state: "failed", failure: { code: "backupKey" } });
    expect(status?.steps[0]).toEqual({ id: "verify", state: "failed" });
    expect(database.restored).toBeUndefined();
    expect(await readFile(path.join(filesDir, "left-from-the-setup.txt"), "utf8")).toBe("old");
    expect(keyRing.ring.get(1).use().equals(masterKey)).toBe(false);
    expect(notified).toEqual([]);
  });

  it("refuses keys it cannot read and a second restore while one runs", async () => {
    await expect(
      service.start({
        source: { type: "directory", name: "lunedo-2026-10-23.ldbak" },
        backupKey: "x",
        masterKeys: "y",
      }),
    ).rejects.toMatchObject({ code: "invalidKeys" });
    await expect(
      service.start({ source: { type: "directory", name: "../secrets/master-keys" }, ...keys() }),
    ).rejects.toMatchObject({ code: "backupNotFound" });
    const first = service.start({
      source: { type: "directory", name: "lunedo-2026-10-23.ldbak" },
      ...keys(),
    });
    await expect(
      service.start({ source: { type: "directory", name: "lunedo-2026-10-23.ldbak" }, ...keys() }),
    ).rejects.toMatchObject({ code: "restoreRunning" });
    const token = await first;
    await until(
      () => service.status(token),
      (value) => value?.state !== "running",
    );
  });

  it("takes a backup in parts, continues after an interruption and refuses parts out of order", async () => {
    const content = await readFile(path.join(backupDir, "lunedo-2026-10-23.ldbak"));
    await expect(
      service.startUpload({ name: "huge.ldbak", size: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({
      code: "notEnoughSpace",
    });
    const upload = await service.startUpload({
      name: "../../Upload from laptop.ldbak",
      size: content.length,
    });
    expect(upload.name).toBe("Upload-from-laptop.ldbak");
    const half = Math.floor(content.length / 2);
    await service.appendUpload(upload.id, 0, Readable.from([content.subarray(0, half)]));
    expect((await service.upload(upload.id)).received).toBe(half);
    await expect(
      service.appendUpload(upload.id, 0, Readable.from([content.subarray(0, 10)])),
    ).rejects.toMatchObject({
      code: "uploadOffset",
    });
    await expect(
      service.appendUpload(upload.id, half, Readable.from([content.subarray(half), Buffer.from("extra")])),
    ).rejects.toMatchObject({ code: "uploadTooLarge" });
    expect((await service.upload(upload.id)).received).toBe(half);
    const done = await service.appendUpload(upload.id, half, Readable.from([content.subarray(half)]));
    expect(done).toMatchObject({
      complete: true,
      file: "Upload-from-laptop.ldbak",
      received: content.length,
    });
    expect((await readFile(path.join(backupDir, "Upload-from-laptop.ldbak"))).equals(content)).toBe(true);
    await expect(service.upload("../escape")).rejects.toMatchObject({ code: "uploadNotFound" });

    const token = await service.start({
      source: { type: "upload", name: "Upload-from-laptop.ldbak" },
      ...keys(),
    });
    expect(
      await until(
        () => service.status(token),
        (value) => value?.state !== "running",
      ),
    ).toMatchObject({ state: "done" });
  });

  it("says that a restore was interrupted when the process ended in the middle of it", async () => {
    const token = await service.start({
      source: { type: "directory", name: "lunedo-2026-10-23.ldbak" },
      ...keys(),
    });
    await until(
      () => service.status(token),
      (value) => value?.state !== "running",
    );
    const file = path.join(dir, "work", "setup-restore.json");
    const stored = JSON.parse(await readFile(file, "utf8"));
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        state: "running",
        steps: [{ id: "database", state: "running" }],
        finishedAt: null,
      }),
    );
    const restarted = new SetupRestoreService({
      backupDir,
      workDir: path.join(dir, "work"),
      filesDir,
      databaseUrl: "postgres://unused",
      policy: { allowedNetworks: new BlockList(), resolve: async () => [] },
      keys: { provider: "file", masterKeysPath: path.join(secretsDir, "master-keys"), backupKeysPath: null },
      keyRing,
      pool: test.pool,
      database: test.database,
      knownSchemaVersions: [schemaVersion],
      migrate,
      logger,
    });
    expect(await restarted.status(token)).toMatchObject({
      state: "failed",
      steps: [{ id: "database", state: "failed" }],
      failure: { code: "interrupted" },
    });
    await rm(dir, { recursive: true, force: true });
  });
});

const s3Endpoint = process.env.LUNEDO_TEST_S3_ENDPOINT?.trim();

describe.skipIf(!baseUrl || !s3Endpoint)("restoring a backup from a bucket during the setup", () => {
  const bucket = `lunedo-restore-${randomBytes(4).toString("hex")}`;
  const credentials = {
    accessKeyId: process.env.LUNEDO_TEST_S3_ACCESS_KEY_ID ?? "lunedo",
    secretAccessKey: process.env.LUNEDO_TEST_S3_SECRET_ACCESS_KEY ?? "lunedo-s3",
  };
  const client = new S3Client({
    region: "us-east-1",
    endpoint: s3Endpoint,
    forcePathStyle: true,
    credentials,
  });
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    client.destroy();
    await test?.close();
  });

  it("lists the backups of the bucket and downloads the chosen one before restoring it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lunedo-setup-restore-s3-"));
    const backupKey = randomBytes(32);
    const masterKey = randomBytes(32);
    const name = backupName("daily", new Date("2026-10-23T02:00:00Z"));
    await mkdir(path.join(dir, "source"), { recursive: true });
    await createBackup({
      output: path.join(dir, name),
      stagingDir: path.join(dir, "staging"),
      backupKeys: ring(backupKey),
      masterKeys: [{ version: 1, fingerprint: keyFingerprint("master", ring(masterKey).get(1)) }],
      database: new FakeDatabase(Buffer.from("PGDMP from the bucket")),
      filesDir: path.join(dir, "source"),
      config: {},
      lunedoVersion: "1.0.2",
      schemaVersion,
      logger,
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `lunedo/${name}`,
        Body: await readFile(path.join(dir, name)),
      }),
    );
    const database = new FakeDatabase(Buffer.alloc(0));
    const secretsDir = path.join(dir, "secrets");
    const keyRing = new KeyRingHolder(new FileKeyProvider(path.join(secretsDir, "master-keys")), logger);
    await keyRing.reload({ create: true });
    const service = new SetupRestoreService({
      backupDir: path.join(dir, "backups"),
      workDir: path.join(dir, "work"),
      filesDir: path.join(dir, "files"),
      databaseUrl: "postgres://unused",
      policy: outboundPolicy(["127.0.0.0/8", "::1/128"]),
      keys: { provider: "file", masterKeysPath: path.join(secretsDir, "master-keys"), backupKeysPath: null },
      keyRing,
      pool: { query: async () => ({ rows: [] }) } as never,
      database: test.database,
      knownSchemaVersions: [schemaVersion],
      migrate: async () => {},
      archiver: () => database,
      logger,
    });
    await mkdir(path.join(dir, "files"), { recursive: true });
    const target = {
      endpoint: s3Endpoint ?? null,
      region: "us-east-1",
      bucket,
      prefix: "lunedo/",
      forcePathStyle: true,
      ...credentials,
    };
    expect(await service.listS3(target)).toEqual([
      expect.objectContaining({ name, lunedoVersion: "1.0.2", scope: "all", readable: true }),
    ]);
    await expect(service.listS3({ ...target, secretAccessKey: "wrong" })).rejects.toMatchObject({
      failure: "credentials",
    });
    const token = await service.start({
      source: { type: "s3", name, ...target },
      backupKey: formatKeyEntry(1, backupKey),
      masterKeys: formatKeyEntry(1, masterKey),
    });
    const status = await until(
      () => service.status(token),
      (value) => value?.state !== "running",
    );
    expect(status?.failure).toBeNull();
    expect(status).toMatchObject({ state: "done" });
    expect(status?.steps[0]).toEqual({ id: "download", state: "done" });
    expect(database.restored?.toString()).toBe("PGDMP from the bucket");
    expect(await readFile(path.join(dir, "backups", name))).toBeTruthy();
    expect(await readFile(path.join(dir, "work", "setup-restore.json"), "utf8")).not.toContain(
      credentials.secretAccessKey,
    );
    await rm(dir, { recursive: true, force: true });
  });
});
