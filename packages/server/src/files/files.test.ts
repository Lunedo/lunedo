import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret } from "../config/secret.js";
import { FileKeyProvider } from "../crypto/key-provider.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { masterKeyVersionsInUse } from "../crypto/key-usage.js";
import { masterStreamKeys, rewrapStreamHeader, STREAM_HEADER_LENGTH } from "../crypto/stream.js";
import { createLogger } from "../logging/logger.js";
import { ValueSigner } from "../sharing/signer.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { FileService, FileTooLargeError, fileStreamOwner } from "./files.js";
import { cleanFileName, contentDisposition, fileNameKey } from "./names.js";
import { detectType } from "./sniff.js";
import { type FileStore, LocalFileStore, S3FileStore } from "./store.js";

const baseUrl = testDatabaseBaseUrl();
const s3Endpoint = process.env.PAGEHALL_TEST_S3_ENDPOINT?.trim();
const logger = createLogger({ service: "test", level: "silent" });

function detect(content: string | Buffer, name = "file.bin") {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return detectType(bytes, { name, truncated: false }).contentType;
}

describe("content types", () => {
  it("come from the content, not from the name", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(32),
    ]);
    expect(detect(png, "report.pdf")).toBe("image/png");
    expect(detect("<html><body><script>alert(1)</script></body></html>", "photo.png")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(detect("%PDF-1.7\n/OpenAction << /S /JavaScript /JS (app.alert(1)) >>", "a.pdf")).toBe(
      "application/pdf",
    );
  });

  it("treat an SVG with script as SVG, which is never shown inline", () => {
    expect(detect('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg")).toBe(
      "image/svg+xml",
    );
  });

  it("keep a polyglot image an image", () => {
    const gif = Buffer.concat([
      Buffer.from("GIF89a"),
      Buffer.from("<script>alert(document.cookie)</script>"),
    ]);
    expect(detect(gif, "evil.html")).toBe("image/gif");
  });

  it("recognize Markdown, CSV and binary files", () => {
    expect(detect("# Title\n\nText", "notes.md")).toBe("text/markdown; charset=utf-8");
    expect(detect("a,b\n1,2\n", "data.csv")).toBe("text/csv; charset=utf-8");
    expect(detect("<script>x</script>", "notes.md")).toBe("text/plain; charset=utf-8");
    expect(detect(Buffer.from([0, 1, 2, 3, 0, 255]), "x.txt")).toBe("application/octet-stream");
  });
});

describe("file names", () => {
  it("drop paths, control characters and direction overrides", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\a\\report.pdf")).toBe("report.pdf");
    expect(cleanFileName("in\u0000voice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(cleanFileName("a\r\nb.txt")).toBe("ab.txt");
    expect(cleanFileName('what?<>|*".txt')).toBe("what______.txt");
    expect(cleanFileName("..")).toBeNull();
    expect(cleanFileName("   ")).toBeNull();
    expect(cleanFileName(".hidden")).toBe("_hidden");
  });

  it("compare without case and in one Unicode form", () => {
    expect(fileNameKey("Ärger.PDF")).toBe(fileNameKey("A\u0308rger.pdf"));
  });

  it("are quoted safely in the download header", () => {
    expect(contentDisposition("attachment", 'Bericht "Q1"; ü.pdf')).toBe(
      "attachment; filename=\"Bericht _Q1__ _.pdf\"; filename*=UTF-8''Bericht%20%22Q1%22%3B%20%C3%BC.pdf",
    );
  });
});

describe.skipIf(!baseUrl)("the encrypted file store", () => {
  let test: TestServices;
  let keyRing: KeyRingHolder;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-file-keys-"));
    keyRing = new KeyRingHolder(new FileKeyProvider(path.join(dir, "master-keys")), logger);
    await keyRing.reload({ create: true });
  });

  afterAll(async () => {
    await test?.close();
  });

  function service(store: FileStore) {
    const signer = new ValueSigner({ database: test.database, encryption: test.encryption });
    return new FileService({ database: test.database, store, keyRing, logger, signer });
  }

  async function roundTrips(files: FileService) {
    const content = randomBytes(300_000);
    const stored = await files.write(Readable.from([content]), { name: "data.bin", maxBytes: 1_000_000 });
    await files.commit(test.database, stored.id);
    expect(stored.size).toBe(content.length);
    expect(await buffer(await files.read(stored.id))).toEqual(content);
    for (const [start, end] of [
      [0, 0],
      [10, 65_535],
      [65_530, 65_545],
      [131_072, 299_999],
      [299_990, 299_999],
    ] as const) {
      expect(await buffer(await files.read(stored.id, { start, end }))).toEqual(
        content.subarray(start, end + 1),
      );
    }
    return stored;
  }

  it("stores, reads and reads ranges on the local file system without plaintext on disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-store-"));
    const files = service(new LocalFileStore(dir));
    const stored = await roundTrips(files);
    const row = await test.database.execute<{ storage_key: string }>(
      sql`select storage_key from stored_files where id = ${stored.id}`,
    );
    const onDisk = readFileSync(
      path.join(dir, "attachments", ...(row.rows[0]?.storage_key ?? "").split("/")),
    );
    expect(onDisk.subarray(0, 3).toString()).toBe("PHS");
    expect(onDisk.includes(Buffer.from("data.bin"))).toBe(false);
  });

  it("refuses a file above the limit while it streams and leaves nothing behind", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-store-"));
    const files = service(new LocalFileStore(dir));
    const before = await test.database.execute<{ count: string }>(
      sql`select count(*) as count from stored_files`,
    );
    await expect(
      files.write(Readable.from([randomBytes(2000)]), { name: "big.bin", maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    const after = await test.database.execute<{ count: string }>(
      sql`select count(*) as count from stored_files`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const left: string[] = [];
    for await (const object of new LocalFileStore(dir).list()) left.push(object.key);
    expect(left).toEqual([]);
  });

  it("fails to read a file whose stored bytes were changed or swapped with another file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-store-"));
    const store = new LocalFileStore(dir);
    const files = service(store);
    const first = await files.write(Readable.from([Buffer.from("first file")]), {
      name: "a.txt",
      maxBytes: 100,
    });
    const second = await files.write(Readable.from([Buffer.from("second file")]), {
      name: "b.txt",
      maxBytes: 100,
    });
    await files.commit(test.database, first.id);
    await files.commit(test.database, second.id);
    const keys = await test.database.execute<{ id: string; storage_key: string }>(
      sql`select id, storage_key from stored_files where id in (${first.id}, ${second.id})`,
    );
    const location = (id: string) =>
      path.join(
        dir,
        "attachments",
        ...(keys.rows.find((row) => row.id === id)?.storage_key ?? "").split("/"),
      );
    writeFileSync(location(first.id), readFileSync(location(second.id)));
    await expect(buffer(await files.read(first.id))).rejects.toThrow();
    const tampered = readFileSync(location(second.id));
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    writeFileSync(location(second.id), tampered);
    await expect(buffer(await files.read(second.id))).rejects.toThrow();
  });

  it("counts master key versions from the database and re-wraps only the header", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pagehall-store-"));
    const store = new LocalFileStore(dir);
    const files = service(store);
    const content = Buffer.from("rotation content");
    const stored = await files.write(Readable.from([content]), { name: "a.txt", maxBytes: 100 });
    await files.commit(test.database, stored.id);
    const owner = fileStreamOwner(store);
    const context = { database: test.database, filesDir: dir };
    const counts = await masterKeyVersionsInUse({
      database: test.database,
      columns: [],
      streams: { owners: () => [owner], context },
    });
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    const provider = keyRing.provider as FileKeyProvider;
    await provider.addVersion();
    const ring = await keyRing.reload();
    for await (const stream of owner.streams(context, ring.currentVersion)) {
      if (stream.id !== stored.id) continue;
      const header = await stream.readHeader();
      expect(header.length).toBe(STREAM_HEADER_LENGTH);
      await stream.writeHeader(
        rewrapStreamHeader(
          header,
          masterStreamKeys(() => ring),
        ),
      );
    }
    const row = await test.database.execute<{ version: number }>(
      sql`select master_key_version as version from stored_files where id = ${stored.id}`,
    );
    expect(row.rows[0]?.version).toBe(ring.currentVersion);
    expect(await buffer(await files.read(stored.id))).toEqual(content);
  });

  it.skipIf(!s3Endpoint)("stores, reads and reads ranges in S3-compatible storage", async () => {
    const bucket = `pagehall-${randomBytes(4).toString("hex")}`;
    const config = {
      kind: "s3" as const,
      bucket,
      endpoint: s3Endpoint,
      region: "us-east-1",
      accessKeyId: new Secret(process.env.PAGEHALL_TEST_S3_ACCESS_KEY_ID ?? "pagehall"),
      secretAccessKey: new Secret(process.env.PAGEHALL_TEST_S3_SECRET_ACCESS_KEY ?? "pagehall-minio"),
      forcePathStyle: true,
      prefix: "test/",
    };
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId.reveal(),
        secretAccessKey: config.secretAccessKey.reveal(),
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const store = new S3FileStore(config);
    const files = service(store);
    const stored = await roundTrips(files);
    const listed: string[] = [];
    for await (const object of store.list()) listed.push(object.key);
    expect(listed).toHaveLength(1);
    const owner = fileStreamOwner(store);
    const context = { database: test.database, filesDir: "" };
    for await (const stream of owner.streams(context)) {
      if (stream.id !== stored.id) continue;
      const header = await stream.readHeader();
      await stream.writeHeader(
        rewrapStreamHeader(
          header,
          masterStreamKeys(() => keyRing.ring),
        ),
      );
    }
    const content = await buffer(await files.read(stored.id));
    expect(content.length).toBe(300_000);
    await expect(
      files.write(Readable.from([randomBytes(2000)]), { name: "big.bin", maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    const after: string[] = [];
    for await (const object of store.list()) after.push(object.key);
    expect(after).toHaveLength(1);
  });
});
