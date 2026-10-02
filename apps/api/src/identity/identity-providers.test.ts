import { type FakeOidcProvider, startFakeOidcProvider } from "@pagehall/server/testing";
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
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("identity providers through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let idp: FakeOidcProvider;
  let organizationId: string;
  let providerId: string;

  beforeAll(async () => {
    test = await createAuthTestApp({ ...configuredSetupEnv, PAGEHALL_INSECURE_IDENTITY_PROVIDERS: "true" });
    await completeConfiguredSetup(test);
    idp = await startFakeOidcProvider();
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
    const created = await owner.post("/api/v1/instance/identity-providers", {
      name: "Company login",
      config: {
        preset: "generic",
        issuer: idp.issuer,
        clientId: idp.clientId,
        domains: ["pagehall.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
      },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    expect(created.statusCode).toBe(201);
    providerId = created.json().provider.id;
    expect(created.json().provider.redirectUri).toBe(
      `${TEST_ORIGIN}/api/v1/auth/providers/${providerId}/callback`,
    );
    expect(created.body).not.toContain(idp.clientSecret);
    await owner.put(`/api/v1/instance/identity-providers/${providerId}/availability`, {
      organizationIds: [organizationId],
    });
    await owner.put(`/api/v1/organizations/${organizationId}/sign-in-providers/${providerId}`, {
      enabled: true,
    });
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  async function signInThroughProvider(client: TestClient, claims: Record<string, unknown>) {
    const started = await client.post(`/api/v1/auth/providers/${providerId}/start`, { organizationId });
    expect(started.statusCode).toBe(200);
    const callback = await idp.authorize(started.json().url, claims);
    return client.get(`${callback.pathname}${callback.search}`);
  }

  it("offers the provider on the sign-in page and keeps its management to permitted people", async () => {
    const options = await new TestClient(test.app).get("/api/v1/auth/sign-in-options");
    expect(options.json()).toMatchObject({
      organization: { id: organizationId },
      providers: [{ id: providerId, name: "Company login", enabled: true }],
      passwordSignIn: true,
    });
    const member = await createAccount(test, "plain.member@pagehall.test");
    const client = await signedInClient(test, member.email, member.password);
    expect((await client.get("/api/v1/instance/identity-providers")).statusCode).toBe(403);
    expect((await owner.get("/api/v1/instance/identity-providers")).json()).toEqual([
      expect.objectContaining({ id: providerId, warnings: [] }),
    ]);
  });

  it("signs a new person in through the browser flow and sends them back", async () => {
    const browser = new TestClient(test.app);
    const response = await signInThroughProvider(browser, {
      sub: "new-person",
      email: "new.person@pagehall.test",
      name: "New Person",
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/");
    const session = await browser.get("/api/v1/auth/session");
    expect(session.json()).toMatchObject({
      sessionKind: "full",
      account: { email: "new.person@pagehall.test" },
    });

    const withoutFlow = new TestClient(test.app);
    const started = await browser.post(`/api/v1/auth/providers/${providerId}/start`, { organizationId });
    const callback = await idp.authorize(started.json().url, {
      sub: "new-person",
      email: "new.person@pagehall.test",
    });
    const stolen = await withoutFlow.get(`${callback.pathname}${callback.search}`);
    expect(stolen.headers.location).toBe("/sign-in?error=challengeExpired");
  });

  it("ends provider sessions through back-channel logout without a browser", async () => {
    const browser = new TestClient(test.app);
    await signInThroughProvider(browser, {
      sub: "logout-person",
      sid: "idp-session-1",
      email: "logout@pagehall.test",
    });
    expect((await browser.get("/api/v1/auth/session")).statusCode).toBe(200);
    const response = await test.app.inject({
      method: "POST",
      url: `/api/v1/auth/providers/${providerId}/backchannel-logout`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        logout_token: await idp.logoutToken({ sid: "idp-session-1" }),
      }).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect((await browser.get("/api/v1/auth/session")).statusCode).toBe(401);
    const forged = await test.app.inject({
      method: "POST",
      url: `/api/v1/auth/providers/${providerId}/backchannel-logout`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ logout_token: "not.a.token" }).toString(),
    });
    expect(forged.statusCode).toBe(400);
  });

  it("links an existing account after its password and shows linked identities", async () => {
    const existing = await createAccount(test, "existing.person@pagehall.test");
    const browser = new TestClient(test.app);
    const response = await signInThroughProvider(browser, { sub: "existing-subject", email: existing.email });
    expect(response.headers.location).toBe("/sign-in/link");
    expect((await browser.get("/api/v1/auth/link")).json()).toMatchObject({
      providerName: "Company login",
      email: existing.email,
      factors: [],
    });
    expect((await browser.post("/api/v1/auth/link", { password: "wrong password" })).statusCode).toBe(401);
    const linked = await browser.post("/api/v1/auth/link", { password: existing.password });
    expect(linked.json()).toMatchObject({ status: "signedIn", account: { id: existing.id } });
    expect((await browser.get("/api/v1/account/identities")).json()).toEqual([
      expect.objectContaining({ providerId, subject: "existing-subject" }),
    ]);
    const identities = await owner.get(`/api/v1/accounts/${existing.id}/identities`);
    expect(identities.json()).toHaveLength(1);
  });

  it("turns password sign-in off for an organization, except for the instance owner", async () => {
    const member = await createAccount(test, "password.member@pagehall.test");
    const changed = await owner.put(`/api/v1/organizations/${organizationId}/settings/auth.passwordSignIn`, {
      value: false,
    });
    expect(changed.statusCode).toBeLessThan(300);
    try {
      const refused = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: member.email,
        password: member.password,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: "passwordSignInDisabled" });
      const options = await new TestClient(test.app).get("/api/v1/auth/sign-in-options");
      expect(options.json()).toMatchObject({ passwordSignIn: false });
      const emergency = await new TestClient(test.app).post("/api/v1/auth/sign-in", OWNER);
      expect(emergency.json()).toMatchObject({ status: "secondFactorRequired" });
    } finally {
      await owner.put(`/api/v1/organizations/${organizationId}/settings/auth.passwordSignIn`, {
        clear: true,
      });
    }
  });
});
