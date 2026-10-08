import { randomBytes } from "node:crypto";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, maxFileSizeSetting } from "@pagehall/server";
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const HTML = Buffer.from(
  "<!doctype html><html><body><script>fetch('/api/v1/account').then(r=>r.text())</script></body></html>",
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
);
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF",
);
const POLYGLOT = Buffer.concat([
  Buffer.from("GIF89a"),
  Buffer.from("<script>alert(document.cookie)</script>"),
]);

describe.skipIf(!databaseBaseUrl)("attachments through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `files${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function page(grants: unknown[] = []) {
    counter += 1;
    const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Files ${counter}`,
      key: `F${counter}X`,
      visibility: "private",
      grants,
    });
    expect(space.statusCode, space.body).toBe(201);
    const spaceId = (space.json() as { id: string }).id;
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: `Page ${counter}`,
      parentId: null,
      mode: "live",
    });
    expect(created.statusCode, created.body).toBe(201);
    return { spaceId, pageId: (created.json() as { id: string }).id };
  }

  async function upload(
    client: TestClient,
    pageId: string,
    name: string,
    bytes: Buffer,
    type = "application/octet-stream",
  ) {
    return client.post(`/api/v1/pages/${pageId}/attachments?name=${encodeURIComponent(name)}`, bytes, {
      "content-type": type,
    });
  }

  async function uploaded(pageId: string, name: string, bytes: Buffer) {
    const response = await upload(owner, pageId, name, bytes);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as {
      id: string;
      contentType: string;
      preview: string;
      inline: boolean;
      name: string;
    };
  }

  function expectIsolated(headers: Record<string, unknown>) {
    expect(headers["content-security-policy"]).toMatch(/^sandbox;/);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  }

  it("serve an HTML file as plain text download inside a sandbox", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "invoice.html", HTML);
    expect(file).toMatchObject({ contentType: "text/plain; charset=utf-8", inline: false, preview: "code" });
    const response = await owner.get(`/api/v1/attachments/${file.id}/content`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(String(response.headers["content-disposition"])).toMatch(/^attachment;/);
    expectIsolated(response.headers);
  });

  it("serve an SVG with script only as download, never inline", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "logo.svg", SVG);
    expect(file).toMatchObject({ contentType: "image/svg+xml", preview: "svg", inline: false });
    const response = await owner.get(`/api/v1/attachments/${file.id}/content`);
    expect(String(response.headers["content-disposition"])).toMatch(/^attachment;/);
    expectIsolated(response.headers);
  });

  it("serve a PDF with JavaScript as download, so the browser's viewer never runs it", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "report.pdf", PDF);
    expect(file).toMatchObject({ contentType: "application/pdf", preview: "pdf", inline: false });
    const response = await owner.get(`/api/v1/attachments/${file.id}/content`);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(String(response.headers["content-disposition"])).toMatch(/^attachment;/);
    expectIsolated(response.headers);
  });

  it("decide the type from the content, not from the declared type or name", async () => {
    const { pageId } = await page();
    const response = await upload(owner, pageId, "photo.png", HTML, "application/octet-stream");
    const file = response.json() as { contentType: string; inline: boolean };
    expect(file).toMatchObject({ contentType: "text/plain; charset=utf-8", inline: false });
    const refused = await upload(owner, pageId, "photo.png", PNG, "image/png");
    expect(refused.statusCode).toBe(415);
  });

  it("keep a polyglot image an image with nosniff and sandbox", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "evil.html", POLYGLOT);
    expect(file).toMatchObject({ contentType: "image/gif", inline: true });
    const response = await owner.get(`/api/v1/attachments/${file.id}/content`);
    expect(response.headers["content-type"]).toBe("image/gif");
    expect(String(response.headers["content-disposition"])).toMatch(/^inline;/);
    expectIsolated(response.headers);
  });

  it("strip paths and control characters from file names and quote them in the header", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "../../etc/pass\r\nwd‮txt.exe", Buffer.from("hello"));
    expect(file.name).toBe("passwdtxt.exe");
    const response = await owner.get(`/api/v1/attachments/${file.id}/content`);
    expect(String(response.headers["content-disposition"])).toBe(
      "attachment; filename=\"passwdtxt.exe\"; filename*=UTF-8''passwdtxt.exe",
    );
  });

  it("serve ranges for media and refuse ranges outside the file", async () => {
    const { pageId } = await page();
    const file = await uploaded(pageId, "logo.png", PNG);
    const part = await owner.get(`/api/v1/attachments/${file.id}/content`, { range: "bytes=4-15" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 4-15/${PNG.length}`);
    expect(part.rawPayload.equals(PNG.subarray(4, 16))).toBe(true);
    const outside = await owner.get(`/api/v1/attachments/${file.id}/content`, {
      range: `bytes=${PNG.length + 5}-`,
    });
    expect(outside.statusCode).toBe(416);
  });

  it("refuse a file above the size limit and name the limit", async () => {
    const { pageId } = await page();
    await test.runtime.settings.set(maxFileSizeSetting, { organization: organizationId }, "organization", 1);
    try {
      const response = await upload(owner, pageId, "big.bin", randomBytes(1024 * 1024 + 10));
      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({ code: "fileTooLarge", maxBytes: 1024 * 1024 });
      expect(String(response.json().detail)).toContain("1 MB");
    } finally {
      await test.runtime.settings.clear(maxFileSizeSetting, { organization: organizationId }, "organization");
    }
  });

  it("do not exist for people who cannot read the page", async () => {
    const reader = await person();
    const outsider = await person();
    const { pageId } = await page([
      { principalKind: "account", principalId: reader.id, role: "reader" },
      { principalKind: "account", principalId: outsider.id, role: "reader" },
    ]);
    const file = await uploaded(pageId, "notes.txt", Buffer.from("secret"));
    expect((await reader.client.get(`/api/v1/attachments/${file.id}/content`)).statusCode).toBe(200);
    expect(
      (
        await reader.client.post(`/api/v1/pages/${pageId}/attachments?name=x.txt`, Buffer.from("x"), {
          "content-type": "application/octet-stream",
        })
      ).statusCode,
    ).toBe(403);
    expect((await reader.client.delete(`/api/v1/attachments/${file.id}`)).statusCode).toBe(403);
    const restricted = await owner.post(`/api/v1/pages/${pageId}/access`, {
      changes: [
        { action: "share", holderKind: "account", holderId: reader.id, role: "reader" },
        { action: "restrict", kind: "view" },
      ],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    for (const path of [
      `/api/v1/attachments/${file.id}`,
      `/api/v1/attachments/${file.id}/content`,
      `/api/v1/attachments/${file.id}/versions`,
      `/api/v1/pages/${pageId}/attachments`,
    ]) {
      expect((await outsider.client.get(path)).statusCode, path).toBe(404);
    }
    expect((await reader.client.get(`/api/v1/attachments/${file.id}/content`)).statusCode).toBe(200);
  });

  it("give short-lived addresses that check access again on every request", async () => {
    const reader = await person();
    const { spaceId, pageId } = await page([
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const file = await uploaded(pageId, "logo.png", PNG);
    const link = await reader.client.get(`/api/v1/attachments/${file.id}/link`);
    expect(link.statusCode, link.body).toBe(200);
    const url = (link.json() as { url: string }).url;
    const anonymous = new TestClient(test.app);
    expect((await anonymous.get(url)).statusCode).toBe(200);
    expect(
      (await anonymous.get(`${url.slice(0, -20)}${url.at(-20) === "A" ? "B" : "A"}${url.slice(-19)}`))
        .statusCode,
    ).toBe(404);
    const permissions = await owner.get(`/api/v1/spaces/${spaceId}/permissions`);
    const entry = (permissions.json() as { id: string; principalId: string }[]).find(
      (permission) => permission.principalId === reader.id,
    );
    await owner.delete(`/api/v1/spaces/${spaceId}/permissions/${entry?.id}`);
    expect((await anonymous.get(url)).statusCode).toBe(404);
  });

  it("keep versions under one name and restore an earlier one", async () => {
    const { pageId } = await page();
    const first = await uploaded(pageId, "plan.txt", Buffer.from("first"));
    const second = await uploaded(pageId, "Plan.TXT", Buffer.from("second"));
    expect(second.id).toBe(first.id);
    const restored = await owner.post(`/api/v1/attachments/${first.id}/versions/1/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    expect((await owner.get(`/api/v1/attachments/${first.id}/content`)).body).toBe("first");
    const removed = await owner.delete(`/api/v1/attachments/${first.id}`);
    expect(removed.statusCode).toBe(204);
    const back = await owner.post(`/api/v1/pages/${pageId}/attachments/${first.id}/restore`);
    expect(back.statusCode, back.body).toBe(200);
  });
});
