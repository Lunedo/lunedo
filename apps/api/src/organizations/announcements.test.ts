import { randomUUID } from "node:crypto";
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
const DAY = 86_400_000;

describe.skipIf(!databaseBaseUrl)("announcements, blog subscriptions and shortcuts through the API", () => {
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

  async function person(homeOrganizationId?: string) {
    counter += 1;
    const email = `announce${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password, homeOrganizationId)).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  function banner(text: string, severity = "information") {
    return { severity, text, link: null, startsAt: null, endsAt: new Date(Date.now() + DAY).toISOString() };
  }

  it("lets only administrators set banners and shows them to the right people", async () => {
    const member = await person();
    const elsewhere = await owner.post("/api/v1/organizations", {
      name: `Elsewhere ${randomUUID().slice(0, 6)}`,
    });
    expect(elsewhere.statusCode).toBe(201);
    const outsider = await person(elsewhere.json().id);

    expect(
      (await member.client.put(`/api/v1/organizations/${organizationId}/announcement`, banner("Hi")))
        .statusCode,
    ).toBe(403);
    expect((await member.client.get(`/api/v1/organizations/${organizationId}/announcement`)).statusCode).toBe(
      403,
    );
    expect((await member.client.put("/api/v1/instance/announcement", banner("Hi"))).statusCode).toBe(403);
    expect((await member.client.delete("/api/v1/instance/announcement")).statusCode).toBe(403);

    const organization = await owner.put(
      `/api/v1/organizations/${organizationId}/announcement`,
      banner("Organization news"),
    );
    expect(organization.statusCode, organization.body).toBe(200);
    const instance = await owner.put("/api/v1/instance/announcement", banner("Maintenance", "warning"));
    expect(instance.statusCode, instance.body).toBe(200);
    const refused = await owner.put("/api/v1/instance/announcement", {
      ...banner("Maintenance"),
      link: { url: "javascript:alert(1)", label: "Open" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "invalidAnnouncement" });

    const shown = await member.client.get("/api/v1/announcements");
    expect((shown.json() as { text: string }[]).map((entry) => entry.text)).toEqual([
      "Maintenance",
      "Organization news",
    ]);
    expect(
      ((await outsider.client.get("/api/v1/announcements")).json() as { text: string }[]).map(
        (entry) => entry.text,
      ),
    ).toEqual(["Maintenance"]);

    const information = organization.json() as { id: string; version: string };
    const dismissed = await member.client.post(`/api/v1/announcements/${information.id}/dismiss`, {
      version: information.version,
    });
    expect(dismissed.statusCode, dismissed.body).toBe(204);
    expect(
      (
        await outsider.client.post(`/api/v1/announcements/${information.id}/dismiss`, {
          version: information.version,
        })
      ).statusCode,
    ).toBe(404);
    const warning = instance.json() as { id: string; version: string };
    const kept = await member.client.post(`/api/v1/announcements/${warning.id}/dismiss`, {
      version: warning.version,
    });
    expect(kept.statusCode).toBe(409);
    expect(kept.json()).toMatchObject({ code: "announcementNotDismissible" });

    expect((await owner.delete("/api/v1/instance/announcement")).statusCode).toBe(204);
    expect((await owner.delete("/api/v1/instance/announcement")).statusCode).toBe(404);
    expect((await owner.delete(`/api/v1/organizations/${organizationId}/announcement`)).statusCode).toBe(204);
  });

  it("tells open sessions of another node about changed banners they are shown", async () => {
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    const member = await person();
    const elsewhere = await owner.post("/api/v1/organizations", { name: `Away ${randomUUID().slice(0, 6)}` });
    const outsider = await person(elsewhere.json().id);
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, events: [] as unknown[] };
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
          for (const match of chunk.matchAll(/event: announcements\ndata: (\{.*\})\n\n/g)) {
            received.events.push(JSON.parse(match[1] ?? "{}"));
          }
        });
        await expect.poll(() => received.connected, { timeout: 5000 }).toBe(true);
        return received;
      };
      const colleague = await follow(member.client);
      const stranger = await follow(outsider.client);
      await owner.put(`/api/v1/organizations/${organizationId}/announcement`, banner("Live news"));
      const organizationChange = { scope: "organization", organizationId };
      await expect.poll(() => colleague.events, { timeout: 5000 }).toContainEqual(organizationChange);
      await owner.put("/api/v1/instance/announcement", banner("Live maintenance"));
      const instanceChange = { scope: "instance", organizationId: null };
      await expect.poll(() => stranger.events, { timeout: 5000 }).toContainEqual(instanceChange);
      await expect.poll(() => colleague.events, { timeout: 5000 }).toContainEqual(instanceChange);
      expect(stranger.events).not.toContainEqual(organizationChange);
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime.close();
      await owner.delete("/api/v1/instance/announcement");
      await owner.delete(`/api/v1/organizations/${organizationId}/announcement`);
    }
  });

  async function space() {
    const admin = await person();
    const reader = await person();
    const outsider = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Shortcuts ${counter}`,
      key: `SC${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    return { admin, reader, outsider, space: created.json() as { id: string } };
  }

  it("lets readers follow a blog and keeps people without access out", async () => {
    const context = await space();
    const path = `/api/v1/spaces/${context.space.id}/blog/subscription`;
    expect((await context.outsider.client.put(path)).statusCode).toBe(404);
    expect((await context.outsider.client.get(path)).statusCode).toBe(404);
    expect((await context.reader.client.put(path)).statusCode).toBe(204);
    expect((await context.reader.client.get(path)).json()).toEqual({ following: true });
    const followed = await context.reader.client.get("/api/v1/account/followed-blogs");
    expect(followed.json()).toMatchObject({ items: [{ spaceId: context.space.id }], unavailable: 0 });
    expect((await context.reader.client.delete(path)).statusCode).toBe(204);
    expect((await context.reader.client.get(path)).json()).toEqual({ following: false });
    expect((await context.outsider.client.delete(path)).statusCode).toBe(204);
  });

  it("lets space admins manage shortcuts that readers see", async () => {
    const context = await space();
    const path = `/api/v1/spaces/${context.space.id}/shortcuts`;
    const body = { label: "Status page", target: { url: "https://status.example.org" } };
    expect((await context.reader.client.post(path, body)).statusCode).toBe(403);
    expect((await context.reader.client.get(`${path}/manage`)).statusCode).toBe(403);
    expect((await context.outsider.client.get(path)).statusCode).toBe(404);
    const added = await context.admin.client.post(path, body);
    expect(added.statusCode, added.body).toBe(201);
    const refused = await context.admin.client.post(path, {
      label: "Bad",
      target: { url: "javascript:alert(1)" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "invalidShortcut" });
    expect(
      ((await context.reader.client.get(path)).json() as { label: string }[]).map((s) => s.label),
    ).toEqual(["Status page"]);
    const id = (added.json() as { id: string }).id;
    expect((await context.reader.client.delete(`${path}/${id}`)).statusCode).toBe(403);
    expect((await context.admin.client.delete(`${path}/${id}`)).statusCode).toBe(204);
  });
});
