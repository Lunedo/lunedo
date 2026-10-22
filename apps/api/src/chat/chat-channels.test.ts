import { createECDH, randomBytes } from "node:crypto";
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

describe.skipIf(!databaseBaseUrl)("chat channels and browser push through the API", () => {
  let test: AuthTestApp;
  let organizationId: string;
  let counter = 0;
  let owner: TestClient;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    organizationId = await firstOrganizationId(test);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `chat${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password)).id;
    return { id, email, password, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const admin = await person();
    const editor = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Chat ${counter}`,
      key: `CH${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: editor.id, role: "editor" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    return { admin, editor, space: created.json() as { id: string } };
  }

  const channel = {
    kind: "webhook",
    name: "Automation",
    events: ["pagePublished", "commentCreated"],
    target: { url: "https://93.184.216.34/hooks/secret-path" },
  };

  it("lets only space admins connect channels and never returns the address", async () => {
    const context = await setup();
    const path = `/api/v1/spaces/${context.space.id}/chat-channels`;
    expect((await context.editor.client.get(path)).statusCode).toBe(403);
    expect((await context.editor.client.post(path, channel)).statusCode).toBe(403);

    const blocked = await context.admin.client.post(path, {
      ...channel,
      target: { url: "http://127.0.0.1/hook" },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ code: "chatAddressBlocked", fields: ["body.target.url"] });
    const malformed = await context.admin.client.post(path, {
      ...channel,
      target: { url: "http://hooks example" },
    });
    expect(malformed.json()).toMatchObject({
      code: "invalidChatAddress",
      fields: ["body.target.url"],
      problem: "notUrl",
    });

    const created = await context.admin.client.post(path, channel);
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json() as { channel: { id: string }; signingSecret: string };
    expect(saved.signingSecret).toHaveLength(43);
    const listed = await context.admin.client.get(path);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain("secret-path");
    expect(listed.body).not.toContain(saved.signingSecret);
    expect(listed.json()).toMatchObject({ items: [{ id: saved.channel.id, state: "working" }] });

    const other = await setup();
    const foreign = await other.admin.client.delete(
      `/api/v1/spaces/${other.space.id}/chat-channels/${saved.channel.id}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect((await context.admin.client.delete(`${path}/${saved.channel.id}`)).statusCode).toBe(204);
  });

  it("lets only organization administrators connect announcement channels", async () => {
    const member = await person();
    const path = `/api/v1/organizations/${organizationId}/chat-channels`;
    const input = { ...channel, events: ["announcementPublished"] };
    expect((await member.client.post(path, input)).statusCode).toBe(403);
    const created = await owner.post(path, input);
    expect(created.statusCode, created.body).toBe(201);
    const wrong = await owner.post(path, { ...channel, events: ["pagePublished"] });
    expect(wrong.json()).toMatchObject({ code: "invalidChatChannel" });
  });

  it("turns browser push on per instance and forgets a device when its session signs out", async () => {
    const reader = await person();
    expect((await reader.client.get("/api/v1/account/push")).json()).toEqual({
      enabled: false,
      publicKey: null,
      devices: [],
    });
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: {
        p256dh: browser.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    };
    const refused = await reader.client.post("/api/v1/account/push/devices", subscription);
    expect(refused.json()).toMatchObject({ code: "pushDisabled" });

    expect(
      (await reader.client.put("/api/v1/instance/settings/notifications.browserPush", { value: true }))
        .statusCode,
    ).toBe(403);
    const enabled = await owner.put("/api/v1/instance/settings/notifications.browserPush", { value: true });
    expect(enabled.statusCode, enabled.body).toBe(204);
    expect((await reader.client.get("/api/v1/account/notification-delivery")).json()).toMatchObject({
      browserPush: true,
    });

    const added = await reader.client.post("/api/v1/account/push/devices", subscription);
    expect(added.statusCode, added.body).toBe(201);
    const status = (await reader.client.get("/api/v1/account/push")).json() as {
      publicKey: string;
      devices: { current: boolean }[];
    };
    expect(status.publicKey).toHaveLength(87);
    expect(status.devices).toMatchObject([{ current: true }]);

    expect((await reader.client.post("/api/v1/auth/sign-out")).statusCode).toBe(204);
    const again = await signedInClient(test, reader.email, reader.password);
    expect((await again.get("/api/v1/account/push")).json()).toMatchObject({ devices: [] });
    await owner.put("/api/v1/instance/settings/notifications.browserPush", { value: false });
  });
});
