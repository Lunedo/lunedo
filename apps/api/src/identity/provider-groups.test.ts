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
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("mapping rules and synchronization through the API", () => {
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
        domains: ["groups.lunedo.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
        claims: {
          email: "email",
          signInName: "preferred_username",
          displayName: "name",
          groups: "groups",
          groupNames: "group_names",
        },
      },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    expect(created.statusCode).toBe(201);
    providerId = created.json().provider.id;
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  const base = () => `/api/v1/instance/identity-providers/${providerId}`;

  it("manages rules, shows who gains access and grants it at sign-in", async () => {
    const created = await owner.post(`${base()}/mapping-rules`, {
      target: "organization",
      group: { id: "engineering-id", name: "Engineering" },
      organizationId,
      role: null,
      synchronizedGroup: true,
      homeOrganization: true,
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule).toMatchObject({
      group: { id: "engineering-id", name: "Engineering", missing: false },
      organization: { id: organizationId },
      homeOrganization: true,
      accounts: 0,
    });
    expect(rule.synchronizedGroup.name).toBe("Engineering");

    const person = new TestClient(test.app);
    const started = await person.post(`/api/v1/auth/providers/${providerId}/start`, {});
    const callback = await idp.authorize(started.json().url, {
      sub: "grace-subject",
      email: "grace@groups.lunedo.test",
      name: "Grace",
      groups: ["engineering-id"],
      group_names: ["Engineering"],
    });
    expect((await person.get(`${callback.pathname}${callback.search}`)).statusCode).toBe(303);
    const session = (await person.get("/api/v1/auth/session")).json();
    expect(session.sessionKind).toBe("full");

    expect((await owner.get(`${base()}/group-preview?group=engineering-id`)).json()).toMatchObject({
      accounts: 1,
      members: null,
      sample: [{ name: "Grace" }],
    });
    expect((await owner.get(`${base()}/groups?q=engin`)).json()).toEqual([
      { id: "engineering-id", name: "Engineering", members: null, accounts: 1, mapped: true },
    ]);

    const group = (await owner.get(`/api/v1/groups/${rule.synchronizedGroup.id}`)).json();
    expect(group.managedBy).toEqual({ providerId, providerName: "Company login" });
    const members = await owner.post(`/api/v1/groups/${rule.synchronizedGroup.id}/members`, {
      accountId: session.account.id,
    });
    expect(members.statusCode).toBe(409);
    expect(members.json()).toMatchObject({ code: "groupManagedByProvider" });

    const second = await owner.post(`${base()}/mapping-rules`, {
      target: "instance",
      group: { id: "auditors-id", name: "Auditors" },
      role: { builtIn: "securityAuditor" },
    });
    expect(second.statusCode).toBe(201);
    const order = await owner.put(`${base()}/mapping-rule-order`, {
      ruleIds: [second.json().id, rule.id],
    });
    expect(order.json().map((entry: { id: string }) => entry.id)).toEqual([second.json().id, rule.id]);
    expect((await owner.delete(`${base()}/mapping-rules/${second.json().id}`)).statusCode).toBe(204);
  });

  it("keeps rules to people who may manage sign-in and grant the access", async () => {
    const member = await createAccount(test, "rule-member@lunedo.test", undefined, organizationId);
    const client = await signedInClient(test, member.email, member.password);
    const refused = await client.post(`${base()}/mapping-rules`, {
      target: "organization",
      group: { id: "any", name: null },
      organizationId,
      role: { builtIn: "owner" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    expect(refused.statusCode).toBe(403);
    expect((await client.get(`${base()}/mapping-rules`)).statusCode).toBe(403);
  });

  it("explains that a provider without a directory updates at sign-in", async () => {
    const response = await owner.post(`${base()}/sync`, {});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "syncUnavailable" });
    expect((await owner.get(`${base()}/sync-runs`)).json()).toEqual({ items: [], nextCursor: null });
  });
});
