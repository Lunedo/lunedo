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

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe.skipIf(!databaseBaseUrl)("spaces and pages through the API", () => {
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

  async function person(kind: "member" | "none" = "member") {
    counter += 1;
    const email = `person${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const id =
      kind === "member"
        ? (await createAccount(test, email, password)).id
        : (
            await test.runtime.database.transaction((tx) =>
              test.runtime.services.accounts.createStandard(tx, {
                email,
                name: `person${counter}`,
                password,
                homeOrganizationId: null,
              }),
            )
          ).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function createSpace(client: TestClient, grants: unknown[] = [], visibility = "private") {
    counter += 1;
    const response = await client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Space ${counter}`,
      key: `S${counter}X`,
      visibility,
      grants,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; key: string; overviewItemId: string };
  }

  async function createPage(
    client: TestClient,
    spaceId: string,
    title: string,
    parentId: string | null = null,
  ) {
    const response = await client.post(`/api/v1/spaces/${spaceId}/items`, { kind: "page", title, parentId, mode: "live" });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; position: string };
  }

  it("creates a space with defaults from the organization and finds it by key", async () => {
    const creator = await person();
    const defaults = await creator.client.get(`/api/v1/organizations/${organizationId}/space-defaults`);
    expect(defaults.json()).toMatchObject({ visibility: "organization" });
    const suggestion = await creator.client.get(
      `/api/v1/organizations/${organizationId}/space-key-suggestion?name=${encodeURIComponent("Customer Support")}`,
    );
    expect(suggestion.json()).toMatchObject({ key: "CS", available: true });
    const space = await createSpace(creator.client);
    const byKey = await creator.client.get(`/api/v1/space-keys/${space.key.toLowerCase()}`);
    expect(byKey.json()).toMatchObject({ redirected: false, space: { id: space.id, role: "admin" } });
    const listed = await creator.client.get(`/api/v1/spaces?organizationId=${organizationId}&q=${space.key}`);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([space.id]);
    const taken = await creator.client.get(`/api/v1/organizations/${organizationId}/space-keys/${space.key}`);
    expect(taken.json()).toMatchObject({ valid: true, available: false });
  });

  it("hides spaces and pages from people without access and refuses changes to readers", async () => {
    const creator = await person();
    const reader = await person();
    const outsider = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const page = await createPage(creator.client, space.id, "Runbook");
    expect((await outsider.client.get(`/api/v1/spaces/${space.id}`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/items/${page.id}`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/pages/${page.id}/content`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/space-keys/${space.key}`)).statusCode).toBe(404);

    expect((await reader.client.get(`/api/v1/pages/${page.id}/content`)).statusCode).toBe(200);
    const writes = [
      reader.client.put(`/api/v1/pages/${page.id}/content`, {
        document: { type: "doc", content: [paragraph("x")] },
      }),
      reader.client.patch(`/api/v1/items/${page.id}`, { title: "Renamed" }),
      reader.client.post(`/api/v1/items/${page.id}/move`, { parentId: null }),
      reader.client.post(`/api/v1/items/${page.id}/convert`, { kind: "folder" }),
      reader.client.post(`/api/v1/pages/${page.id}/labels`, { label: "x" }),
      reader.client.post(`/api/v1/spaces/${space.id}/items`, { kind: "page", title: "New", parentId: null }),
      reader.client.patch(`/api/v1/spaces/${space.id}`, { name: "Renamed" }),
      reader.client.get(`/api/v1/spaces/${space.id}/permissions`),
    ];
    for (const response of await Promise.all(writes)) expect(response.statusCode, response.body).toBe(403);
    const content = await creator.client.get(`/api/v1/pages/${page.id}/content`);
    expect(JSON.stringify(content.json().document)).not.toContain('"x"');
  });

  it("stores valid content, rejects invalid content and returns Markdown and backlinks", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const target = await createPage(creator.client, space.id, "Target");
    const source = await createPage(creator.client, space.id, "Source");
    const stored = await creator.client.put(`/api/v1/pages/${source.id}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "See " },
              { type: "pageLink", attrs: { pageId: target.id, spaceId: null, title: null } },
            ],
          },
        ],
      },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json().references.pages[target.id]).toMatchObject({ title: "Target", accessible: true });
    const invalid = await creator.client.put(`/api/v1/pages/${source.id}/content`, {
      document: { type: "doc", content: [{ type: "iframe", attrs: { src: "https://evil.example" } }] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalidDocument", problems: [{ code: "unknownNode" }] });
    const markdown = await creator.client.get(`/api/v1/pages/${source.id}/markdown`);
    expect(markdown.json().markdown).toContain(`[Target](/spaces/${space.key}/pages/${target.id}/target)`);
    const backlinks = await creator.client.get(`/api/v1/pages/${target.id}/backlinks`);
    expect(backlinks.json().map((link: { itemId: string }) => link.itemId)).toEqual([source.id]);
  });

  it("arranges the tree and keeps moves inside the rules", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const parent = await createPage(creator.client, space.id, "Parent");
    const child = await createPage(creator.client, space.id, "Child", parent.id);
    const below = await creator.client.post(`/api/v1/items/${parent.id}/move`, { parentId: child.id });
    expect(below.statusCode).toBe(409);
    expect(below.json()).toMatchObject({ code: "moveIntoDescendant" });
    const moved = await creator.client.post(`/api/v1/items/${child.id}/move`, {
      parentId: null,
      beforeId: parent.id,
    });
    expect(moved.json()).toMatchObject({ parentId: null });
    const root = await creator.client.get(`/api/v1/spaces/${space.id}/items`);
    expect(root.json().items.map((item: { title: string }) => item.title)).toEqual([
      expect.any(String),
      "Child",
      "Parent",
    ]);
    const folder = await creator.client.post(`/api/v1/items/${parent.id}/convert`, { kind: "folder" });
    expect(folder.json()).toMatchObject({ kind: "folder" });
    const found = await creator.client.get(`/api/v1/items?q=chil&spaceId=${space.id}`);
    expect(found.json().map((item: { id: string }) => item.id)).toEqual([child.id]);
  });

  it("previews and changes permissions with the space admin rules", async () => {
    const creator = await person();
    const colleague = await person();
    const space = await createSpace(creator.client);
    const change = { action: "grant", principalKind: "account", principalId: colleague.id, role: "editor" };
    const preview = await creator.client.post(`/api/v1/spaces/${space.id}/permissions/preview`, change);
    expect(preview.json()).toMatchObject({
      gaining: 1,
      changes: [{ accountId: colleague.id, after: "editor" }],
    });
    const changed = await creator.client.post(`/api/v1/spaces/${space.id}/permissions`, change);
    expect(changed.statusCode, changed.body).toBe(200);
    const own = changed.json().find((entry: { principalId: string }) => entry.principalId === creator.id);
    const last = await creator.client.delete(`/api/v1/spaces/${space.id}/permissions/${own.id}`);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ code: "lastSpaceAdmin" });
    const visibility = await creator.client.post(`/api/v1/spaces/${space.id}/visibility/preview`, {
      visibility: "organization",
    });
    expect(visibility.statusCode).toBe(200);
    expect(visibility.json().gaining).toBeGreaterThan(0);
  });

  it("limits API tokens to their scopes", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const page = await createPage(creator.client, space.id, "Scripted");
    const token = async (scopes: object) =>
      (await creator.client.post("/api/v1/account/tokens", { name: "Script", scopes })).json()
        .token as string;
    const readOnly = await token({ organization: { spaces: "view" } });
    const writer = await token({ organization: { spaces: "manage" } });
    const unrelated = await token({ organization: { membersAndGroups: "view" } });
    const script = new TestClient(test.app);
    expect((await script.get(`/api/v1/pages/${page.id}/content`, bearer(readOnly))).statusCode).toBe(200);
    const document = { type: "doc", content: [paragraph("From a script")] };
    expect(
      (await script.put(`/api/v1/pages/${page.id}/content`, { document }, bearer(readOnly))).statusCode,
    ).toBe(403);
    expect(
      (await script.put(`/api/v1/pages/${page.id}/content`, { document }, bearer(writer))).statusCode,
    ).toBe(200);
    expect((await script.get(`/api/v1/pages/${page.id}/content`, bearer(unrelated))).statusCode).toBe(404);
    expect(
      (await script.get(`/api/v1/spaces?organizationId=${organizationId}`, bearer(unrelated))).statusCode,
    ).toBe(403);
    const listed = await script.get(`/api/v1/spaces?organizationId=${organizationId}`, bearer(readOnly));
    expect(listed.json().items.map((item: { id: string }) => item.id)).toContain(space.id);
  });

  it("lets organization administrators see spaces without a space admin and appoint one", async () => {
    const creator = await person();
    const successor = await person();
    const space = await createSpace(creator.client);
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [creator.id]);
    const listed = await owner.get(`/api/v1/organizations/${organizationId}/spaces-without-administrator`);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toContain(space.id);
    const appointed = await owner.post(
      `/api/v1/organizations/${organizationId}/spaces/${space.id}/administrator`,
      {
        accountId: successor.id,
      },
    );
    expect(appointed.statusCode, appointed.body).toBe(204);
    expect((await successor.client.get(`/api/v1/spaces/${space.id}`)).json()).toMatchObject({
      role: "admin",
    });
    const ordinary = await person();
    expect(
      (await ordinary.client.get(`/api/v1/organizations/${organizationId}/spaces-without-administrator`))
        .statusCode,
    ).toBe(403);
  });

  it("creates the personal space on first use and lets instance administrators transfer it without reading it", async () => {
    const leaving = await person();
    const personal = await leaving.client.post("/api/v1/account/personal-space", {
      overviewTitle: "Personal space",
    });
    expect(personal.json()).toMatchObject({ personal: true, organizationId: null });
    const again = await leaving.client.post("/api/v1/account/personal-space", { overviewTitle: "Other" });
    expect(again.json().id).toBe(personal.json().id);
    expect((await owner.get(`/api/v1/spaces/${personal.json().id}`)).statusCode).toBe(404);
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [leaving.id]);
    const review = await owner.get("/api/v1/instance/personal-spaces");
    expect(review.json().items.map((item: { spaceId: string }) => item.spaceId)).toContain(
      personal.json().id,
    );
    const successor = await person();
    const transfer = await owner.post(`/api/v1/instance/personal-spaces/${personal.json().id}/transfer`, {
      accountId: successor.id,
    });
    expect(transfer.statusCode, transfer.body).toBe(204);
    expect((await successor.client.get(`/api/v1/spaces/${personal.json().id}`)).json()).toMatchObject({
      role: "admin",
    });
    expect((await owner.get(`/api/v1/spaces/${personal.json().id}`)).statusCode).toBe(404);
  });

  it("finds people the caller may see", async () => {
    const searcher = await person();
    const colleague = await person();
    const stranger = await person("none");
    const found = await searcher.client.get("/api/v1/people?q=person");
    const ids = found.json().items.map((item: { id: string }) => item.id);
    expect(ids).toContain(colleague.id);
    expect(ids).not.toContain(stranger.id);
  });
});
