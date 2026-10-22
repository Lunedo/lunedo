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

describe.skipIf(!databaseBaseUrl)("knowledge base statistics through the API", () => {
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

  async function person() {
    counter += 1;
    const account = await createAccount(test, `statistics${counter}@lunedo.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function setup() {
    const admin = await person();
    const editor = await person();
    const reader = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Rated help ${counter}`,
      key: `ST${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [
        { principalKind: "account", principalId: editor.id, role: "editor" },
        { principalKind: "account", principalId: reader.id, role: "reader" },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const kb = created.json() as { id: string };
    const article = await admin.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "Set up the VPN",
      parentId: null,
    });
    const articleId = (article.json() as { id: string }).id;
    expect((await admin.client.post(`/api/v1/pages/${articleId}/publish`, {})).statusCode).toBe(200);
    const statistics = test.runtime.services.portalStatistics;
    for (let index = 0; index < 3; index++) {
      await statistics.recordSearch(kb.id, { term: "Parkausweis", results: 0, categoryId: null });
    }
    await statistics.recordRating(kb.id, articleId, false);
    await statistics.recordFeedback(kb.id, articleId, "Lea Hoffmann, room 4.12, knows how");
    return { admin, editor, reader, kb, articleId };
  }

  it("shows the statistics to editors and admins, not to readers", async () => {
    const context = await setup();
    const url = `/api/v1/spaces/${context.kb.id}/statistics?period=7d`;
    expect((await context.reader.client.get(url)).statusCode).toBe(403);
    const shown = await context.editor.client.get(url);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.json()).toMatchObject({
      searches: { total: 3, zeroResults: 3 },
      zeroResultTerms: [{ term: "parkausweis", searches: 3 }],
      unhelpful: [{ article: { id: context.articleId }, unhelpful: 1, feedback: 1 }],
    });
    expect((await context.admin.client.get(`${url.split("?")[0]}?period=1y`)).statusCode).toBe(400);
  });

  it("lists notes for editors and lets only admins delete them", async () => {
    const context = await setup();
    const listUrl = `/api/v1/spaces/${context.kb.id}/statistics/articles/${context.articleId}/feedback`;
    expect((await context.reader.client.get(listUrl)).statusCode).toBe(403);
    const listed = await context.editor.client.get(listUrl);
    expect(listed.statusCode, listed.body).toBe(200);
    const [note] = (listed.json() as { items: { id: string; text: string }[] }).items;
    if (!note) throw new Error("No note listed");
    const deleteUrl = `/api/v1/spaces/${context.kb.id}/statistics/feedback/${note.id}`;
    expect((await context.editor.client.delete(deleteUrl)).statusCode).toBe(403);
    expect((await context.admin.client.delete(deleteUrl)).statusCode).toBe(204);
    const again = await context.admin.client.delete(deleteUrl);
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe("feedbackNotFound");
    expect((await context.editor.client.get(listUrl)).json()).toEqual({ items: [], nextCursor: null });
  });
});
