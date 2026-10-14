import { Readable } from "node:stream";
import {
  accountAttemptLimitSetting,
  accountPrincipal,
  clientAttemptLimitSetting,
  SYSTEM,
} from "@pagehall/server";
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

function documentWith(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe.skipIf(!databaseBaseUrl)("search through the API", () => {
  let test: AuthTestApp;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    const owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(home?: string) {
    counter += 1;
    const account = await createAccount(test, `search${counter}@pagehall.test`, undefined, home);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function setup() {
    const editor = await person();
    const reader = await person();
    counter += 1;
    const word = `searchword${counter}x`;
    const space = await editor.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Search ${counter}`,
      key: `S${counter}Q`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(space.statusCode, space.body).toBe(201);
    const spaceId = space.json().id as string;
    const page = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Printer setup",
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    const content = await editor.client.put(`/api/v1/pages/${page.json().id}/content`, {
      document: documentWith(`Connect the ${word} printer`),
    });
    expect(content.statusCode, content.body).toBe(200);
    await test.runtime.services.search.indexer.drain();
    return { editor, reader, word, spaceId, pageId: page.json().id as string };
  }

  it("returns results, counts and the index state to people of the organization", async () => {
    const { reader, word, spaceId, pageId } = await setup();
    const response = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${encodeURIComponent(word)}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.results[0]).toMatchObject({
      type: "page",
      id: pageId,
      itemId: pageId,
      title: "Printer setup",
      sharedWithYou: false,
      space: { id: spaceId },
    });
    expect(body.results[0].excerpt).toContainEqual({ text: word, highlighted: true });
    expect(body.facets.types).toEqual([{ value: "page", count: 1 }]);
    expect(body.index).toEqual({ building: false });
  });

  it("serves quick search with few results and no counts", async () => {
    const { reader, word, spaceId } = await setup();
    const response = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?mode=quick&spaceId=${spaceId}&q=${encodeURIComponent(word.slice(0, -2))}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ total: 1, facets: null, nextCursor: null });
  });

  it("filters with lists of values and rejects a broken cursor", async () => {
    const { reader, word, spaceId } = await setup();
    const filtered = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${word}&spaceIds=${spaceId}&types=page,comment&includeArchived=true&sort=newest`,
    );
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().total).toBe(1);
    const broken = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${word}&cursor=nope`,
    );
    expect(broken.statusCode).toBe(400);
  });

  it("returns attachments with their file and accepts the new types as filters", async () => {
    const { editor, reader, word, pageId } = await setup();
    const attachment = await test.runtime.services.attachments.upload(accountPrincipal(editor.id), pageId, {
      name: "printer-manual.txt",
      body: Readable.from([Buffer.from("Manual")]),
    });
    await test.runtime.services.search.indexer.drain();
    const response = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=manual&types=attachment,topic,decision`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().results).toEqual([
      expect.objectContaining({
        type: "attachment",
        id: attachment.id,
        itemId: pageId,
        itemType: "page",
        heading: "printer-manual.txt",
        attachment: {
          id: attachment.id,
          name: "printer-manual.txt",
          contentType: attachment.contentType,
          size: 6,
        },
        topic: null,
        series: null,
      }),
    ]);
    const typed = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${encodeURIComponent(`type:attachment printer ${word}`)}`,
    );
    expect(typed.json().total).toBe(0);
  });

  it("refuses people outside the organization", async () => {
    const { word } = await setup();
    const other = await test.runtime.services.organizations.createAsActor(SYSTEM, {
      name: `Other ${counter}`,
      ownerAccountId: (await createAccount(test, `owner${counter}@pagehall.test`)).id,
    });
    const outsider = await person(other.id);
    const response = await outsider.client.get(`/api/v1/organizations/${organizationId}/search?q=${word}`);
    expect(response.statusCode).toBe(404);
  });

  it("lets editors set the content language of a page and refuses readers", async () => {
    const { editor, reader, pageId } = await setup();
    const refused = await reader.client.put(`/api/v1/pages/${pageId}/content-language`, { language: "de" });
    expect(refused.statusCode).toBe(403);
    const set = await editor.client.put(`/api/v1/pages/${pageId}/content-language`, { language: "de" });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().contentLanguage).toBe("de");
    const invalid = await editor.client.put(`/api/v1/pages/${pageId}/content-language`, { language: "xx" });
    expect(invalid.statusCode).toBe(400);
    const cleared = await editor.client.put(`/api/v1/pages/${pageId}/content-language`, { language: null });
    expect(cleared.json().contentLanguage).toBeNull();
  });
  it("filters by content language and counts recent changes", async () => {
    const { reader, word } = await setup();
    const languages = await reader.client.get(`/api/v1/organizations/${organizationId}/search?q=${word}`);
    expect(languages.json().facets.languages).toHaveLength(1);
    expect(languages.json().facets.updated).toContainEqual({ value: "week", count: 1 });
    const none = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${word}&languages=xx`,
    );
    expect(none.json().total).toBe(0);
  });

  it("keeps recent searches private to the person who searched", async () => {
    const { editor, reader } = await setup();
    const base = `/api/v1/organizations/${organizationId}/search/recent`;
    const filters = { labels: ["runbook"], updated: "month" };
    const remembered = await reader.client.post(base, { query: "vpn gateway", filters });
    expect(remembered.statusCode, remembered.body).toBe(204);
    const list = await reader.client.get(base);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({
        query: "vpn gateway",
        filters: expect.objectContaining({ labels: ["runbook"], updated: "month", sort: "relevance" }),
      }),
    ]);
    expect((await editor.client.get(base)).json()).toEqual([]);
    const id = list.json()[0].id as string;
    expect((await editor.client.delete(`${base}/${id}`)).statusCode).toBe(404);
    expect((await editor.client.delete(base)).statusCode).toBe(204);
    expect((await reader.client.get(base)).json()).toHaveLength(1);
    expect((await reader.client.delete(`${base}/${id}`)).statusCode).toBe(204);
    expect((await reader.client.get(base)).json()).toEqual([]);
    const invalid = await reader.client.post(base, { query: "x", filters: { sort: "oldest" } });
    expect(invalid.statusCode).toBe(400);
  });

  it("keeps saved searches private and stores the query, never results", async () => {
    const { editor, reader, word } = await setup();
    const base = `/api/v1/organizations/${organizationId}/search/saved`;
    const created = await reader.client.post(base, {
      name: "Printers",
      query: word,
      filters: { types: ["page"] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json();
    expect(Object.keys(saved).sort()).toEqual(["createdAt", "filters", "id", "name", "query", "updatedAt"]);
    expect((await editor.client.get(base)).json()).toEqual([]);
    expect((await editor.client.patch(`${base}/${saved.id}`, { name: "Mine now" })).statusCode).toBe(404);
    expect((await editor.client.delete(`${base}/${saved.id}`)).statusCode).toBe(404);
    const renamed = await reader.client.patch(`${base}/${saved.id}`, { name: "Printer pages" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().name).toBe("Printer pages");
    expect((await reader.client.post(base, { name: " ", query: "x", filters: {} })).statusCode).toBe(400);
    expect((await reader.client.get(base)).json().map((entry: { name: string }) => entry.name)).toEqual([
      "Printer pages",
    ]);
    expect((await reader.client.delete(`${base}/${saved.id}`)).statusCode).toBe(204);
  });
});
