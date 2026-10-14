import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { testJobContext } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl } from "../testing/auth-app.js";

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
    const email = `exporter${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password)).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const admin = await person();
    const reader = await person();
    const outsider = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Exported ${counter}`,
      key: `EX${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
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
    return { admin, reader, outsider, space, pageId };
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
    const started = await context.reader.client.post(`/api/v1/spaces/${context.space.id}/exports`);
    expect(started.statusCode, started.body).toBe(202);
    const exported = started.json() as { id: string; state: string };
    expect(exported.state).toBe("queued");

    const second = await context.reader.client.post(`/api/v1/pages/${context.pageId}/exports`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "exportRunning" });

    await run(exported.id);
    const ready = await context.reader.client.get(`/api/v1/exports/${exported.id}`);
    expect(ready.json()).toMatchObject({ state: "ready", scope: "space" });
    const listed = await context.reader.client.get("/api/v1/exports");
    expect((listed.json() as { id: string }[]).map((entry) => entry.id)).toContain(exported.id);

    const download = await context.reader.client.get(`/api/v1/exports/${exported.id}/content`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");
    expect(download.headers["content-disposition"]).toMatch(/^attachment; filename=".+\.zip"/);
    expect(download.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");

    for (const other of [context.admin, context.outsider]) {
      expect((await other.client.get(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
      expect((await other.client.get(`/api/v1/exports/${exported.id}/content`)).statusCode).toBe(404);
      expect((await other.client.delete(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
    }

    expect((await context.reader.client.delete(`/api/v1/exports/${exported.id}`)).statusCode).toBe(204);
    expect((await context.reader.client.get(`/api/v1/exports/${exported.id}`)).statusCode).toBe(404);
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

    for (const client of [context.admin.client, context.reader.client]) {
      for (const response of [
        await client.get(`/api/v1/pages/${context.pageId}/export?format=markdown`),
        await client.post(`/api/v1/pages/${context.pageId}/exports`),
        await client.post(`/api/v1/spaces/${context.space.id}/exports`),
      ]) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          code: "exportDisabled",
          detail: expect.stringContaining("space administrator can turn it on"),
        });
      }
    }
  });
});
