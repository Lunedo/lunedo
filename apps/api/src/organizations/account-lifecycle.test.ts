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

describe.skipIf(!databaseBaseUrl)("account lifecycle through the API", () => {
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

  it("creates a placeholder, lists it by state and merges it into an account", async () => {
    const created = await owner.post("/api/v1/instance/accounts/placeholders", {
      name: "Imported Author",
      email: "imported.author@example.org",
    });
    expect(created.statusCode).toBe(201);
    const placeholderId = created.json().id;
    const listed = (await owner.get("/api/v1/instance/accounts?state=placeholder")).json();
    expect(listed.items.map((item: { id: string }) => item.id)).toContain(placeholderId);
    expect(
      (
        await owner.post("/api/v1/instance/accounts/placeholders", {
          name: "Again",
          email: "IMPORTED.author@example.org",
        })
      ).json(),
    ).toMatchObject({ code: "emailInUse" });

    const target = await createAccount(test, "real.author@example.org");
    const merged = await owner.post(`/api/v1/instance/accounts/${placeholderId}/merge`, {
      accountId: target.id,
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toEqual({ memberships: 0, groups: 0, roles: 0 });
    const after = (await owner.get("/api/v1/instance/accounts?state=placeholder")).json();
    expect(after.items.map((item: { id: string }) => item.id)).not.toContain(placeholderId);
  });

  it("anonymizes an account only with a recent confirmation, a session and the typed name", async () => {
    const person = await createAccount(test, "erika.example@example.org");
    const path = `/api/v1/instance/accounts/${person.id}/anonymize`;
    const wrong = await owner.post(path, { reason: "Erasure request", confirmation: "Someone" });
    expect(wrong.json()).toMatchObject({ code: "confirmationMismatch" });

    const token = (
      await owner.post("/api/v1/account/tokens", {
        name: "Automation",
        scopes: { instance: { accounts: "manage" } },
      })
    ).json().token as string;
    const byToken = await new TestClient(test.app).post(
      path,
      { reason: "Erasure request", confirmation: person.name },
      { authorization: `Bearer ${token}` },
    );
    expect(byToken.json()).toMatchObject({ code: "sessionRequired" });

    const done = await owner.post(path, { reason: "Erasure request", confirmation: person.name });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ endedSessions: 0, removedIdentities: 0, endedMemberships: 1 });
    const detail = (await owner.get(`/api/v1/instance/accounts/${person.id}`)).json();
    expect(detail.account).toMatchObject({
      state: "anonymized",
      email: null,
      name: `Former user ${person.id.slice(0, 8)}`,
    });

    const events = (await owner.get(`/api/v1/instance/audit-events?targetId=${person.id}`)).json();
    const anonymized = events.items.find((item: { name: string }) => item.name === "account.anonymized");
    expect(anonymized).toMatchObject({ target: { former: true, name: null }, formerAccounts: [person.id] });
  });

  it("changes the home organization of an account only for an organization it belongs to", async () => {
    const person = await createAccount(test, "moving.person@example.org");
    const created = await owner.post("/api/v1/organizations", {
      name: "Second organization",
      slug: "second",
    });
    const secondId = created.json().id;
    const path = `/api/v1/accounts/${person.id}/home-organization`;
    expect((await owner.put(path, { organizationId: secondId })).json()).toMatchObject({ code: "notMember" });
    await test.runtime.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values (gen_random_uuid(), $1, $2, 'member')",
      [secondId, person.id],
    );
    const stranger = await createAccount(test, "stranger@example.org");
    const strangerClient = await signedInClient(test, stranger.email, stranger.password);
    expect((await strangerClient.put(path, { organizationId: secondId })).statusCode).toBe(403);
    expect((await owner.put(path, { organizationId: secondId })).statusCode).toBe(204);
    const detail = (await owner.get(`/api/v1/instance/accounts/${person.id}`)).json();
    expect(detail.account.homeOrganizationId).toBe(secondId);
    expect(
      detail.memberships.find((entry: { organizationId: string }) => entry.organizationId === organizationId),
    ).toMatchObject({
      home: false,
    });
  });
});
