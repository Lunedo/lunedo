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
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  async function signInThroughProvider(client: TestClient, claims: Record<string, unknown>) {
    const started = await client.post(`/api/v1/auth/providers/${providerId}/start`, {});
    expect(started.statusCode).toBe(200);
    const callback = await idp.authorize(started.json().url, claims);
    return client.get(`${callback.pathname}${callback.search}`);
  }

  it("chooses the provider by e-mail domain and keeps its management to permitted people", async () => {
    const options = await new TestClient(test.app).get("/api/v1/auth/sign-in-options");
    expect(options.json()).toEqual({
      emailStep: true,
      directProvider: null,
      lastProvider: null,
      passwordSignIn: true,
      passkeys: true,
    });
    const visitor = new TestClient(test.app, { remoteAddress: "198.51.100.40" });
    expect(
      (await visitor.post("/api/v1/auth/sign-in/discover", { email: "Anyone@PAGEHALL.test" })).json(),
    ).toEqual({
      step: "provider",
      providerId,
      name: "Company login",
      preset: "generic",
    });
    expect(
      (await visitor.post("/api/v1/auth/sign-in/discover", { email: "someone@other.test" })).json(),
    ).toEqual({
      step: "password",
    });
    const taken = await owner.post("/api/v1/instance/identity-providers", {
      name: "Second login",
      config: { preset: "generic", issuer: idp.issuer, clientId: "second", domains: ["pagehall.test"] },
      credential: { kind: "clientSecret", secret: "second-secret", expiresAt: null },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: "domainInUse" });
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
    expect(String(response.headers["set-cookie"])).toContain(
      `__Host-pagehall-last-provider=${providerId}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`,
    );
    expect((await browser.get("/api/v1/auth/sign-in-options")).json()).toMatchObject({
      lastProvider: { id: providerId, name: "Company login" },
    });

    const withoutFlow = new TestClient(test.app);
    const started = await browser.post(`/api/v1/auth/providers/${providerId}/start`, {});
    const callback = await idp.authorize(started.json().url, {
      sub: "new-person",
      email: "new.person@pagehall.test",
    });
    const stolen = await withoutFlow.get(`${callback.pathname}${callback.search}`);
    expect(stolen.headers.location).toBe("/sign-in?error=challengeExpired");
  });

  it("tells only sign-in administrators that providers are not checked strictly", async () => {
    const security = await owner.get("/api/v1/instance/sign-in-security");
    expect(security.statusCode).toBe(200);
    expect(security.json()).toEqual({ insecureIdentityProviders: true });
    const person = new TestClient(test.app);
    await signInThroughProvider(person, { sub: "security-reader", email: "reader@pagehall.test" });
    expect((await person.get("/api/v1/instance/sign-in-security")).statusCode).toBe(403);
  });

  it("sends people to the second factor of Pagehall when the provider asks for it", async () => {
    const created = await owner.post("/api/v1/instance/identity-providers", {
      name: "Second factor login",
      config: {
        preset: "generic",
        issuer: idp.issuer,
        clientId: idp.clientId,
        domains: ["factor.pagehall.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
        secondFactor: { mode: "pagehall" },
      },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    expect(created.json().provider.config.secondFactor).toEqual({ mode: "pagehall", proofValues: ["mfa"] });
    const factorProvider = created.json().provider.id;
    const signInOnce = async (client: TestClient) => {
      const started = await client.post(`/api/v1/auth/providers/${factorProvider}/start`, {
        returnTo: "/settings/security",
      });
      const callback = await idp.authorize(started.json().url, {
        sub: "factor-person",
        email: "person@factor.pagehall.test",
        amr: ["mfa"],
      });
      return client.get(`${callback.pathname}${callback.search}`);
    };
    const first = new TestClient(test.app);
    expect((await signInOnce(first)).headers.location).toBe("/settings/security");
    expect((await first.get("/api/v1/auth/session")).json()).toMatchObject({
      sessionKind: "secondFactorSetup",
    });
    await addTotp(first);

    const second = new TestClient(test.app);
    const response = await signInOnce(second);
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      `/sign-in/verify?${new URLSearchParams({ factors: '["totp","recoveryCode"]', redirect: "/settings/security" })}`,
    );
    expect(String(response.headers["set-cookie"])).toContain("__Host-pagehall-pending=");
    expect((await second.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await owner.delete(`/api/v1/instance/identity-providers/${factorProvider}`)).statusCode).toBe(
      204,
    );
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

  it("answers the same for known and unknown addresses and limits the questions per client", async () => {
    const known = await createAccount(test, "known.person@other.test");
    const client = new TestClient(test.app, { remoteAddress: "198.51.100.41" });
    for (const domain of ["other.test", "pagehall.test"]) {
      const withAccount = await client.post("/api/v1/auth/sign-in/discover", {
        email: `known.person@${domain}`,
      });
      const without = await client.post("/api/v1/auth/sign-in/discover", { email: `nobody.here@${domain}` });
      expect(withAccount.statusCode).toBe(without.statusCode);
      expect(withAccount.body).toBe(without.body);
    }
    expect(known.email).toBe("known.person@other.test");
    const limited = new TestClient(test.app, { remoteAddress: "198.51.100.42" });
    for (let attempt = 0; attempt < 30; attempt++) {
      expect(
        (await limited.post("/api/v1/auth/sign-in/discover", { email: "a@other.test" })).statusCode,
      ).toBe(200);
    }
    const refused = await limited.post("/api/v1/auth/sign-in/discover", { email: "a@other.test" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "rateLimited" });
  });

  it("turns password sign-in off for the instance, except for the instance owner", async () => {
    const member = await createAccount(test, "password.member@pagehall.test");
    const organizationLevel = await owner.put(
      `/api/v1/organizations/${organizationId}/settings/auth.passwordSignIn`,
      { value: false },
    );
    expect(organizationLevel.statusCode).toBeGreaterThanOrEqual(400);
    const changed = await owner.put("/api/v1/instance/settings/auth.passwordSignIn", { value: false });
    expect(changed.statusCode).toBeLessThan(300);
    try {
      const refused = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: member.email,
        password: member.password,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: "passwordSignInDisabled" });
      const options = await new TestClient(test.app).get("/api/v1/auth/sign-in-options");
      expect(options.json()).toMatchObject({
        emailStep: false,
        directProvider: { id: providerId, name: "Company login" },
        passwordSignIn: false,
        passkeys: true,
      });
      const visitor = new TestClient(test.app, { remoteAddress: "198.51.100.43" });
      expect(
        (await visitor.post("/api/v1/auth/sign-in/discover", { email: "someone@other.test" })).json(),
      ).toEqual({
        step: "none",
      });
      const emergency = await new TestClient(test.app).post("/api/v1/auth/sign-in", OWNER);
      expect(emergency.json()).toMatchObject({ status: "secondFactorRequired" });
    } finally {
      await owner.put("/api/v1/instance/settings/auth.passwordSignIn", { clear: true });
    }
  });

  it("answers provider failures and invalid profile values with a problem or a reference", async () => {
    const unreachable = await owner.post("/api/v1/instance/identity-providers", {
      name: "Unreachable login",
      config: {
        preset: "generic",
        issuer: "http://127.0.0.1:9/realms/gone",
        clientId: "pagehall",
        domains: ["unreachable.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
      },
      credential: { kind: "clientSecret", secret: "secret", expiresAt: null },
    });
    expect(unreachable.statusCode).toBe(201);
    const started = await new TestClient(test.app).post(
      `/api/v1/auth/providers/${unreachable.json().provider.id}/start`,
      {},
    );
    expect(started.statusCode).toBe(502);
    expect(started.json()).toMatchObject({ code: "providerUnavailable" });

    const callback = await signInThroughProvider(new TestClient(test.app), {
      sub: crypto.randomUUID(),
      email: "long.name@pagehall.test",
      name: "x".repeat(300),
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toMatch(/^\/sign-in\/refused\?reference=/);
  });
});
