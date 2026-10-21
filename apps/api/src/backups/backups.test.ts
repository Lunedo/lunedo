import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

const NAME = "pagehall-backup-20261021T020000Z-daily-0a1b2c3d.phbak";

describe.skipIf(!databaseBaseUrl)("backups through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let member: TestClient;
  let auditor: TestClient;
  let targetDir: string;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    await createAccount(test, "backup-member@pagehall.test", "a long enough passphrase");
    member = await signedInClient(test, "backup-member@pagehall.test", "a long enough passphrase");
    const watcher = await createAccount(test, "backup-auditor@pagehall.test", "a long enough passphrase");
    await test.runtime.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: watcher.id },
    });
    auditor = await signedInClient(test, "backup-auditor@pagehall.test", "a long enough passphrase");
    targetDir = mkdtempSync(path.join(tmpdir(), "pagehall-api-target-"));
  });

  afterAll(async () => {
    await test?.close();
  });

  const reads: [string, number][] = [
    ["/api/v1/instance/backups", 200],
    ["/api/v1/instance/backups/status", 200],
    ["/api/v1/instance/backups/files", 200],
    ["/api/v1/instance/backups/test-restores/0192f0e0-0000-7000-8000-000000000001", 404],
  ];

  const changes: [string, string, unknown?][] = [
    ["PATCH", "/api/v1/instance/backups/settings", { enabled: false }],
    ["PUT", "/api/v1/instance/backups/target", { kind: "local", path: "/var/lib/pagehall/backups" }],
    ["POST", "/api/v1/instance/backups/target/test", { kind: "local", path: "/var/lib/pagehall/backups" }],
    ["PUT", "/api/v1/instance/backups/key-confirmation", { confirmed: true }],
    ["POST", "/api/v1/instance/backups/runs"],
    ["DELETE", `/api/v1/instance/backups/files/${NAME}`],
    ["POST", `/api/v1/instance/backups/files/${NAME}/test-restore`],
  ];

  async function send(client: TestClient, method: string, url: string, body?: unknown) {
    switch (method) {
      case "GET":
        return client.get(url);
      case "POST":
        return client.post(url, body);
      case "PUT":
        return client.put(url, body);
      case "PATCH":
        return client.patch(url, body);
      default:
        return client.delete(url);
    }
  }

  it.each(reads)("lets security auditors read %s and refuses it to members", async (url, status) => {
    expect((await member.get(url)).statusCode).toBe(403);
    const read = await auditor.get(url);
    expect(read.statusCode, read.body).toBe(status);
  });

  it("shows security auditors an S3 target without its secret key", async () => {
    const secret = "auditor-must-not-see-this-secret";
    const saved = await owner.put("/api/v1/instance/backups/target", {
      kind: "s3",
      endpoint: "https://s3.example.org",
      region: "eu-central-1",
      bucket: "pagehall-backups",
      prefix: "",
      forcePathStyle: false,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: secret,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const read = await auditor.get("/api/v1/instance/backups");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      target: { kind: "s3", bucket: "pagehall-backups", secretKeyConfigured: true },
    });
    expect(read.body).not.toContain(secret);
    expect(
      (await owner.put("/api/v1/instance/backups/target", { kind: "local", path: targetDir })).statusCode,
    ).toBe(200);
  });

  it.each(changes)("refuses %s %s to members and security auditors", async (method, url, body) => {
    expect((await send(member, method, url, body)).statusCode).toBe(403);
    expect((await send(auditor, method, url, body)).statusCode).toBe(403);
  });

  it.skipIf(!hasTools)("sets a target, backs up, lists, test-restores and deletes a backup", async () => {
    const target = await owner.put("/api/v1/instance/backups/target", { kind: "local", path: targetDir });
    expect(target.statusCode, target.body).toBe(200);
    expect(target.json()).toMatchObject({ target: { kind: "local", path: targetDir } });

    const tested = await owner.post("/api/v1/instance/backups/target/test", {
      kind: "local",
      path: targetDir,
    });
    expect(tested.json()).toEqual({
      ok: true,
      failure: null,
      step: null,
      message: null,
      blockedAddress: null,
      allowedNetwork: null,
    });

    const started = await owner.post("/api/v1/instance/backups/runs");
    expect(started.statusCode, started.body).toBe(202);
    const queued = await test.runtime.pool.query<{ data: { payload: { actorId: string } } }>(
      "select data from pgboss.job where name = $1",
      ["backup.run"],
    );
    const payload = queued.rows[0]?.data.payload;
    expect(payload).toMatchObject({ trigger: "manual" });
    await test.runtime.services.backups.run({
      trigger: "manual",
      slot: null,
      actorId: payload?.actorId ?? null,
    });

    const listed = await owner.get("/api/v1/instance/backups/files");
    expect(listed.statusCode, listed.body).toBe(200);
    const [backup] = (listed.json() as { backups: { name: string; backupClass: string }[] }).backups;
    expect(backup).toMatchObject({ backupClass: "manual", readable: true });

    const restore = await owner.post(`/api/v1/instance/backups/files/${backup?.name}/test-restore`);
    expect(restore.statusCode, restore.body).toBe(202);
    const { id } = restore.json() as { id: string };
    await test.runtime.services.backups.runTestRestore({ testId: id });
    const result = await owner.get(`/api/v1/instance/backups/test-restores/${id}`);
    expect(result.json()).toMatchObject({ id, stage: "done" });

    const removed = await owner.delete(`/api/v1/instance/backups/files/${backup?.name}`);
    expect(removed.statusCode, removed.body).toBe(204);
    expect(readdirSync(targetDir)).toEqual([]);
    const again = await owner.delete(`/api/v1/instance/backups/files/${backup?.name}`);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: "backupNotFound" });
  });

  it("explains refused settings with the field", async () => {
    const response = await owner.put("/api/v1/instance/backups/target", {
      kind: "local",
      path: "relative/dir",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalidBackupSettings",
      problem: "invalidPath",
      fields: ["body.path"],
    });
    const invalidName = await owner.delete("/api/v1/instance/backups/files/notes.txt");
    expect(invalidName.statusCode).toBe(400);
  });

  it("returns the short status for monitoring", async () => {
    const response = await owner.get("/api/v1/instance/backups/status");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: false,
      targetConfigured: true,
      beforeUpdate: { enabled: true, disabledBy: null },
    });
  });
});
