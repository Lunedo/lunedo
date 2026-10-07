import { get, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, createServerRuntime } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiContextOf } from "../context.js";
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
import { createTestApp } from "../testing/create-test-app.js";

const SESSION_COOKIE = "__Host-pagehall-session";
const DRAFT_TEXT = "Unpublished draft sentence";
const DRAFT_TITLE = "Unpublished draft title";

function documentWith(...blocks: unknown[]) {
  return { type: "doc", content: blocks };
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe.skipIf(!databaseBaseUrl)("publish mode through the API", () => {
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
    const account = await createAccount(test, `versions${counter}@pagehall.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function setup() {
    const editor = await person();
    const reader = await person();
    counter += 1;
    const space = await editor.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Versions ${counter}`,
      key: `V${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(space.statusCode, space.body).toBe(201);
    const spaceId = space.json().id as string;
    const target = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Target",
      parentId: null,
      mode: "live",
    });
    const page = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Published title",
      parentId: null,
      mode: "publish",
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageId = page.json().id as string;
    await editor.client.put(`/api/v1/pages/${pageId}/content`, {
      document: documentWith(paragraph("Published text")),
    });
    expect((await editor.client.post(`/api/v1/pages/${pageId}/publish`, { note: "First" })).json()).toEqual({
      version: 1,
      created: true,
    });
    await editor.client.put(`/api/v1/pages/${pageId}/content`, {
      document: documentWith(paragraph(DRAFT_TEXT), {
        type: "paragraph",
        content: [{ type: "pageLink", attrs: { pageId: target.json().id, spaceId: null, title: null } }],
      }),
    });
    expect((await editor.client.patch(`/api/v1/items/${pageId}`, { title: DRAFT_TITLE })).statusCode).toBe(
      200,
    );
    return { editor, reader, spaceId, pageId, targetId: target.json().id as string };
  }

  it("keeps the draft away from readers on every read path", async () => {
    const { editor, reader, spaceId, pageId, targetId } = await setup();
    const paths = [
      `/api/v1/pages/${pageId}/content`,
      `/api/v1/pages/${pageId}/markdown`,
      `/api/v1/items/${pageId}`,
      `/api/v1/spaces/${spaceId}/items`,
      `/api/v1/items?q=Unpublished&spaceId=${spaceId}`,
      `/api/v1/items?q=Published&spaceId=${spaceId}`,
      `/api/v1/pages/${targetId}/backlinks`,
      `/api/v1/pages/${pageId}/versions`,
      `/api/v1/pages/${pageId}/versions/1`,
      `/api/v1/pages/${pageId}/compare?from=1&to=1`,
    ];
    for (const path of paths) {
      const response = await reader.client.get(path);
      expect(response.statusCode, path).toBe(200);
      expect(response.body, path).not.toContain(DRAFT_TEXT);
      expect(response.body, path).not.toContain(DRAFT_TITLE);
    }
    expect((await reader.client.get(`/api/v1/pages/${pageId}/content`)).json()).toMatchObject({
      title: "Published title",
      version: 1,
    });
    expect((await reader.client.get(`/api/v1/pages/${targetId}/backlinks`)).json()).toEqual([]);
    for (const path of [
      `/api/v1/pages/${pageId}/draft`,
      `/api/v1/pages/${pageId}/compare?from=1&to=draft`,
      `/api/v1/pages/${pageId}/compare?from=draft&to=1`,
      `/api/v1/pages/${pageId}/discarded-drafts`,
    ]) {
      const response = await reader.client.get(path);
      expect(response.statusCode, path).toBe(403);
      expect(response.body, path).not.toContain(DRAFT_TEXT);
    }
    const draft = await editor.client.get(`/api/v1/pages/${pageId}/draft`);
    expect(draft.json()).toMatchObject({ title: DRAFT_TITLE, hasChanges: true, basedOn: 1 });
    expect(draft.body).toContain(DRAFT_TEXT);
    const compare = await editor.client.get(`/api/v1/pages/${pageId}/compare?from=1&to=draft`);
    expect(compare.json().diff.title).toEqual({ before: "Published title", after: DRAFT_TITLE });
  });

  it("keeps a new unpublished page away from readers", async () => {
    const { editor, reader, spaceId } = await setup();
    const created = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Never published",
      parentId: null,
      mode: "publish",
    });
    const id = created.json().id as string;
    await editor.client.post(`/api/v1/pages/${id}/labels`, { label: "hidden-label" });
    expect((await reader.client.get(`/api/v1/items/${id}`)).statusCode).toBe(404);
    expect((await reader.client.get(`/api/v1/pages/${id}/content`)).statusCode).toBe(404);
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/items`)).body).not.toContain(
      "Never published",
    );
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/labels/hidden-label/pages`)).json()).toEqual(
      [],
    );
    expect((await editor.client.get(`/api/v1/spaces/${spaceId}/labels/hidden-label/pages`)).body).toContain(
      "Never published",
    );
  });

  it("sends draft changes only to editors on the live update channel", async () => {
    const { editor, reader, spaceId, pageId } = await setup();
    const runtime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    try {
      second = await createTestApp(apiContextOf(runtime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, spaces: [] as { kind: string; itemId: string | null }[] };
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
          get(
            `http://127.0.0.1:${port}/api/v1/notifications/stream`,
            { headers: { cookie: `${SESSION_COOKIE}=${client.cookies.get(SESSION_COOKIE)}` } },
            resolve,
          ).on("error", reject);
        });
        responses.push(response);
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (chunk.includes("event: notifications")) received.connected = true;
          for (const match of chunk.matchAll(/event: spaces\ndata: (\{.*\})\n\n/g)) {
            received.spaces.push(JSON.parse(match[1] ?? "{}"));
          }
        });
        await expect.poll(() => received.connected, { timeout: 5000 }).toBe(true);
        return received;
      };
      const editorEvents = await follow(editor.client);
      const readerEvents = await follow(reader.client);
      await editor.client.put(`/api/v1/pages/${pageId}/content`, {
        document: documentWith(paragraph("More draft")),
      });
      await expect
        .poll(() => editorEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "draft", itemId: pageId });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(readerEvents.spaces.filter((event) => event.kind === "draft" || event.kind === "page")).toEqual(
        [],
      );
      await editor.client.post(`/api/v1/pages/${pageId}/publish`, {});
      await expect
        .poll(() => readerEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "page", itemId: pageId });
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await runtime.close();
    }
  });

  it("restores, discards and switches modes through the API", async () => {
    const { editor, reader, pageId } = await setup();
    const discarded = await editor.client.post(`/api/v1/pages/${pageId}/draft/discard`, {});
    expect(discarded.statusCode, discarded.body).toBe(200);
    const draftId = discarded.json().discardedDraftId as string;
    expect((await editor.client.get(`/api/v1/pages/${pageId}/draft`)).json()).toMatchObject({
      hasChanges: false,
    });
    expect(
      (await editor.client.post(`/api/v1/pages/${pageId}/discarded-drafts/${draftId}/restore`, {}))
        .statusCode,
    ).toBe(204);
    expect((await editor.client.get(`/api/v1/pages/${pageId}/draft`)).body).toContain(DRAFT_TEXT);
    const live = await editor.client.put(`/api/v1/pages/${pageId}/mode`, { mode: "live" });
    expect(live.json()).toMatchObject({ code: "draftPending" });
    expect((await reader.client.put(`/api/v1/pages/${pageId}/mode`, { mode: "live" })).statusCode).toBe(403);
    expect((await reader.client.post(`/api/v1/pages/${pageId}/versions/1/restore`, {})).statusCode).toBe(403);
    expect((await reader.client.post(`/api/v1/pages/${pageId}/publish`, {})).statusCode).toBe(403);
    expect(
      (await editor.client.put(`/api/v1/pages/${pageId}/mode`, { mode: "live", confirmDraft: true }))
        .statusCode,
    ).toBe(204);
    expect((await reader.client.get(`/api/v1/pages/${pageId}/content`)).body).toContain(DRAFT_TEXT);
    const restored = await editor.client.post(`/api/v1/pages/${pageId}/versions/1/restore`, {});
    expect(restored.json()).toEqual({ mode: "live", version: 3 });
    expect((await reader.client.get(`/api/v1/pages/${pageId}/content`)).body).not.toContain(DRAFT_TEXT);
  });

  it("deletes, restores and archives through the API with read-only archived pages", async () => {
    const { editor, reader, spaceId, targetId } = await setup();
    expect((await reader.client.delete(`/api/v1/items/${targetId}`)).statusCode).toBe(403);
    const deleted = await editor.client.delete(`/api/v1/items/${targetId}`);
    expect(deleted.json()).toMatchObject({ title: "Target", stage: 1 });
    expect((await reader.client.get(`/api/v1/items/${targetId}`)).statusCode).toBe(404);
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/trash`)).statusCode).toBe(403);
    const trash = await editor.client.get(`/api/v1/spaces/${spaceId}/trash`);
    expect(trash.json()).toHaveLength(1);
    const entryId = deleted.json().id as string;
    expect(
      (await editor.client.post(`/api/v1/spaces/${spaceId}/trash/${entryId}/restore`, {})).json(),
    ).toEqual({
      itemId: targetId,
      parentId: null,
    });
    expect((await editor.client.post(`/api/v1/items/${targetId}/archive`, {})).statusCode).toBe(204);
    const write = await editor.client.put(`/api/v1/pages/${targetId}/content`, {
      document: documentWith(paragraph("Not allowed")),
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ denials: ["archived"] });
    expect((await editor.client.patch(`/api/v1/items/${targetId}`, { title: "Renamed" })).statusCode).toBe(
      403,
    );
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/archive`)).json()).toHaveLength(1);
    expect((await editor.client.post(`/api/v1/items/${targetId}/unarchive`, {})).json()).toEqual({
      parentId: null,
    });
  });

  it("offers the template gallery to editors and creates pages from templates", async () => {
    const { editor, reader, spaceId } = await setup();
    expect((await reader.client.get(`/api/v1/spaces/${spaceId}/template-gallery`)).statusCode).toBe(403);
    const gallery = await editor.client.get(`/api/v1/spaces/${spaceId}/template-gallery`);
    expect(gallery.json().length).toBeGreaterThanOrEqual(10);
    const created = await editor.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "",
      parentId: null,
      template: {
        id: "builtin:project-plan",
        values: { name: "Atlas", owner: editor.id, startDate: "2026-11-02" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().title).toBe("Project Atlas");
  });
});
