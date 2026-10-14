import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { exportEnabledSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { type ExportFile, MAX_EXPORT_ATTEMPTS } from "./exports.js";

const baseUrl = testDatabaseBaseUrl();
const INSTANCE = "https://wiki.example.org";

function text(value: string, marks?: unknown[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(...content: unknown[]) {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function doc(...content: unknown[]) {
  return { type: "doc", content };
}

async function bytesOf(file: ExportFile): Promise<Buffer> {
  return Buffer.isBuffer(file.body) ? file.body : buffer(file.body as Readable);
}

async function unzip(data: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  );
  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        buffer(stream).then((content) => {
          files.set(entry.fileName, content);
          zip.readEntry();
        }, reject);
      });
    });
    zip.readEntry();
  });
  return files;
}

describe.skipIf(!baseUrl)("exports", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", { configuredInstanceUrl: INSTANCE });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const adminId = await member(org.id, "member", "Space admin");
    const readerId = await member(org.id, "member", "Rita Reader");
    const insiderId = await member(org.id, "member", "Ines Insider");
    const editorId = await member(org.id, "member", "Eddi Editor");
    const created = await space(org.id, adminId, {
      name: "Handbook",
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: insiderId, role: "editor" },
        { principalKind: "account", principalId: editorId, role: "editor" },
      ],
    });
    const other = await space(org.id, adminId, {
      name: "Elsewhere",
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    const admin = accountPrincipal(adminId);
    const editor = accountPrincipal(editorId);
    const create = (
      spaceId: string,
      title: string,
      parentId: string | null,
      mode: "live" | "publish" = "live",
    ) => test.services.tree.create(admin, spaceId, { kind: "page", title, mode, placement: { parentId } });
    const welcome = await create(created.id, "Welcome", null);
    const network = await create(created.id, "Network: setup/guide", null, "publish");
    const salaries = await create(created.id, "Salaries 2027", null);
    const bonus = await create(created.id, "Bonus plan", salaries.id);
    const unpublished = await create(created.id, "Unpublished idea", null, "publish");
    const ops = await create(created.id, "Ops", null);
    const remote = await create(other.id, "Remote page", null);
    await test.services.documents.replace(
      admin,
      salaries.id,
      doc(paragraph(text("Confidential numbers")), {
        type: "taskList",
        content: [{ type: "taskItem", content: [paragraph(text("Secret task"))] }],
      }),
    );
    await test.services.pageAccess.change(admin, salaries.id, [
      { action: "share", holderKind: "account", holderId: insiderId, role: "editor" },
      { action: "restrict", kind: "view" },
    ]);
    await test.services.documents.replace(admin, network.id, doc(paragraph(text("Published text"))));
    await test.services.versions.publish(admin, network.id);
    await test.services.documents.replace(admin, network.id, doc(paragraph(text("Draft secret"))));
    await test.services.documents.replace(admin, unpublished.id, doc(paragraph(text("Never published"))));
    await test.services.documents.replace(
      admin,
      ops.id,
      doc({
        type: "taskList",
        content: [{ type: "taskItem", content: [paragraph(text("Renew certificate"))] }],
      }),
    );
    const notes = await test.services.attachments.upload(admin, welcome.id, {
      name: "notes.txt",
      body: Readable.from([Buffer.from("attachment body")]),
      contentLength: 15,
    });
    await test.services.documents.replace(
      admin,
      welcome.id,
      doc(
        paragraph(
          text("See "),
          { type: "pageLink", attrs: { pageId: network.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: salaries.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: remote.id } },
          text(" and "),
          { type: "pageLink", attrs: { pageId: unpublished.id } },
          text(" by "),
          { type: "mention", attrs: { id: readerId } },
        ),
        paragraph(text("Docs", [{ type: "link", attrs: { href: `/spaces/X/pages/${ops.id}/ops#steps` } }])),
        { type: "file", attrs: { attachmentId: notes.id, name: "notes.txt" } },
        { type: "childPages", attrs: { pageId: null } },
        { type: "pageReport", attrs: { spaceId: created.id } },
        { type: "taskReport", attrs: { spaceId: created.id, status: "all" } },
      ),
    );
    return {
      org,
      space: created,
      other,
      pages: { welcome, network, salaries, bonus, unpublished, ops, remote },
      notes,
      adminId,
      readerId,
      insiderId,
      editorId,
      admin,
      editor,
      reader: accountPrincipal(readerId),
      insider: accountPrincipal(insiderId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

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

  describe("a space as the reader sees it", () => {
    let context: Context;
    let files: Map<string, Buffer>;
    let fileName: string;

    beforeAll(async () => {
      context = await setup();
      const result = await exported(context.reader, { spaceId: context.space.id });
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

    it("renders modules as static content with the reader's permissions", () => {
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

  it("leaves drafts and unpublished pages out for editors, who could see them in Pagehall", async () => {
    const context = await setup();
    const { files } = await exported(context.editor, { spaceId: context.space.id });
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
    const { id } = await exported(context.reader, { spaceId: context.space.id });
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
      const ready = await exported(context.reader, { spaceId: context.space.id });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", false);
      for (const actor of [context.admin, context.reader]) {
        await expect(test.services.exports.start(actor, { spaceId: context.space.id })).rejects.toMatchObject(
          {
            decision: { denials: ["exportDisabled"] },
          },
        );
        await expect(
          test.services.exports.page(actor, context.pages.welcome.id, "markdown"),
        ).rejects.toMatchObject({ decision: { denials: ["exportDisabled"] } });
      }
      await expect(test.services.exports.download(context.reader, ready.id)).rejects.toMatchObject({
        decision: { denials: ["exportDisabled"] },
      });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", true);
      await expect(test.services.exports.download(context.reader, ready.id)).resolves.toMatchObject({
        contentType: "application/zip",
      });
    });

    it("fails a waiting export when export is turned off before it runs", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.reader, { spaceId: context.space.id });
      await test.settings.set(exportEnabledSetting, { space: context.space.id }, "space", false);
      await run(started.id);
      expect(await test.services.exports.get(context.reader, started.id)).toMatchObject({
        state: "failed",
        errorCode: "exportDisabled",
      });
      const notification = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = ${context.readerId} and target_id = ${started.id}`);
      expect(notification.rows.map((row) => row.type)).toEqual(["export.failed"]);
    });
  });

  describe("downloads", () => {
    it("are only for the person who exported", async () => {
      const context = await setup();
      const { id } = await exported(context.reader, { spaceId: context.space.id });
      for (const other of [context.admin, context.insider, accountPrincipal(context.org.owner)]) {
        await expect(test.services.exports.download(other, id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(test.services.exports.get(other, id)).rejects.toMatchObject({ code: "exportNotFound" });
        expect((await test.services.exports.list(other)).map((entry) => entry.id)).not.toContain(id);
      }
      expect((await test.services.exports.list(context.reader)).map((entry) => entry.id)).toContain(id);
    });

    it("tell the person through a notification with the expiry", async () => {
      const context = await setup();
      const { id } = await exported(context.reader, { spaceId: context.space.id });
      const notification = await test.database.execute<{ type: string; params: { expiresAt: string } }>(sql`
        select type, params from notifications where recipient_id = ${context.readerId} and target_id = ${id}`);
      expect(notification.rows.map((row) => row.type)).toEqual(["export.ready"]);
      const days = (Date.parse(notification.rows[0]?.params.expiresAt ?? "") - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });

    it("are gone after seven days, together with their file", async () => {
      const context = await setup();
      const { id } = await exported(context.reader, { spaceId: context.space.id });
      const row = await test.database.execute<{ file_id: string }>(
        sql`select file_id from exports where id = ${id}`,
      );
      await test.database.execute(
        sql`update exports set expires_at = now() - interval '1 second' where id = ${id}`,
      );
      await expect(test.services.exports.download(context.reader, id)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await test.services.exports.list(context.reader)).map((entry) => entry.id)).not.toContain(id);
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
      const first = await exported(context.reader, { spaceId: context.space.id });
      await test.services.memberships.remove(SYSTEM, context.org.id, context.readerId, "removed", {
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

  describe("the background job", () => {
    it("allows one running export per person", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.reader, { spaceId: context.space.id });
      await expect(
        test.services.exports.start(context.reader, { pageId: context.pages.welcome.id }),
      ).rejects.toMatchObject({ code: "exportRunning" });
      await run(started.id);
      await expect(
        test.services.exports.start(context.reader, { pageId: context.pages.welcome.id }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("offers nothing after an interruption and finishes when it runs again", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.reader, { spaceId: context.space.id });
      const controller = new AbortController();
      controller.abort(new Error("Worker stopped"));
      await expect(run(started.id, controller.signal)).rejects.toThrow();
      expect(await test.services.exports.get(context.reader, started.id)).toMatchObject({
        state: "running",
        fileName: null,
      });
      await expect(test.services.exports.download(context.reader, started.id)).rejects.toBeInstanceOf(
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
      expect(await test.services.exports.get(context.reader, started.id)).toMatchObject({ state: "ready" });
      expect(
        (await unzip(await bytesOf(await test.services.exports.download(context.reader, started.id)))).size,
      ).toBe(10);
    });

    it("fails with a clear reason after too many interruptions", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.reader, { spaceId: context.space.id });
      await test.database.execute(
        sql`update exports set state = 'running', attempts = ${MAX_EXPORT_ATTEMPTS} where id = ${started.id}`,
      );
      await run(started.id);
      expect(await test.services.exports.get(context.reader, started.id)).toMatchObject({
        state: "failed",
        errorCode: "interrupted",
      });
    });

    it("stops when the export is removed while it runs", async () => {
      const context = await setup();
      const started = await test.services.exports.start(context.reader, { spaceId: context.space.id });
      await test.services.exports.remove(context.reader, started.id);
      await run(started.id);
      expect(
        (await test.database.execute(sql`select id from exports where id = ${started.id}`)).rows,
      ).toEqual([]);
    });

    it("keeps the limits of the API token that started it", async () => {
      const context = await setup();
      const { apiToken } = await test.services.apiTokens.create(SYSTEM, {
        accountId: context.readerId,
        name: "Export",
        scopes: { organization: { spaces: "view" } },
        organizationId: context.org.id,
      });
      const viaToken: Principal = {
        type: "account",
        id: context.readerId,
        token: {
          id: apiToken.id,
          organizationId: context.org.id,
          scopes: { organization: { spaces: "view" } },
        },
      };
      const started = await test.services.exports.start(viaToken, { spaceId: context.space.id });
      await test.services.apiTokens.revoke(SYSTEM, apiToken.id);
      await run(started.id);
      expect(await test.services.exports.get(context.reader, started.id)).toMatchObject({
        state: "failed",
        errorCode: "tokenRevoked",
      });
    });
  });
});
