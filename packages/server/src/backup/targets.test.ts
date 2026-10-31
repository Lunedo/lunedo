import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import type { FileStore } from "../files/store.js";
import { createLogger } from "../logging/logger.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { createBackup, verifyBackup } from "./archive.js";
import { backupName } from "./naming.js";
import type { DatabaseArchiver } from "./postgres.js";
import { applyRetention, listBackups } from "./runner.js";
import {
  BackupTargetError,
  LocalBackupTarget,
  S3BackupTarget,
  type S3TargetConfig,
  s3Failure,
} from "./targets.js";

const endpoint = process.env.LUNEDO_TEST_S3_ENDPOINT?.trim();
const accessKeyId = process.env.LUNEDO_TEST_S3_ACCESS_KEY_ID ?? "lunedo";
const secretAccessKey = process.env.LUNEDO_TEST_S3_SECRET_ACCESS_KEY ?? "lunedo-s3";
const logger = createLogger({ service: "test", level: "silent" });
const backupKeys = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
const MB = 1024 * 1024;

const database = (content: Buffer): DatabaseArchiver => ({
  dump: () => Readable.from([content]),
  restore: async () => {},
  isEmpty: async () => true,
});

describe("failures of S3 requests", () => {
  it.each([
    [Object.assign(new Error("x"), { code: "ENOTFOUND" }), "dns"],
    [Object.assign(new Error("x"), { code: "ECONNREFUSED" }), "connection"],
    [Object.assign(new Error("x"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), "tls"],
    [Object.assign(new Error("x"), { name: "InvalidAccessKeyId" }), "credentials"],
    [Object.assign(new Error("x"), { name: "SignatureDoesNotMatch" }), "credentials"],
    [Object.assign(new Error("x"), { name: "NoSuchBucket" }), "bucket"],
    [Object.assign(new Error("x"), { name: "AccessDenied" }), "permission"],
    [Object.assign(new Error("x"), { $metadata: { httpStatusCode: 403 } }), "permission"],
    [new Error("outer", { cause: Object.assign(new Error("x"), { code: "EAI_AGAIN" }) }), "dns"],
    [new Error("something else"), "other"],
  ])("classifies %s", (error, failure) => {
    expect(s3Failure(error)).toBe(failure);
  });

  it("never puts the cause into the message", () => {
    const error = new BackupTargetError("credentials", "write", {
      cause: new Error("https://bucket.example.org/x?X-Amz-Signature=secret"),
    });
    expect(error.message).toBe(
      "Writing to the backup target failed: The access key or the secret key was not accepted. Check both keys.",
    );
  });
});

describe("local backup target", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lunedo-target-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("removes partial files of interrupted backups, nothing else", async () => {
    const target = new LocalBackupTarget(dir);
    const name = backupName("daily", new Date());
    const destination = target.destination(name);
    const output = destination.open();
    await new Promise<void>((resolve) => output.end("partial", () => resolve()));
    await writeFile(path.join(dir, "keep.txt"), "x");
    expect((await readdir(dir)).some((entry) => entry.endsWith(".partial"))).toBe(true);
    const foreign = target.destination(backupName("daily", new Date(Date.UTC(2026, 0, 1))));
    const foreignOutput = foreign.open();
    await new Promise<void>((resolve) => foreignOutput.end("partial", () => resolve()));
    await target.removeIncomplete(new Set([name]));
    const left = await readdir(dir);
    expect(left.filter((entry) => entry.endsWith(".partial"))).toHaveLength(1);
    expect(left.find((entry) => entry.endsWith(".partial"))).not.toContain(name);
    expect(left).toContain("keep.txt");
  });
});

describe.skipIf(!endpoint)("S3 backup target", () => {
  const bucket = `lunedo-backup-${randomBytes(4).toString("hex")}`;
  const policy = outboundPolicy(["127.0.0.0/8", "::1/128"]);
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const config: S3TargetConfig = {
    endpoint: endpoint ?? null,
    region: "us-east-1",
    bucket,
    prefix: "backups/",
    forcePathStyle: true,
    accessKeyId,
    secretAccessKey,
  };
  let staging: string;

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    staging = await mkdtemp(path.join(tmpdir(), "lunedo-s3-staging-"));
  });

  afterAll(async () => {
    client.destroy();
    await rm(staging, { recursive: true, force: true });
  });

  async function keys(prefix = "") {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    return (listed.Contents ?? []).map((object) => object.Key ?? "").sort();
  }

  async function pendingUploads() {
    return (await client.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? [];
  }

  it("passes the connection test and leaves no test object behind", async () => {
    const target = new S3BackupTarget(config, policy);
    await target.test();
    expect(await keys()).toEqual([]);
    target.destroy();
  });

  it("names wrong keys and a refused address", async () => {
    const failure = async (target: S3BackupTarget) => {
      try {
        await target.test();
        return "passed";
      } catch (error) {
        return error instanceof BackupTargetError ? `${error.step}:${error.failure}` : String(error);
      } finally {
        target.destroy();
      }
    };
    expect(await failure(new S3BackupTarget({ ...config, secretAccessKey: "wrong" }, policy))).toBe(
      "write:credentials",
    );
    expect(
      () => new S3BackupTarget({ ...config, endpoint: "http://127.0.0.1:8333" }, outboundPolicy([])),
    ).toThrow("LUNEDO_OUTBOUND_ALLOWED_NETWORKS");
    const resolvesPrivately = new S3BackupTarget(
      { ...config, endpoint: "http://storage.internal.test:8333" },
      outboundPolicy([], async () => [{ address: "172.18.0.7", family: 4 }]),
    );
    const refused = await resolvesPrivately.test().then(
      () => null,
      (error: unknown) => error,
    );
    resolvesPrivately.destroy();
    expect(refused).toBeInstanceOf(BackupTargetError);
    expect(refused).toMatchObject({ failure: "blockedAddress", blockedAddress: "172.18.0.7" });
    expect((refused as BackupTargetError).allowedNetwork).toBe("172.18.0.7/32");
    expect((refused as BackupTargetError).message).not.toContain("172.18.0.7");
  });

  it("streams a backup in parts, lists it by name and header and reads it back", async () => {
    const target = new S3BackupTarget(config, policy);
    const name = backupName("manual", new Date());
    const lookalike = backupName("daily", new Date(Date.UTC(2026, 0, 1)));
    const dump = randomBytes(20 * MB);
    await createBackup({
      output: target.destination(name),
      stagingDir: staging,
      backupKeys,
      masterKeys: [],
      database: database(dump),
      filesDir: path.join(staging, "no-files"),
      config: {},
      lunedoVersion: "1.2.3",
      schemaVersion: "0000_baseline",
      logger,
    });
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: "backups/notes.txt", Body: "not a backup" }),
    );
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: `backups/${lookalike}`, Body: "named like a backup" }),
    );
    const listed = await listBackups(target);
    expect(listed.map((backup) => [backup.name, backup.header?.lunedoVersion ?? null])).toEqual([
      [name, "1.2.3"],
      [lookalike, null],
    ]);
    const source = await target.source(name);
    try {
      const manifest = await verifyBackup({
        input: source,
        backupKeys,
        knownSchemaVersions: ["0000_baseline"],
      });
      expect(manifest.entries.find((entry) => entry.path === "database.dump")?.size).toBe(dump.length);
    } finally {
      await source.close();
    }
    await applyRetention(
      target,
      { daily: 1, weekly: 1, monthly: 1, beforeUpdate: 1 },
      { own: new Set([name, lookalike]), logger },
    );
    await target.delete(name);
    expect(await keys("backups/")).toEqual([`backups/${lookalike}`, "backups/notes.txt"].sort());
    target.destroy();
  });

  it("aborts a failed multipart upload and leaves no object or part behind", async () => {
    const target = new S3BackupTarget(config, policy);
    const name = backupName("manual", new Date());
    async function* breaking() {
      for (let index = 0; index < 24; index += 1) yield randomBytes(MB);
      throw new Error("the file store broke");
    }
    const objectStore = {
      kind: "s3",
      async *list() {
        yield { key: "2026/large.bin", size: 32 * MB };
      },
      read: async () => Readable.from(breaking()),
    } as unknown as FileStore;
    await expect(
      createBackup({
        output: target.destination(name),
        stagingDir: staging,
        backupKeys,
        masterKeys: [],
        database: database(Buffer.from("dump")),
        filesDir: path.join(staging, "no-files"),
        objectStore,
        config: {},
        lunedoVersion: "1.2.3",
        schemaVersion: "0000_baseline",
        logger,
      }),
    ).rejects.toThrow("the file store broke");
    expect((await pendingUploads()).filter((upload) => upload.Key === `backups/${name}`)).toEqual([]);
    await expect(
      client.send(new GetObjectCommand({ Bucket: bucket, Key: `backups/${name}` })),
    ).rejects.toThrow();
    target.destroy();
  });

  it("aborts only the uploads this instance started and a killed process left behind", async () => {
    const target = new S3BackupTarget(config, policy);
    const own = backupName("daily", new Date());
    const foreign = `backups/${backupName("daily", new Date())}`;
    await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: `backups/${own}` }));
    await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: foreign }));
    await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: "backups/other-upload.bin" }));
    await target.removeIncomplete(new Set([own]));
    expect((await pendingUploads()).map((upload) => upload.Key).sort()).toEqual(
      ["backups/other-upload.bin", foreign].sort(),
    );
    target.destroy();
  });
});
