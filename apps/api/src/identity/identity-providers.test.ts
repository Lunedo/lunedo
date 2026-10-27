import { type FakeOidcProvider, startFakeOidcProvider } from "@lunedo/server/testing";
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
    test = await createAuthTestApp({ ...configuredSetupEnv, LUNEDO_INSECURE_IDENTITY_PROVIDERS: "true" });
    await completeConfiguredSetup(test);
    idp = await startFakeOidcProvider();
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
    const created = await owner.post("/api/v1/instance/identity-providers", {
      type: "oidc",
      name: "Company login",
      config: {
        preset: "generic",
        issuer: idp.issuer,
        clientId: idp.clientId,
        domains: ["lunedo.test"],
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
      providers: [expect.objectContaining({ id: providerId, type: "oidc" })],
      lastProvider: null,
      passkeys: true,
    });
    const visitor = new TestClient(test.app, { remoteAddress: "198.51.100.40" });
    expect(
      (await visitor.post("/api/v1/auth/sign-in/discover", { email: "Anyone@LUNEDO.test" })).json(),
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
      type: "oidc",
      name: "Second login",
      config: { preset: "generic", issuer: idp.issuer, clientId: "second", domains: ["lunedo.test"] },
      credential: { kind: "clientSecret", secret: "second-secret", expiresAt: null },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: "domainInUse" });
    const member = await createAccount(test, "plain.member@lunedo.test");
    const client = await signedInClient(test, member.email, member.password);
    expect((await client.get("/api/v1/instance/identity-providers")).statusCode).toBe(403);
    expect((await owner.get("/api/v1/instance/identity-providers")).json()).toEqual([
      expect.objectContaining({ id: providerId, warnings: [] }),
    ]);
  });

  it("starts a provider as a draft, connects it and finishes its setup", async () => {
    const started = await owner.post("/api/v1/instance/identity-provider-drafts", {
      type: "oidc",
      preset: "generic",
      name: "Draft login",
    });
    expect(started.statusCode).toBe(201);
    const draft = started.json();
    expect(draft.redirectUri).toBe(`${TEST_ORIGIN}/api/v1/auth/providers/${draft.id}/callback`);
    expect(
      (
        await owner.patch(`/api/v1/instance/identity-provider-drafts/${draft.id}`, {
          fields: { issuer: idp.issuer, clientId: "draft-client" },
        })
      ).json().fields,
    ).toEqual({ issuer: idp.issuer, clientId: "draft-client" });
    const drafts = (await owner.get("/api/v1/instance/identity-provider-drafts")).json();
    expect(drafts.map((entry: { id: string }) => entry.id)).toContain(draft.id);
    const listed = (await owner.get("/api/v1/instance/identity-providers")).json();
    expect(listed.map((entry: { id: string }) => entry.id)).not.toContain(draft.id);

    const connected = await owner.post("/api/v1/instance/identity-providers", {
      type: "oidc",
      name: "Draft login",
      draftId: draft.id,
      config: { preset: "generic", issuer: idp.issuer, clientId: idp.clientId, domains: ["draft.test"] },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    expect(connected.statusCode).toBe(201);
    expect(connected.json().provider).toMatchObject({ id: draft.id, setupComplete: false });
    expect(
      (
        await new TestClient(test.app).post("/api/v1/auth/sign-in/discover", { email: "a@draft.test" })
      ).json(),
    ).toEqual({ step: "password" });
    const finished = await owner.post(`/api/v1/instance/identity-providers/${draft.id}/complete-setup`);
    expect(finished.json()).toMatchObject({ id: draft.id, setupComplete: true });
    expect(
      (
        await new TestClient(test.app).post("/api/v1/auth/sign-in/discover", { email: "a@draft.test" })
      ).json(),
    ).toMatchObject({ step: "provider", providerId: draft.id });
    await owner.delete(`/api/v1/instance/identity-providers/${draft.id}`);

    const other = (
      await owner.post("/api/v1/instance/identity-provider-drafts", {
        type: "ldap",
        preset: "activeDirectory",
        name: "Directory draft",
      })
    ).json();
    expect(other.redirectUri).toBe(`${TEST_ORIGIN}/sign-in`);
    expect((await owner.delete(`/api/v1/instance/identity-provider-drafts/${other.id}`)).statusCode).toBe(
      204,
    );
    expect((await owner.get(`/api/v1/instance/identity-provider-drafts/${other.id}`)).statusCode).toBe(404);
    expect(
      (
        await owner.post("/api/v1/instance/identity-provider-drafts", {
          type: "ldap",
          preset: "google",
          name: "Wrong kind",
        })
      ).json(),
    ).toMatchObject({ code: "invalidProviderConfiguration" });
  });

  it("lets an administrator choose the credential in use and return to the newest", async () => {
    const original = (await owner.get(`/api/v1/instance/identity-providers/${providerId}`)).json()
      .credentials[0] as { id: string };
    const added = await owner.post(`/api/v1/instance/identity-providers/${providerId}/credentials`, {
      kind: "clientSecret",
      secret: idp.clientSecret,
      expiresAt: null,
    });
    expect(added.statusCode).toBe(201);
    const inUse = (body: { credentials: { id: string; inUse: boolean }[] }) =>
      body.credentials.filter((credential) => credential.inUse).map((credential) => credential.id);
    expect(inUse((await owner.get(`/api/v1/instance/identity-providers/${providerId}`)).json())).toEqual([
      added.json().id,
    ]);
    const chosen = await owner.put(
      `/api/v1/instance/identity-providers/${providerId}/credentials/${original.id}/use`,
      { use: "this" },
    );
    expect(chosen.statusCode).toBe(200);
    expect(inUse(chosen.json())).toEqual([original.id]);
    const member = await createAccount(test, "credential.viewer@lunedo.test");
    const client = await signedInClient(test, member.email, member.password);
    expect(
      (
        await client.put(`/api/v1/instance/identity-providers/${providerId}/credentials/${original.id}/use`, {
          use: "newest",
        })
      ).statusCode,
    ).toBe(403);
    const automatic = await owner.put(
      `/api/v1/instance/identity-providers/${providerId}/credentials/${original.id}/use`,
      { use: "newest" },
    );
    expect(inUse(automatic.json())).toEqual([added.json().id]);
    await owner.delete(`/api/v1/instance/identity-providers/${providerId}/credentials/${added.json().id}`);
  });

  it("signs a new person in through the browser flow and sends them back", async () => {
    const browser = new TestClient(test.app);
    const response = await signInThroughProvider(browser, {
      sub: "new-person",
      email: "new.person@lunedo.test",
      name: "New Person",
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/");
    const session = await browser.get("/api/v1/auth/session");
    expect(session.json()).toMatchObject({
      sessionKind: "full",
      account: { email: "new.person@lunedo.test" },
    });
    expect(String(response.headers["set-cookie"])).toContain(
      `__Host-lunedo-last-provider=${providerId}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`,
    );
    expect((await browser.get("/api/v1/auth/sign-in-options")).json()).toMatchObject({
      lastProvider: { id: providerId, name: "Company login" },
    });

    const withoutFlow = new TestClient(test.app);
    const started = await browser.post(`/api/v1/auth/providers/${providerId}/start`, {});
    const callback = await idp.authorize(started.json().url, {
      sub: "new-person",
      email: "new.person@lunedo.test",
    });
    const stolen = await withoutFlow.get(`${callback.pathname}${callback.search}`);
    expect(stolen.headers.location).toBe("/sign-in?error=challengeExpired");
  });

  it("tells only sign-in administrators that providers are not checked strictly", async () => {
    const security = await owner.get("/api/v1/instance/sign-in-security");
    expect(security.statusCode).toBe(200);
    expect(security.json()).toEqual({ insecureIdentityProviders: true });
    const person = new TestClient(test.app);
    await signInThroughProvider(person, { sub: "security-reader", email: "reader@lunedo.test" });
    expect((await person.get("/api/v1/instance/sign-in-security")).statusCode).toBe(403);
    const withheld = await person.get("/api/v1/account/withheld-roles");
    expect(withheld.statusCode).toBe(200);
    expect(withheld.json()).toEqual([]);
  });

  it("sends people to the second factor of Lunedo when the provider asks for it", async () => {
    const created = await owner.post("/api/v1/instance/identity-providers", {
      type: "oidc",
      name: "Second factor login",
      config: {
        preset: "generic",
        issuer: idp.issuer,
        clientId: idp.clientId,
        domains: ["factor.lunedo.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
        secondFactor: { mode: "lunedo" },
      },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    expect(created.json().provider.config.secondFactor).toEqual({ mode: "lunedo", proofValues: ["mfa"] });
    const factorProvider = created.json().provider.id;
    const signInOnce = async (client: TestClient) => {
      const started = await client.post(`/api/v1/auth/providers/${factorProvider}/start`, {
        returnTo: "/settings/security",
      });
      const callback = await idp.authorize(started.json().url, {
        sub: "factor-person",
        email: "person@factor.lunedo.test",
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
    expect(String(response.headers["set-cookie"])).toContain("__Host-lunedo-pending=");
    expect((await second.get("/api/v1/auth/session")).statusCode).toBe(401);
    const refused = await owner.delete(`/api/v1/instance/identity-providers/${factorProvider}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "providerHasAccounts", accounts: 1 });
    expect(
      (await owner.post(`/api/v1/instance/identity-providers/${factorProvider}/deactivate`, {})).statusCode,
    ).toBe(200);
  });

  it("ends provider sessions through back-channel logout without a browser", async () => {
    const browser = new TestClient(test.app);
    await signInThroughProvider(browser, {
      sub: "logout-person",
      sid: "idp-session-1",
      email: "logout@lunedo.test",
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
    const existing = await createAccount(test, "existing.person@lunedo.test");
    const browser = new TestClient(test.app);
    const response = await signInThroughProvider(browser, { sub: "existing-subject", email: existing.email });
    expect(response.headers.location).toBe("/sign-in/link");
    expect([response.headers["set-cookie"]].flat()).toContainEqual(
      expect.stringMatching(/^__Host-lunedo-link=[\w-]+; Path=\/; Max-Age=900; /),
    );
    expect((await browser.get("/api/v1/auth/link")).json()).toMatchObject({
      providerName: "Company login",
      email: existing.email,
      factors: [],
    });
    expect((await browser.get("/api/v1/auth/link")).json()).toMatchObject({
      password: true,
      passkey: false,
      providers: [],
      confirmed: false,
    });
    expect((await browser.post("/api/v1/auth/link", {})).json()).toMatchObject({
      code: "invalidCredentials",
    });
    expect((await browser.post("/api/v1/auth/link/provider", { providerId })).json()).toMatchObject({
      code: "notFound",
    });
    expect(
      (await browser.post("/api/v1/auth/link/directory", { providerId, password: "secret" })).json(),
    ).toMatchObject({ code: "invalidInput" });
    expect((await browser.post("/api/v1/auth/link", { password: "wrong password" })).statusCode).toBe(401);
    const linked = await browser.post("/api/v1/auth/link", { password: existing.password });
    expect(linked.json()).toMatchObject({ status: "signedIn", account: { id: existing.id } });
    expect((await browser.get("/api/v1/account/identities")).json()).toEqual([
      expect.objectContaining({ providerId, subject: "existing-subject" }),
    ]);
    const identities = await owner.get(`/api/v1/accounts/${existing.id}/identities`);
    expect(identities.json()).toHaveLength(1);
  });

  it("checks the discovery document of an issuer before anything is saved", async () => {
    const check = (issuer: string) =>
      owner.post("/api/v1/instance/identity-provider-connection-checks", {
        type: "oidc",
        config: { preset: "generic", issuer, clientId: "check", domains: [] },
      });
    expect((await check(idp.issuer)).json()).toMatchObject({ ok: true, check: "discovery", status: 200 });
    const wrong = (await check(`${idp.issuer}/realms/wrong`)).json();
    expect(wrong).toMatchObject({
      ok: false,
      status: 404,
      problem: "status",
      url: `${idp.issuer}/realms/wrong/.well-known/openid-configuration`,
    });
    const before = await test.runtime.pool.query("select count(*)::int as count from identity_providers");
    await check(idp.issuer);
    expect(
      (await test.runtime.pool.query("select count(*)::int as count from identity_providers")).rows,
    ).toEqual(before.rows);
  });

  it("names the provider of a refused sign-in so the page can offer a retry", async () => {
    const response = await signInThroughProvider(new TestClient(test.app), {
      sub: "foreign-subject",
      email: "someone@foreign.test",
    });
    const refused = new URL(String(response.headers.location), "https://lunedo.test");
    expect(refused.pathname).toBe("/sign-in/refused");
    expect(refused.searchParams.get("reason")).toBe("domainNotAllowed");
    expect(refused.searchParams.get("provider")).toBe(providerId);
  });

  it("lets a person decline a link after a wrong password", async () => {
    const existing = await createAccount(test, "declining.person@lunedo.test");
    const browser = new TestClient(test.app);
    await signInThroughProvider(browser, { sub: "declining-subject", email: existing.email });
    expect((await browser.post("/api/v1/auth/link", { password: "wrong password" })).statusCode).toBe(401);
    const declined = await browser.post("/api/v1/auth/link/decline");
    expect(declined.statusCode).toBe(200);
    expect(declined.json().reference).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("answers the same for known and unknown addresses and limits the questions per client", async () => {
    const known = await createAccount(test, "known.person@other.test");
    const client = new TestClient(test.app, { remoteAddress: "198.51.100.41" });
    for (const domain of ["other.test", "lunedo.test"]) {
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

  it("refuses the removed password sign-in setting at every level", async () => {
    for (const path of [
      "/api/v1/instance/settings/auth.passwordSignIn",
      `/api/v1/organizations/${organizationId}/settings/auth.passwordSignIn`,
    ]) {
      const refused = await owner.put(path, { value: false });
      expect(refused.statusCode).toBe(404);
    }
    const listed = await owner.get("/api/v1/instance/settings");
    expect(listed.body).not.toContain("auth.passwordSignIn");
    const visitor = new TestClient(test.app, { remoteAddress: "198.51.100.43" });
    expect(
      (await visitor.post("/api/v1/auth/sign-in/discover", { email: "someone@other.test" })).json(),
    ).toEqual({ step: "password" });
  });

  it("answers provider failures and invalid profile values with a problem or a reference", async () => {
    const unreachable = await owner.post("/api/v1/instance/identity-providers", {
      type: "oidc",
      name: "Unreachable login",
      config: {
        preset: "generic",
        issuer: "http://127.0.0.1:9/realms/gone",
        clientId: "lunedo",
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
      email: "long.name@lunedo.test",
      name: "x".repeat(300),
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toMatch(/^\/sign-in\/refused\?reference=/);
  });
});
