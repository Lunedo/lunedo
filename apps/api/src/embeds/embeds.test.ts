import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

const custom = {
  id: "videos",
  name: "Company videos",
  rules: [
    {
      pattern: "https://videos.example.org/watch?v={video}",
      embed: "https://videos.example.org/embed/{video}",
    },
  ],
};

describe.skipIf(!databaseBaseUrl)("embeds, whiteboard blocks and page options through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let webRoot: string;
  let counter = 0;

  beforeAll(async () => {
    webRoot = mkdtempSync(path.join(tmpdir(), "pagehall-embeds-"));
    writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Pagehall</title>");
    test = await createAuthTestApp(configuredSetupEnv, { webRoot });
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
    rmSync(webRoot, { recursive: true, force: true });
  });

  async function person() {
    counter += 1;
    const email = `embeds${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function space(grants: unknown[] = []) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Embeds ${counter}`,
      key: `E${counter}B`,
      visibility: "private",
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }

  async function item(spaceId: string, kind: string, title: string, extra: Record<string, unknown> = {}) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind,
      title,
      parentId: null,
      ...extra,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string };
  }

  const services = async (client: TestClient) =>
    (await client.get(`/api/v1/organizations/${organizationId}/embed-services`)).json().services as {
      id: string;
    }[];

  it("lists the default services, follows the instance list and lets organizations only narrow it", async () => {
    const member = await person();
    expect((await services(member.client)).map((service) => service.id)).toContain("youtube");

    const instance = await owner.put("/api/v1/instance/settings/embeds.services", { value: [custom] });
    expect(instance.statusCode, instance.body).toBe(204);
    expect(await services(member.client)).toEqual([custom]);

    const narrowed = await owner.put(
      `/api/v1/organizations/${organizationId}/settings/embeds.allowedServices`,
      {
        value: ["youtube"],
      },
    );
    expect(narrowed.statusCode, narrowed.body).toBe(204);
    expect(await services(member.client)).toEqual([]);
    const overview = (
      await member.client.get(`/api/v1/organizations/${organizationId}/embed-services`)
    ).json();
    expect(overview).toMatchObject({ available: [custom], narrowed: true });

    await owner.put(`/api/v1/organizations/${organizationId}/settings/embeds.allowedServices`, {
      clear: true,
    });
    expect(await services(member.client)).toEqual([custom]);

    const invalid = await owner.put("/api/v1/instance/settings/embeds.services", {
      value: [
        {
          ...custom,
          rules: [{ pattern: "http://videos.example.org/{id}", embed: "https://x.example.org/{id}" }],
        },
      ],
    });
    expect(invalid.statusCode).toBe(400);
    const html = await owner.put("/api/v1/instance/settings/embeds.services", {
      value: [{ ...custom, rules: [{ pattern: "https://a.example.org/{id}", embed: "<iframe src=x>" }] }],
    });
    expect(html.statusCode).toBe(400);
    await owner.put("/api/v1/instance/settings/embeds.services", { clear: true });
  });

  it("does not let members change the allowlist", async () => {
    const member = await person();
    const instance = await member.client.put("/api/v1/instance/settings/embeds.services", {
      value: [custom],
    });
    expect([403, 404]).toContain(instance.statusCode);
    const organization = await member.client.put(
      `/api/v1/organizations/${organizationId}/settings/embeds.allowedServices`,
      { value: [] },
    );
    expect([403, 404]).toContain(organization.statusCode);
  });

  it("generates the frame policy of the application from the instance allowlist", async () => {
    const before = await owner.get("/spaces/docs");
    expect(before.headers["content-security-policy"]).toContain("frame-src 'self'");
    expect(before.headers["content-security-policy"]).toContain("https://www.youtube-nocookie.com");
    await owner.put("/api/v1/instance/settings/embeds.services", { value: [custom] });
    const after = await owner.get("/spaces/docs");
    expect(after.headers["content-security-policy"]).toBe("frame-src 'self' https://videos.example.org");
    await owner.put("/api/v1/instance/settings/embeds.services", { value: [] });
    expect((await owner.get("/")).headers["content-security-policy"]).toBe("frame-src 'self'");
    await owner.put("/api/v1/instance/settings/embeds.services", { clear: true });
  });

  it("shows a whiteboard in a block only to people who can see it", async () => {
    const both = await person();
    const pageOnly = await person();
    const boardSpace = await space([{ principalKind: "account", principalId: both.id, role: "reader" }]);
    const pageSpace = await space([
      { principalKind: "account", principalId: both.id, role: "reader" },
      { principalKind: "account", principalId: pageOnly.id, role: "reader" },
    ]);
    const board = await item(boardSpace, "whiteboard", "Netzwerk-Umbau 2027");
    const reference = await both.client.get(`/api/v1/whiteboards/${board.id}/reference`);
    expect(reference.statusCode, reference.body).toBe(200);
    expect(reference.json()).toMatchObject({
      itemId: board.id,
      title: "Netzwerk-Umbau 2027",
      preview: false,
    });
    expect(reference.json().href).toContain(`/whiteboards/${board.id}/`);
    const hidden = await pageOnly.client.get(`/api/v1/whiteboards/${board.id}/reference`);
    expect([403, 404]).toContain(hidden.statusCode);
    expect(hidden.body).not.toContain("Netzwerk-Umbau");

    const page = await item(pageSpace, "page", "Standort Graz");
    const stored = await owner.put(`/api/v1/pages/${page.id}/content`, {
      document: { type: "doc", content: [{ type: "whiteboard", attrs: { whiteboardId: board.id } }] },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    await owner.post(`/api/v1/pages/${page.id}/publish`, {});
    const markdown = await pageOnly.client.get(`/api/v1/pages/${page.id}/markdown`);
    expect(markdown.statusCode, markdown.body).toBe(200);
    expect(markdown.body).not.toContain("Netzwerk-Umbau");
  });

  it("lets page tree links point to whiteboards", async () => {
    const spaceId = await space();
    const board = await item(spaceId, "whiteboard", "Retro board");
    const link = await item(spaceId, "link", "Board link", { link: { itemId: board.id } });
    const read = await owner.get(`/api/v1/items/${link.id}`);
    expect(read.json().link).toMatchObject({
      itemId: board.id,
      accessible: true,
      target: { kind: "whiteboard" },
    });
  });

  it("refuses links to other kinds of items", async () => {
    const spaceId = await space();
    const folder = await item(spaceId, "folder", "Docs");
    const link = await item(spaceId, "link", "Docs link", { link: { itemId: folder.id } });
    const nested = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "link",
      title: "Link to a link",
      parentId: null,
      link: { itemId: link.id },
    });
    expect(nested.statusCode).toBe(400);
  });

  it("stores whether the headings of a page are numbered", async () => {
    const spaceId = await space();
    const page = await item(spaceId, "page", "Handbook");
    expect((await owner.get(`/api/v1/items/${page.id}`)).json().numberHeadings).toBe(false);
    const changed = await owner.patch(`/api/v1/items/${page.id}`, { numberHeadings: true });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().numberHeadings).toBe(true);
    expect(
      (await owner.patch(`/api/v1/items/${page.id}`, { title: "Handbook 2" })).json().numberHeadings,
    ).toBe(true);
  });
});
