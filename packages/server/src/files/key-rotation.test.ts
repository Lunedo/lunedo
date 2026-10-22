import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { Secret } from "../config/secret.js";
import { EnvKeyProvider, FileKeyProvider } from "../crypto/key-provider.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { KeyRotation, rotateDataKeysJob } from "../crypto/rotation.js";
import { keyRotations } from "../crypto/schema.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { FileService, fileStreamOwner } from "./files.js";
import type { FileStore } from "./store.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!baseUrl)("key rotation of stored files", () => {
  let test: TestServices;
  let keyFile: string;
  let queue: PgBossQueue;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    keyFile = path.join(mkdtempSync(path.join(tmpdir(), "lunedo-file-rotation-")), "master-keys");
    test = await createTestServices(baseUrl ?? "", { keyProvider: new FileKeyProvider(keyFile) });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    queue = new PgBossQueue({
      connectionString: test.url,
      database: test.database,
      logger,
      role: "producer",
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function page() {
    const org = await organization();
    const editor = await member(org.id);
    const wiki = await space(org.id, editor);
    const as = accountPrincipal(editor);
    const created = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "Files",
      mode: "live",
      placement: { parentId: null },
    });
    return { as, id: created.id };
  }

  async function addKeyVersion(): Promise<number> {
    await (test.keyRing.provider as FileKeyProvider).addVersion();
    return (await test.keyRing.reload()).currentVersion;
  }

  async function rotate(store: FileStore = test.services.files.store) {
    const rotation = new KeyRotation({
      database: test.database,
      encryption: test.encryption,
      keyRing: test.keyRing,
      jobs: queue,
      columns: () => [],
      streams: { owners: () => [fileStreamOwner(store)], context: { database: test.database, filesDir: "" } },
    });
    const targetVersion = test.keyRing.ring.currentVersion;
    const [row] = await test.database.insert(keyRotations).values({ targetVersion }).returning();
    const rotationId = row?.id ?? "";
    await rotation.run({
      id: uuidv7(),
      name: rotateDataKeysJob.name,
      payload: { rotationId, targetVersion },
      retryCount: 0,
      signal: new AbortController().signal,
      logger,
      reportProgress: async () => {},
    });
    const status = await test.database.execute<{ status: string }>(
      sql`select status from key_rotations where id = ${rotationId}`,
    );
    return status.rows[0]?.status;
  }

  async function withCurrentKeyOnly(): Promise<FileService> {
    const version = test.keyRing.ring.currentVersion;
    const entry = readFileSync(keyFile, "utf8")
      .split("\n")
      .find((line) => line.startsWith(`${version}:`));
    const keyRing = new KeyRingHolder(new EnvKeyProvider(new Secret(entry ?? "")), logger);
    await keyRing.reload();
    return new FileService({
      database: test.database,
      store: test.services.files.store,
      keyRing,
      logger,
      signer: test.services.signer,
    });
  }

  async function versionOf(fileId: string): Promise<number | null> {
    const found = await test.database.execute<{ version: number | null }>(
      sql`select master_key_version as version from stored_files where id = ${fileId}`,
    );
    return found.rows[0]?.version ?? null;
  }

  async function pendingUpload(files: FileService) {
    const before = await test.database.execute<{ id: string }>(
      sql`select id from stored_files where state = 'pending'`,
    );
    const known = new Set(before.rows.map((row) => row.id));
    const body = new PassThrough();
    const content = randomBytes(5000);
    body.write(content.subarray(0, 1000));
    const writing = files.write(body, { name: "slow.bin", maxBytes: 1_000_000 });
    for (;;) {
      const pending = await test.database.execute<{ id: string }>(
        sql`select id from stored_files where state = 'pending'`,
      );
      const id = pending.rows.map((row) => row.id).find((candidate) => !known.has(candidate));
      if (id) {
        return {
          id,
          content,
          finish: async () => {
            body.end(content.subarray(1000));
            const stored = await writing;
            await files.commit(test.database, stored.id);
            return stored;
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("re-wraps a file that a deduplicated upload left orphaned", async () => {
    const target = await page();
    const content = randomBytes(2000);
    const before = await test.database.execute<{ id: string }>(sql`select id from stored_files`);
    const known = new Set(before.rows.map((row) => row.id));
    for (const name of ["report.bin", "copy.bin"]) {
      await test.services.attachments.upload(target.as, target.id, { name, body: Readable.from([content]) });
    }
    const created = await test.database.execute<{ id: string; state: string }>(
      sql`select id, state from stored_files order by id`,
    );
    const orphaned = created.rows.find((row) => !known.has(row.id) && row.state === "orphaned");
    expect(orphaned).toBeDefined();

    const version = await addKeyVersion();
    expect(await rotate()).toBe("completed");
    expect(await versionOf(orphaned?.id ?? "")).toBe(version);
    await test.database.execute(sql`update stored_files set state = 'ready' where id = ${orphaned?.id}`);
    expect(await buffer(await (await withCurrentKeyOnly()).read(orphaned?.id ?? ""))).toEqual(content);
  });

  it("completes while an upload is in progress, and the upload finishes with the new key", async () => {
    const upload = await pendingUpload(test.services.files);
    const version = await addKeyVersion();
    expect(await rotate()).toBe("completed");

    const stored = await upload.finish();
    expect(stored.id).toBe(upload.id);
    expect(await versionOf(upload.id)).toBe(version);
    expect(await buffer(await (await withCurrentKeyOnly()).read(upload.id))).toEqual(upload.content);
  });

  it("re-wraps an upload that finished on a node with the old key while the rotation ran", async () => {
    const staleRing = new KeyRingHolder(new FileKeyProvider(keyFile), logger);
    await staleRing.reload();
    const store = test.services.files.store;
    const stale = new FileService({
      database: test.database,
      store,
      keyRing: staleRing,
      logger,
      signer: test.services.signer,
    });
    const upload = await pendingUpload(stale);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const ready = await test.services.files.write(Readable.from([randomBytes(100)]), {
      name: "ready.bin",
      maxBytes: 1000,
    });
    expect(ready.id > upload.id).toBe(true);
    const version = await addKeyVersion();

    let finished = false;
    const hooked = new Proxy(store, {
      get(target, property) {
        if (property === "replaceHead") {
          return async (key: string, header: Buffer) => {
            if (!finished) {
              finished = true;
              await upload.finish();
              expect(await versionOf(upload.id)).toBe(version - 1);
            }
            return target.replaceHead(key, header);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await rotate(hooked)).toBe("completed");
    expect(finished).toBe(true);
    expect(await versionOf(upload.id)).toBe(version);
    expect(await versionOf(ready.id)).toBe(version);
    expect(await buffer(await (await withCurrentKeyOnly()).read(upload.id))).toEqual(upload.content);
  });
});
