import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { knownSchemaVersions, schemaVersionTimes } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import type { JobDefinition, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { smtpSetting } from "../mail/mail-service.js";
import { timeZoneSetting } from "../settings/builtin.js";
import { storageCriticalPercentSetting, storageOperationsEmailsSetting } from "../storage/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { readBackupHeader } from "./archive.js";
import { BackupSettingsError } from "./errors.js";
import { writeRestoredMarker } from "./restore-marker.js";
import { pauseBackupsAfterRestore } from "./restored.js";
import { tryBackupLock } from "./runner.js";
import { LocalBackupTarget } from "./targets.js";
import { runTestRestore } from "./test-restore.js";

const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

const baseUrl = testDatabaseBaseUrl();
const DAY = 86_400_000;
const logger = createLogger({ service: "test", level: "silent" });

interface Enqueued {
  name: string;
  payload: unknown;
  key: string | undefined;
}

describe.skipIf(!baseUrl)("backups", () => {
  let test: TestServices;
  let backupDir: string;
  let workDir: string;
  let targetDir: string;
  let now = new Date("2026-10-21T08:00:00.000Z");
  const enqueued: Enqueued[] = [];
  const keys = new Set<string>();
  const jobs = {
    async enqueue(
      definition: JobDefinition<unknown>,
      payload: unknown,
      options?: { idempotencyKey?: string },
    ) {
      if (options?.idempotencyKey && keys.has(options.idempotencyKey)) return "existing";
      if (options?.idempotencyKey) keys.add(options.idempotencyKey);
      enqueued.push({ name: definition.name, payload, key: options?.idempotencyKey });
      return randomBytes(8).toString("hex");
    },
  } as unknown as JobQueue;
  const { organization, member, space } = spaceFixtures(() => test);
  let owner = "";
  const admins: string[] = [];

  beforeAll(async () => {
    backupDir = await mkdtemp(path.join(tmpdir(), "pagehall-backup-default-"));
    workDir = await mkdtemp(path.join(tmpdir(), "pagehall-backup-work-"));
    test = await createTestServices(baseUrl ?? "", {
      configuredInstanceUrl: "https://wiki.example.org",
      jobs,
      backup: (url) => ({
        databaseUrl: url,
        backupDir,
        workDir,
        secretsDir: path.join(backupDir, "secrets"),
        configuration: { "environment.json": '{"PAGEHALL_HOST":"0.0.0.0"}\n' },
        pagehallVersion: "1.2.3",
        beforeUpdateEnvironment: true,
        clock: () => now,
      }),
    });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.settings.set(timeZoneSetting, {}, "instance", "Europe/Vienna");
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@example.org",
      oauth2: null,
    });
    const org = await organization();
    owner = await member(org.id, "member", "Administrator");
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: owner },
    });
    admins.push(owner);
    const created = await space(org.id, owner, { name: "Handbook" });
    await test.services.tree.create(accountPrincipal(owner), created.id, {
      kind: "page",
      title: "Welcome",
      mode: "live",
      placement: { parentId: null },
    });
    await writeFile(path.join(test.filesDir, "report.txt"), "kept in the backup");
  });

  afterAll(async () => {
    await test?.close();
    await rm(backupDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    now = new Date("2026-10-21T08:00:00.000Z");
    enqueued.length = 0;
    keys.clear();
    targetDir = await mkdtemp(path.join(tmpdir(), "pagehall-backup-target-"));
    await test.database.execute(sql`delete from backup_configuration`);
    await test.database.execute(sql`delete from backup_state`);
    await test.database.execute(sql`delete from backup_runs`);
    await test.database.execute(sql`delete from backup_test_restores`);
    await test.database.execute(sql`delete from notifications where type like 'backup.%'`);
    await test.database.execute(sql`delete from instance_secrets where name like 'backup.%'`);
    await test.settings.clear(storageCriticalPercentSetting, {}, "instance");
    await test.settings.clear(storageOperationsEmailsSetting, {}, "instance");
  });

  const backups = () => test.services.backups;
  const actor = () => accountPrincipal(owner);

  async function useLocalTarget(dir = targetDir) {
    await backups().updateTarget(actor(), { kind: "local", path: dir });
  }

  async function files(dir = targetDir) {
    return (await readdir(dir)).sort();
  }

  async function runs() {
    const result = await test.database.execute<{
      state: string;
      trigger: string;
      backup_class: string;
      error: string | null;
    }>(sql`select state, trigger, backup_class, error from backup_runs order by started_at, id`);
    return result.rows;
  }

  async function notified(type: string) {
    const result = await test.database.execute<{ recipient_id: string; params: Record<string, unknown> }>(
      sql`select recipient_id, params from notifications where type = ${type} order by created_at, id`,
    );
    return result.rows;
  }

  async function audited(name: string) {
    const result = await test.database.execute<{ fields: Record<string, unknown> }>(
      sql`select fields from audit_events where name = ${name} order by occurred_at, id`,
    );
    return result.rows.map((row) => row.fields);
  }

  async function settingsError(action: Promise<unknown>): Promise<string> {
    try {
      await action;
    } catch (error) {
      if (error instanceof BackupSettingsError) return error.code;
      throw error;
    }
    return "accepted";
  }

  describe("settings", () => {
    it("refuses targets that are not usable or that hold other data", async () => {
      expect(await settingsError(backups().updateTarget(actor(), { kind: "local", path: "backups" }))).toBe(
        "invalidPath",
      );
      expect(
        await settingsError(
          backups().updateTarget(actor(), { kind: "local", path: path.join(test.filesDir, "backups") }),
        ),
      ).toBe("reservedPath");
      expect(await settingsError(backups().updateTarget(actor(), { kind: "local", path: "/" }))).toBe(
        "reservedPath",
      );
      const s3 = {
        kind: "s3" as const,
        endpoint: "https://s3.example.org",
        region: "eu-central-1",
        bucket: "pagehall-backups",
        prefix: "",
        forcePathStyle: false,
        accessKeyId: "AKIAEXAMPLE",
      };
      expect(await settingsError(backups().updateTarget(actor(), { ...s3, bucket: "Upper_Case" }))).toBe(
        "invalidBucket",
      );
      expect(
        await settingsError(
          backups().updateTarget(actor(), { ...s3, endpoint: "https://s3.example.org/path" }),
        ),
      ).toBe("invalidEndpoint");
      expect(
        await settingsError(
          backups().updateTarget(actor(), { ...s3, endpoint: "https://user:secret@s3.example.org" }),
        ),
      ).toBe("invalidEndpoint");
      expect(await settingsError(backups().updateTarget(actor(), { ...s3, prefix: "backups" }))).toBe(
        "invalidPrefix",
      );
      expect(await settingsError(backups().updateTarget(actor(), s3))).toBe("secretKeyRequired");
      expect((await backups().overview()).target).toBeNull();
    });

    it("stores the S3 secret key encrypted, never returns it and audits the change without it", async () => {
      const secret = `secret-${randomBytes(12).toString("hex")}`;
      const overview = await backups().updateTarget(actor(), {
        kind: "s3",
        endpoint: "https://s3.example.org",
        region: "eu-central-1",
        bucket: "pagehall-backups",
        prefix: "pagehall/",
        forcePathStyle: true,
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: secret,
      });
      expect(overview.target).toMatchObject({
        kind: "s3",
        secretKeyConfigured: true,
        bucket: "pagehall-backups",
      });
      expect(JSON.stringify(overview)).not.toContain(secret);
      const stored = await test.database.execute<{ value: Buffer }>(
        sql`select value from instance_secrets where name = 'backup.s3SecretAccessKey'`,
      );
      expect(stored.rows[0]?.value.toString("latin1")).not.toContain(secret);
      const changes = await audited("backup.targetChanged");
      expect(changes.at(-1)).toMatchObject({
        kind: "s3",
        location: "s3://pagehall-backups/pagehall/",
        endpointHost: "s3.example.org",
        credentialsReplaced: true,
      });
      expect(JSON.stringify(changes)).not.toContain(secret);

      const same = {
        kind: "s3" as const,
        endpoint: "https://s3.example.org",
        region: "eu-central-1",
        bucket: "pagehall-backups",
        prefix: "other/",
        forcePathStyle: true,
        accessKeyId: "AKIAEXAMPLE",
      };
      const kept = await backups().updateTarget(actor(), same);
      expect(kept.target).toMatchObject({ prefix: "other/", secretKeyConfigured: true });
      expect((await audited("backup.targetChanged")).at(-1)).toMatchObject({ credentialsReplaced: false });

      for (const changed of [
        { endpoint: "https://collector.example.net" },
        { bucket: "other-bucket" },
        { region: "us-east-1" },
        { accessKeyId: "AKIAOTHER" },
      ]) {
        expect(await settingsError(backups().updateTarget(actor(), { ...same, ...changed }))).toBe(
          "secretKeyRequired",
        );
        expect(await settingsError(backups().testTarget({ ...same, ...changed }))).toBe("secretKeyRequired");
      }
      expect((await backups().overview()).target).toMatchObject({ endpoint: "https://s3.example.org" });

      await useLocalTarget();
      const secrets = await test.database.execute(
        sql`select 1 from instance_secrets where name like 'backup.%'`,
      );
      expect(secrets.rows).toHaveLength(0);
    });

    it("turns backups on only with a target and audits each change", async () => {
      expect(await settingsError(backups().updateSettings(actor(), { enabled: true }))).toBe("noTarget");
      await useLocalTarget();
      const overview = await backups().updateSettings(actor(), {
        enabled: true,
        dailyTime: "03:15",
        weeklyDay: 7,
        retention: { daily: 5 },
      });
      expect(overview.settings).toMatchObject({ enabled: true, dailyTime: "03:15", weeklyDay: 7 });
      expect(overview.settings.retention).toEqual({ daily: 5, weekly: 4, monthly: 6, beforeUpdate: 3 });
      expect(overview.timeZone).toBe("Europe/Vienna");
      expect(overview.nextRunAt).toEqual(new Date("2026-10-22T01:15:00.000Z"));
      expect((await audited("backup.settingsChanged")).at(-1)).toEqual({
        changes: { enabled: true, dailyTime: "03:15", weeklyDay: 7, "retention.daily": 5 },
      });
      expect(await settingsError(backups().updateSettings(actor(), { dailyTime: "25:00" }))).toBe(
        "invalidTime",
      );
      expect(await settingsError(backups().updateSettings(actor(), { monthlyDay: 32 }))).toBe("invalidDay");
      expect(await settingsError(backups().updateSettings(actor(), { retention: { monthly: 0 } }))).toBe(
        "invalidCount",
      );
    });

    it("records who confirmed that the backup key is stored elsewhere", async () => {
      const confirmed = await backups().confirmKey(actor(), true);
      expect(confirmed.keyConfirmed).toEqual({ at: now, by: { id: owner, name: "Administrator" } });
      expect((await backups().confirmKey(actor(), false)).keyConfirmed).toBeNull();
      expect(await audited("backup.keyConfirmed")).toEqual([{ confirmed: true }, { confirmed: false }]);
    });

    it("warns in the admin area while backups are off or have no target", async () => {
      expect((await backups().overview()).warning).toBe("noTarget");
      await useLocalTarget();
      expect((await backups().overview()).warning).toBe("off");
      await backups().updateSettings(actor(), { enabled: true });
      expect((await backups().overview()).warning).toBeNull();
    });

    it("shows that backups before updates are turned off, and by what", async () => {
      expect((await backups().overview()).beforeUpdate).toEqual({ enabled: true, disabledBy: null });
      await backups().updateSettings(actor(), { beforeUpdate: false });
      expect((await backups().status()).beforeUpdate).toEqual({ enabled: false, disabledBy: "setting" });
    });
  });

  describe("testing a target", () => {
    it("names the failing step and the cause", async () => {
      const missing = path.join(targetDir, "not-there");
      expect(await backups().testTarget({ kind: "local", path: missing })).toMatchObject({
        ok: false,
        failure: "notFound",
        step: "write",
      });
      expect(await backups().testTarget({ kind: "local", path: targetDir })).toEqual({ ok: true });
      expect(await files()).toEqual([]);
    });

    it("refuses endpoints in private networks unless they are allowed", async () => {
      const result = await backups().testTarget({
        kind: "s3",
        endpoint: "http://127.0.0.1:1",
        region: "us-east-1",
        bucket: "pagehall-backups",
        prefix: "",
        forcePathStyle: true,
        accessKeyId: "pagehall",
        secretAccessKey: "not used",
      });
      expect(result).toMatchObject({
        ok: false,
        failure: "blockedAddress",
        blockedAddress: "127.0.0.1",
        allowedNetwork: "127.0.0.1/32",
      });
      expect(result.ok === false && result.message).toContain(
        "resolves to 127.0.0.1, which is in a private network. If Pagehall should reach it, add 127.0.0.1/32 or the subnet of its network to PAGEHALL_OUTBOUND_ALLOWED_NETWORKS",
      );
    });
  });

  describe("runs", () => {
    it.skipIf(!hasTools)(
      "writes a manual backup, lists it with its version and leaves other files alone",
      async () => {
        await useLocalTarget();
        await writeFile(path.join(targetDir, "notes.txt"), "not a backup");
        await writeFile(
          path.join(targetDir, "pagehall-backup-20260101T000000Z-daily-00000000.phbak"),
          "looks like a backup by its name only",
        );
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        expect(await runs()).toMatchObject([
          { error: null, state: "succeeded", trigger: "manual", backup_class: "manual" },
        ]);
        const list = await backups().list();
        expect(list.available).toBe(true);
        const created = list.backups.find((backup) => backup.backupClass === "manual");
        expect(created).toMatchObject({ readable: true, pagehallVersion: "1.2.3", scope: "all" });
        expect(list.backups.find((backup) => backup.name.endsWith("00000000.phbak"))).toMatchObject({
          readable: false,
        });
        const header = (await readBackupHeader(path.join(targetDir, created?.name ?? ""))).header;
        expect(header.schemaVersion).toBe(knownSchemaVersions().at(-1));
        expect((await audited("backup.created")).at(-1)).toMatchObject({
          trigger: "manual",
          backupClass: "manual",
        });

        await backups().deleteBackup(actor(), created?.name ?? "");
        expect(await files()).toEqual(["notes.txt", "pagehall-backup-20260101T000000Z-daily-00000000.phbak"]);
        expect((await audited("backup.deleted")).at(-1)).toMatchObject({
          name: created?.name,
          reason: "manual",
        });
        await expect(backups().deleteBackup(actor(), "notes.txt")).rejects.toThrow(
          "is not in the backup target",
        );
        await expect(
          backups().deleteBackup(actor(), "pagehall-backup-20260101T000000Z-daily-00000000.phbak"),
        ).rejects.toThrow("is not in the backup target");
      },
    );

    it.skipIf(!hasTools)(
      "stages the database dump in the private work directory, never in the target, and removes stale dumps",
      async () => {
        await useLocalTarget(backupDir);
        const staging = path.join(workDir, "backup-staging");
        await mkdir(staging, { recursive: true });
        const stale = path.join(staging, "backup-00000000-0000-4000-8000-000000000000.dump.enc");
        await writeFile(stale, "left over by a killed run");
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        expect(await runs()).toMatchObject([{ state: "succeeded" }]);
        expect(await readdir(staging)).toEqual([]);
        expect(
          (await readdir(backupDir, { recursive: true })).filter((name) => name.includes("dump")),
        ).toEqual([]);
        if (process.platform !== "win32") {
          expect((await stat(staging)).mode & 0o777).toBe(0o700);
          expect((await stat(workDir)).mode & 0o777).toBe(0o700);
        }
      },
    );

    it("refuses a target that contains the work directory", async () => {
      expect(
        await settingsError(backups().updateTarget(actor(), { kind: "local", path: path.dirname(workDir) })),
      ).toBe("reservedPath");
      expect(await settingsError(backups().updateTarget(actor(), { kind: "local", path: workDir }))).toBe(
        "reservedPath",
      );
    });

    it.skipIf(!hasTools)(
      "deletes only backups this instance recorded and removes only its own unfinished files",
      async () => {
        await useLocalTarget();
        await backups().updateSettings(actor(), { enabled: true, retention: { daily: 1 } });
        now = new Date(Date.UTC(2026, 9, 22, 1, 0, 30));
        await backups().run({ trigger: "scheduled", slot: "2026-10-22T00:00:00.000Z", actorId: null });
        const [foreign] = (await backups().list()).backups;
        await test.database.execute(sql`delete from backup_runs`);
        const foreignPartial = `${foreign?.name}.00000000-0000-4000-8000-000000000000.partial`;
        await writeFile(path.join(targetDir, foreignPartial), "an upload of another instance");
        const ownName = "pagehall-backup-20261022T010000Z-daily-0000abcd.phbak";
        await test.database.execute(sql`
          insert into backup_runs (id, trigger, backup_class, state, name, started_at, finished_at)
          values (gen_random_uuid(), 'scheduled', 'daily', 'failed', ${ownName}, now(), now())`);
        const ownPartial = `${ownName}.00000000-0000-4000-8000-000000000001.partial`;
        await writeFile(path.join(targetDir, ownPartial), "left over by an interrupted run");
        for (let day = 1; day < 4; day += 1) {
          now = new Date(Date.UTC(2026, 9, 22 + day, 1, 0, 30));
          await backups().run({
            trigger: "scheduled",
            slot: new Date(Date.UTC(2026, 9, 22 + day, 0, 0)).toISOString(),
            actorId: null,
          });
        }
        const names = await files();
        expect(names).toContain(foreign?.name);
        expect(names).toContain(foreignPartial);
        expect(names).not.toContain(ownPartial);
        expect(names.filter((name) => name.endsWith(".phbak"))).toHaveLength(2);
        expect((await audited("backup.deleted")).map((fields) => fields.name)).not.toContain(foreign?.name);
      },
    );

    it.skipIf(!hasTools)("leaves out the file store when the scope says so", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { scope: "database" });
      await backups().run({ trigger: "manual", slot: null, actorId: owner });
      const [created] = (await backups().list()).backups;
      expect(created).toMatchObject({ scope: "database" });
    });

    it.skipIf(!hasTools)(
      "keeps the configured generations of scheduled backups and never deletes manual ones",
      async () => {
        await useLocalTarget();
        await backups().updateSettings(actor(), {
          enabled: true,
          dailyTime: "02:00",
          retention: { daily: 2 },
        });
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        for (let day = 0; day < 4; day += 1) {
          now = new Date(Date.UTC(2026, 9, 22 + day, 1, 0, 30));
          await backups().run({
            trigger: "scheduled",
            slot: new Date(Date.UTC(2026, 9, 22 + day, 0, 0)).toISOString(),
            actorId: null,
          });
        }
        const kept = (await backups().list()).backups.map((backup) => backup.backupClass).sort();
        expect(kept).toEqual(["daily", "daily", "manual"]);
        const expired = (await audited("backup.deleted")).filter((fields) => fields.reason === "retention");
        expect(expired.length).toBeGreaterThanOrEqual(2);
      },
    );

    it.skipIf(!hasTools)("skips and records a scheduled run while another backup is running", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { enabled: true });
      const lock = await tryBackupLock(test.pool);
      try {
        expect((await backups().overview()).running).toBe(true);
        await backups().run({ trigger: "scheduled", slot: now.toISOString(), actorId: null });
        await expect(backups().requestBackup(actor())).rejects.toThrow("already running");
      } finally {
        await lock?.release();
      }
      expect(await runs()).toMatchObject([
        { state: "skipped", error: expect.stringContaining("another backup") },
      ]);
      expect(await files()).toEqual([]);
    });

    it.skipIf(!hasTools)("refuses a backup that would fill a local target", async () => {
      await useLocalTarget();
      await test.settings.set(storageCriticalPercentSetting, {}, "instance", 1);
      await backups().run({ trigger: "manual", slot: null, actorId: owner });
      expect(await runs()).toMatchObject([
        { state: "failed", error: expect.stringContaining("Not enough free space") },
      ]);
      expect(await files()).toEqual([]);
    });

    it("queues manual backups for the worker and audits the request", async () => {
      await useLocalTarget();
      await backups().requestBackup(actor());
      expect(enqueued).toMatchObject([
        { name: "backup.run", payload: { trigger: "manual", actorId: owner } },
      ]);
      expect(await audited("backup.requested")).toHaveLength(1);
    });
  });

  describe("schedule", () => {
    it("starts one run per scheduled time, also with several workers checking", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { enabled: true, dailyTime: "02:00" });
      now = new Date("2026-10-22T00:00:30.000Z");
      await Promise.all([backups().check(), backups().check(), test.anotherNode().backups.check()]);
      expect(enqueued).toEqual([
        {
          name: "backup.run",
          payload: { trigger: "scheduled", slot: "2026-10-22T00:00:00.000Z", actorId: null },
          key: "backup-slot:2026-10-22T00:00:00.000Z",
        },
      ]);
      now = new Date("2026-10-22T12:00:00.000Z");
      await backups().check();
      expect(enqueued).toHaveLength(1);
      now = new Date("2026-10-23T00:01:00.000Z");
      await backups().check();
      expect(enqueued).toHaveLength(2);
    });

    it("does not start a missed run when backups are turned on later that day", async () => {
      await useLocalTarget();
      now = new Date("2026-10-22T10:00:00.000Z");
      await backups().updateSettings(actor(), { enabled: true, dailyTime: "02:00" });
      await backups().check();
      expect(enqueued).toEqual([]);
    });

    it.skipIf(!hasTools)("classes scheduled runs by the local date", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { enabled: true, monthlyDay: 1, weeklyDay: 7 });
      await backups().run({ trigger: "scheduled", slot: "2026-10-31T23:00:00.000Z", actorId: null });
      expect((await runs()).at(-1)).toMatchObject({ backup_class: "monthly" });
    });
  });

  describe("warnings", () => {
    it.skipIf(!hasTools)(
      "reports the first failure, not the following ones, and once that backups work again",
      async () => {
        await test.settings.set(storageOperationsEmailsSetting, {}, "instance", ["it@example.org"]);
        const missing = path.join(targetDir, "missing");
        const failuresBefore = (await audited("backup.failed")).length;
        await useLocalTarget(missing);
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        expect(await notified("backup.failed")).toMatchObject([
          {
            recipient_id: owner,
            params: { reminder: false, reason: expect.stringContaining("does not exist") },
          },
        ]);
        expect((await backups().status()).alert).toBe("failing");
        expect(await audited("backup.failed")).toHaveLength(failuresBefore + 2);
        const mails = await test.database.execute(sql`select 1 from mail_outbox`);
        expect(mails.rows.length).toBeGreaterThanOrEqual(1);
        await mkdir(missing);
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        expect(await notified("backup.recovered")).toHaveLength(1);
        expect((await backups().status()).alert).toBe("none");
        expect((await backups().status()).lastSuccess).not.toBeNull();
      },
    );

    it("reports once when no backup succeeded for the configured days", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { enabled: true, missingDays: 2, dailyTime: "23:59" });
      now = new Date(now.getTime() + DAY);
      await backups().check();
      expect(await notified("backup.missing")).toHaveLength(0);
      now = new Date(now.getTime() + DAY + 60_000);
      await backups().check();
      await backups().check();
      expect(await notified("backup.missing")).toMatchObject([{ params: { days: 2, lastSuccessAt: null } }]);
      expect((await backups().status()).alert).toBe("missing");
      await backups().updateSettings(actor(), { enabled: false });
      expect((await backups().status()).alert).toBe("none");
    });
  });

  describe("test restore", () => {
    it.skipIf(!hasTools)(
      "restores into a temporary database, checks it and removes everything afterwards",
      async () => {
        await useLocalTarget();
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        const [created] = (await backups().list()).backups;
        const id = await backups().requestTestRestore(actor(), created?.name ?? "");
        expect(enqueued.at(-1)).toMatchObject({ name: "backup.test-restore", payload: { testId: id } });
        await backups().runTestRestore({ testId: id });
        const result = await backups().testRestore(id);
        expect(result).toMatchObject({ state: "passed", stage: "done", error: null, actor: { id: owner } });
        expect(result?.checks.map((check) => [check.check, check.passed])).toEqual([
          ["verify", true],
          ["restore", true],
          ["schemaVersion", true],
          ["rows", true],
          ["files", true],
        ]);
        expect(result?.checks.find((check) => check.check === "rows")?.detail).toMatchObject({ instance: 1 });
        const leftovers = await test.pool.query(
          "select datname from pg_database where datname like 'pagehall_test_restore_%'",
        );
        expect(leftovers.rows).toEqual([]);
        expect(
          (await readdir(backupDir)).filter((entry) => entry.startsWith(".pagehall-test-restore")),
        ).toEqual([]);
        expect((await backups().list()).backups[0]?.testRestore).toMatchObject({ id, state: "passed" });
        expect((await audited("backup.testRestoreFinished")).at(-1)).toMatchObject({ state: "passed" });
      },
    );

    it.skipIf(!hasTools)("fails and reports a backup whose stored files are missing", async () => {
      await useLocalTarget();
      const stored = `${randomBytes(4).toString("hex")}/missing`;
      await test.database.execute(sql`
        insert into stored_files (id, storage_key, size, state) values (gen_random_uuid(), ${stored}, 1, 'ready')`);
      try {
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
      } finally {
        await test.database.execute(sql`delete from stored_files where storage_key = ${stored}`);
      }
      const [created] = (await backups().list()).backups;
      const id = await backups().requestTestRestore(actor(), created?.name ?? "");
      await backups().runTestRestore({ testId: id });
      const result = await backups().testRestore(id);
      expect(result).toMatchObject({ state: "failed", stage: "checks" });
      expect(result?.checks.find((check) => check.check === "files")).toMatchObject({
        passed: false,
        detail: { missing: 1, firstMissing: stored },
      });
      expect(await notified("backup.testRestoreFailed")).toMatchObject([
        { params: { backupName: created?.name } },
      ]);
    });

    it.skipIf(!hasTools)(
      "only verifies when the database user may not create databases, and says how to grant it",
      async () => {
        await useLocalTarget();
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        const [created] = (await backups().list()).backups;
        const role = `pagehall_nocreate_${randomBytes(4).toString("hex")}`;
        await test.pool.query(`create role ${role} login password 'only for this test' nocreatedb`);
        const url = new URL(test.url);
        url.username = role;
        url.password = "only for this test";
        const limited = createDatabasePool({
          connectionString: url.toString(),
          applicationName: "pagehall-test",
        });
        try {
          const outcome = await runTestRestore(
            new LocalBackupTarget(targetDir),
            created?.name ?? "",
            {
              pool: limited,
              databaseUrl: url.toString(),
              backupKeys: test.backupKeys,
              masterKeys: async () => test.keyRing.ring,
              knownSchemaVersions: knownSchemaVersions(),
              migrationTimes: schemaVersionTimes(),
              workDir: backupDir,
              logger,
            },
            async () => {},
          );
          expect(outcome).toMatchObject({ state: "verified", stage: "done", error: null });
          expect(outcome.checks).toEqual([
            expect.objectContaining({ check: "verify", passed: true }),
            { check: "privilege", passed: false, detail: { grant: `ALTER ROLE "${role}" CREATEDB;` } },
          ]);
        } finally {
          await limited.end();
          await test.pool.query(`drop role ${role}`);
        }
      },
    );

    it.skipIf(!hasTools)("runs a test restore after the first scheduled backup of a month", async () => {
      await useLocalTarget();
      await backups().updateSettings(actor(), { enabled: true });
      await backups().run({ trigger: "scheduled", slot: now.toISOString(), actorId: null });
      now = new Date(now.getTime() + DAY);
      await backups().run({ trigger: "scheduled", slot: now.toISOString(), actorId: null });
      expect(enqueued.filter((job) => job.name === "backup.test-restore")).toHaveLength(1);
      expect((await audited("backup.testRestoreStarted")).at(-1)).toMatchObject({ trigger: "automatic" });
    });
  });

  describe("after a restore", () => {
    it.skipIf(!hasTools)(
      "pauses scheduled backups, retention and the monthly test restore until the target is confirmed",
      async () => {
        await useLocalTarget();
        await backups().updateSettings(actor(), { enabled: true, retention: { daily: 1 } });
        now = new Date(Date.UTC(2026, 9, 22, 1, 0, 30));
        await backups().run({ trigger: "scheduled", slot: "2026-10-22T00:00:00.000Z", actorId: null });
        const before = await files();
        enqueued.length = 0;

        await writeRestoredMarker(test.filesDir);
        await pauseBackupsAfterRestore(test.filesDir, test.database, logger);
        await expect(stat(path.join(test.filesDir, ".pagehall-restored"))).rejects.toThrow();
        const paused = await backups().overview();
        expect(paused.restoredAt).not.toBeNull();
        expect(paused.nextRunAt).toBeNull();

        now = new Date(Date.UTC(2026, 9, 23, 1, 0, 30));
        await backups().check();
        expect(enqueued).toEqual([]);
        await backups().run({ trigger: "scheduled", slot: "2026-10-23T00:00:00.000Z", actorId: null });
        expect(await files()).toEqual(before);
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
        expect((await files()).filter((name) => name.endsWith(".phbak"))).toHaveLength(2);
        expect(enqueued.filter((job) => job.name === "backup.test-restore")).toEqual([]);

        const confirmed = await backups().confirmTarget(actor());
        expect(confirmed.restoredAt).toBeNull();
        expect(await audited("backup.targetConfirmed")).toEqual([{ location: targetDir }]);
        await backups().check();
        expect(enqueued.filter((job) => job.name === "backup.run")).toHaveLength(1);
      },
    );

    it("ends the pause when the target is changed", async () => {
      await useLocalTarget();
      await writeRestoredMarker(test.filesDir);
      await pauseBackupsAfterRestore(test.filesDir, test.database, logger);
      expect((await backups().overview()).restoredAt).not.toBeNull();
      const other = await mkdtemp(path.join(tmpdir(), "pagehall-backup-other-"));
      try {
        expect((await backups().updateTarget(actor(), { kind: "local", path: other })).restoredAt).toBeNull();
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });
  });

  it.skipIf(!hasTools)(
    "lists the target version of a running key rotation as needed for the restore",
    async () => {
      await useLocalTarget();
      await test.database.execute(
        sql`insert into key_rotations (id, target_version, status) values (gen_random_uuid(), 7, 'running')`,
      );
      try {
        await backups().run({ trigger: "manual", slot: null, actorId: owner });
      } finally {
        await test.database.execute(sql`delete from key_rotations where target_version = 7`);
      }
      expect(await runs()).toMatchObject([
        { state: "failed", error: expect.stringContaining("master key version 7") },
      ]);
    },
  );

  it("keeps the content of other files out of the list", async () => {
    await useLocalTarget();
    await writeFile(path.join(targetDir, "pagehall-backup-x.phbak"), "x");
    expect((await backups().list()).backups).toEqual([]);
    expect(await readFile(path.join(targetDir, "pagehall-backup-x.phbak"), "utf8")).toBe("x");
  });
});
