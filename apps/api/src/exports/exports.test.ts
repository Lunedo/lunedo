import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  MAX_PARALLEL_PAGE_EXPORTS,
  pageExportSlots,
} from "@lunedo/server";
import { testJobContext } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("exports through the API", () => {
  let test: AuthTestApp;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `exporter${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password)).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const admin = await person();
    const reader = await person();
    const exporter = await person();
    const outsider = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Exported ${counter}`,
      key: `EX${counter}X`,
      visibility: "private",
      grants: [
        { principalKind: "account", principalId: reader.id, role: "reader" },
        { principalKind: "account", principalId: exporter.id, role: "admin" },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const space = created.json() as { id: string; exportEnabled: boolean };
    const page = await admin.client.post(`/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title: "Restart the VPN gateway",
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageId = (page.json() as { id: string }).id;
    const content = await admin.client.put(`/api/v1/pages/${pageId}/content`, {
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hold the button" }] }],
      },
    });
    expect(content.statusCode, content.body).toBe(200);
    return { admin, reader, exporter, outsider, space, pageId };
  }

  async function run(exportId: string) {
    await test.runtime.services.exports.work(testJobContext("exports.build", { exportId }));
  }

  it("sends a page as Markdown, HTML or ZIP as a download", async () => {
    const context = await setup();
    const markdown = await context.reader.client.get(
      `/api/v1/pages/${context.pageId}/export?format=markdown`,
    );
    expect(markdown.statusCode, markdown.body).toBe(200);
    expect(markdown.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers["content-disposition"]).toContain(
      'attachment; filename="Restart the VPN gateway.md"',
    );
    expect(markdown.body).toContain("# Restart the VPN gateway");
    expect(markdown.body).toContain("Hold the button");

    const html = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=html`);
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(html.headers["content-security-policy"]).toContain("sandbox");
    expect(html.body).toContain("<h1>Restart the VPN gateway</h1>");

    const zip = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=zip`);
    expect(zip.statusCode).toBe(200);
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("answers pages the caller cannot read like unknown pages", async () => {
    const context = await setup();
    const response = await context.outsider.client.get(
      `/api/v1/pages/${context.pageId}/export?format=markdown`,
    );
    expect(response.statusCode).toBe(404);
  });

  it("builds a space export in the background and lets only its owner download it", async () => {
    const context = await setup();
    const started = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`);
    expect(started.statusCode, started.body).toBe(202);
    const exported = started.json() as { id: string; state: string };
    expect(exported.state).toBe("queued");

    const second = await context.exporter.client.post(`/api/v1/pages/${context.pageId}/exports`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "exportRunning" });

    await run(exported.id);
    const ready = await context.exporter.client.get(`/api/v1/exports/${exported.id}`);
    expect(ready.json()).toMatchObject({ state: "ready", scope: "space" });
    const listed = await context.exporter.client.get("/api/v1/exports");
    expect((listed.json() as { id: string }[]).map((entry) => entry.id)).toContain(exported.id);

    const download = await context.exporter.client.get(`/api/v1/exports/${exported.id}/content`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");
    expect(download.headers["content-disposition"]).toMatch(/^attachment; filename=".+\.zip"/);
    expect(download.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");

    for (const other of [context.admin, context.outsider]) {
      expect((await other.client.get(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
      expect((await other.client.get(`/api/v1/exports/${exported.id}/content`)).statusCode).toBe(404);
      expect((await other.client.delete(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
    }

    expect((await context.exporter.client.delete(`/api/v1/exports/${exported.id}`)).statusCode).toBe(204);
    expect((await context.exporter.client.get(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
  });

  it("refuses every export with a clear error while export is turned off, also for space administrators", async () => {
    const context = await setup();
    const reader = await context.reader.client.put(
      `/api/v1/spaces/${context.space.id}/settings/spaces.export`,
      { value: false },
    );
    expect(reader.statusCode).toBe(403);
    const turnedOff = await context.admin.client.put(
      `/api/v1/spaces/${context.space.id}/settings/spaces.export`,
      {
        value: false,
      },
    );
    expect(turnedOff.statusCode, turnedOff.body).toBe(204);
    const details = await context.reader.client.get(`/api/v1/spaces/${context.space.id}`);
    expect(details.json()).toMatchObject({ exportEnabled: false });

    for (const response of [
      await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=markdown`),
      await context.admin.client.get(`/api/v1/pages/${context.pageId}/export?format=markdown`),
      await context.admin.client.post(`/api/v1/pages/${context.pageId}/exports`),
      await context.admin.client.post(`/api/v1/spaces/${context.space.id}/exports`),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        code: "exportDisabled",
        detail: expect.stringContaining("space administrator can turn it on"),
      });
    }
  });

  it("lets only space administrators export the space and pages with their subpages", async () => {
    const context = await setup();
    for (const response of [
      await context.reader.client.post(`/api/v1/spaces/${context.space.id}/exports`),
      await context.reader.client.post(`/api/v1/pages/${context.pageId}/exports`),
    ]) {
      expect(response.statusCode).toBe(403);
    }
    const reader = await context.reader.client.get(`/api/v1/spaces/${context.space.id}`);
    expect(reader.json()).toMatchObject({ role: "reader", mayExport: false });
    const exporter = await context.exporter.client.get(`/api/v1/spaces/${context.space.id}`);
    expect(exporter.json()).toMatchObject({ role: "admin", mayExport: true });
    const started = await context.exporter.client.post(`/api/v1/pages/${context.pageId}/exports`);
    expect(started.statusCode, started.body).toBe(202);
  });

  it("sends a page as print-ready HTML or Word and explains that PDF needs the render container", async () => {
    const context = await setup();
    const printed = await context.reader.client.get(
      `/api/v1/pages/${context.pageId}/export?format=print&paper=letter&orientation=landscape&contents=false`,
    );
    expect(printed.statusCode, printed.body).toBe(200);
    expect(printed.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(printed.headers["content-disposition"]).toContain('filename="Restart the VPN gateway.html"');
    expect(printed.body).toContain("@page{size:letter landscape;");
    expect(printed.body).toContain("Hold the button");
    expect(printed.body).not.toContain('<nav class="ld-contents"');

    const word = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=docx`);
    expect(word.statusCode, word.body).toBe(200);
    expect(word.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(word.headers["content-disposition"]).toContain('filename="Restart the VPN gateway.docx"');
    expect(word.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");

    const pdf = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=pdf`);
    expect(pdf.statusCode).toBe(503);
    expect(pdf.json()).toMatchObject({
      code: "renderUnavailable",
      detail: "Server-side PDF needs the render container; see the documentation",
    });
    const job = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`, {
      format: "pdf",
    });
    expect(job.statusCode).toBe(503);
    expect(job.json()).toMatchObject({ code: "renderUnavailable" });

    const invalid = await context.reader.client.get(
      `/api/v1/pages/${context.pageId}/export?format=print&paper=a3`,
    );
    expect(invalid.statusCode).toBe(400);
  });

  it("asks to retry a Word file later while the node builds as many as it may", async () => {
    const context = await setup();
    const releases: (() => void)[] = [];
    const held = Array.from({ length: MAX_PARALLEL_PAGE_EXPORTS }, (_, index) =>
      pageExportSlots.run(
        { type: "account", id: `holder-${index}` },
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
    );
    const busy = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=docx`);
    expect(busy.statusCode).toBe(503);
    expect(busy.headers["retry-after"]).toBe("5");
    expect(busy.json().type).toContain("busy");
    for (const release of releases) release();
    await Promise.all(held);
    const word = await context.reader.client.get(`/api/v1/pages/${context.pageId}/export?format=docx`);
    expect(word.statusCode).toBe(200);
  });

  it("builds a Word document of a space with the chosen options and counts what it contains", async () => {
    const context = await setup();
    const counted = await context.exporter.client.get(`/api/v1/spaces/${context.space.id}/exports/summary`);
    expect(counted.statusCode, counted.body).toBe(200);
    expect(counted.json()).toEqual({
      pages: 2,
      blogPosts: 0,
      printLimit: 300,
      fileLimit: 1000,
      serverPdf: false,
      largeWritesPaused: false,
    });
    const subtree = await context.exporter.client.get(`/api/v1/pages/${context.pageId}/exports/summary`);
    expect(subtree.json()).toMatchObject({ pages: 1 });
    for (const response of [
      await context.reader.client.get(`/api/v1/spaces/${context.space.id}/exports/summary`),
      await context.reader.client.get(`/api/v1/pages/${context.pageId}/exports/summary`),
    ]) {
      expect(response.statusCode).toBe(403);
    }

    const started = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`, {
      format: "docx",
      comments: true,
      paper: "letter",
    });
    expect(started.statusCode, started.body).toBe(202);
    const exported = started.json() as { id: string; format: string; options: Record<string, unknown> };
    expect(exported.format).toBe("docx");
    expect(exported.options).toEqual({
      attachments: true,
      comments: true,
      contents: true,
      paper: "letter",
      orientation: "portrait",
      siteUrl: null,
    });
    await run(exported.id);
    const download = await context.exporter.client.get(`/api/v1/exports/${exported.id}/content`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(download.headers["content-disposition"]).toMatch(/filename=".+\.docx"/);

    const unknown = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`, {
      format: "epub",
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("shows the state of rendering to instance administrators only", async () => {
    const context = await setup();
    const refused = await context.exporter.client.get("/api/v1/instance/rendering");
    expect(refused.statusCode).toBe(403);
    const owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    const status = await owner.get("/api/v1/instance/rendering");
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toEqual({
      pdf: {
        state: "notConfigured",
        reason: null,
        url: null,
        checkedAt: null,
        version: null,
        browser: null,
        concurrency: null,
        running: null,
        waiting: null,
        maxBytes: null,
        timeoutSeconds: null,
        image: null,
      },
      word: { available: true },
    });
  });

  it("keeps a download for 24 hours after it was first sent completely, and resumes with ranges", async () => {
    const context = await setup();
    const started = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`);
    const { id } = started.json() as { id: string };
    await run(id);
    const hoursLeft = async () => {
      const details = (await context.exporter.client.get(`/api/v1/exports/${id}`)).json() as {
        expiresAt: string;
        size: number;
      };
      return { hours: (Date.parse(details.expiresAt) - Date.now()) / 3_600_000, size: details.size };
    };
    const { size } = await hoursLeft();
    const part = await context.exporter.client.get(`/api/v1/exports/${id}/content`, { range: "bytes=0-9" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-9/${size}`);
    expect(part.rawPayload.length).toBe(10);
    expect((await hoursLeft()).hours).toBeGreaterThan(24 * 6.9);

    const rest = await context.exporter.client.get(`/api/v1/exports/${id}/content`, { range: "bytes=10-" });
    expect(rest.statusCode).toBe(206);
    expect(rest.rawPayload.length).toBe(size - 10);
    await expect.poll(async () => (await hoursLeft()).hours, { timeout: 15_000 }).toBeLessThanOrEqual(24);
    expect((await hoursLeft()).hours).toBeGreaterThan(23.9);

    const outside = await context.exporter.client.get(`/api/v1/exports/${id}/content`, {
      range: `bytes=${size}-`,
    });
    expect(outside.statusCode).toBe(416);
  });

  it("accepts a single range only and refuses several or malformed ranges", async () => {
    const context = await setup();
    const started = await context.exporter.client.post(`/api/v1/spaces/${context.space.id}/exports`);
    const { id } = started.json() as { id: string };
    await run(id);
    const details = async () =>
      (await context.exporter.client.get(`/api/v1/exports/${id}`)).json() as {
        expiresAt: string;
        size: number;
      };
    const { size, expiresAt } = await details();
    for (const range of [
      "bytes=0-1,4-5",
      "bytes=0-1, 4-5",
      "bytes=0-,-1",
      "bytes=5-2",
      "bytes=-0",
      "bytes=-",
      "bytes=x-1",
      "items=0-1",
    ]) {
      const refused = await context.exporter.client.get(`/api/v1/exports/${id}/content`, { range });
      expect(refused.statusCode, range).toBe(416);
      expect(refused.headers["content-range"], range).toBe(`bytes */${size}`);
    }
    expect((await details()).expiresAt).toBe(expiresAt);
  });

  it("builds a static website only of a public knowledge base and checks its address", async () => {
    const admin = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Help ${counter}`,
      key: `HW${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const spaceId = (created.json() as { id: string }).id;
    const refused = await admin.client.post(`/api/v1/spaces/${spaceId}/exports`, { format: "site" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "staticSiteNotPublic" });
    const audience = await admin.client.put(`/api/v1/spaces/${spaceId}/knowledge-base/audience`, {
      audience: "public",
      groupIds: [],
      confirmWidening: true,
    });
    expect(audience.statusCode, audience.body).toBe(200);
    for (const siteUrl of ["help.example.org", "javascript:alert(1)", "ftp://help.example.org/"]) {
      const invalid = await admin.client.post(`/api/v1/spaces/${spaceId}/exports`, {
        format: "site",
        siteUrl,
      });
      expect(invalid.statusCode, siteUrl).toBe(400);
    }
    const started = await admin.client.post(`/api/v1/spaces/${spaceId}/exports`, {
      format: "site",
      siteUrl: "https://help.example.org/",
    });
    expect(started.statusCode, started.body).toBe(202);
    const exported = started.json() as { id: string; options: { siteUrl: string | null } };
    expect(exported.options.siteUrl).toBe("https://help.example.org/");
    await run(exported.id);
    const download = await admin.client.get(`/api/v1/exports/${exported.id}/content`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");

    const standard = await setup();
    const notKnowledgeBase = await standard.exporter.client.post(
      `/api/v1/spaces/${standard.space.id}/exports`,
      {
        format: "site",
      },
    );
    expect(notKnowledgeBase.statusCode).toBe(409);
    expect(notKnowledgeBase.json()).toMatchObject({ code: "notKnowledgeBase" });
    const page = await standard.exporter.client.post(`/api/v1/pages/${standard.pageId}/exports`, {
      format: "site",
    });
    expect(page.statusCode).toBe(400);
    const archive = await standard.exporter.client.post(`/api/v1/spaces/${standard.space.id}/exports`, {
      format: "archive",
      siteUrl: "https://help.example.org/",
    });
    expect(archive.statusCode, archive.body).toBe(202);
    expect((archive.json() as { options: { siteUrl: string | null } }).options.siteUrl).toBeNull();
  });
});
