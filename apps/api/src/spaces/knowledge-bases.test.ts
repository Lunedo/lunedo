import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe.skipIf(!databaseBaseUrl)("knowledge bases through the API", () => {
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
    const account = await createAccount(test, `kb${counter}@lunedo.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function knowledgeBase(client: TestClient) {
    counter += 1;
    const created = await client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Help ${counter}`,
      key: `KB${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; type: string; audience: string; overviewItemId: string | null };
  }

  it("creates a knowledge base and exposes its type", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    expect(kb).toMatchObject({ type: "knowledgeBase", audience: "signedIn", overviewItemId: null });
    const read = await author.client.get(`/api/v1/spaces/${kb.id}`);
    expect(read.json()).toMatchObject({ type: "knowledgeBase", audience: "signedIn" });
    const standard = await author.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: "No visibility",
      key: `NV${counter}X`,
      grants: [],
    });
    expect(standard.statusCode).toBe(400);
  });

  it("refuses content kinds that do not belong into a knowledge base", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    for (const body of [
      { kind: "whiteboard", title: "Board", parentId: null },
      { kind: "link", title: "Link", parentId: null, link: { url: "https://example.org" } },
    ]) {
      const response = await author.client.post(`/api/v1/spaces/${kb.id}/items`, body);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().code).toBe("knowledgeBaseContent");
    }
    const live = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "Live",
      parentId: null,
      mode: "live",
    });
    expect(live.json().code).toBe("knowledgeBaseMode");
    const post = await author.client.post(`/api/v1/spaces/${kb.id}/blog`, { title: "News" });
    expect(post.json().code).toBe("knowledgeBaseContent");
  });

  it("creates an article with sections, an image and a category, and reads it back by machine", async () => {
    const author = await person();
    const reader = await person();
    const kb = await knowledgeBase(author.client);
    const category = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "folder",
      title: "IT",
      description: "Devices and accounts",
      parentId: null,
    });
    expect(category.statusCode, category.body).toBe(201);
    const categoryId = category.json().id as string;
    expect(
      (await author.client.put(`/api/v1/categories/${categoryId}`, { icon: "monitor" })).statusCode,
    ).toBe(204);
    expect(
      (
        await author.client.put(`/api/v1/categories/${categoryId}/contact`, {
          contactEmail: "it@example.org",
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await reader.client.put(`/api/v1/categories/${categoryId}/contact`, { contactEmail: null }))
        .statusCode,
    ).toBe(403);

    const created = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "Set up the VPN connection",
      parentId: categoryId,
      articleType: "howTo",
    });
    expect(created.statusCode, created.body).toBe(201);
    const article = created.json() as { id: string; articleType: string; mode: string };
    expect(article).toMatchObject({ articleType: "howTo", mode: "publish" });

    const uploaded = await author.client.post(
      `/api/v1/pages/${article.id}/attachments?name=${encodeURIComponent("client.png")}`,
      PNG,
      { "content-type": "application/octet-stream" },
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const imageId = uploaded.json().id as string;
    const content = await author.client.put(`/api/v1/pages/${article.id}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "section",
            attrs: { key: "summary", title: "What this is about" },
            content: [paragraph("Remote access.")],
          },
          {
            type: "section",
            attrs: { key: "steps", title: "Steps", icon: "list-ordered" },
            content: [
              paragraph("Open the client."),
              { type: "image", attrs: { attachmentId: imageId, alt: "Client" } },
            ],
          },
        ],
      },
    });
    expect(content.statusCode, content.body).toBe(200);
    expect((await author.client.post(`/api/v1/pages/${article.id}/publish`, {})).statusCode).toBe(200);

    const read = await reader.client.get(`/api/v1/articles/${article.id}`);
    expect(read.statusCode, read.body).toBe(200);
    const body = read.json();
    const itemNumber = await test.runtime.pool.query<{ number: string }>(
      "select number from tree_items where id = $1",
      [article.id],
    );
    expect(body).toMatchObject({
      title: "Set up the VPN connection",
      type: "howTo",
      number: Number(itemNumber.rows[0]?.number),
      slug: "set-up-the-vpn-connection",
      categoryPath: [{ id: categoryId, title: "IT" }],
      contactEmail: "it@example.org",
      version: 1,
    });
    expect(
      body.sections.map((section: { key: string; text: string }) => [section.key, section.text]),
    ).toEqual([
      ["summary", "Remote access."],
      ["steps", "Open the client."],
    ]);
    expect(body.sections[1].content[1]).toMatchObject({
      type: "image",
      attrs: { attachmentId: imageId, frame: null },
    });

    const list = await reader.client.get(`/api/v1/spaces/${kb.id}/articles?categoryId=${categoryId}`);
    expect(list.json().items.map((entry: { id: string }) => entry.id)).toEqual([article.id]);
    const categories = await reader.client.get(`/api/v1/spaces/${kb.id}/categories`);
    expect(categories.json()).toMatchObject([{ id: categoryId, icon: "monitor", articles: 1, level: 1 }]);
    expect((await reader.client.get(`/api/v1/articles/${article.id}?draft=true`)).statusCode).toBe(403);
  });

  it("returns the numbers of the article and its translations for the addresses of the app", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    const languages = await author.client.put(`/api/v1/spaces/${kb.id}/knowledge-base/languages`, {
      defaultLanguage: "de",
      languages: ["de", "en", "fr"],
    });
    expect(languages.statusCode, languages.body).toBe(200);
    const created = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "Drucker einrichten",
      parentId: null,
    });
    expect(created.statusCode, created.body).toBe(201);
    const original = created.json() as { id: string; number: number };
    const translation = await author.client.post(`/api/v1/articles/${original.id}/translations`, {
      language: "en",
    });
    expect(translation.statusCode, translation.body).toBe(201);
    const english = translation.json() as { id: string; number: number };
    const numbers = await test.runtime.pool.query<{ id: string; number: string }>(
      "select id, number from tree_items where id = any($1::uuid[])",
      [[original.id, english.id]],
    );
    const numberOf = (id: string) => Number(numbers.rows.find((row) => row.id === id)?.number);
    expect(english.number).toBe(numberOf(english.id));
    const listed = await author.client.get(`/api/v1/articles/${english.id}/translations`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().translations).toEqual([
      expect.objectContaining({ language: "de", itemId: original.id, itemNumber: numberOf(original.id) }),
      expect.objectContaining({ language: "en", itemId: english.id, itemNumber: numberOf(english.id) }),
      expect.objectContaining({ language: "fr", itemId: null, itemNumber: null, state: "missing" }),
    ]);
    const articles = await author.client.get(`/api/v1/spaces/${kb.id}/articles`);
    expect(articles.statusCode, articles.body).toBe(200);
    expect(articles.json().items).toMatchObject([{ id: original.id, number: numberOf(original.id) }]);
  });

  it("keeps the article type of knowledge base templates and refuses it elsewhere", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    const body = {
      name: "Störungsbild",
      category: "operations",
      title: "Störung",
      fields: [],
      document: { type: "doc", content: [{ type: "paragraph" }] },
    };
    const created = await author.client.post(`/api/v1/spaces/${kb.id}/templates`, {
      ...body,
      articleType: "troubleshooting",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().articleType).toBe("troubleshooting");
    const renamed = await author.client.put(`/api/v1/spaces/${kb.id}/templates/${created.json().id}`, {
      ...body,
      name: "Neues Störungsbild",
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().articleType).toBe("troubleshooting");
    const cleared = await author.client.put(`/api/v1/spaces/${kb.id}/templates/${created.json().id}`, {
      ...body,
      articleType: null,
    });
    expect(cleared.json().articleType).toBeNull();
    counter += 1;
    const standard = await author.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Team ${counter}`,
      key: `TM${counter}X`,
      visibility: "organization",
      grants: [],
    });
    expect(standard.statusCode, standard.body).toBe(201);
    const refused = await author.client.post(`/api/v1/spaces/${standard.json().id}/templates`, {
      ...body,
      articleType: "howTo",
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe("invalidArticleType");
  });

  it("blocks publishing with an empty required section and names the section", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    const required = await author.client.put(`/api/v1/spaces/${kb.id}/knowledge-base/required-sections`, {
      templateId: "builtin:article-troubleshooting",
      sectionKey: "resolution",
      required: true,
    });
    expect(required.statusCode, required.body).toBe(200);
    const created = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "",
      parentId: null,
      template: { id: "builtin:article-troubleshooting", values: {} },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().articleType).toBe("troubleshooting");
    const publish = await author.client.post(`/api/v1/pages/${created.json().id}/publish`, {});
    expect(publish.statusCode).toBe(409);
    expect(publish.json()).toMatchObject({
      code: "requiredSectionsEmpty",
      sections: [{ key: "resolution" }],
    });
  });

  it("asks before widening the audience", async () => {
    const author = await person();
    const kb = await knowledgeBase(author.client);
    const preview = await author.client.post(`/api/v1/spaces/${kb.id}/knowledge-base/audience/preview`, {
      audience: "public",
    });
    expect(preview.json()).toEqual({ widening: true, articles: 0 });
    const refused = await author.client.put(`/api/v1/spaces/${kb.id}/knowledge-base/audience`, {
      audience: "public",
    });
    expect(refused.json().code).toBe("audienceWidening");
    const confirmed = await author.client.put(`/api/v1/spaces/${kb.id}/knowledge-base/audience`, {
      audience: "public",
      confirmWidening: true,
    });
    expect(confirmed.json()).toMatchObject({ audience: "public" });
    const visibility = await author.client.put(`/api/v1/spaces/${kb.id}/visibility`, {
      visibility: "private",
    });
    expect(visibility.json().code).toBe("knowledgeBaseVisibility");
  });

  it("sets who maintains and who reads a category, for space admins only", async () => {
    const author = await person();
    const colleague = await person();
    const kb = await knowledgeBase(author.client);
    const folder = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "folder",
      title: "IT and devices",
      parentId: null,
    });
    expect(folder.statusCode, folder.body).toBe(201);
    const folderId = (folder.json() as { id: string }).id;
    const group = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
      name: `IT ${counter}`,
    });
    const groupId = (group.json() as { id: string }).id;
    const path = `/api/v1/spaces/${kb.id}/knowledge-base/categories/${folderId}/access`;
    const body = { responsibleGroupIds: [groupId], visibleGroupIds: [groupId] };

    expect((await colleague.client.put(path, body)).statusCode).toBe(403);
    const preview = await author.client.post(`${path}/preview`, body);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ widening: false, articles: 0 });
    const changed = await author.client.put(path, body);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({
      itemId: folderId,
      readable: false,
      responsibleGroups: [{ id: groupId }],
      visibleTo: [{ id: groupId }],
    });
    const listed = await author.client.get(`/api/v1/spaces/${kb.id}/knowledge-base/category-access`);
    expect(listed.json()).toEqual([expect.objectContaining({ itemId: folderId, readable: false })]);
    const hidden = await colleague.client.get(`/api/v1/spaces/${kb.id}/knowledge-base/category-access`);
    expect(hidden.json()).toEqual([]);

    const widening = await author.client.put(path, { responsibleGroupIds: [groupId], visibleGroupIds: null });
    expect(widening.statusCode).toBe(409);
    expect(widening.json()).toMatchObject({ code: "categoryVisibilityWidening", articles: 0 });
    const confirmed = await author.client.put(path, {
      responsibleGroupIds: [groupId],
      visibleGroupIds: null,
      confirmWidening: true,
    });
    expect(confirmed.json()).toMatchObject({ readable: true, visibleTo: null });

    const shared = await author.client.post(`/api/v1/pages/${folderId}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(shared.statusCode).toBe(409);
    expect(shared.json()).toMatchObject({ code: "categoryAccessManaged" });
  });
});
