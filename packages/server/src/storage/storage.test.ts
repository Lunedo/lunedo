import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { FileService } from "../files/files.js";
import type { ByteRange, FileStore, ListProgress, StoreCapacity, StoredObject } from "../files/store.js";
import { createLogger } from "../logging/logger.js";
import { smtpSetting } from "../mail/mail-service.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { ValueSigner } from "../sharing/signer.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeRequest, type RunningFake, serveFake } from "../testing/fakes/http.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { LARGE_WRITE_REFUSED, StorageFullError, UPLOAD_REFUSED } from "./errors.js";
import {
  storageCriticalPercentSetting,
  storageLargeWritesPercentSetting,
  storageOperationsEmailsSetting,
  storageReminderSetting,
  storageS3LimitSetting,
  storageWarningPercentSetting,
} from "./settings.js";
import { StorageService } from "./storage.js";
import { StorageUsage } from "./usage.js";

const baseUrl = testDatabaseBaseUrl();
const MEGABYTE = 1024 * 1024;
const TOTAL = 1000 * MEGABYTE;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const logger = createLogger({ service: "test", level: "silent" });

class MemoryObjectStore implements FileStore {
  readonly kind = "s3" as const;
  readonly objects = new Map<string, Buffer>();

  async capacity(): Promise<StoreCapacity | null> {
    return null;
  }

  async write(key: string, body: Readable): Promise<number> {
    const data = await buffer(body);
    this.objects.set(key, data);
    return data.length;
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const data = this.objects.get(key);
    if (!data) throw new Error("missing");
    return Readable.from([range ? data.subarray(range.start, range.end + 1) : data]);
  }

  async size(key: string): Promise<number | null> {
    return this.objects.get(key)?.length ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  pageSize = 1000;
  afterPage: ((page: number) => Promise<void>) | null = null;

  async *list(_prefix?: string, progress?: ListProgress): AsyncIterable<StoredObject> {
    let after = "";
    for (let page = 0; ; page += 1) {
      await progress?.fetching();
      const keys = [...this.objects.keys()].filter((key) => key > after).sort();
      const listed = keys
        .slice(0, this.pageSize)
        .map((key) => ({ key, size: this.objects.get(key)?.length ?? 0 }));
      const more = keys.length > this.pageSize;
      await progress?.fetched(listed.at(-1)?.key ?? null, more);
      await this.afterPage?.(page);
      yield* listed;
      if (!more) return;
      after = listed.at(-1)?.key ?? after;
    }
  }

  async replaceHead(key: string, head: Buffer): Promise<void> {
    const data = this.objects.get(key);
    if (data) head.copy(data);
  }
}

describe.skipIf(!baseUrl)("storage warnings", () => {
  let test: TestServices;
  let fake: RunningFake;
  let port = "";
  const requests: FakeRequest[] = [];
  let now = new Date("2026-10-15T08:00:00.000Z");
  let percent = 0;
  let webhookStatus = 200;
  const { organization, member, space } = spaceFixtures(() => test);
  const admins: string[] = [];
  let bystander = "";

  beforeAll(async () => {
    fake = await serveFake((request) => {
      requests.push(request);
      return { status: webhookStatus };
    });
    port = new URL(fake.url).port;
    test = await createTestServices(baseUrl ?? "", {
      configuredInstanceUrl: "https://wiki.example.org",
      chatPolicy: outboundPolicy(["127.0.0.0/8"], async (hostname) =>
        hostname === "hooks.test" ? [{ address: "127.0.0.1", family: 4 }] : [],
      ),
    });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.services.instanceAddress.applyConfigured();
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@example.org",
      oauth2: null,
    });
    const org = await organization();
    for (const name of ["First administrator", "Second administrator"]) {
      const id = await member(org.id, "member", name);
      await test.services.roles.assign(SYSTEM, {
        scope: "instance",
        organizationId: null,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id },
      });
      admins.push(id);
    }
    bystander = await member(org.id, "member", "Bystander");
  });

  afterAll(async () => {
    await test?.close();
    await fake?.close();
  });

  const clock = () => now;

  function monitorOf(store: FileStore = test.services.files.store, usage?: StorageUsage) {
    return new StorageService({
      database: test.database,
      store,
      usage: usage ?? new StorageUsage({ database: test.database }),
      settings: test.settings,
      notifications: test.services.notifications,
      mail: test.services.mail,
      chat: test.services.chatChannels,
      encryption: test.encryption,
      audit: test.services.audit,
      logger,
      clock,
    });
  }

  let monitor: StorageService;

  function usage(share: number) {
    percent = share;
  }

  beforeEach(async () => {
    now = new Date("2026-10-15T08:00:00.000Z");
    percent = 0;
    webhookStatus = 200;
    requests.length = 0;
    vi.spyOn(test.services.files.store, "capacity").mockImplementation(async () => ({
      free: Math.round(TOTAL * (1 - percent / 100)),
      total: TOTAL,
    }));
    await test.database.execute(sql`delete from storage_state`);
    await test.database.execute(sql`delete from notifications where type like 'storage.%'`);
    await test.database.execute(sql`delete from mail_outbox`);
    await test.database.execute(sql`delete from chat_deliveries where channel_id is null`);
    await test.database.execute(sql`delete from instance_secrets where name like 'storage.%'`);
    test.mail.sent.length = 0;
    for (const setting of [
      storageWarningPercentSetting,
      storageLargeWritesPercentSetting,
      storageCriticalPercentSetting,
      storageReminderSetting,
      storageOperationsEmailsSetting,
      storageS3LimitSetting,
    ]) {
      await test.settings.clear(setting, {}, "instance");
    }
    monitor = monitorOf();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function tick(share: number, minutes = 1) {
    usage(share);
    now = new Date(now.getTime() + minutes * MINUTE);
    return monitor.check();
  }

  async function teamsDeliveries() {
    const result = await test.database.execute<{ id: string; state: string }>(
      sql`select id, state from chat_deliveries where channel_id is null order by created_at, id`,
    );
    return result.rows;
  }

  async function deliverTeams(lastAttempt = false) {
    const results: string[] = [];
    for (const row of (await teamsDeliveries()).filter((entry) => entry.state === "pending")) {
      results.push(await test.services.chatChannels.deliver(row.id, lastAttempt));
    }
    return results;
  }

  async function received(accountId: string, type?: string) {
    const result = await test.database.execute<{ type: string; params: Record<string, unknown> }>(sql`
      select type, params from notifications
      where recipient_id = ${accountId} and type like 'storage.%' ${type ? sql`and type = ${type}` : sql``}
      order by created_at, id`);
    return result.rows;
  }

  async function mailTo(address: string) {
    await deliverPendingMail(test.services, test.database);
    return test.mail.sent.filter((message) => message.to === address);
  }

  describe("refusals at each level", () => {
    async function setup() {
      const org = await organization();
      const adminId = await member(org.id, "member", "Space admin");
      const created = await space(org.id, adminId, { name: "Handbook" });
      const admin = accountPrincipal(adminId);
      const page = await test.services.tree.create(admin, created.id, {
        kind: "page",
        title: "Welcome",
        mode: "live",
        placement: { parentId: null },
      });
      return { org, admin, space: created, page };
    }

    function upload(context: Awaited<ReturnType<typeof setup>>) {
      return test.services.attachments.upload(context.admin, context.page.id, {
        name: `file-${randomUUID().slice(0, 6)}.txt`,
        body: Readable.from([Buffer.from("content")]),
        contentLength: 7,
      });
    }

    it("blocks nothing at the warning level", async () => {
      const context = await setup();
      usage(89.9);
      await expect(upload(context)).resolves.toMatchObject({ name: expect.any(String) });
      await expect(
        test.services.importUploads.create(accountPrincipal(context.org.owner), context.org.id, {
          name: "export.zip",
          size: 1000,
        }),
      ).resolves.toMatchObject({ id: expect.any(String) });
      await expect(
        test.services.exports.start(context.admin, { spaceId: context.space.id }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("refuses new exports and imports from the large-writes level, but not uploads", async () => {
      const context = await setup();
      usage(90);
      await expect(upload(context)).resolves.toMatchObject({ name: expect.any(String) });
      await expect(
        test.services.importUploads.create(accountPrincipal(context.org.owner), context.org.id, {
          name: "export.zip",
          size: 1000,
        }),
      ).rejects.toMatchObject({
        name: "StorageFullError",
        refusal: "largeWrite",
        message: LARGE_WRITE_REFUSED,
      });
      await expect(
        test.services.exports.start(context.admin, { spaceId: context.space.id }),
      ).rejects.toMatchObject({
        code: "notEnoughStorage",
        message: "Not enough storage for this export. Your instance administrator needs to free up space.",
      });
    });

    it("refuses uploads from the critical level and keeps page editing working", async () => {
      const context = await setup();
      usage(95);
      await expect(upload(context)).rejects.toMatchObject({
        name: "StorageFullError",
        refusal: "upload",
        message: UPLOAD_REFUSED,
      });
      await expect(
        test.services.documents.replace(context.admin, context.page.id, {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Still editable" }] }],
        }),
      ).resolves.toBeDefined();
    });

    it("follows the thresholds that the administrator set", async () => {
      usage(60);
      await test.settings.set(storageWarningPercentSetting, {}, "instance", 40);
      await test.settings.set(storageLargeWritesPercentSetting, {}, "instance", 50);
      await test.settings.set(storageCriticalPercentSetting, {}, "instance", 70);
      await expect(monitor.requireLargeWrite()).rejects.toBeInstanceOf(StorageFullError);
      await expect(monitor.requireUpload()).resolves.toBeUndefined();
      usage(70);
      await expect(monitor.requireUpload()).rejects.toBeInstanceOf(StorageFullError);
    });

    it("counts waiting exports against the large-writes level", async () => {
      usage(80);
      await expect(monitor.requireLargeWrite(50 * MEGABYTE)).resolves.toBeUndefined();
      await expect(monitor.requireLargeWrite(100 * MEGABYTE)).rejects.toBeInstanceOf(StorageFullError);
    });

    it("stops a running build at the critical level", async () => {
      usage(94.9);
      await expect(monitor.requireBuildRoom(10 * MEGABYTE)).resolves.toBeUndefined();
      usage(95);
      await expect(monitor.requireBuildRoom(0)).rejects.toBeInstanceOf(StorageFullError);
    });
  });

  describe("notifications without flapping", () => {
    it("does nothing after one reading above the threshold", async () => {
      const first = await tick(85);
      expect(first).toMatchObject({ level: 0, change: null });
      expect(await received(admins[0] ?? "")).toEqual([]);
    });

    it("activates a level after two readings in a row and tells every administrator once", async () => {
      await tick(85);
      const second = await tick(85);
      expect(second).toMatchObject({ level: 1, change: "raised" });
      for (const admin of admins) {
        expect(await received(admin)).toMatchObject([
          { type: "storage.levelReached", params: { level: 1, reminder: false, store: "local" } },
        ]);
      }
      expect(await received(bystander)).toEqual([]);
      await tick(86);
      await tick(87);
      expect(await received(admins[0] ?? "")).toHaveLength(1);
    });

    it("ignores a single reading that goes back below the threshold", async () => {
      await tick(85);
      await tick(70);
      await tick(85);
      expect(await received(admins[0] ?? "")).toEqual([]);
      await tick(85);
      expect(await received(admins[0] ?? "")).toHaveLength(1);
    });

    it("notifies once for values moving between 79.9 and 80.1 percent", async () => {
      const values = [80.1, 80.1, 79.9, 80.1, 79.9, 80.1, 80.1, 79.9];
      for (const value of values) await tick(value);
      expect(await received(admins[0] ?? "")).toHaveLength(1);
      expect(await received(admins[0] ?? "", "storage.levelCleared")).toEqual([]);
    });

    it("clears a level only below five points under its threshold", async () => {
      await tick(81);
      await tick(81);
      await tick(75);
      await tick(75);
      expect((await monitor.status()).level).toBe(1);
      const cleared = await tick(74.9);
      expect(cleared).toMatchObject({ level: 0, change: "cleared" });
      expect(await received(admins[0] ?? "", "storage.levelCleared")).toMatchObject([
        { params: { level: 0 } },
      ]);
    });

    it("notifies again when a higher level becomes active and when a level returns after clearing", async () => {
      await tick(82);
      await tick(82);
      await tick(91);
      expect((await monitor.status()).level).toBe(1);
      await tick(91);
      expect((await monitor.status()).level).toBe(2);
      await tick(96);
      await tick(96);
      expect((await monitor.status()).level).toBe(3);
      expect(
        (await received(admins[0] ?? "", "storage.levelReached")).map((row) => row.params.level),
      ).toEqual([1, 2, 3]);
      await tick(40);
      await tick(40);
      expect((await monitor.status()).level).toBe(0);
      await tick(85);
      await tick(85);
      expect(
        (await received(admins[0] ?? "", "storage.levelReached")).map((row) => row.params.level),
      ).toEqual([1, 2, 3, 1]);
    });

    it("sends one back-to-normal message to the same recipients", async () => {
      await test.settings.set(storageOperationsEmailsSetting, {}, "instance", ["ops@example.org"]);
      await tick(85);
      await tick(85);
      await tick(10);
      await tick(10);
      await tick(10);
      for (const admin of admins) {
        expect(await received(admin, "storage.levelCleared")).toHaveLength(1);
      }
      const mails = await mailTo("ops@example.org");
      expect(mails.map((mail) => mail.subject)).toEqual([
        expect.stringContaining("is 85.0 % full"),
        expect.stringContaining("back to normal"),
      ]);
    });

    it("lowers the active level and tells the recipients what works again", async () => {
      await tick(96);
      await tick(96);
      expect((await monitor.status()).level).toBe(3);
      const lowered = await tick(88);
      expect(lowered).toMatchObject({ level: 2, change: "cleared" });
      expect(await received(admins[0] ?? "", "storage.levelCleared")).toMatchObject([
        { params: { level: 2 } },
      ]);
    });

    it("counts two checks less than half a minute apart as one", async () => {
      usage(85);
      now = new Date(now.getTime() + MINUTE);
      await monitor.check();
      now = new Date(now.getTime() + 5_000);
      const again = await monitor.check();
      expect(again.skipped).toBe(true);
      expect((await monitor.status()).level).toBe(0);
    });

    it("lets two nodes check at the same moment without a duplicate", async () => {
      await tick(85);
      usage(85);
      now = new Date(now.getTime() + MINUTE);
      const other = monitorOf();
      await Promise.all([monitor.check(), other.check()]);
      expect(await received(admins[0] ?? "")).toHaveLength(1);
    });

    it("links the administrator mails and notifications to the storage section", async () => {
      await tick(96);
      await tick(96);
      const first = await test.database.execute<{ email: string }>(
        sql`select email from accounts where id = ${admins[0] ?? ""}`,
      );
      const mails = await mailTo(first.rows[0]?.email ?? "");
      expect(mails[0]?.text).toContain("https://wiki.example.org/settings/instance/storage");
      expect(await received(admins[0] ?? "", "storage.levelReached")).toMatchObject([
        { params: { link: "https://wiki.example.org/settings/instance/storage" } },
      ]);
      await tick(50);
      const cleared = await mailTo(first.rows[0]?.email ?? "");
      expect(cleared.at(-1)?.text).toContain("https://wiki.example.org/settings/instance/storage");
    });

    it("sends operations mails without an unsubscribe link and with the operations footer", async () => {
      await tick(96);
      await tick(96);
      const first = await test.database.execute<{ email: string }>(
        sql`select email from accounts where id = ${admins[0] ?? ""}`,
      );
      const mails = await mailTo(first.rows[0]?.email ?? "");
      expect(mails).toHaveLength(1);
      expect(mails[0]?.headers?.["List-Unsubscribe"]).toBeUndefined();
      expect(mails[0]?.html).not.toContain("unsubscribe");
      expect(mails[0]?.text).toContain("instance administrator or operations contact");
      expect(mails[0]?.text).toContain("Uploads are refused too");
    });
  });

  describe("reminders", () => {
    async function activate() {
      await tick(85);
      await tick(85);
    }

    async function reminders() {
      return (await received(admins[0] ?? "", "storage.levelReached")).filter(
        (row) => row.params.reminder === true,
      );
    }

    async function later(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
      usage(85);
      return monitor.check();
    }

    it("sends no reminder when the interval is off", async () => {
      await test.settings.set(storageReminderSetting, {}, "instance", "off");
      await activate();
      await later(90 * DAY);
      expect(await reminders()).toEqual([]);
    });

    it("repeats the state daily", async () => {
      await test.settings.set(storageReminderSetting, {}, "instance", "daily");
      await activate();
      await later(DAY - 2 * MINUTE);
      expect(await reminders()).toHaveLength(0);
      await later(3 * MINUTE);
      expect(await reminders()).toHaveLength(1);
      await later(DAY);
      expect(await reminders()).toHaveLength(2);
    });

    it("repeats the state weekly by default", async () => {
      await activate();
      await later(6 * DAY);
      expect(await reminders()).toHaveLength(0);
      const result = await later(DAY + MINUTE);
      expect(result.change).toBe("reminder");
      expect(await reminders()).toHaveLength(1);
      await later(3 * DAY);
      expect(await reminders()).toHaveLength(1);
    });

    it("repeats the state monthly", async () => {
      await test.settings.set(storageReminderSetting, {}, "instance", "monthly");
      await activate();
      await later(29 * DAY);
      expect(await reminders()).toHaveLength(0);
      await later(2 * DAY);
      expect(await reminders()).toHaveLength(1);
    });

    it("reports the current level in a reminder", async () => {
      await tick(91);
      await tick(91);
      await tick(91);
      await later(8 * DAY);
      const rows = await reminders();
      expect(rows).toMatchObject([{ params: { level: 2, reminder: true } }]);
    });

    it("sends no reminder when no level is active", async () => {
      await later(400 * DAY);
      expect(await received(admins[0] ?? "")).toEqual([]);
    });
  });

  describe("S3 storage", () => {
    function s3() {
      const store = new MemoryObjectStore();
      const files = new FileService({
        database: test.database,
        store,
        keyRing: test.keyRing,
        logger,
        signer: new ValueSigner({ database: test.database, encryption: test.encryption }),
        usage: new StorageUsage({ database: test.database }),
      });
      return { store, files, monitor: monitorOf(store) };
    }

    async function write(files: FileService, size: number) {
      const stored = await files.write(Readable.from([Buffer.alloc(size, 1)]), {
        name: "data.bin",
        maxBytes: 10 * MEGABYTE,
      });
      await files.commit(test.database, stored.id);
      return stored;
    }

    it("keeps a running total of the stored bytes on write and delete", async () => {
      const { store, files } = s3();
      const usageRows = new StorageUsage({ database: test.database });
      const stored = await write(files, 100_000);
      const bytes = (await store.size([...store.objects.keys()][0] ?? "")) ?? 0;
      expect(bytes).toBeGreaterThan(100_000);
      expect(await usageRows.total()).toBe(bytes);
      await write(files, 50_000);
      expect(await usageRows.total()).toBeGreaterThan(bytes);
      await test.database.execute(sql`update stored_files set state = 'orphaned' where id = ${stored.id}`);
      await files.deleteOrphaned();
      expect(await usageRows.total()).toBe(
        [...store.objects.values()].reduce((sum, object) => sum + object.length, 0),
      );
    });

    it("subtracts the bytes of an upload that failed after it was stored", async () => {
      const { store, files } = s3();
      const usageRows = new StorageUsage({ database: test.database });
      await expect(
        files.write(Readable.from([Buffer.alloc(2 * MEGABYTE, 1)]), { name: "big.bin", maxBytes: MEGABYTE }),
      ).rejects.toMatchObject({ name: "FileTooLargeError" });
      expect(store.objects.size).toBe(0);
      expect(await usageRows.total()).toBe(0);
    });

    it("reconciles the total with the real sum once a day", async () => {
      const { store, monitor: s3Monitor } = s3();
      store.objects.set("aa/bb/one", Buffer.alloc(1000));
      store.objects.set("aa/bb/two", Buffer.alloc(500));
      await test.database.execute(sql`insert into storage_state (singleton, used_bytes) values (true, 123)`);
      expect(await s3Monitor.reconcile()).toBe(1500);
      expect((await s3Monitor.status()).usedBytes).toBeNull();
      await test.settings.set(storageS3LimitSetting, {}, "instance", 3000);
      expect(await s3Monitor.status()).toMatchObject({ usedBytes: 1500, totalBytes: 3000, percent: 50 });
    });

    it("keeps uploads and deletions made while a slow listing runs, without counting them twice", async () => {
      const { store, monitor: s3Monitor } = s3();
      const usageRows = new StorageUsage({ database: test.database });
      for (const key of ["aa/one", "aa/two", "bb/one", "bb/two"]) store.objects.set(key, Buffer.alloc(100));
      await test.database.execute(sql`insert into storage_state (singleton, used_bytes) values (true, 400)`);
      store.pageSize = 2;
      store.afterPage = async (page) => {
        if (page !== 0) return;
        store.objects.set("aa/new", Buffer.alloc(50));
        await usageRows.add(50, "aa/new");
        store.objects.delete("aa/one");
        await usageRows.add(-100, "aa/one");
        store.objects.set("cc/new", Buffer.alloc(70));
        await usageRows.add(70, "cc/new");
        store.objects.delete("bb/two");
        await usageRows.add(-100, "bb/two");
      };
      const real = () => [...store.objects.values()].reduce((sum, data) => sum + data.length, 0);
      expect(await s3Monitor.reconcile()).toBe(real());
      expect(await usageRows.total()).toBe(320);
      store.afterPage = null;
      await usageRows.add(30, "dd/after");
      expect(await usageRows.total()).toBe(350);
      const left = await test.database.execute(
        sql`select count(*)::int as count from storage_reconcile_deltas`,
      );
      expect(left.rows[0]).toEqual({ count: 0 });
    });

    it("reconciles on the first check before it measures", async () => {
      const { store, monitor: s3Monitor } = s3();
      store.objects.set("aa/bb/one", Buffer.alloc(900));
      await test.settings.set(storageS3LimitSetting, {}, "instance", 1000);
      now = new Date(now.getTime() + MINUTE);
      expect(await s3Monitor.check()).toMatchObject({ reading: { percent: 90 } });
    });

    it("has no warning and no refusal without a limit", async () => {
      const { store, monitor: s3Monitor } = s3();
      store.objects.set("aa/bb/one", Buffer.alloc(900));
      await s3Monitor.reconcile();
      for (let minute = 0; minute < 3; minute += 1) {
        now = new Date(now.getTime() + MINUTE);
        expect(await s3Monitor.check()).toMatchObject({ reading: null, level: 0, change: null });
      }
      await expect(s3Monitor.requireUpload()).resolves.toBeUndefined();
      await expect(s3Monitor.requireLargeWrite(10 ** 12)).resolves.toBeUndefined();
      expect(await s3Monitor.status()).toMatchObject({
        store: "s3",
        measured: false,
        inactiveReason: "noLimit",
        level: 0,
      });
      expect(await received(admins[0] ?? "")).toEqual([]);
    });

    it("warns and refuses against the limit", async () => {
      const { store, monitor: s3Monitor } = s3();
      await test.settings.set(storageS3LimitSetting, {}, "instance", 1000);
      store.objects.set("aa/bb/one", Buffer.alloc(960));
      await s3Monitor.reconcile();
      await expect(s3Monitor.requireUpload()).rejects.toBeInstanceOf(StorageFullError);
      for (let minute = 0; minute < 2; minute += 1) {
        now = new Date(now.getTime() + MINUTE);
        await s3Monitor.check();
      }
      expect(await received(admins[0] ?? "", "storage.levelReached")).toMatchObject([
        { params: { level: 3, store: "s3", totalBytes: 1000 } },
      ]);
    });

    it("adds the bytes of a running build to the total", async () => {
      const { store, monitor: s3Monitor } = s3();
      await test.settings.set(storageS3LimitSetting, {}, "instance", 1000);
      store.objects.set("aa/bb/one", Buffer.alloc(900));
      await s3Monitor.reconcile();
      await expect(s3Monitor.requireBuildRoom(0)).resolves.toBeUndefined();
      await expect(s3Monitor.requireBuildRoom(60)).rejects.toBeInstanceOf(StorageFullError);
    });

    it("drops an active level when the limit is removed", async () => {
      const { store, monitor: s3Monitor } = s3();
      await test.settings.set(storageS3LimitSetting, {}, "instance", 1000);
      store.objects.set("aa/bb/one", Buffer.alloc(850));
      await s3Monitor.reconcile();
      for (let minute = 0; minute < 2; minute += 1) {
        now = new Date(now.getTime() + MINUTE);
        await s3Monitor.check();
      }
      expect((await s3Monitor.status()).level).toBe(1);
      await test.settings.clear(storageS3LimitSetting, {}, "instance");
      now = new Date(now.getTime() + MINUTE);
      await s3Monitor.check();
      expect((await s3Monitor.status()).level).toBe(0);
    });
  });

  describe("operations contacts", () => {
    const [firstAdmin = ""] = admins;
    const actor = () => accountPrincipal(admins[0] ?? firstAdmin);

    function hook(path: string = randomUUID()) {
      return `http://hooks.test:${port}/${path}`;
    }

    it("mails every operations address and leaves the unsubscribe link out", async () => {
      await monitor.configure(actor(), {
        operationsEmails: ["Ops@Example.org", "tickets@example.org", "ops@example.org"],
      });
      expect((await monitor.status()).operationsEmails).toEqual(["ops@example.org", "tickets@example.org"]);
      await tick(96);
      await tick(96);
      for (const address of ["ops@example.org", "tickets@example.org"]) {
        const mails = await mailTo(address);
        expect(mails).toHaveLength(1);
        expect(mails[0]?.subject).toContain("96.0 % full");
        expect(mails[0]?.text).toContain("https://wiki.example.org/settings/instance/storage");
        expect(mails[0]?.headers?.["List-Unsubscribe"]).toBeUndefined();
        expect(mails[0]?.text).toContain("operations contact");
      }
    });

    it("posts to the Teams webhook through the chat delivery when a level becomes active and when it clears", async () => {
      const url = hook("teams");
      await monitor.configure(actor(), { teamsWebhook: url });
      await tick(91);
      await tick(91);
      expect(requests).toHaveLength(0);
      expect(await teamsDeliveries()).toMatchObject([{ state: "pending" }]);
      expect(await deliverTeams()).toEqual(["delivered"]);
      expect(requests).toHaveLength(1);
      const posted = JSON.parse(requests[0]?.body ?? "{}") as {
        attachments: { content: { body: { text: string }[] } }[];
      };
      expect(posted.attachments[0]?.content.body.map((block) => block.text).join(" ")).toContain("91.0");
      await tick(50);
      expect(await deliverTeams()).toEqual(["delivered"]);
      expect(requests).toHaveLength(2);
    });

    it("posts reminders to Teams as well", async () => {
      await monitor.configure(actor(), { teamsWebhook: hook() });
      await tick(85);
      await tick(85);
      now = new Date(now.getTime() + 8 * DAY);
      usage(85);
      await monitor.check();
      await deliverTeams();
      expect(requests).toHaveLength(2);
    });

    it("queues nothing for Teams when no webhook is set", async () => {
      await tick(85);
      await tick(85);
      expect(await teamsDeliveries()).toEqual([]);
    });

    it("retries a failed Teams post and delivers it once Teams answers again", async () => {
      await monitor.configure(actor(), { teamsWebhook: hook() });
      webhookStatus = 500;
      await tick(85);
      await tick(85);
      expect(await received(admins[0] ?? "", "storage.levelReached")).toHaveLength(1);
      expect(await deliverTeams()).toEqual(["retry"]);
      expect(await teamsDeliveries()).toMatchObject([{ state: "pending" }]);
      webhookStatus = 200;
      expect(await deliverTeams()).toEqual(["delivered"]);
      expect(await teamsDeliveries()).toMatchObject([{ state: "delivered" }]);
      expect(requests).toHaveLength(2);
    });

    it("gives up after the last attempt without leaking the address", async () => {
      await monitor.configure(actor(), { teamsWebhook: hook("private-path") });
      webhookStatus = 500;
      await tick(85);
      await tick(85);
      expect(await deliverTeams(true)).toEqual(["failed"]);
      expect(await teamsDeliveries()).toMatchObject([{ state: "failed" }]);
      const stored = await test.database.execute(
        sql`select data::text as data from chat_deliveries where channel_id is null`,
      );
      expect(JSON.stringify(stored.rows)).not.toContain("private-path");
    });

    it("skips the Teams post when the webhook was removed before it was sent", async () => {
      await monitor.configure(actor(), { teamsWebhook: hook() });
      await tick(85);
      await tick(85);
      await monitor.configure(actor(), { teamsWebhook: null });
      expect(await deliverTeams()).toEqual(["skipped"]);
      expect(requests).toHaveLength(0);
    });

    it("stores the webhook address encrypted and never returns it", async () => {
      const url = hook("secret-path");
      const status = await monitor.configure(actor(), { teamsWebhook: url });
      expect(status.teamsWebhook).toEqual({ configured: true, host: "hooks.test" });
      expect(JSON.stringify(status)).not.toContain("secret-path");
      const stored = await test.database.execute<{ value: Buffer }>(
        sql`select value from instance_secrets where name = 'storage.operationsTeamsWebhook'`,
      );
      expect(Buffer.from(stored.rows[0]?.value ?? "").toString("latin1")).not.toContain("secret-path");
      const audit = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from audit_events where name = 'storage.contactsChanged'`,
      );
      expect(Number(audit.rows[0]?.count)).toBeGreaterThan(0);
      const removed = await monitor.configure(actor(), { teamsWebhook: null });
      expect(removed.teamsWebhook).toEqual({ configured: false, host: null });
    });

    it("refuses invalid addresses and keeps the earlier contacts", async () => {
      await monitor.configure(actor(), { operationsEmails: ["ops@example.org"] });
      for (const bad of [
        ["not-an-address"],
        ["ops@example.org", "missing@"],
        Array(21)
          .fill("a@example.org")
          .map((a, i) => `${i}${a}`),
      ]) {
        await expect(monitor.configure(actor(), { operationsEmails: bad })).rejects.toMatchObject({
          code: "invalidContacts",
          fields: ["operationsEmails"],
        });
      }
      expect((await monitor.status()).operationsEmails).toEqual(["ops@example.org"]);
    });

    it("refuses a webhook address that is not a valid public address", async () => {
      for (const bad of ["not a url", "ftp://hooks.test/x", "http://unknown.test/x"]) {
        await expect(monitor.configure(actor(), { teamsWebhook: bad })).rejects.toMatchObject({
          code: "invalidTeamsWebhook",
          fields: ["teamsWebhook"],
        });
      }
      expect((await monitor.status()).teamsWebhook.configured).toBe(false);
    });

    it("sends a test message to the contacts", async () => {
      await monitor.configure(actor(), { operationsEmails: ["ops@example.org"], teamsWebhook: hook() });
      const result = await monitor.sendTest();
      expect(result).toMatchObject({ addresses: 1, teams: { delivered: true } });
      expect(requests).toHaveLength(1);
      expect(await mailTo("ops@example.org")).toHaveLength(1);
    });
  });

  describe("settings", () => {
    const actor = () => accountPrincipal(admins[0] ?? "");

    it("keeps the three levels in ascending order", async () => {
      for (const bad of [
        { warning: 90 },
        { largeWrites: 80 },
        { critical: 90 },
        { warning: 70, largeWrites: 70 },
        { warning: 0 },
        { critical: 101 },
        { warning: 50.5 },
      ]) {
        await expect(monitor.configure(actor(), { thresholds: bad })).rejects.toMatchObject({
          code: "invalidThresholds",
        });
      }
      expect((await monitor.status()).thresholds).toEqual({ warning: 80, largeWrites: 90, critical: 95 });
    });

    it("saves valid thresholds together and applies them at once", async () => {
      const status = await monitor.configure(actor(), {
        thresholds: { warning: 50, largeWrites: 60, critical: 70 },
      });
      expect(status.thresholds).toEqual({ warning: 50, largeWrites: 60, critical: 70 });
      usage(65);
      await expect(monitor.requireLargeWrite()).rejects.toBeInstanceOf(StorageFullError);
    });

    it("accepts a partial change that stays in order", async () => {
      const status = await monitor.configure(actor(), { thresholds: { critical: 99 } });
      expect(status.thresholds).toEqual({ warning: 80, largeWrites: 90, critical: 99 });
    });

    it("stores the reminder interval and the S3 limit", async () => {
      const status = await monitor.configure(actor(), { reminder: "monthly", s3LimitBytes: 500 * MEGABYTE });
      expect(status).toMatchObject({ reminder: "monthly", s3LimitBytes: 500 * MEGABYTE });
      await expect(monitor.configure(actor(), { s3LimitBytes: 0 })).rejects.toMatchObject({
        code: "invalidS3Limit",
      });
      expect((await monitor.configure(actor(), { s3LimitBytes: null })).s3LimitBytes).toBeNull();
    });

    it("shows the usage of a local volume", async () => {
      usage(42);
      expect(await monitor.status()).toMatchObject({
        store: "local",
        measured: true,
        inactiveReason: null,
        usedBytes: Math.round(TOTAL * 0.42),
        totalBytes: TOTAL,
        level: 0,
      });
    });
  });
});
