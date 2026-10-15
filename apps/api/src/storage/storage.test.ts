import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

const TOTAL = 1000 * 1024 * 1024;

describe.skipIf(!databaseBaseUrl)("storage warnings through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let member: TestClient;
  let organizationId: string;
  let usage = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
    await createAccount(test, "storage-member@pagehall.test", "a long enough passphrase");
    member = await signedInClient(test, "storage-member@pagehall.test", "a long enough passphrase");
  });

  afterAll(async () => {
    await test?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    usage = 0;
  });

  function simulate(share: number) {
    usage = share;
    vi.spyOn(test.runtime.services.files.store, "capacity").mockImplementation(async () => ({
      free: Math.round(TOTAL * (1 - usage / 100)),
      total: TOTAL,
    }));
  }

  async function page() {
    const key = `S${Math.floor(Math.random() * 1e6)}`;
    const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Storage ${key}`,
      key,
      visibility: "private",
      grants: [],
    });
    expect(space.statusCode, space.body).toBe(201);
    const created = await owner.post(`/api/v1/spaces/${(space.json() as { id: string }).id}/items`, {
      kind: "page",
      title: "Page",
      parentId: null,
      mode: "live",
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  it("shows the usage to the administration only", async () => {
    simulate(42);
    const shown = await owner.get("/api/v1/instance/storage");
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.json()).toMatchObject({
      store: "local",
      measured: true,
      inactiveReason: null,
      percent: 42,
      level: 0,
      thresholds: { warning: 80, largeWrites: 90, critical: 95 },
      reminder: "weekly",
      operationsEmails: [],
      teamsWebhook: { configured: false, host: null },
    });
    expect((await member.get("/api/v1/instance/storage")).statusCode).toBe(403);
    expect((await member.put("/api/v1/instance/storage", { reminder: "daily" })).statusCode).toBe(403);
    expect((await member.post("/api/v1/instance/storage/test")).statusCode).toBe(403);
    expect((await new TestClient(test.app).get("/api/v1/instance/storage")).statusCode).toBe(401);
  });

  it("keeps the levels in ascending order and says which field is wrong", async () => {
    const refused = await owner.put("/api/v1/instance/storage", { thresholds: { warning: 96 } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: "invalidStorageSettings",
      fields: ["body.thresholds"],
      problem: "invalidThresholds",
    });
    const saved = await owner.put("/api/v1/instance/storage", {
      thresholds: { warning: 70, largeWrites: 85, critical: 92 },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ thresholds: { warning: 70, largeWrites: 85, critical: 92 } });
    await owner.put("/api/v1/instance/storage", {
      thresholds: { warning: 80, largeWrites: 90, critical: 95 },
    });
  });

  it("refuses invalid operations contacts and keeps the earlier ones", async () => {
    const saved = await owner.put("/api/v1/instance/storage", {
      operationsEmails: ["tickets@example.org"],
    });
    expect(saved.json()).toMatchObject({ operationsEmails: ["tickets@example.org"] });
    const refused = await owner.put("/api/v1/instance/storage", { operationsEmails: ["not an address"] });
    expect(refused.json()).toMatchObject({
      code: "invalidStorageSettings",
      fields: ["body.operationsEmails"],
      problem: "invalidContacts",
    });
    const webhook = await owner.put("/api/v1/instance/storage", { teamsWebhook: "not a url" });
    expect(webhook.json()).toMatchObject({ code: "invalidStorageSettings", problem: "invalidTeamsWebhook" });
    expect((await owner.get("/api/v1/instance/storage")).json()).toMatchObject({
      operationsEmails: ["tickets@example.org"],
    });
    await owner.put("/api/v1/instance/storage", { operationsEmails: [] });
  });

  it("keeps the levels and contacts out of the general settings endpoint", async () => {
    for (const key of ["storage.warningPercent", "storage.operationsEmails", "storage.s3LimitBytes"]) {
      const response = await owner.put(`/api/v1/instance/settings/${key}`, { value: 50 });
      expect(response.json()).toMatchObject({ code: "settingManagedElsewhere" });
    }
    const reminder = await owner.put("/api/v1/instance/settings/storage.reminder", { value: "daily" });
    expect(reminder.statusCode, reminder.body).toBe(204);
    expect((await owner.get("/api/v1/instance/storage")).json()).toMatchObject({ reminder: "daily" });
    await owner.put("/api/v1/instance/settings/storage.reminder", { clear: true });
  });

  it("refuses uploads from the critical level with a clear message", async () => {
    const pageId = await page();
    const send = () =>
      owner.post(`/api/v1/pages/${pageId}/attachments?name=notes.txt`, Buffer.from("hello"), {
        "content-type": "application/octet-stream",
      });
    simulate(94);
    expect((await send()).statusCode).toBe(201);
    simulate(95);
    const refused = await send();
    expect(refused.statusCode).toBe(507);
    expect(refused.json()).toMatchObject({
      code: "storageFull",
      detail: "Storage is almost full. Your instance administrator has been informed.",
      refusal: "upload",
    });
  });

  it("refuses new import uploads from the large-writes level", async () => {
    const start = () =>
      owner.post(`/api/v1/organizations/${organizationId}/import-uploads`, {
        name: "export.zip",
        size: 1000,
      });
    simulate(89);
    expect((await start()).statusCode).toBe(201);
    simulate(90);
    const refused = await start();
    expect(refused.statusCode).toBe(507);
    expect(refused.json()).toMatchObject({ code: "storageFull", refusal: "largeWrite" });
  });

  it("refuses new exports from the large-writes level with the export message", async () => {
    const key = `E${Math.floor(Math.random() * 1e6)}`;
    const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Export ${key}`,
      key,
      visibility: "private",
      grants: [],
    });
    const spaceId = (space.json() as { id: string }).id;
    await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Page",
      parentId: null,
      mode: "live",
    });
    simulate(90);
    const refused = await owner.post(`/api/v1/spaces/${spaceId}/exports`);
    expect(refused.statusCode).toBe(507);
    expect(refused.json()).toMatchObject({
      code: "notEnoughStorage",
      detail: "Not enough storage for this export. Your instance administrator needs to free up space.",
    });
  });

  it("sends a test message to the operations contacts", async () => {
    await owner.put("/api/v1/instance/storage", { operationsEmails: ["tickets@example.org"] });
    const result = await owner.post("/api/v1/instance/storage/test");
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ addresses: 1, teams: null });
    await owner.put("/api/v1/instance/storage", { operationsEmails: [] });
  });
});
