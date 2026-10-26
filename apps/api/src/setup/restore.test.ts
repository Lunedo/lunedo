import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createBackup, createLogger, KeyRing, keyFingerprint, SecretKey } from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const CLIENT_IP = "198.51.100.11";
const behindProxy = { host: "lunedo.test", "x-forwarded-proto": "https" };
const BACKUP = "lunedo-2026-10-23.ldbak";

async function issueCode(test: AuthTestApp): Promise<string> {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    level: "info",
    destination: { write: (line: string) => lines.push(line) },
  });
  await test.runtime.services.setup.issueCode(logger);
  const match = /setup#code=([0-9A-Z-]+)\./.exec(lines.join(""));
  if (!match?.[1]) throw new Error("No setup code was logged");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("restoring a backup from the setup through the API", () => {
  let test: AuthTestApp;
  let client: TestClient;
  const backupKey = randomBytes(32);
  const masterKey = randomBytes(32);

  beforeAll(async () => {
    test = await createAuthTestApp({ LUNEDO_TRUSTED_PROXIES: CLIENT_IP });
    client = new TestClient(test.app, { remoteAddress: CLIENT_IP });
    const source = mkdtempSync(path.join(tmpdir(), "lunedo-restore-source-"));
    await mkdir(path.join(source, "attachments"), { recursive: true });
    await writeFile(path.join(source, "attachments", "report.pdf"), "content");
    await createBackup({
      output: path.join(test.env.LUNEDO_BACKUP_DIR ?? "", BACKUP),
      stagingDir: path.join(source, "staging"),
      backupKeys: new KeyRing(new Map([[1, new SecretKey(backupKey)]])),
      masterKeys: [{ version: 1, fingerprint: keyFingerprint("master", new SecretKey(masterKey)) }],
      database: {
        dump: () => Readable.from([Buffer.from("PGDMP")]),
        restore: async () => {},
        isEmpty: async () => true,
      },
      filesDir: source,
      config: {},
      lunedoVersion: "1.0.3",
      schemaVersion: "0000_foundation",
      logger: createLogger({ service: "test", level: "silent" }),
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  const get = (url: string) => client.get(url, behindProxy);
  const post = (url: string, body?: unknown) => client.post(url, body, behindProxy);

  it("needs the setup code for everything but the status of a restore started in this browser", async () => {
    expect((await get("/api/v1/setup/restore/sources")).statusCode).toBe(401);
    expect((await post("/api/v1/setup/restore/uploads", { name: "a.ldbak", size: 10 })).statusCode).toBe(401);
    expect(
      (
        await post("/api/v1/setup/restore", {
          source: { type: "directory", name: BACKUP },
          backupKey: "1:x",
          masterKeys: "1:x",
        })
      ).statusCode,
    ).toBe(401);
    expect((await get("/api/v1/setup/restore/status")).json()).toMatchObject({ code: "notFound" });
    expect((await post("/api/v1/setup/session", { code: await issueCode(test) })).statusCode).toBe(204);
  });

  it("lists the backups on the server and in another readable directory", async () => {
    const listed = (await get("/api/v1/setup/restore/sources")).json();
    expect(listed.backups).toEqual([
      expect.objectContaining({ name: BACKUP, lunedoVersion: "1.0.3", scope: "all", readable: true }),
    ]);
    expect(listed.freeBytes).toBeGreaterThan(0);
    const other = mkdtempSync(path.join(tmpdir(), "lunedo-restore-other-"));
    await writeFile(path.join(other, "copy.ldbak"), "not a backup");
    expect(
      (await get(`/api/v1/setup/restore/sources?directory=${encodeURIComponent(other)}`)).json().backups,
    ).toEqual([expect.objectContaining({ name: "copy.ldbak", readable: false })]);
    expect(
      (
        await get(`/api/v1/setup/restore/sources?directory=${encodeURIComponent(path.join(other, "none"))}`)
      ).json(),
    ).toMatchObject({ code: "directoryNotReadable" });
  });

  it("takes a backup in parts and continues where an interrupted upload stopped", async () => {
    const content = await readFile(path.join(test.env.LUNEDO_BACKUP_DIR ?? "", BACKUP));
    const started = await post("/api/v1/setup/restore/uploads", {
      name: "laptop.ldbak",
      size: content.length,
    });
    expect(started.statusCode).toBe(201);
    const id = started.json().id;
    const put = (offset: number, bytes: Buffer) =>
      client.request("PUT", `/api/v1/setup/restore/uploads/${id}?offset=${offset}`, bytes, {
        ...behindProxy,
        "content-type": "application/octet-stream",
      });
    const half = Math.floor(content.length / 2);
    expect((await put(0, content.subarray(0, half))).json()).toMatchObject({
      received: half,
      complete: false,
    });
    expect((await put(0, content.subarray(0, half))).json()).toMatchObject({ code: "uploadOffset" });
    expect((await get(`/api/v1/setup/restore/uploads/${id}`)).json()).toMatchObject({ received: half });
    expect((await put(half, content.subarray(half))).json()).toMatchObject({
      complete: true,
      file: "laptop.ldbak",
    });
    expect(
      (await get("/api/v1/setup/restore/sources"))
        .json()
        .backups.map((backup: { name: string }) => backup.name),
    ).toContain("laptop.ldbak");
    expect(
      (await post("/api/v1/setup/restore/uploads", { name: "huge.ldbak", size: 10 * 1024 ** 4 })).json(),
    ).toMatchObject({ code: "notEnoughSpace" });
  });

  it("checks the keys and the backup before it starts and reports the progress to this browser only", async () => {
    const keys = {
      backupKey: `1:${backupKey.toString("base64")}`,
      masterKeys: `1:${masterKey.toString("base64")}`,
    };
    expect(
      (
        await post("/api/v1/setup/restore", {
          source: { type: "directory", name: BACKUP },
          backupKey: "x",
          masterKeys: "y",
        })
      ).json(),
    ).toMatchObject({ code: "invalidKeys" });
    expect(
      (
        await post("/api/v1/setup/restore", { source: { type: "directory", name: "missing.ldbak" }, ...keys })
      ).json(),
    ).toMatchObject({ code: "backupNotFound" });

    const wrongKey = `1:${randomBytes(32).toString("base64")}`;
    const started = await post("/api/v1/setup/restore", {
      source: { type: "directory", name: BACKUP },
      ...keys,
      backupKey: wrongKey,
    });
    expect(started.statusCode).toBe(202);
    expect(started.headers["set-cookie"]).toEqual([
      expect.stringMatching(
        /^__Host-lunedo-restore=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
      ),
    ]);
    let status = (await get("/api/v1/setup/restore/status")).json();
    for (let attempt = 0; status.state === "running" && attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = (await get("/api/v1/setup/restore/status")).json();
    }
    expect(status).toMatchObject({
      state: "failed",
      backup: BACKUP,
      failure: { code: "backupKey" },
      steps: [
        { id: "verify", state: "failed" },
        { state: "waiting" },
        { state: "waiting" },
        { state: "waiting" },
      ],
    });
    expect(JSON.stringify(status)).not.toContain(backupKey.toString("base64"));
    expect((await new TestClient(test.app).get("/api/v1/setup/restore/status", behindProxy)).statusCode).toBe(
      404,
    );
  });
});
