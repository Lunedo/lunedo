import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import type { BackupStatus } from "../backup/service.js";
import type { JobQueue } from "../jobs/job-queue.js";
import { smtpSetting } from "../mail/mail-service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { ErrorEvents } from "./error-events.js";
import { backupItem, jobsItem, OperationsStatusService, type StatusItem } from "./status.js";

const baseUrl = testDatabaseBaseUrl();
const NOW = new Date("2026-10-21T08:00:00Z");
const HOUR = 60 * 60 * 1000;

const healthyBackup: BackupStatus = {
  enabled: true,
  targetConfigured: true,
  running: false,
  nextRunAt: new Date(NOW.getTime() + 20 * HOUR),
  lastSuccess: { at: new Date(NOW.getTime() - 3 * HOUR), name: "pagehall-daily.phbak", sizeBytes: 1024 },
  lastFailure: null,
  alert: "none",
  beforeUpdate: { enabled: true, disabledBy: null },
};

describe("backupItem", () => {
  it("is ok after a recent successful backup and notes when backups before updates are off", () => {
    expect(backupItem(healthyBackup)).toMatchObject({
      status: "ok",
      reason: null,
      page: "/settings/instance/backups",
    });
    expect(
      backupItem({ ...healthyBackup, beforeUpdate: { enabled: false, disabledBy: "environment" } }),
    ).toMatchObject({ status: "ok", reason: "beforeUpdateOff" });
  });

  it("warns when backups are off, have no target or are missing, and fails while they fail", () => {
    expect(backupItem({ ...healthyBackup, targetConfigured: false }).reason).toBe("noTarget");
    expect(backupItem({ ...healthyBackup, enabled: false }).reason).toBe("off");
    expect(backupItem({ ...healthyBackup, alert: "missing" })).toMatchObject({
      status: "warning",
      reason: "noRecentBackup",
    });
    expect(
      backupItem({
        ...healthyBackup,
        alert: "failing",
        lastFailure: { at: new Date(NOW.getTime() - HOUR), reason: "The target is full" },
      }),
    ).toMatchObject({
      status: "error",
      reason: "failed",
      facts: { lastFailureReason: "The target is full" },
    });
  });
});

describe("jobsItem", () => {
  const queue = { queue: "mail.deliver", queued: 0, active: 0, deferred: 0, failed: 0 };

  it("warns about failed jobs and a large backlog", () => {
    expect(jobsItem([queue]).status).toBe("ok");
    expect(jobsItem([{ ...queue, failed: 1 }])).toMatchObject({ status: "warning", reason: "failedJobs" });
    expect(
      jobsItem([
        { ...queue, queued: 600 },
        { ...queue, queue: "search.update-index", queued: 400 },
      ]),
    ).toMatchObject({
      status: "warning",
      reason: "backlog",
      facts: { queued: 1000 },
    });
  });
});

describe.skipIf(!baseUrl)("OperationsStatusService", () => {
  let test: TestServices;
  let backup: BackupStatus;
  let collaborationReady: boolean | Error;
  let counts: Awaited<ReturnType<JobQueue["counts"]>>;
  const filesDir = mkdtempSync(path.join(tmpdir(), "pagehall-status-"));

  const service = () =>
    new OperationsStatusService({
      database: test.database,
      pool: test.pool,
      settings: test.settings,
      storage: test.services.storage,
      mail: test.services.mail,
      indexer: test.services.search.indexer,
      keyRing: test.keyRing,
      jobs: {
        counts: async () => counts,
      } as unknown as JobQueue,
      backups: { status: async () => backup },
      maintenance: test.services.maintenance,
      collaboration: async () => {
        if (collaborationReady instanceof Error) throw collaborationReady;
        return collaborationReady;
      },
      filesDir,
      fileStore: "local",
      keyProvider: "file",
      now: () => NOW,
    });

  const byId = (items: StatusItem[]) => Object.fromEntries(items.map((entry) => [entry.id, entry]));

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    backup = healthyBackup;
    collaborationReady = true;
    counts = {
      "mail.deliver": { queued: 1, active: 0, deferred: 0, failed: 0 },
      "copies.run": { queued: 0, active: 0, deferred: 0, failed: 0 },
    };
    await test.pool.query("delete from operations_error_events");
    await test.pool.query("delete from setup_steps");
    await test.pool.query("delete from search_pending_items");
    await test.pool.query("update search_index_state set building_since = null");
  });

  it("lists every item with a status, a reason and where it is fixed", async () => {
    const status = await service().status();
    expect(status.items.map((entry) => entry.id)).toEqual([
      "version",
      "maintenance",
      "database",
      "storage",
      "jobs",
      "collaboration",
      "backups",
      "searchIndex",
      "recentErrors",
      "tls",
      "email",
      "encryption",
      "clock",
      "fileStorage",
    ]);
    const items = byId(status.items);
    expect(items.database).toMatchObject({ status: "ok" });
    expect(items.database?.facts.sizeBytes).toBeGreaterThan(0);
    expect(items.tls).toMatchObject({
      status: "warning",
      reason: "instanceUrlNotSet",
      page: "/settings/instance/general",
    });
    expect(items.email).toMatchObject({
      status: "warning",
      reason: "notConfigured",
      page: "/settings/instance/mail",
    });
    expect(items.encryption).toMatchObject({ status: "warning", reason: "keysNotBackedUp" });
    expect(status.queues).toEqual([{ queue: "mail.deliver", queued: 1, active: 0, deferred: 0, failed: 0 }]);
    expect(status.status).toBe("warning");
  });

  it("reports TLS, e-mail and key backup as ok once they are set up", async () => {
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 587,
      security: "none",
      username: null,
      from: "wiki@example.org",
      oauth2: null,
    });
    await test.pool.query("insert into setup_steps (step, completed_at) values ('keyBackup', now())");
    const items = byId((await service().status()).items);
    expect(items.tls).toMatchObject({ status: "ok", facts: { url: "https://wiki.example.org" } });
    expect(items.email?.status).toBe("ok");
    expect(items.encryption).toMatchObject({ status: "ok", facts: { provider: "file", currentVersion: 1 } });
    await test.settings.set(instanceUrlSetting, {}, "instance", "http://wiki.example.org");
    expect(byId((await service().status()).items).tls?.reason).toBe("instanceUrlNotHttps");
  });

  it("reports an unreachable collaboration server and failed jobs", async () => {
    collaborationReady = new Error("refused");
    counts = { "copies.run": { queued: 0, active: 0, deferred: 0, failed: 2 } };
    const status = await service().status();
    const items = byId(status.items);
    expect(items.collaboration).toMatchObject({ status: "error", reason: "unavailable" });
    expect(items.jobs).toMatchObject({ status: "warning", reason: "failedJobs", facts: { failed: 2 } });
    expect(status.status).toBe("error");
  });

  it("lists recent errors by type without their content", async () => {
    const events = new ErrorEvents({ service: "worker", now: () => new Date(NOW.getTime() - HOUR) });
    events.record({ type: "Copy failed", code: null });
    events.record({ type: "Copy failed", code: null });
    await events.flush(test.database);
    const status = await service().status();
    expect(byId(status.items).recentErrors).toMatchObject({
      status: "warning",
      reason: "errorsLogged",
      facts: { count: 2, types: 1 },
    });
    expect(status.recentErrors).toEqual([
      {
        type: "Copy failed",
        code: null,
        services: ["worker"],
        count: 2,
        lastAt: new Date(NOW.getTime() - HOUR),
      },
    ]);
  });

  it("reports failing search items", async () => {
    expect(byId((await service().status()).items).searchIndex?.status).toBe("ok");
    await test.pool.query("insert into search_pending_items (item_id, attempts) values ($1, 2)", [
      randomUUID(),
    ]);
    expect(byId((await service().status()).items).searchIndex).toMatchObject({
      status: "warning",
      reason: "failingItems",
      facts: { failingItems: 1, pendingItems: 1 },
    });
    await test.pool.query(
      "insert into search_index_state (id, building_since, build_total) values (1, now(), 3) on conflict (id) do update set building_since = now(), build_total = 3",
    );
    expect(byId((await service().status()).items).searchIndex).toMatchObject({
      status: "warning",
      reason: "building",
      facts: { total: 3 },
    });
  });
});
