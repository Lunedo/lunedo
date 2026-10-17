import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { exportEnabledSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { MAX_EXPORT_ATTEMPTS } from "./exports.js";
import {
  bytesOf,
  doc,
  type ExportContext,
  exportFixtures,
  paragraph,
  text,
  unzip,
} from "./fixtures.testing.js";

const baseUrl = testDatabaseBaseUrl();
const INSTANCE = "https://wiki.example.org";

describe.skipIf(!baseUrl)("exports", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);
  const { setup } = exportFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", { configuredInstanceUrl: INSTANCE });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  type Context = ExportContext;

  async function run(exportId: string, signal?: AbortSignal) {
    const job = testJobContext("exports.build", { exportId });
    await test.services.exports.work(signal ? { ...job, signal } : job);
  }

  async function exported(actor: Principal, target: { spaceId: string } | { pageId: string }) {
    const started = await test.services.exports.start(actor, target);
    await run(started.id);
    const ready = await test.services.exports.get(actor, started.id);
    expect(ready.state).toBe("ready");
    const file = await test.services.exports.download(actor, started.id);
    return { id: started.id, file, files: await unzip(await bytesOf(file)) };
  }

  function textOf(files: Map<string, Buffer>, path: string): string {
    const content = files.get(path);
    if (!content) throw new Error(`${path} is missing; the archive has ${[...files.keys()].join(", ")}`);
    return content.toString("utf8");
  }

  function everything(files: Map<string, Buffer>): string {
    return [...files].map(([path, content]) => `${path}\n${content.toString("utf8")}`).join("\n");
  }

  describe("a space as an administrator without access to restricted pages sees it", () => {
    let context: Context;
    let files: Map<string, Buffer>;
    let fileName: string;

    beforeAll(async () => {
      context = await setup();
      const result = await exported(context.steward, { spaceId: context.space.id });
      files = result.files;
      fileName = result.file.fileName;
    });

    it("lays out the page tree as folders with each page as Markdown and HTML and an index", () => {
      expect([...files.keys()].sort()).toEqual(
        [
          "index.html",
          "Handbook/Handbook.md",
          "Handbook/Handbook.html",
          "Welcome/Welcome.md",
          "Welcome/Welcome.html",
          "Welcome/notes.txt",
          "Network- setup-guide/Network- setup-guide.md",
          "Network- setup-guide/Network- setup-guide.html",
          "Ops/Ops.md",
          "Ops/Ops.html",
        ].sort(),
      );
      expect(fileName).toMatch(/^Handbook \d{4}-\d{2}-\d{2}\.zip$/);
      expect(textOf(files, "Welcome/notes.txt")).toBe("attachment body");
    });

    it("leaves out restricted pages, their titles and their links", () => {
      const all = everything(files);
      expect(all).not.toContain("Salaries");
      expect(all).not.toContain("Bonus plan");
      expect(all).not.toContain("Confidential numbers");
      expect(all).not.toContain("Secret task");
      expect(all).not.toContain(context.pages.salaries.id);
      expect(textOf(files, "Welcome/Welcome.html")).toContain('data-access="none">No access</span>');
    });

    it("exports the published version and never the draft", () => {
      const all = everything(files);
      expect(textOf(files, "Network- setup-guide/Network- setup-guide.md")).toContain("Published text");
      expect(all).not.toContain("Draft secret");
      expect(all).not.toContain("Unpublished idea");
      expect(all).not.toContain("Never published");
    });

    it("rewrites links inside the export to relative paths and points the rest to Pagehall", () => {
      const html = textOf(files, "Welcome/Welcome.html");
      const markdown = textOf(files, "Welcome/Welcome.md");
      expect(html).toContain('href="../Network-%20setup-guide/Network-%20setup-guide.html"');
      expect(markdown).toContain("](../Network-%20setup-guide/Network-%20setup-guide.md)");
      expect(html).toContain('href="../Ops/Ops.html#steps"');
      expect(html).toContain('href="notes.txt"');
      expect(markdown).toContain("[notes.txt](notes.txt)");
      expect(html).toContain(`href="${INSTANCE}/spaces/`);
      expect(html).toContain(`/pages/${context.pages.remote.id}/remote-page"`);
      expect(html).toContain('<a href="../index.html">Contents</a>');
      expect(textOf(files, "index.html")).toContain('<a href="Welcome/Welcome.html">Welcome</a>');
    });

    it("renders modules as static content with the exporter's permissions", () => {
      const html = textOf(files, "Welcome/Welcome.html");
      expect(html).toContain("@Rita Reader</span>");
      expect(html).toContain('class="ph-page-report"');
      expect(html).toContain("Renew certificate");
      expect(html).toContain('<a href="../Ops/Ops.html">Ops</a>');
      expect(textOf(files, "Welcome/Welcome.md")).toContain("| Task | Assigned to | Due | Page |");
    });

    it("makes HTML files self-contained", () => {
      const html = textOf(files, "Ops/Ops.html");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("<style>");
      expect(html).not.toMatch(/<link|<script|src="http/);
    });
  });

  it("includes restricted pages for people who may read them", async () => {
    const context = await setup();
    const { files } = await exported(context.insider, { spaceId: context.space.id });
    expect(textOf(files, "Salaries 2027/Salaries 2027.md")).toContain("Confidential numbers");
    expect(textOf(files, "Salaries 2027/Bonus plan/Bonus plan.html")).toContain("<h1>Bonus plan</h1>");
    expect(textOf(files, "Welcome/Welcome.html")).toContain("Secret task");
    expect(textOf(files, "Welcome/Welcome.html")).toContain('href="../Salaries%202027/Salaries%202027.html"');
  });

  it("leaves drafts and unpublished pages out for space admins, who could see them in Pagehall", async () => {
    const context = await setup();
    const { files } = await exported(context.steward, { spaceId: context.space.id });
    const all = everything(files);
    expect(all).toContain("Published text");
    expect(all).not.toContain("Draft secret");
    expect(all).not.toContain("Unpublished idea");
    expect(all).not.toContain("Never published");
    expect(all).not.toContain(context.pages.unpublished.id);
  });

  it("exports a page with its subpages and audits it", async () => {
    const context = await setup();
    const { id, files } = await exported(context.insider, { pageId: context.pages.salaries.id });
    expect([...files.keys()].sort()).toEqual(
      [
        "index.html",
        "Salaries 2027/Salaries 2027.md",
        "Salaries 2027/Salaries 2027.html",
        "Salaries 2027/Bonus plan/Bonus plan.md",
        "Salaries 2027/Bonus plan/Bonus plan.html",
      ].sort(),
    );
    const events = await test.database.execute<{ name: string; fields: { exportId: string } }>(sql`
      select name, fields from audit_events where target_id = ${context.pages.salaries.id} and name = 'page.subtreeExported'`);
    expect(events.rows.map((row) => row.fields.exportId)).toEqual([id]);
  });

  it("audits space exports", async () => {
    const context = await setup();
    const { id } = await exported(context.steward, { spaceId: context.space.id });
    const events = await test.database.execute<{ fields: { exportId: string; name: string } }>(sql`
      select fields from audit_events where target_id = ${context.space.id} and name = 'space.exported'`);
    expect(events.rows.map((row) => row.fields)).toEqual([
      expect.objectContaining({ exportId: id, name: "Handbook" }),
    ]);
  });

  describe("single pages", () => {
    it("exports the published version as Markdown and as self-contained HTML", async () => {
      const context = await setup();
      for (const actor of [context.reader, context.admin]) {
        const markdown = await test.services.exports.page(actor, context.pages.network.id, "markdown");
        expect(markdown.fileName).toBe("Network- setup-guide.md");
        const content = (await bytesOf(markdown)).toString("utf8");
        expect(content).toContain("# Network: setup/guide");
        expect(content).toContain("Published text");
        expect(content).not.toContain("Draft secret");
        const html = (
          await bytesOf(await test.services.exports.page(actor, context.pages.network.id, "html"))
        ).toString("utf8");
        expect(html).toContain("Published text");
        expect(html).not.toContain("Draft secret");
      }
    });

    it("exports a page with its attachments as a ZIP and links them relatively", async () => {
      const context = await setup();
      const file = await test.services.exports.page(context.reader, context.pages.welcome.id, "zip");
      const files = await unzip(await bytesOf(file));
      expect([...files.keys()].sort()).toEqual(["Welcome.html", "Welcome.md", "notes.txt"]);
      expect(textOf(files, "Welcome.html")).toContain('href="notes.txt"');
      expect(textOf(files, "Welcome.html")).toContain(`href="${INSTANCE}/spaces/`);
    });

    it("points links to absolute addresses when the page is exported alone", async () => {
      const context = await setup();
      const html = (
        await bytesOf(await test.services.exports.page(context.reader, context.pages.welcome.id, "html"))
      ).toString("utf8");
      expect(html).toContain(`href="${INSTANCE}/api/v1/attachments/${context.notes.id}/content"`);
      expect(html).not.toContain("../");
    });

    it("refuses pages the person cannot read and pages that were never published", async () => {
      const context = await setup();
      await expect(
        test.services.exports.page(context.reader, context.pages.salaries.id, "markdown"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        test.services.exports.page(context.admin, context.pages.unpublished.id, "markdown"),
      ).rejects.toMatchObject({ decision: { denials: ["unpublished"] } });
    });
  });

  describe("the export setting of a space", () => {
    it("applies to everyone, including space and organization administrators", async () => {
      const context = await setup();
      const ready = await exported(context.steward, { spaceId: context.space.id });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", false);
      for (const actor of [context.admin, context.steward]) {
        await expect(test.services.exports.start(actor, { spaceId: context.space.id })).rejects.toMatchObject(
          {
            decision: { denials: ["exportDisabled"] },
          },
        );
        await expect(
          test.services.exports.page(actor, context.pages.welcome.id, "markdown"),
        ).rejects.toMatchObject({ decision: { denials: ["exportDisabled"] } });
      }
      await expect(
        test.services.exports.page(context.reader, context.pages.welcome.id, "markdown"),
      ).rejects.toMatchObject({ decision: { denials: ["exportDisabled"] } });
      await expect(test.services.exports.download(context.steward, ready.id)).rejects.toMatchObject({
        decision: { denials: ["exportDisabled"] },
      });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", true);
      await expect(test.services.exports.download(context.steward, ready.id)).resolves.toMatchObject({
        fileName: expect.stringMatching(/\.zip$/),
      });
    });

    it("fails a waiting export when export is turned off before it runs", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", false);
      await run(started.id);
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({
        state: "failed",
        errorCode: "exportDisabled",
      });
      const notification = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = ${context.stewardId} and target_id = ${started.id}`);
      expect(notification.rows.map((row) => row.type)).toEqual(["export.failed"]);
    });
  });

  describe("downloads", () => {
    it("are only for the person who exported", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      for (const other of [context.admin, context.insider, accountPrincipal(context.org.owner)]) {
        await expect(test.services.exports.download(other, id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(test.services.exports.get(other, id)).rejects.toMatchObject({ code: "exportNotFound" });
        expect((await test.services.exports.list(other)).map((entry) => entry.id)).not.toContain(id);
      }
      expect((await test.services.exports.list(context.steward)).map((entry) => entry.id)).toContain(id);
    });

    it("tell the person through a notification with the expiry", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      const notification = await test.database.execute<{ type: string; params: { expiresAt: string } }>(sql`
        select type, params from notifications where recipient_id = ${context.stewardId} and target_id = ${id}`);
      expect(notification.rows.map((row) => row.type)).toEqual(["export.ready"]);
      const days = (Date.parse(notification.rows[0]?.params.expiresAt ?? "") - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });

    it("are gone after seven days, together with their file", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      const row = await test.database.execute<{ file_id: string }>(
        sql`select file_id from exports where id = ${id}`,
      );
      await test.database.execute(
        sql`update exports set expires_at = now() - interval '1 second' where id = ${id}`,
      );
      await expect(test.services.exports.download(context.steward, id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((await test.services.exports.list(context.steward)).map((entry) => entry.id)).not.toContain(id);
      expect(await test.services.exports.removeExpired()).toBeGreaterThanOrEqual(1);
      expect((await test.database.execute(sql`select id from exports where id = ${id}`)).rows).toEqual([]);
      const file = await test.database.execute<{ state: string }>(
        sql`select state from stored_files where id = ${row.rows[0]?.file_id ?? null}`,
      );
      expect(file.rows.map((entry) => entry.state)).toEqual(["orphaned"]);
      await test.services.files.deleteOrphaned();
      expect(
        (
          await test.database.execute(
            sql`select id from stored_files where id = ${row.rows[0]?.file_id ?? null}`,
          )
        ).rows,
      ).toEqual([]);
    });

    it("stop when the person loses access to what was exported", async () => {
      const context = await setup();
      const { id } = await exported(context.insider, { pageId: context.pages.salaries.id });
      await test.services.pageAccess.change(context.admin, context.pages.salaries.id, [
        { action: "removeShare", shareId: (await shareOf(context)).id },
      ]);
      await expect(test.services.exports.download(context.insider, id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("are removed when the membership in the organization ends or the account is deactivated", async () => {
      const context = await setup();
      const first = await exported(context.steward, { spaceId: context.space.id });
      await test.services.memberships.remove(SYSTEM, context.org.id, context.stewardId, "removed", {
        releaseHome: true,
      });
      expect((await test.database.execute(sql`select id from exports where id = ${first.id}`)).rows).toEqual(
        [],
      );

      const second = await exported(context.insider, { spaceId: context.space.id });
      await test.services.memberships.deactivate(SYSTEM, context.insiderId);
      expect((await test.database.execute(sql`select id from exports where id = ${second.id}`)).rows).toEqual(
        [],
      );
    });
  });

  async function shareOf(context: Context) {
    const access = await test.services.pageAccess.get(context.admin, context.pages.salaries.id);
    const share = access.shares.find((entry) => entry.holder.id === context.insiderId);
    if (!share) throw new Error("The share is missing");
    return share;
  }

  describe("who may export spaces and pages with subpages", () => {
    async function refused(actor: Principal, context: Context) {
      await expect(test.services.exports.start(actor, { spaceId: context.space.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        test.services.exports.start(actor, { pageId: context.pages.welcome.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }

    async function allowed(actor: Extract<Principal, { type: "account" }>, context: Context) {
      const space = await test.services.exports.start(actor, { spaceId: context.space.id });
      await test.services.exports.remove(actor, space.id);
      const pages = await test.services.exports.start(actor, { pageId: context.pages.welcome.id });
      await test.services.exports.remove(actor, pages.id);
    }

    it("are space admins only, never readers, editors or guests", async () => {
      const context = await setup();
      const guestId = await member(context.org.id, "guest", "Gus Guest");
      await test.services.spacePermissions.apply(context.admin, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: guestId,
        role: "admin",
      });
      for (const actor of [context.reader, context.editor, accountPrincipal(guestId)]) {
        await refused(actor, context);
      }
      await allowed(context.steward, context);
      const page = await test.services.exports.page(context.reader, context.pages.welcome.id, "markdown");
      expect(page.fileName).toBe("Welcome.md");
    });

    it("include organization administrators with access to the space, outside confidential spaces", async () => {
      const context = await setup();
      const owner = accountPrincipal(context.org.owner);
      await refused(owner, context);
      await test.services.spacePermissions.apply(context.admin, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: context.org.owner,
        role: "reader",
      });
      await allowed(owner, context);

      const council = await test.services.spaces.create(
        context.admin,
        context.org.id,
        {
          name: `Council ${crypto.randomUUID().slice(0, 6)}`,
          key: `C${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
          visibility: "private",
          confidential: true,
          grants: [{ principalKind: "account", principalId: context.org.owner, role: "reader" }],
        },
        test.services.spacePermissions.holders,
      );
      await expect(test.services.exports.start(owner, { spaceId: council.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        test.services.exports.start(context.admin, { spaceId: council.id }),
      ).resolves.toMatchObject({
        state: "queued",
      });
    });

    it("are checked again before the download", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { pageId: context.pages.welcome.id });
      const permission = (await test.services.spacePermissions.list(context.space.id)).find(
        (entry) => entry.principalId === context.stewardId,
      );
      await test.services.spacePermissions.apply(context.admin, context.space.id, {
        action: "change",
        permissionId: permission?.id ?? "",
        role: "reader",
      });
      await expect(test.services.exports.download(context.steward, id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("free space of the file store", () => {
    const MEGABYTE = 1024 * 1024;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function capacity(free: () => number) {
      return vi
        .spyOn(test.services.files.store, "capacity")
        .mockImplementation(async () => ({ free: free(), total: 1000 * MEGABYTE }));
    }

    async function storedFiles(): Promise<number> {
      const result = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from stored_files`,
      );
      return Number(result.rows[0]?.count ?? 0);
    }

    it("refuses an export that would leave less than a tenth free, counting waiting exports", async () => {
      const context = await setup();
      capacity(() => 95 * MEGABYTE);
      await expect(
        test.services.exports.start(context.steward, { spaceId: context.space.id }),
      ).rejects.toMatchObject({
        code: "notEnoughStorage",
        message: "Not enough storage for this export. Your instance administrator needs to free up space.",
      });
      expect(await test.services.exports.list(context.steward)).toEqual([]);

      vi.restoreAllMocks();
      capacity(() => 200 * MEGABYTE);
      const waiting = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      await test.database.execute(
        sql`update exports set estimated_size = ${150 * MEGABYTE} where id = ${waiting.id}`,
      );
      await expect(
        test.services.exports.start(context.insider, { spaceId: context.space.id }),
      ).rejects.toMatchObject({ code: "notEnoughStorage" });
      await run(waiting.id);
      await expect(
        test.services.exports.start(context.insider, { spaceId: context.space.id }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("estimates the size from the pages and attachments", async () => {
      const context = await setup();
      await test.services.attachments.upload(context.admin, context.pages.welcome.id, {
        name: "dump.bin",
        body: Readable.from([Buffer.alloc(3 * MEGABYTE)]),
        contentLength: 3 * MEGABYTE,
      });
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      const row = await test.database.execute<{ estimated_size: string }>(
        sql`select estimated_size from exports where id = ${started.id}`,
      );
      expect(Number(row.rows[0]?.estimated_size)).toBeGreaterThan(3 * MEGABYTE);
    });

    it("refuses a second export of the same person before it estimates the size", async () => {
      const context = await setup();
      await test.services.exports.start(context.steward, { spaceId: context.space.id });
      const checked = capacity(() => 500 * MEGABYTE);
      await expect(
        test.services.exports.start(context.steward, { pageId: context.pages.welcome.id }),
      ).rejects.toMatchObject({ code: "exportRunning" });
      expect(checked).not.toHaveBeenCalled();
    });

    it("skips the estimate when the file store cannot report its free space", async () => {
      const context = await setup();
      vi.spyOn(test.services.files.store, "capacity").mockResolvedValue(null);
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      const row = await test.database.execute<{ estimated_size: string }>(
        sql`select estimated_size from exports where id = ${started.id}`,
      );
      expect(Number(row.rows[0]?.estimated_size)).toBe(0);
    });

    it("stops cleanly while writing when less than a twentieth is left, and leaves no file", async () => {
      const context = await setup();
      let free = 500 * MEGABYTE;
      capacity(() => free);
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      free = 40 * MEGABYTE;
      const files = await storedFiles();
      await run(started.id);
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({
        state: "failed",
        errorCode: "notEnoughStorage",
        fileName: null,
      });
      expect(await storedFiles()).toBe(files);
      const notification = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = ${context.stewardId} and target_id = ${started.id}`);
      expect(notification.rows.map((row) => row.type)).toEqual(["export.failed"]);
    });
  });

  describe("retention", () => {
    async function expiresInHours(id: string): Promise<number> {
      const result = await test.database.execute<{ expires_at: Date | string }>(
        sql`select expires_at from exports where id = ${id}`,
      );
      return (new Date(result.rows[0]?.expires_at ?? 0).getTime() - Date.now()) / 3_600_000;
    }

    it("keeps a download for 24 hours after its first complete download", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      expect(await expiresInHours(id)).toBeGreaterThan(24 * 6.9);
      const archive = await test.services.exports.download(context.steward, id);
      expect(await expiresInHours(id)).toBeGreaterThan(24 * 6.9);
      await archive.delivered();
      const first = await expiresInHours(id);
      expect(first).toBeGreaterThan(23.9);
      expect(first).toBeLessThanOrEqual(24);
      await test.database.execute(
        sql`update exports set expires_at = expires_at - interval '2 hours' where id = ${id}`,
      );
      await (await test.services.exports.download(context.steward, id)).delivered();
      expect(await expiresInHours(id)).toBeLessThan(22.1);
    });

    it("sends parts of the archive to resume a download", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      const archive = await test.services.exports.download(context.steward, id);
      const whole = await buffer(await archive.read());
      const tail = await buffer(await archive.read({ start: 10, end: archive.size - 1 }));
      expect(whole.length).toBe(archive.size);
      expect(tail.equals(whole.subarray(10))).toBe(true);
    });
  });

  describe("the background job", () => {
    it("replaces an earlier export of the same space or page and keeps only a few per person", async () => {
      const context = await setup();
      const first = await exported(context.admin, { spaceId: context.space.id });
      const firstFile = await test.database.execute<{ file_id: string }>(
        sql`select file_id from exports where id = ${first.id}`,
      );
      const second = await exported(context.admin, { spaceId: context.space.id });
      expect((await test.services.exports.list(context.admin)).map((entry) => entry.id)).toEqual([second.id]);
      const orphaned = await test.database.execute<{ state: string }>(
        sql`select state from stored_files where id = ${firstFile.rows[0]?.file_id ?? null}`,
      );
      expect(orphaned.rows.map((row) => row.state)).toEqual(["orphaned"]);
      for (const page of [
        context.pages.welcome,
        context.pages.ops,
        context.pages.network,
        context.pages.salaries,
      ]) {
        await exported(context.admin, { pageId: page.id });
      }
      await expect(
        test.services.exports.start(context.admin, { pageId: context.pages.bonus.id }),
      ).rejects.toMatchObject({ code: "tooManyExports" });
      await test.services.exports.remove(context.admin, second.id);
      await expect(
        test.services.exports.start(context.admin, { pageId: context.pages.bonus.id }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("shows a token limited to one organization only the exports of that organization", async () => {
      const context = await setup();
      const { id } = await exported(context.steward, { spaceId: context.space.id });
      const other = await organization();
      const limited: Principal = {
        type: "account",
        id: context.stewardId,
        token: {
          id: crypto.randomUUID(),
          organizationId: other.id,
          scopes: { organization: { spaces: "manage" } },
        },
      };
      expect(await test.services.exports.list(limited)).toEqual([]);
      await expect(test.services.exports.get(limited, id)).rejects.toMatchObject({ code: "exportNotFound" });
      await expect(test.services.exports.download(limited, id)).rejects.toMatchObject({
        code: "exportNotFound",
      });
      await expect(test.services.exports.remove(limited, id)).rejects.toMatchObject({
        code: "exportNotFound",
      });
      const own: Principal = {
        ...limited,
        token: { ...limited.token, organizationId: context.org.id } as never,
      };
      expect((await test.services.exports.list(own)).map((entry) => entry.id)).toEqual([id]);
    });

    it("allows one running export per person", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      await expect(
        test.services.exports.start(context.steward, { pageId: context.pages.welcome.id }),
      ).rejects.toMatchObject({ code: "exportRunning" });
      await run(started.id);
      await expect(
        test.services.exports.start(context.steward, { pageId: context.pages.welcome.id }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("offers nothing after an interruption and finishes when it runs again", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      const controller = new AbortController();
      controller.abort(new Error("Worker stopped"));
      await expect(run(started.id, controller.signal)).rejects.toThrow();
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({
        state: "running",
        fileName: null,
      });
      await expect(test.services.exports.download(context.steward, started.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const files = await test.database.execute<{ state: string }>(
        sql`select state from stored_files where state <> 'ready' and updated_at > now() - interval '1 minute'`,
      );
      expect(files.rows.filter((row) => row.state === "stored")).toEqual([]);

      await test.database.execute(
        sql`update exports set heartbeat_at = now() - interval '1 hour' where id = ${started.id}`,
      );
      expect(await test.services.exports.watchdog()).toBeGreaterThanOrEqual(1);
      await run(started.id);
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({ state: "ready" });
      expect(
        (await unzip(await bytesOf(await test.services.exports.download(context.steward, started.id)))).size,
      ).toBe(10);
    });

    it("fails with a clear reason after too many interruptions", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      await test.database.execute(
        sql`update exports set state = 'running', attempts = ${MAX_EXPORT_ATTEMPTS} where id = ${started.id}`,
      );
      await run(started.id);
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({
        state: "failed",
        errorCode: "interrupted",
      });
    });

    it("stops when the export is removed while it runs", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.steward, { spaceId: context.space.id });
      await test.services.exports.remove(context.steward, started.id);
      await run(started.id);
      expect(
        (await test.database.execute(sql`select id from exports where id = ${started.id}`)).rows,
      ).toEqual([]);
    });

    it("keeps the limits of the API token that started it", async () => {
      const context = await setup();
      const { apiToken } = await test.services.apiTokens.create(SYSTEM, {
        accountId: context.stewardId,
        name: "Export",
        scopes: { organization: { spaces: "view" } },
        organizationId: context.org.id,
      });
      const viaToken: Principal = {
        type: "account",
        id: context.stewardId,
        token: {
          id: apiToken.id,
          organizationId: context.org.id,
          scopes: { organization: { spaces: "view" } },
        },
      };
      const started = await test.services.exports.start(viaToken, { spaceId: context.space.id });
      await test.services.apiTokens.revoke(SYSTEM, apiToken.id);
      await run(started.id);
      expect(await test.services.exports.get(context.steward, started.id)).toMatchObject({
        state: "failed",
        errorCode: "tokenRevoked",
      });
    });
  });
  describe("blog posts in a space export", () => {
    async function blogSetup() {
      const context = await setup();
      const post = async (title: string, body: string) => {
        const created = await test.services.blog.create(context.admin, context.space.id, { title });
        await test.services.documents.replace(context.admin, created.id, doc(paragraph(text(body))));
        return created;
      };
      const release = await post("Release notes", "Published post text");
      await test.services.attachments.upload(context.admin, release.id, {
        name: "changes.txt",
        body: Readable.from([Buffer.from("post attachment")]),
        contentLength: 15,
      });
      await test.services.versions.publish(context.admin, release.id);
      await test.services.documents.replace(
        context.admin,
        release.id,
        doc(paragraph(text("Post draft secret"))),
      );
      const draft = await post("Draft post", "Never published post");
      const restricted = await post("Board post", "Board only text");
      await test.services.versions.publish(context.admin, restricted.id);
      await test.services.pageAccess.change(context.admin, restricted.id, [
        { action: "share", holderKind: "account", holderId: context.insiderId, role: "editor" },
        { action: "restrict", kind: "view" },
      ]);
      return { ...context, posts: { release, draft, restricted } };
    }

    it("puts published posts the exporter can read into a Blog folder, with their attachments", async () => {
      const context = await blogSetup();
      const { files } = await exported(context.steward, { spaceId: context.space.id });
      expect(textOf(files, "Blog/Release notes/Release notes.md")).toContain("Published post text");
      expect(textOf(files, "Blog/Release notes/Release notes.html")).toContain("Published post text");
      expect(textOf(files, "Blog/Release notes/changes.txt")).toBe("post attachment");
      expect(textOf(files, "index.html")).toContain("Release%20notes.html");
      const all = everything(files);
      expect(all).not.toContain("Post draft secret");
      expect(all).not.toContain("Draft post");
      expect(all).not.toContain("Never published post");
      expect(all).not.toContain("Board post");
      expect(all).not.toContain("Board only text");
    });

    it("includes restricted posts for people they are shared with", async () => {
      const context = await blogSetup();
      const { files } = await exported(context.insider, { spaceId: context.space.id });
      expect(textOf(files, "Blog/Board post/Board post.md")).toContain("Board only text");
    });

    it("leaves the Blog folder out of a page export and when there are no posts", async () => {
      const context = await blogSetup();
      const page = await exported(context.steward, { pageId: context.pages.welcome.id });
      expect([...page.files.keys()].some((path) => path.startsWith("Blog/"))).toBe(false);
      const plain = await setup();
      const space = await exported(plain.steward, { spaceId: plain.space.id });
      expect([...space.files.keys()].some((path) => path.startsWith("Blog/"))).toBe(false);
    });
  });
});
