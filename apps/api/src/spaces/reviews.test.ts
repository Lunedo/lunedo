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

describe.skipIf(!databaseBaseUrl)("knowledge base reviews through the API", () => {
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
    const account = await createAccount(test, `review${counter}@lunedo.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function setup() {
    const author = await person();
    const reader = await person();
    counter += 1;
    const created = await author.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Reviewed help ${counter}`,
      key: `RV${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const kb = created.json() as { id: string; key: string };
    const article = await author.client.post(`/api/v1/spaces/${kb.id}/items`, {
      kind: "page",
      title: "Set up the VPN",
      parentId: null,
    });
    expect(article.statusCode, article.body).toBe(201);
    const articleId = (article.json() as { id: string }).id;
    expect((await author.client.post(`/api/v1/pages/${articleId}/publish`, {})).statusCode).toBe(200);
    return { author, reader, kb, articleId };
  }

  it("saves the review settings for space admins only and lists due articles for editors", async () => {
    const context = await setup();
    const denied = await context.reader.client.put(`/api/v1/spaces/${context.kb.id}/knowledge-base/reviews`, {
      intervalMonths: 3,
    });
    expect(denied.statusCode).toBe(403);
    const saved = await context.author.client.put(`/api/v1/spaces/${context.kb.id}/knowledge-base/reviews`, {
      intervalMonths: 3,
      leadDays: 7,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ intervalMonths: 3, leadDays: 7, recipients: "owner" });
    const invalid = await context.author.client.put(
      `/api/v1/spaces/${context.kb.id}/knowledge-base/reviews`,
      {
        leadDays: 5,
      },
    );
    expect(invalid.statusCode).toBe(400);
    await test.runtime.pool.query(
      "update article_reviews set published_at = now() - interval '4 months' where item_id = $1",
      [context.articleId],
    );
    const listed = await context.author.client.get(`/api/v1/spaces/${context.kb.id}/reviews?filter=due`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toMatchObject({
      items: [{ id: context.articleId, state: "overdue", owner: { id: context.author.id } }],
      counts: { due: 1 },
    });
    const readers = await context.reader.client.get(`/api/v1/spaces/${context.kb.id}/reviews`);
    expect(readers.json()).toMatchObject({ items: [], counts: { all: 0 } });
    const mine = await context.author.client.get("/api/v1/reviews/mine");
    expect(mine.json()).toMatchObject({ total: 1, items: [{ id: context.articleId }] });
  });

  it("marks as reviewed for editors, shows it in the activity and undoes it", async () => {
    const context = await setup();
    expect(
      (await context.reader.client.post(`/api/v1/articles/${context.articleId}/reviews`, {})).statusCode,
    ).toBe(403);
    const marked = await context.author.client.post(`/api/v1/articles/${context.articleId}/reviews`, {});
    expect(marked.statusCode, marked.body).toBe(201);
    const { reviewId } = marked.json() as { reviewId: string };
    const activity = await context.reader.client.get(`/api/v1/items/${context.articleId}/activity`);
    expect(activity.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "review", id: reviewId, via: "marked" })]),
    );
    const undone = await context.author.client.delete(
      `/api/v1/articles/${context.articleId}/reviews/${reviewId}`,
    );
    expect(undone.statusCode, undone.body).toBe(204);
    const again = await context.author.client.delete(
      `/api/v1/articles/${context.articleId}/reviews/${reviewId}`,
    );
    expect(again.json().code).toBe("reviewNotUndoable");
  });

  it("records a review with the publication when the author ticks it", async () => {
    const context = await setup();
    const changed = await context.author.client.put(`/api/v1/pages/${context.articleId}/content`, {
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Checked" }] }],
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const published = await context.author.client.post(`/api/v1/pages/${context.articleId}/publish`, {
      reviewed: true,
    });
    expect(published.statusCode, published.body).toBe(200);
    const review = await context.author.client.get(`/api/v1/articles/${context.articleId}/review`);
    expect(review.json()).toMatchObject({ reviewedBy: { id: context.author.id } });
  });

  it("hides source pages from people who cannot read them and keeps them out of the article", async () => {
    const context = await setup();
    counter += 1;
    const internal = await context.author.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Operations ${counter}`,
      key: `OP${counter}X`,
      visibility: "private",
      grants: [],
    });
    expect(internal.statusCode, internal.body).toBe(201);
    const source = await context.author.client.post(`/api/v1/spaces/${internal.json().id}/items`, {
      kind: "page",
      title: "VPN gateway",
      parentId: null,
    });
    const sourceId = (source.json() as { id: string }).id;
    const linked = await context.author.client.post(`/api/v1/articles/${context.articleId}/sources`, {
      sourceId,
    });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(linked.json()).toMatchObject([{ id: sourceId, title: "VPN gateway" }]);
    expect((await context.reader.client.get(`/api/v1/articles/${context.articleId}/sources`)).json()).toEqual(
      [],
    );
    const forbidden = await context.reader.client.post(`/api/v1/articles/${context.articleId}/sources`, {
      sourceId,
    });
    expect(forbidden.statusCode).toBe(403);
    const article = await context.reader.client.get(`/api/v1/articles/${context.articleId}`);
    expect(article.statusCode).toBe(200);
    expect(article.body).not.toContain(sourceId);
    expect(article.body).not.toContain("VPN gateway");
    const removed = await context.author.client.delete(
      `/api/v1/articles/${context.articleId}/sources/${sourceId}`,
    );
    expect(removed.json()).toEqual([]);
  });
});
