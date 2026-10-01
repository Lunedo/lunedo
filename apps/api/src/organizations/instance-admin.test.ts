import {
  accentColorSetting,
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  selfRegistrationSetting,
} from "@pagehall/server";
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

describe.skipIf(!databaseBaseUrl)("instance administration for the interface", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;

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

  it("tells anonymous visitors the instance name and the only organization", async () => {
    await test.runtime.settings.set(
      accentColorSetting,
      { organization: organizationId },
      "organization",
      "violet",
    );
    const info = (await new TestClient(test.app).get("/api/v1/instance/info")).json();
    expect(info).toEqual({
      name: "Test wiki",
      setupComplete: true,
      language: "en",
      accentColor: "petrol",
      passwordMinLength: 12,
      selfRegistration: false,
      organization: { id: organizationId, name: "Test organization", logoRef: null, accentColor: "violet" },
    });
  });

  it("tells the sign-in page whether people can register themselves", async () => {
    const anonymous = new TestClient(test.app);
    expect((await anonymous.get("/api/v1/instance/info")).json().selfRegistration).toBe(false);
    await test.runtime.settings.set(
      selfRegistrationSetting,
      { organization: organizationId },
      "organization",
      true,
    );
    expect((await anonymous.get("/api/v1/instance/info")).json().selfRegistration).toBe(false);
    const added = await owner.post(`/api/v1/organizations/${organizationId}/domains`, {
      domain: "register.example",
    });
    expect(added.statusCode).toBe(201);
    expect((await anonymous.get("/api/v1/instance/info")).json().selfRegistration).toBe(true);
    await test.runtime.settings.set(
      selfRegistrationSetting,
      { organization: organizationId },
      "organization",
      false,
    );
    expect((await anonymous.get("/api/v1/instance/info")).json().selfRegistration).toBe(false);
  });

  it("uploads, serves and removes an organization logo", async () => {
    const url = `/api/v1/organizations/${organizationId}/logo`;
    const uploaded = await owner.put(url, { contentType: "image/png", data: PNG.toString("base64") });
    expect(uploaded.statusCode).toBe(200);
    const logoRef = uploaded.json().logoRef;
    expect(logoRef).toMatch(/^[0-9a-f]{16}$/);

    const anonymous = new TestClient(test.app);
    const served = await anonymous.get(url);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(served.rawPayload.equals(PNG)).toBe(true);
    expect((await anonymous.get("/api/v1/instance/info")).json().organization.logoRef).toBe(logoRef);

    const audit = await test.runtime.pool.query(
      "select fields from audit_events where name = 'organization.updated' order by sequence desc limit 1",
    );
    expect(JSON.stringify(audit.rows[0])).toContain(logoRef);

    expect((await owner.delete(url)).statusCode).toBe(204);
    expect((await anonymous.get(url)).statusCode).toBe(404);
    expect((await owner.get(`/api/v1/organizations/${organizationId}`)).json().logoRef).toBeNull();
  });

  it("rejects logos that are not small PNG, JPEG or WebP images", async () => {
    const url = `/api/v1/organizations/${organizationId}/logo`;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const disguised = await owner.put(url, { contentType: "image/png", data: svg.toString("base64") });
    expect(disguised.json()).toMatchObject({ code: "invalidLogo" });
    const mismatch = await owner.put(url, { contentType: "image/jpeg", data: PNG.toString("base64") });
    expect(mismatch.json()).toMatchObject({ code: "invalidLogo" });
    const large = Buffer.concat([PNG, Buffer.alloc(256 * 1024)]);
    const tooLarge = await owner.put(url, { contentType: "image/png", data: large.toString("base64") });
    expect(tooLarge.statusCode).toBe(400);
    const vector = await owner.put(url, { contentType: "image/svg+xml", data: svg.toString("base64") });
    expect(vector.statusCode).toBe(400);
    const invented = await owner.patch(`/api/v1/organizations/${organizationId}`, {
      logoRef: "https://evil.example",
    });
    expect(invented.json()).toMatchObject({ code: "invalidLogo" });
  });

  it("lets only organization managers change the logo", async () => {
    const member = await createAccount(test, "logo.member@example.org");
    const client = await signedInClient(test, member.email, member.password);
    const response = await client.put(`/api/v1/organizations/${organizationId}/logo`, {
      contentType: "image/png",
      data: PNG.toString("base64"),
    });
    expect(response.statusCode).toBe(403);
  });

  it("shows the mail server without its password and sends a test mail", async () => {
    const shown = (await owner.get("/api/v1/instance/mail")).json();
    expect(shown).toEqual({
      smtp: {
        host: "smtp.pagehall.test",
        port: 587,
        security: "none",
        username: null,
        from: "wiki@pagehall.test",
      },
      passwordSet: false,
    });

    const configuration = {
      host: "mail.example.org",
      port: 465,
      security: "tls",
      username: "wiki",
      from: "wiki@example.org",
    };
    const saved = await owner.put("/api/v1/instance/mail", { ...configuration, password: "secret" });
    expect(saved.statusCode).toBe(204);
    const stored = (await owner.get("/api/v1/instance/mail")).json();
    expect(stored).toEqual({ smtp: configuration, passwordSet: true });
    expect(JSON.stringify(stored)).not.toContain("secret");

    const before = test.mail.sent.length;
    const result = await owner.post("/api/v1/instance/mail/test", {
      ...configuration,
      to: "owner@pagehall.test",
      language: "de",
    });
    expect(result.json()).toEqual({ delivered: true, error: null });
    expect(test.mail.sent.length).toBe(before + 1);
    expect(test.mail.sent.at(-1)?.to).toBe("owner@pagehall.test");
  });

  it("keeps the mail server and break-glass list away from people without permission", async () => {
    const member = await createAccount(test, "mail.member@example.org");
    const client = await signedInClient(test, member.email, member.password);
    expect((await client.get("/api/v1/instance/mail")).statusCode).toBe(403);
    const configuration = {
      host: "x.example",
      port: 587,
      security: "none",
      username: null,
      from: "a@b.example",
    };
    expect((await client.put("/api/v1/instance/mail", configuration)).statusCode).toBe(403);
    const tested = await client.post("/api/v1/instance/mail/test", { ...configuration, to: "a@b.example" });
    expect(tested.statusCode).toBe(403);
    expect((await client.get("/api/v1/instance/break-glass")).statusCode).toBe(403);
  });

  it("lists recent break-glass access with names", async () => {
    const administrator = await createAccount(test, "glass.admin@example.org");
    await owner.post("/api/v1/instance/role-assignments", {
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    const created = await owner.post("/api/v1/organizations", { name: "Locked away" });
    const client = await signedInClient(test, administrator.email, administrator.password);
    await addTotp(client);
    const started = await client.post(`/api/v1/organizations/${created.json().id}/break-glass`, {
      reason: "Investigating a reported incident",
    });
    expect(started.statusCode).toBe(201);
    const list = (await owner.get("/api/v1/instance/break-glass")).json();
    expect(list.items[0]).toMatchObject({
      id: started.json().id,
      organizationName: "Locked away",
      accountName: "glass.admin",
      reason: "Investigating a reported incident",
      endedAt: null,
    });
  });

  it("shows where each organization setting comes from", async () => {
    const settings = (await owner.get(`/api/v1/organizations/${organizationId}/settings?limit=200`)).json()
      .items;
    const accent = settings.find((entry: { key: string }) => entry.key === "branding.accentColor");
    expect(accent).toMatchObject({
      value: "violet",
      source: "organization",
      defaultValue: "petrol",
      levelsBelow: [],
    });
    const language = settings.find((entry: { key: string }) => entry.key === "locale.language");
    expect(language).toMatchObject({ defaultValue: "en", lockable: true, levelsBelow: ["user"] });
    const instanceSettings = (await owner.get("/api/v1/instance/settings?limit=200")).json().items;
    const twoFactor = instanceSettings.find(
      (entry: { key: string }) => entry.key === "auth.twoFactorRequired",
    );
    expect(twoFactor).toMatchObject({ defaultValue: false, levelsBelow: ["organization"] });
    expect(accent.levels).toEqual([
      { level: "instance", value: null, locked: false, effective: true },
      { level: "organization", value: "violet", locked: false, effective: true },
    ]);
  });
});
