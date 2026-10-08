import { accountAttemptLimitSetting, anyoneLinksSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

const DAY = 24 * 60 * 60 * 1000;

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

describe.skipIf(!databaseBaseUrl)("page access through the API", () => {
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
    const email = `access${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function space(grants: unknown[]) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Access ${counter}`,
      key: `A${counter}X`,
      visibility: "private",
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; key: string };
  }

  async function page(spaceId: string, title: string, parentId: string | null = null) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title,
      parentId,
      mode: "live",
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  it("hide a restricted page in every API path, including its title", async () => {
    const insider = await person();
    const outsider = await person();
    const created = await space([
      { principalKind: "account", principalId: insider.id, role: "editor" },
      { principalKind: "account", principalId: outsider.id, role: "editor" },
    ]);
    const target = await page(created.id, "Glossary");
    const secret = await page(created.id, "Merger plans");
    const child = await page(created.id, "Merger timeline", secret);
    await owner.put(`/api/v1/pages/${secret}/content`, {
      document: { type: "doc", content: [paragraph({ type: "pageLink", attrs: { pageId: target } })] },
    });
    await owner.post(`/api/v1/pages/${secret}/labels`, { label: "merger" });
    await owner.post(`/api/v1/pages/${secret}/comments`, {
      body: { type: "doc", content: [paragraph({ type: "text", text: "Board only" })] },
    });
    const restricted = await owner.post(`/api/v1/pages/${secret}/access`, {
      changes: [
        { action: "share", holderKind: "account", holderId: insider.id, role: "editor" },
        { action: "restrict", kind: "view" },
      ],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    const notFound = [
      `/api/v1/items/${secret}`,
      `/api/v1/items/${child}`,
      `/api/v1/pages/${secret}/content`,
      `/api/v1/pages/${secret}/markdown`,
      `/api/v1/pages/${secret}/labels`,
      `/api/v1/pages/${secret}/comments`,
      `/api/v1/pages/${secret}/tasks`,
      `/api/v1/pages/${secret}/backlinks`,
      `/api/v1/pages/${secret}/reactions`,
      `/api/v1/pages/${secret}/versions`,
      `/api/v1/pages/${secret}/attachments`,
    ];
    for (const path of notFound) {
      const response = await outsider.client.get(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.body, path).not.toContain("Merger");
    }
    for (const path of [
      `/api/v1/spaces/${created.id}/items`,
      `/api/v1/spaces/${created.id}/items?parentId=${secret}`,
      `/api/v1/items?q=Merger`,
      `/api/v1/pages/${target}/backlinks`,
      `/api/v1/spaces/${created.id}/labels`,
      `/api/v1/spaces/${created.id}/labels/merger/pages`,
      `/api/v1/recent`,
      `/api/v1/tasks?assignee=me`,
      `/api/v1/spaces/${created.id}/restricted-pages`,
    ]) {
      const response = await outsider.client.get(path);
      expect(response.body, path).not.toContain("Merger");
    }
    expect((await insider.client.get(`/api/v1/items/${child}`)).statusCode).toBe(200);
    expect((await owner.get(`/api/v1/spaces/${created.id}/restricted-pages`)).body).toContain("Merger plans");
  });

  it("share a page with someone outside the space without revealing the space or its tree", async () => {
    const guest = await person();
    const created = await space([]);
    const root = await page(created.id, "Roadmap");
    const shared = await page(created.id, "Launch plan", root);
    await page(created.id, "Launch checklist", shared);
    const response = await owner.post(`/api/v1/pages/${shared}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    const details = await guest.client.get(`/api/v1/items/${shared}`);
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({ spaceKey: "", spaceName: "", spaceAccess: false, ancestors: [] });
    expect((await guest.client.get(`/api/v1/spaces/${created.id}/items`)).statusCode).toBe(404);
    expect((await guest.client.get(`/api/v1/items/${root}`)).statusCode).toBe(404);
    expect((await guest.client.get(`/api/v1/spaces/${created.id}`)).statusCode).toBe(404);
    const list = (await guest.client.get("/api/v1/shared-with-me")).json() as {
      itemId: string;
      spaceKey: string;
    }[];
    expect(list).toEqual([expect.objectContaining({ itemId: shared, spaceKey: "", spaceName: "" })]);
  });

  it("open links for anyone without an account, with password, rate limit and revocation", async () => {
    const created = await space([]);
    const shared = await page(created.id, "Status page");
    await test.runtime.settings.set(
      anyoneLinksSetting,
      { organization: organizationId },
      "organization",
      true,
    );
    try {
      const made = await owner.post(`/api/v1/pages/${shared}/share-links`, {
        scope: "anyone",
        expiresAt: new Date(Date.now() + DAY).toISOString(),
        password: "harbour lantern",
      });
      expect(made.statusCode, made.body).toBe(201);
      const { token, link } = made.json() as { token: string; link: { id: string } };
      const visitor = new TestClient(test.app, { remoteAddress: "203.0.113.50" });
      expect((await visitor.get(`/api/v1/share-links/${token}/page`)).statusCode).toBe(401);
      expect(
        (await visitor.post(`/api/v1/share-links/${token}/open`, { password: "wrong" })).statusCode,
      ).toBe(401);
      const opened = await visitor.post(`/api/v1/share-links/${token}/open`, { password: "harbour lantern" });
      expect(opened.statusCode, opened.body).toBe(200);
      const unlock = (opened.json() as { unlock: string }).unlock;
      const read = await visitor.get(`/api/v1/share-links/${token}/page`, { "x-pagehall-unlock": unlock });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ title: "Status page" });
      expect((await visitor.get(`/api/v1/items/${shared}`)).statusCode).toBe(401);
      expect((await owner.delete(`/api/v1/pages/${shared}/share-links/${link.id}`)).statusCode).toBe(204);
      expect(
        (await visitor.get(`/api/v1/share-links/${token}/page`, { "x-pagehall-unlock": unlock })).statusCode,
      ).toBe(404);
      const guesser = new TestClient(test.app, { remoteAddress: "203.0.113.51" });
      let limited = false;
      for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
        const response = await guesser.post(
          `/api/v1/share-links/${"x".repeat(16)}${String(attempt).padStart(32, "y")}/open`,
          {},
        );
        limited = response.statusCode === 429;
      }
      expect(limited).toBe(true);
    } finally {
      await test.runtime.settings.clear(anyoneLinksSetting, { organization: organizationId }, "organization");
    }
  });

  it("list signed-in visitors of a link as via link and decide access requests", async () => {
    const member = await person();
    const created = await space([]);
    const shared = await page(created.id, "Onboarding");
    const made = await owner.post(`/api/v1/pages/${shared}/share-links`, { scope: "organization" });
    const { token } = made.json() as { token: string };
    const opened = await member.client.post(`/api/v1/share-links/${token}/open`, {});
    expect(opened.json()).toMatchObject({ kind: "account", itemId: shared });
    const access = await owner.get(`/api/v1/pages/${shared}/access`);
    const body = access.json() as { linkVisitors: { accountId: string }[]; canInviteGuests: boolean };
    expect(body.linkVisitors.map((v) => v.accountId)).toEqual([member.id]);
    expect(body.canInviteGuests).toBe(true);
    const links = await owner.get(`/api/v1/pages/${shared}/share-links`);
    expect((links.json() as { links: { token: string }[] }).links.map((l) => l.token)).toEqual([token]);
    const other = await page(created.id, "Budget");
    expect(
      (await member.client.post(`/api/v1/pages/${other}/access-requests`, { message: "Please" })).statusCode,
    ).toBe(202);
    const requests = await owner.get(`/api/v1/spaces/${created.id}/access-requests`);
    const [request] = requests.json() as { id: string; itemTitle: string }[];
    expect(request?.itemTitle).toBe("Budget");
    expect((await owner.get(`/api/v1/access-requests/${request?.id}`)).json()).toMatchObject({
      status: "open",
    });
    expect((await member.client.get(`/api/v1/access-requests/${request?.id}`)).statusCode).toBe(200);
    const stranger = await person();
    expect((await stranger.client.get(`/api/v1/access-requests/${request?.id}`)).statusCode).toBe(404);
    const decided = await owner.post(`/api/v1/access-requests/${request?.id}/decide`, {
      approve: true,
      role: "reader",
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await member.client.get(`/api/v1/items/${other}`)).statusCode).toBe(200);
  });

  it("explain what a person can do and export the overview as CSV", async () => {
    const member = await person();
    const created = await space([{ principalKind: "account", principalId: member.id, role: "reader" }]);
    const access = await owner.get(`/api/v1/organizations/${organizationId}/people/${member.id}/access`);
    expect(access.statusCode, access.body).toBe(200);
    expect((access.json() as { entries: { spaceId: string; kind: string }[] }).entries).toContainEqual(
      expect.objectContaining({ spaceId: created.id, kind: "space" }),
    );
    const csv = await owner.get(
      `/api/v1/organizations/${organizationId}/access-overview?accountId=${member.id}`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("person,email,kind,space,page,role,pages,reason");
    expect(
      (await member.client.get(`/api/v1/organizations/${organizationId}/access-overview`)).statusCode,
    ).toBe(403);
  });
});
