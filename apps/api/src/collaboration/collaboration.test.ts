import { randomUUID } from "node:crypto";
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

const SECRET = "Unpublished merger plan";

function doc(...blocks: unknown[]) {
  return { type: "doc", content: blocks };
}

function paragraph(...parts: unknown[]) {
  return {
    type: "paragraph",
    content: parts.map((part) => (typeof part === "string" ? { type: "text", text: part } : part)),
  };
}

function mention(id: string) {
  return { type: "mention", attrs: { id } };
}

function task(id: string, text: string, assignee: string) {
  return {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { id, assignee, dueDate: null }, content: [paragraph(text)] }],
  };
}

describe.skipIf(!databaseBaseUrl)("comments, tasks, blog and home pages through the API", () => {
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
    const account = await createAccount(test, `collaboration${counter}@pagehall.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function setup() {
    const editor = await person();
    const commenter = await person();
    const reader = await person();
    counter += 1;
    const space = await editor.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Collaboration ${counter}`,
      key: `C${counter}X`,
      visibility: "private",
      grants: [
        { principalKind: "account", principalId: commenter.id, role: "commenter" },
        { principalKind: "account", principalId: reader.id, role: "reader" },
      ],
    });
    expect(space.statusCode, space.body).toBe(201);
    const spaceId = space.json().id as string;
    const page = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Runbook",
      parentId: null,
      mode: "publish",
    });
    const pageId = page.json().id as string;
    await editor.client.put(`/api/v1/pages/${pageId}/content`, { document: doc(paragraph("Public text.")) });
    expect((await editor.client.post(`/api/v1/pages/${pageId}/publish`, {})).statusCode).toBe(200);
    return { editor, commenter, reader, spaceId, pageId };
  }

  it("keeps draft content away from readers on every collaboration path", async () => {
    const { editor, reader, spaceId, pageId } = await setup();
    const taskId = randomUUID();
    await editor.client.put(`/api/v1/pages/${pageId}/content`, {
      document: doc(
        paragraph("Public text."),
        paragraph(SECRET, " ", mention(reader.id)),
        task(taskId, `${SECRET} task`, reader.id),
      ),
    });
    const inline = await editor.client.post(`/api/v1/pages/${pageId}/comments`, {
      body: doc(paragraph("Is this ready?")),
      anchor: { exact: SECRET, prefix: "", suffix: " " },
    });
    expect(inline.statusCode, inline.body).toBe(201);
    await reader.client.post(`/api/v1/items/${pageId}/views`);
    const paths = [
      `/api/v1/pages/${pageId}/comments`,
      `/api/v1/pages/${pageId}/tasks`,
      "/api/v1/tasks?assignee=me",
      `/api/v1/tasks?spaceId=${spaceId}&status=all`,
      "/api/v1/notifications",
      "/api/v1/home",
      "/api/v1/mentions",
      "/api/v1/recent",
    ];
    for (const path of paths) {
      const response = await reader.client.get(path);
      expect(response.statusCode, path).toBe(200);
      expect(response.body, path).not.toContain(SECRET);
      expect(response.body, path).not.toContain(taskId);
    }
    expect((await reader.client.get(`/api/v1/comments/${inline.json().id}/replies`)).statusCode).toBe(404);
    expect((await reader.client.put(`/api/v1/tasks/${taskId}/status`, { done: true })).statusCode).toBe(404);

    expect((await editor.client.post(`/api/v1/pages/${pageId}/publish`, {})).statusCode).toBe(200);
    expect((await reader.client.get(`/api/v1/pages/${pageId}/comments`)).body).toContain(SECRET);
    expect((await reader.client.get("/api/v1/tasks?assignee=me")).body).toContain(taskId);
    const notifications = await reader.client.get("/api/v1/notifications");
    expect(
      notifications
        .json()
        .items.map((item: { type: string }) => item.type)
        .sort(),
    ).toEqual(["content.mentioned", "task.assigned"]);
    const status = await reader.client.put(`/api/v1/tasks/${taskId}/status`, { done: true });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({ id: taskId, done: true, changedBy: { id: reader.id } });
  });

  it("lets commenters discuss, authors change their comments and space admins delete any comment", async () => {
    const { editor, commenter, reader, pageId } = await setup();
    const denied = await reader.client.post(`/api/v1/pages/${pageId}/comments`, {
      body: doc(paragraph("Hi")),
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await commenter.client.post(`/api/v1/pages/${pageId}/comments`, {
      body: doc({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "x" }] }),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalidComment" });
    const created = await commenter.client.post(`/api/v1/pages/${pageId}/comments`, {
      body: doc(paragraph("On the text")),
      anchor: { exact: "Public", prefix: "", suffix: " text." },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const missing = await commenter.client.post(`/api/v1/pages/${pageId}/comments`, {
      body: doc(paragraph("Gone")),
      anchor: { exact: "Nowhere", prefix: "", suffix: "" },
    });
    expect(missing.json()).toMatchObject({ code: "anchorNotFound" });
    expect(
      (await reader.client.post(`/api/v1/comments/${id}/replies`, { body: doc(paragraph("x")) })).statusCode,
    ).toBe(403);
    expect(
      (await editor.client.post(`/api/v1/comments/${id}/replies`, { body: doc(paragraph("Yes")) }))
        .statusCode,
    ).toBe(201);
    expect(
      (await editor.client.put(`/api/v1/comments/${id}`, { body: doc(paragraph("Hijack")) })).statusCode,
    ).toBe(403);
    expect(
      (await commenter.client.put(`/api/v1/comments/${id}`, { body: doc(paragraph("Edited")) })).statusCode,
    ).toBe(204);
    expect(
      (await commenter.client.put(`/api/v1/comments/${id}/resolved`, { resolved: true })).statusCode,
    ).toBe(204);
    expect(
      (await reader.client.put(`/api/v1/comments/${id}/reactions/${encodeURIComponent("👍")}`)).statusCode,
    ).toBe(204);
    const threads = await reader.client.get(`/api/v1/pages/${pageId}/comments`);
    expect(threads.json().threads[0]).toMatchObject({
      id,
      quote: "Public",
      anchor: "inline",
      editedAt: expect.any(String),
      resolvedBy: { id: commenter.id },
      reactions: [{ emoji: "👍", count: 1 }],
      replies: [{ parentId: id }],
    });
    expect((await editor.client.delete(`/api/v1/comments/${id}`)).statusCode).toBe(204);
    expect((await editor.client.post(`/api/v1/comments/${id}/restore`)).statusCode).toBe(204);
    const access = await commenter.client.get(
      `/api/v1/pages/${pageId}/mention-access?accountIds=${reader.id},${owner ? randomUUID() : ""}`,
    );
    expect(access.json()[0]).toEqual({ accountId: reader.id, hasAccess: true });
    expect(access.json()[1]).toMatchObject({ hasAccess: false });
  });

  it("reacts to pages unless reactions are turned off for the space", async () => {
    const { editor, reader, spaceId, pageId } = await setup();
    const emoji = encodeURIComponent("🎉");
    expect((await reader.client.put(`/api/v1/pages/${pageId}/reactions/${emoji}`)).statusCode).toBe(204);
    expect((await reader.client.get(`/api/v1/pages/${pageId}/reactions`)).json()).toMatchObject({
      enabled: true,
      reactions: [{ emoji: "🎉", count: 1, reacted: true }],
    });
    expect(
      (await editor.client.put(`/api/v1/spaces/${spaceId}/settings/reactions.enabled`, { value: false }))
        .statusCode,
    ).toBe(204);
    const refused = await reader.client.put(`/api/v1/pages/${pageId}/reactions/${emoji}`);
    expect(refused.json()).toMatchObject({ code: "reactionsDisabled" });
    expect((await reader.client.get(`/api/v1/pages/${pageId}/reactions`)).json()).toEqual({
      enabled: false,
      reactions: [],
    });
  });

  async function organizationSpace(client: TestClient) {
    counter += 1;
    const space = await client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Shared ${counter}`,
      key: `S${counter}X`,
      visibility: "organization",
      grants: [],
    });
    expect(space.statusCode, space.body).toBe(201);
    return space.json().id as string;
  }

  it("writes, schedules and pins blog posts", async () => {
    const editor = await person();
    const reader = await person();
    const spaceId = await organizationSpace(editor.client);
    const created = await editor.client.post(`/api/v1/spaces/${spaceId}/blog`, {
      title: "New VPN client",
      excerpt: "From Monday",
    });
    expect(created.statusCode, created.body).toBe(201);
    const postId = created.json().id as string;
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/blog`)).json().items).toEqual([]);
    const past = await editor.client.put(`/api/v1/blog-posts/${postId}/schedule`, {
      at: "2020-01-01T00:00:00Z",
      timeZone: "Europe/Vienna",
    });
    expect(past.json()).toMatchObject({ code: "scheduleInPast" });
    const scheduled = await editor.client.put(`/api/v1/blog-posts/${postId}/schedule`, {
      at: new Date(Date.now() + 3_600_000).toISOString(),
      timeZone: "Europe/Vienna",
    });
    expect(scheduled.json()).toMatchObject({ scheduledTimeZone: "Europe/Vienna", published: false });
    expect(
      (await editor.client.delete(`/api/v1/blog-posts/${postId}/schedule`)).json().scheduledAt,
    ).toBeNull();
    expect(
      (await editor.client.post(`/api/v1/organizations/${organizationId}/blog/pinned/${postId}`)).statusCode,
    ).toBe(404);
    expect((await editor.client.post(`/api/v1/pages/${postId}/publish`, {})).statusCode).toBe(200);
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/blog`)).json().items[0]).toMatchObject({
      id: postId,
      published: true,
    });
    expect((await editor.client.get(`/api/v1/spaces/${spaceId}/items`)).body).not.toContain(postId);
    const refused = await editor.client.put(`/api/v1/organizations/${organizationId}/blog/pinned/${postId}`, {
      pinned: true,
    });
    expect(refused.statusCode).toBe(403);
    const pinned = await owner.put(`/api/v1/organizations/${organizationId}/blog/pinned/${postId}`, {
      pinned: true,
    });
    expect(pinned.json()).toMatchObject({ pinnedInOrganization: true });
    expect(
      (await reader.client.put(`/api/v1/blog-posts/${postId}/pinned`, { pinned: true })).statusCode,
    ).toBe(403);
    expect(
      (await editor.client.put(`/api/v1/blog-posts/${postId}/pinned`, { pinned: true })).json(),
    ).toMatchObject({
      pinnedInSpace: true,
    });
    const overview = await reader.client.get(
      `/api/v1/organizations/${organizationId}/blog?spaceId=${spaceId}`,
    );
    expect(overview.json().items.map((post: { id: string }) => post.id)).toEqual([postId]);
  });

  it("stars, records views and sets the organization home page", async () => {
    const { editor, reader, spaceId, pageId } = await setup();
    expect((await reader.client.put(`/api/v1/starred/items/${pageId}`)).statusCode).toBe(204);
    expect((await reader.client.put(`/api/v1/starred/spaces/${spaceId}`)).statusCode).toBe(204);
    expect((await reader.client.post(`/api/v1/items/${pageId}/views`)).statusCode).toBe(204);
    expect((await reader.client.get("/api/v1/home")).json()).toMatchObject({
      recent: [{ id: pageId }],
      starred: { items: [{ id: pageId }], spaces: [{ id: spaceId }] },
    });
    expect((await reader.client.delete(`/api/v1/starred/items/${pageId}`)).statusCode).toBe(204);
    expect(
      (await editor.client.put(`/api/v1/organizations/${organizationId}/home-page`, { itemId: pageId }))
        .statusCode,
    ).toBe(403);
    const generic = await owner.put(
      `/api/v1/organizations/${organizationId}/settings/home.organizationPage`,
      {
        value: pageId,
      },
    );
    expect(generic.json()).toMatchObject({ code: "settingManagedElsewhere" });
    const hidden = await owner.put(`/api/v1/organizations/${organizationId}/home-page`, { itemId: pageId });
    expect(hidden.json()).toMatchObject({ code: "invalidHomePage" });
    const shared = await organizationSpace(owner);
    const welcome = await owner.post(`/api/v1/spaces/${shared}/items`, {
      kind: "page",
      title: "Welcome",
      parentId: null,
      mode: "live",
    });
    const welcomeId = welcome.json().id as string;
    const set = await owner.put(`/api/v1/organizations/${organizationId}/home-page`, { itemId: welcomeId });
    expect(set.json()).toMatchObject({ page: { id: welcomeId, title: "Welcome" } });
    expect(
      (await reader.client.get(`/api/v1/organizations/${organizationId}/home-page`)).json(),
    ).toMatchObject({
      page: { id: welcomeId },
    });
  });
});
