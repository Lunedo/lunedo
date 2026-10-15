import { randomUUID } from "node:crypto";
import { get, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  createServerRuntime,
  type NotifyInput,
  type ServerRuntime,
  SPACE_CHANGES_CHANNEL,
  signalRun,
} from "@pagehall/server";
import { countQueries } from "@pagehall/server/testing";
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
import { COALESCE_MS } from "./space-signals.js";

const SESSION_COOKIE = "__Host-pagehall-session";

describe.skipIf(!databaseBaseUrl)("notifications through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  function notice(recipients: string[], runtime: ServerRuntime = test.runtime, targetId = randomUUID()) {
    const input: NotifyInput = {
      type: "breakGlass.started",
      recipients,
      organizationId,
      targetId,
      params: {
        organizationName: "Test organization",
        requesterName: "Ada",
        reason: "Investigating an outage",
        minutes: 60,
      },
    };
    return runtime.database.transaction((tx) => runtime.services.notifications.notify(tx, input));
  }

  it("refuses anonymous requests and API tokens", async () => {
    const anonymous = new TestClient(test.app);
    for (const url of [
      "/api/v1/notifications",
      "/api/v1/notifications/unread-count",
      "/api/v1/notifications/stream",
    ]) {
      expect((await anonymous.get(url)).statusCode, url).toBe(401);
    }
    expect((await anonymous.post("/api/v1/notifications/read-all", {})).statusCode).toBe(401);
    const token = (
      await owner.post("/api/v1/account/tokens", {
        name: "Reader",
        scopes: { organization: { auditLog: "view" } },
      })
    ).json().token;
    const withToken = await anonymous.get("/api/v1/notifications", { authorization: `Bearer ${token}` });
    expect(withToken.json()).toMatchObject({ code: "sessionRequired" });
  });

  it("lists, counts and marks the caller's own notifications", async () => {
    await notice([ownerId]);
    await notice([ownerId]);
    const list = (await owner.get("/api/v1/notifications")).json();
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({
      type: "breakGlass.started",
      organizationId,
      target: { type: "breakGlassAccess" },
      actor: null,
      params: { requesterName: "Ada" },
      count: 1,
      readAt: null,
    });
    expect((await owner.get("/api/v1/notifications/unread-count")).json()).toEqual({ count: 2 });

    expect((await owner.post(`/api/v1/notifications/${list.items[0].id}/read`)).statusCode).toBe(204);
    expect((await owner.get("/api/v1/notifications/unread-count")).json()).toEqual({ count: 1 });
    expect((await owner.get("/api/v1/notifications?unread=true")).json().items).toHaveLength(1);

    const before = new Date(Date.now() - 60_000).toISOString();
    expect((await owner.post("/api/v1/notifications/read-all", { before })).json()).toEqual({ marked: 0 });
    expect((await owner.post("/api/v1/notifications/read-all", {})).json()).toEqual({ marked: 1 });
    expect((await owner.get("/api/v1/notifications/unread-count")).json()).toEqual({ count: 0 });
  });

  it("never shows one account the notifications of another", async () => {
    const other = await createAccount(test, "other.reader@example.org");
    const client = await signedInClient(test, other.email, other.password);
    await notice([ownerId]);
    expect((await client.get("/api/v1/notifications")).json().items).toEqual([]);
    const ownerItems = (await owner.get("/api/v1/notifications")).json().items;
    const response = await client.post(`/api/v1/notifications/${ownerItems[0].id}/read`);
    expect(response.statusCode).toBe(404);
    expect((await owner.get("/api/v1/notifications/unread-count")).json()).toEqual({ count: 1 });
  });

  it("lets accounts choose channels per event type in their preferences", async () => {
    const key = "notifications.breakGlassStarted.inApp";
    const listed = (await owner.get("/api/v1/account/preferences")).json();
    expect(listed.find((entry: { key: string }) => entry.key === key)).toMatchObject({
      value: true,
      source: "default",
    });
    expect(
      listed.find((entry: { key: string }) => entry.key === "notifications.breakGlassStarted.email"),
    ).toMatchObject({ value: "immediately", source: "default" });
    expect((await owner.put(`/api/v1/account/preferences/${key}`, { value: false })).statusCode).toBe(204);
    const before = (await owner.get("/api/v1/notifications/unread-count")).json().count;
    await notice([ownerId]);
    expect((await owner.get("/api/v1/notifications/unread-count")).json().count).toBe(before);
    expect((await owner.put(`/api/v1/account/preferences/${key}`, { value: "yes" })).statusCode).toBe(400);
    expect((await owner.put(`/api/v1/account/preferences/${key}`, { clear: true })).statusCode).toBe(204);
  });

  it("pages with an opaque cursor and rejects a forged one", async () => {
    for (let index = 0; index < 3; index += 1) await notice([ownerId]);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; nextCursor: string | null } = (
        await owner.get(`/api/v1/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
      ).json();
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const forged = Buffer.from(
      JSON.stringify(["now()); drop table notifications; --", randomUUID()]),
    ).toString("base64url");
    expect((await owner.get(`/api/v1/notifications?cursor=${forged}`)).statusCode).toBe(400);
  });

  it("streams the unread count to a client of another node", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    let response: IncomingMessage | undefined;
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const session = owner.cookies.get(SESSION_COOKIE);
      const events: number[] = [];
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(
          `http://127.0.0.1:${port}/api/v1/notifications/stream`,
          { headers: { cookie: `${SESSION_COOKIE}=${session}` } },
          resolve,
        ).on("error", reject);
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        for (const match of chunk.matchAll(/event: notifications\ndata: (\{.*\})\n\n/g)) {
          events.push(JSON.parse(match[1] ?? "{}").unreadCount);
        }
      });
      await expect.poll(() => events.length, { timeout: 5000 }).toBe(1);
      const initial = events[0] ?? 0;

      await notice([ownerId]);
      await expect.poll(() => events.at(-1), { timeout: 5000 }).toBe(initial + 1);
      await owner.post("/api/v1/notifications/read-all", {});
      await expect.poll(() => events.at(-1), { timeout: 5000 }).toBe(0);
    } finally {
      response?.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  it("tells clients of another node that may view sign-in providers about changed sync runs", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    const other = await createAccount(test, "sync-runs-other@pagehall.test");
    const otherClient = await signedInClient(test, other.email, other.password);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, runs: [] as unknown[] };
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
          for (const match of chunk.matchAll(/event: syncRuns\ndata: (\{.*\})\n\n/g)) {
            received.runs.push(JSON.parse(match[1] ?? "{}"));
          }
        });
        await expect.poll(() => received.connected, { timeout: 5000 }).toBe(true);
        return received;
      };
      const administrator = await follow(owner);
      const member = await follow(otherClient);
      const signal = { providerId: randomUUID(), runId: randomUUID() };
      await signalRun(test.runtime.database, signal.providerId, signal.runId);
      await expect.poll(() => administrator.runs, { timeout: 5000 }).toEqual([signal]);
      await signalRun(test.runtime.database, signal.providerId, signal.runId);
      await expect.poll(() => administrator.runs.length, { timeout: 5000 }).toBe(2);
      expect(member.runs).toEqual([]);
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  it("tells clients of another node about changed objects only where they may look", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    const member = await createAccount(test, "changes-member@pagehall.test");
    const memberClient = await signedInClient(test, member.email, member.password);
    const elsewhere = await owner.post("/api/v1/organizations", { name: "Changes elsewhere" });
    expect(elsewhere.statusCode).toBe(201);
    const outsider = await createAccount(
      test,
      "changes-outsider@pagehall.test",
      "a long enough passphrase",
      elsewhere.json().id,
    );
    const outsiderClient = await signedInClient(test, outsider.email, outsider.password);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, changes: [] as unknown[] };
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
          for (const match of chunk.matchAll(/event: changes\ndata: (\{.*\})\n\n/g)) {
            received.changes.push(JSON.parse(match[1] ?? "{}"));
          }
        });
        await expect.poll(() => received.connected, { timeout: 5000 }).toBe(true);
        return received;
      };
      const administrator = await follow(owner);
      const colleague = await follow(memberClient);
      const stranger = await follow(outsiderClient);

      const created = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
        name: `Live ${randomUUID().slice(0, 8)}`,
      });
      expect(created.statusCode).toBe(201);
      const groupChange = { scope: "organization", organizationId, target: "group" };
      await expect.poll(() => administrator.changes, { timeout: 5000 }).toContainEqual(groupChange);
      await expect.poll(() => colleague.changes, { timeout: 5000 }).toContainEqual(groupChange);

      const placeholder = await owner.post("/api/v1/instance/accounts/placeholders", {
        name: "Live Placeholder",
        email: `live-${randomUUID().slice(0, 8)}@import.test`,
      });
      expect(placeholder.statusCode).toBe(201);
      const accountChange = { scope: "instance", organizationId: null, target: "account" };
      await expect.poll(() => administrator.changes, { timeout: 5000 }).toContainEqual(accountChange);
      await test.runtime.audit.recordAlone({
        name: "apiToken.revoked",
        targetId: randomUUID(),
        scope: { type: "organization", id: organizationId },
        fields: { accountId: ownerId, reason: "revoked" },
      });
      const tokenChange = { scope: "organization", organizationId, target: "apiToken" };
      await expect.poll(() => administrator.changes, { timeout: 5000 }).toContainEqual(tokenChange);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(colleague.changes).not.toContainEqual(accountChange);
      expect(colleague.changes).not.toContainEqual(tokenChange);
      expect(stranger.changes).toEqual([]);

      const role = await owner.post("/api/v1/instance/roles", {
        name: "Account readers",
        areas: { accounts: "view" },
      });
      expect(role.statusCode).toBe(201);
      const given = await owner.post("/api/v1/instance/role-assignments", {
        role: { customRoleId: role.json().id },
        principal: { kind: "account", id: member.id },
      });
      expect(given.statusCode).toBe(201);
      const assignment = {
        scope: "organization",
        organizationId: elsewhere.json().id,
        target: "roleAssignment",
      };
      await test.runtime.audit.recordAlone({
        name: "role.unassigned",
        targetId: randomUUID(),
        scope: { type: "organization", id: elsewhere.json().id },
        fields: { role: "administrator", principalKind: "account", principalId: ownerId, reason: "removed" },
      });
      await expect.poll(() => administrator.changes, { timeout: 5000 }).toContainEqual(assignment);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(colleague.changes).not.toContainEqual(assignment);
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  it("tells clients of another node about changes in spaces only when they can read them", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    const reader = await createAccount(test, "space-reader@pagehall.test");
    const readerClient = await signedInClient(test, reader.email, reader.password);
    const other = await createAccount(test, "space-other@pagehall.test");
    const otherClient = await signedInClient(test, other.email, other.password);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, spaces: [] as { spaceId: string; kind: string }[] };
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
      const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: "Live space",
        key: "LIVE",
        visibility: "private",
        grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
      });
      expect(space.statusCode, space.body).toBe(201);
      const spaceId = space.json().id as string;
      const readerEvents = await follow(readerClient);
      const otherEvents = await follow(otherClient);
      const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "New",
        parentId: null,
        mode: "live",
      });
      expect(created.statusCode).toBe(201);
      await expect
        .poll(() => readerEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "tree", itemId: created.json().id });
      const unpublished = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Not yet published",
        parentId: null,
        mode: "publish",
      });
      expect(unpublished.statusCode).toBe(201);
      await expect
        .poll(() => readerEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "tree", itemId: null });
      const archived = await owner.post(`/api/v1/items/${unpublished.json().id}/archive`, {});
      expect(archived.statusCode, archived.body).toBeLessThan(300);
      await expect
        .poll(() => readerEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "access", itemId: null });
      expect(JSON.stringify(readerEvents.spaces)).not.toContain(unpublished.json().id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(otherEvents.spaces).toEqual([]);

      const team = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
        name: "Live readers",
      });
      const teamId = team.json().id as string;
      await owner.post(`/api/v1/groups/${teamId}/members`, { accountId: other.id });
      await owner.post(`/api/v1/spaces/${spaceId}/permissions`, {
        action: "grant",
        principalKind: "group",
        principalId: teamId,
        role: "reader",
      });
      const secondPage = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Two",
        parentId: null,
        mode: "live",
      });
      await expect
        .poll(() => otherEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "tree", itemId: secondPage.json().id });
      expect((await owner.delete(`/api/v1/groups/${teamId}/members/${other.id}`)).statusCode).toBe(204);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const third = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Three",
        parentId: null,
        mode: "live",
      });
      await expect
        .poll(() => readerEvents.spaces, { timeout: 5000 })
        .toContainEqual({ spaceId, kind: "tree", itemId: third.json().id });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(otherEvents.spaces).not.toContainEqual({ spaceId, kind: "tree", itemId: third.json().id });
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  it("keeps restricted pages out of the live updates of people without access, also of space editors", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    const editor = await createAccount(test, "live-editor@pagehall.test");
    const editorClient = await signedInClient(test, editor.email, editor.password);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const received = {
        connected: false,
        spaces: [] as { spaceId: string; kind: string; itemId: string | null }[],
      };
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(
          `http://127.0.0.1:${port}/api/v1/notifications/stream`,
          { headers: { cookie: `${SESSION_COOKIE}=${editorClient.cookies.get(SESSION_COOKIE)}` } },
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
      const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: "Restricted live space",
        key: "RLIVE",
        visibility: "private",
        grants: [{ principalKind: "account", principalId: editor.id, role: "editor" }],
      });
      const spaceId = space.json().id as string;
      const secret = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Secret",
        parentId: null,
        mode: "live",
      });
      const secretId = secret.json().id as string;
      await expect
        .poll(() => received.spaces.some((event) => event.itemId === secretId), { timeout: 5000 })
        .toBe(true);
      received.spaces.length = 0;
      await owner.post(`/api/v1/pages/${secretId}/access`, {
        changes: [{ action: "restrict", kind: "view" }],
      });
      await owner.patch(`/api/v1/items/${secretId}`, { title: "Secret renamed" });
      await owner.put(`/api/v1/pages/${secretId}/content`, {
        document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
      });
      await expect
        .poll(
          () => received.spaces.filter((event) => event.kind === "tree" && event.itemId === null).length,
          {
            timeout: 5000,
          },
        )
        .toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(JSON.stringify(received.spaces)).not.toContain(secretId);
    } finally {
      for (const entry of responses) entry.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  describe("space signals on a node with many streams", () => {
    type SpaceEvent = { spaceId: string; kind: string; itemId: string | null };
    let secondRuntime: ServerRuntime;
    let second: NestFastifyApplication;
    let port: number;
    const responses: IncomingMessage[] = [];

    beforeAll(async () => {
      secondRuntime = await createServerRuntime({ role: "api", env: test.env });
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      port = (second.getHttpServer().address() as AddressInfo).port;
    });

    afterAll(async () => {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime?.close();
    });

    async function follow(client: TestClient) {
      const received = { connected: false, spaces: [] as SpaceEvent[] };
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
    }

    async function person(name: string) {
      const created = await createAccount(test, `${name}-${randomUUID().slice(0, 8)}@pagehall.test`);
      return { id: created.id, client: await signedInClient(test, created.email, created.password) };
    }

    async function liveSpace(name: string, readers: string[]) {
      const key = `L${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
      const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: `${name} ${key}`,
        key,
        visibility: "private",
        grants: readers.map((id) => ({ principalKind: "account", principalId: id, role: "reader" })),
      });
      expect(created.statusCode, created.body).toBe(201);
      const spaceId = created.json().id as string;
      const page = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Live page",
        parentId: null,
        mode: "live",
      });
      return { spaceId, pageId: page.json().id as string };
    }

    function signal(event: SpaceEvent) {
      return test.runtime.pool.query("select pg_notify($1, $2)", [
        SPACE_CHANGES_CHANNEL,
        JSON.stringify(event),
      ]);
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

    async function queriesFor(event: SpaceEvent, viewer: { spaces: SpaceEvent[] }) {
      await settle();
      const queries = countQueries(secondRuntime.pool);
      try {
        await signal(event);
        await expect.poll(() => viewer.spaces, { timeout: 5000 }).toContainEqual(event);
        await settle();
        return queries.count;
      } finally {
        queries.stop();
      }
    }

    it("costs as many queries per signal with many streams that cannot see the space as with one", async () => {
      const viewer = await person("live-viewer");
      const first = await liveSpace("First", [viewer.id]);
      const later = await liveSpace("Later", [viewer.id]);
      const viewerEvents = await follow(viewer.client);
      const blind = [await follow((await person("live-blind")).client)];
      const one = await queriesFor(
        { spaceId: first.spaceId, kind: "page", itemId: first.pageId },
        viewerEvents,
      );
      for (let index = 0; index < 6; index += 1)
        blind.push(await follow((await person("live-blind")).client));
      const many = await queriesFor(
        { spaceId: later.spaceId, kind: "page", itemId: later.pageId },
        viewerEvents,
      );
      expect(many).toBe(one);
      for (const events of blind) expect(events.spaces).toEqual([]);
    });

    it("stops sending the signals of a space to a stream whose access was taken away", async () => {
      const viewer = await person("live-revoked");
      const { spaceId, pageId } = await liveSpace("Revoked", [viewer.id]);
      const viewerEvents = await follow(viewer.client);
      const ownerEvents = await follow(owner);
      const before = { spaceId, kind: "page", itemId: pageId };
      await signal(before);
      await expect.poll(() => viewerEvents.spaces, { timeout: 5000 }).toContainEqual(before);
      const permissions = (await owner.get(`/api/v1/spaces/${spaceId}/permissions`)).json() as {
        id: string;
        principalId: string | null;
      }[];
      const permission = permissions.find((entry) => entry.principalId === viewer.id);
      const removed = await owner.post(`/api/v1/spaces/${spaceId}/permissions`, {
        action: "remove",
        permissionId: permission?.id,
      });
      expect(removed.statusCode, removed.body).toBeLessThan(300);
      const after = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "After",
        parentId: null,
        mode: "live",
      });
      const changed = { spaceId, kind: "page", itemId: after.json().id as string };
      await signal(changed);
      await expect.poll(() => ownerEvents.spaces, { timeout: 5000 }).toContainEqual(changed);
      await settle();
      expect(viewerEvents.spaces.filter((event) => event.spaceId === spaceId)).toEqual([before]);
    });

    it("sends one page signal per item at the start and one at the end of a burst", async () => {
      const viewer = await person("live-burst");
      const { spaceId, pageId } = await liveSpace("Burst", [viewer.id]);
      const viewerEvents = await follow(viewer.client);
      const stored = { spaceId, kind: "page", itemId: pageId };
      for (let index = 0; index < 5; index += 1) {
        await signal(stored);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await expect.poll(() => viewerEvents.spaces, { timeout: 5000 }).toContainEqual(stored);
      await new Promise((resolve) => setTimeout(resolve, COALESCE_MS + 1000));
      expect(viewerEvents.spaces.filter((event) => event.itemId === pageId)).toEqual([stored, stored]);
    });
  });

  it("tells a client of another node about settings whose value for it changed", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    let response: IncomingMessage | undefined;
    const other = await createAccount(test, "settings-other@pagehall.test");
    const otherClient = await signedInClient(test, other.email, other.password);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const session = owner.cookies.get(SESSION_COOKIE);
      const settings: { key: string; level: string; organizationId: string | null }[] = [];
      const organizationValue = `/api/v1/organizations/${organizationId}/settings/locale.firstDayOfWeek`;
      expect((await owner.put(organizationValue, { clear: true })).statusCode).toBe(204);
      let connected = false;
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(
          `http://127.0.0.1:${port}/api/v1/notifications/stream`,
          { headers: { cookie: `${SESSION_COOKIE}=${session}` } },
          resolve,
        ).on("error", reject);
      });
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        if (chunk.includes("event: notifications")) connected = true;
        for (const match of chunk.matchAll(/event: settings\ndata: (\{.*\})\n\n/g)) {
          settings.push(JSON.parse(match[1] ?? "{}"));
        }
      });
      await expect.poll(() => connected, { timeout: 5000 }).toBe(true);

      const instanceUrl = "/api/v1/instance/settings/locale.firstDayOfWeek";
      expect((await owner.put(instanceUrl, { value: "sunday" })).statusCode).toBe(204);
      await expect
        .poll(() => settings, { timeout: 5000 })
        .toEqual([{ key: "locale.firstDayOfWeek", level: "instance", organizationId: null }]);

      const ownPreference = "/api/v1/account/preferences/locale.firstDayOfWeek";
      expect((await otherClient.put(ownPreference, { value: "monday" })).statusCode).toBe(204);
      expect((await owner.put(ownPreference, { value: "saturday" })).statusCode).toBe(204);
      await expect.poll(() => settings.length, { timeout: 5000 }).toBe(2);
      expect(settings[1]).toEqual({ key: "locale.firstDayOfWeek", level: "user", organizationId: null });

      expect((await owner.put(instanceUrl, { value: "monday" })).statusCode).toBe(204);
      expect(
        (
          await owner.put(`/api/v1/organizations/${organizationId}/settings/branding.accentColor`, {
            value: "violet",
          })
        ).statusCode,
      ).toBe(204);
      await expect.poll(() => settings.length, { timeout: 5000 }).toBe(3);
      expect(settings[2]).toEqual({ key: "branding.accentColor", level: "organization", organizationId });

      const language = "/api/v1/instance/settings/locale.language";
      expect(
        (await owner.put("/api/v1/account/preferences/locale.language", { value: "en" })).statusCode,
      ).toBe(204);
      await expect.poll(() => settings.length, { timeout: 5000 }).toBe(4);
      expect((await owner.put(language, { value: "de" })).statusCode).toBe(204);
      expect((await owner.put(language, { locked: true })).statusCode).toBe(204);
      await expect.poll(() => settings.length, { timeout: 5000 }).toBe(5);
      expect((await owner.put(language, { value: "en" })).statusCode).toBe(204);
      await expect.poll(() => settings.length, { timeout: 5000 }).toBe(6);
      expect(settings.slice(3)).toEqual([
        { key: "locale.language", level: "user", organizationId: null },
        { key: "locale.language", level: "instance", organizationId: null },
        { key: "locale.language", level: "instance", organizationId: null },
      ]);
    } finally {
      await owner.put("/api/v1/instance/settings/locale.language", { locked: false });
      await owner.put("/api/v1/instance/settings/locale.language", { clear: true });
      await owner.put("/api/v1/account/preferences/locale.language", { clear: true });
      await owner.put("/api/v1/account/preferences/locale.firstDayOfWeek", { clear: true });
      await owner.put("/api/v1/instance/settings/locale.firstDayOfWeek", { clear: true });
      response?.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });
});
