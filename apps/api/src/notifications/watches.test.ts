import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl } from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("watching through the API", () => {
  let test: AuthTestApp;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `watcher${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password)).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const author = await person();
    const reader = await person();
    const outsider = await person();
    counter += 1;
    const created = await author.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Watched ${counter}`,
      key: `WA${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const space = created.json() as { id: string };
    const page = await author.client.post(`/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title: "Restart the VPN gateway",
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    return { author, reader, outsider, space, page: page.json() as { id: string } };
  }

  it("shows the automatic watch of the creator and lets readers watch, mute and reset", async () => {
    const context = await setup();
    const own = await context.author.client.get(`/api/v1/items/${context.page.id}/watch`);
    expect(own.json()).toEqual({
      own: { state: "watching", keepActionable: true, automatic: true },
      effective: { state: "watching", keepActionable: true, source: "target" },
    });

    const watched = await context.reader.client.put(`/api/v1/spaces/${context.space.id}/watch`, {
      state: "watching",
    });
    expect(watched.statusCode, watched.body).toBe(200);
    const inherited = await context.reader.client.get(`/api/v1/items/${context.page.id}/watch`);
    expect(inherited.json()).toEqual({
      own: null,
      effective: { state: "watching", keepActionable: true, source: "space" },
    });

    const muted = await context.reader.client.put(`/api/v1/items/${context.page.id}/watch`, {
      state: "muted",
      keepActionable: false,
    });
    expect(muted.json()).toMatchObject({ own: { state: "muted", keepActionable: false, automatic: false } });
    const list = await context.reader.client.get("/api/v1/account/watches");
    expect(list.json()).toMatchObject({
      items: [
        { target: { type: "item", id: context.page.id }, state: "muted", title: "Restart the VPN gateway" },
        { target: { type: "space", id: context.space.id }, state: "watching", kind: "space" },
      ],
      counts: { watchedItems: 0, watchedSpaces: 1, mutedItems: 1, mutedSpaces: 0 },
    });

    const reset = await context.reader.client.delete(`/api/v1/items/${context.page.id}/watch`);
    expect(reset.json()).toEqual({
      own: null,
      effective: { state: "watching", keepActionable: true, source: "space" },
    });
  });

  it("answers people without access as if the item and space were unknown", async () => {
    const context = await setup();
    for (const url of [
      `/api/v1/items/${context.page.id}/watch`,
      `/api/v1/spaces/${context.space.id}/watch`,
    ]) {
      expect((await context.outsider.client.get(url)).statusCode).toBe(404);
      expect((await context.outsider.client.put(url, { state: "watching" })).statusCode).toBe(404);
    }
    const list = await context.outsider.client.get("/api/v1/account/watches");
    expect(list.json()).toMatchObject({ items: [] });
  });

  it("rejects unknown states", async () => {
    const context = await setup();
    const response = await context.reader.client.put(`/api/v1/items/${context.page.id}/watch`, {
      state: "following",
    });
    expect(response.statusCode).toBe(400);
  });

  it("tells whether e-mail can be delivered", async () => {
    const context = await setup();
    const response = await context.reader.client.get("/api/v1/account/notification-delivery");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("emailMethod");
  });
});
