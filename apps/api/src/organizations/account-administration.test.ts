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

describe.skipIf(!databaseBaseUrl)("account administration", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function member(email: string) {
    const account = await createAccount(test, email);
    await test.runtime.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values (gen_random_uuid(), $1, $2, 'member') on conflict do nothing",
      [organizationId, account.id],
    );
    return { account, client: await signedInClient(test, account.email, account.password) };
  }

  it("lists accounts with roles, second factors and last sign-in, searchable by name and e-mail", async () => {
    await member("ada.lovelace@example.org");
    const list = await owner.get("/api/v1/instance/accounts?q=LOVELACE");
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([
      expect.objectContaining({
        email: "ada.lovelace@example.org",
        twoFactorActive: false,
        instanceRoles: [],
        lastSignInAt: expect.any(String),
      }),
    ]);
    const ownerRow = (
      await owner.get(`/api/v1/instance/accounts?q=${encodeURIComponent(OWNER.email)}`)
    ).json().items[0];
    expect(ownerRow).toMatchObject({
      id: ownerId,
      twoFactorActive: true,
      instanceRoles: [{ builtInRole: "owner", customRoleId: null, name: null }],
    });
    expect((await owner.get("/api/v1/instance/accounts?q=%25")).json().items).toEqual([]);
  });

  it("lists organizations with owners, members and domains, searchable by name", async () => {
    await owner.post(`/api/v1/organizations/${organizationId}/domains`, { domain: "listing.example" });
    const list = (await owner.get("/api/v1/instance/organizations?q=test%20org")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: organizationId,
      owners: [{ id: ownerId }],
      memberCount: expect.any(Number),
      domains: ["listing.example"],
    });
    expect(list.items[0].memberCount).toBeGreaterThanOrEqual(1);
    expect((await owner.get("/api/v1/instance/organizations?q=nothing-like-this")).json().items).toEqual([]);
  });

  it("searches members and groups of an organization", async () => {
    await member("grace.hopper@example.org");
    await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
      name: "Compiler team",
      description: "Builds the compilers",
    });
    const members = (await owner.get(`/api/v1/organizations/${organizationId}/members?q=hopper`)).json();
    expect(members.items.map((item: { email: string }) => item.email)).toEqual(["grace.hopper@example.org"]);
    const groups = (await owner.get(`/api/v1/organizations/${organizationId}/groups?q=compilers`)).json();
    expect(groups.items.map((item: { name: string }) => item.name)).toEqual(["Compiler team"]);
  });

  it("shows an account with memberships, roles, sessions, tokens and second factors", async () => {
    const { account, client } = await member("detail@example.org");
    await addTotp(client);
    await client.post("/api/v1/account/tokens", {
      name: "Script",
      scopes: { organization: { spaces: "view" } },
    });
    await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: account.id },
    });
    const detail = await owner.get(`/api/v1/instance/accounts/${account.id}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.account).toMatchObject({ id: account.id, twoFactorActive: true });
    expect(body.memberships).toEqual([
      expect.objectContaining({
        organizationId,
        kind: "member",
        home: true,
        roles: expect.arrayContaining([
          expect.objectContaining({ builtInRole: "administrator", via: "account" }),
          expect.objectContaining({ builtInRole: "member", via: "membership" }),
        ]),
      }),
    ]);
    expect(body.sessions).toHaveLength(1);
    expect(body.tokens.map((token: { name: string }) => token.name)).toEqual(["Script"]);
    expect(body.twoFactor).toMatchObject({ totp: true, passkeys: 0, recoveryCodes: 10 });
    expect(
      (await owner.get("/api/v1/instance/accounts/01929b1e-0000-7000-8000-000000000000")).statusCode,
    ).toBe(404);
    expect((await client.get(`/api/v1/instance/accounts/${account.id}`)).statusCode).toBe(403);
  });

  it("refuses to make a guest account a member through the organization assignment", async () => {
    const guest = await test.runtime.database.transaction((tx) =>
      test.runtime.services.accounts.create(tx, {
        type: "guest",
        email: "assigned-guest@example.org",
        name: "Guest",
        password: null,
        homeOrganizationId: null,
      }),
    );
    const response = await owner.post(`/api/v1/instance/accounts/${guest.id}/organization`, {
      organizationId,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "guestMembership" });
    const memberships = await test.runtime.pool.query("select 1 from memberships where account_id = $1", [
      guest.id,
    ]);
    expect(memberships.rowCount).toBe(0);
  });

  it("ends the sessions of another account and reactivates a deactivated one", async () => {
    const { account, client } = await member("sessions@example.org");
    const ended = await owner.post(`/api/v1/accounts/${account.id}/sessions/end`);
    expect(ended.json()).toEqual({ endedSessions: 1 });
    expect((await client.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await owner.post(`/api/v1/accounts/${ownerId}/sessions/end`)).json()).toMatchObject({
      code: "endOwnSessions",
    });
    const other = await member("not-an-admin@example.org");
    expect((await other.client.post(`/api/v1/accounts/${account.id}/sessions/end`)).statusCode).toBe(403);

    expect((await owner.post(`/api/v1/accounts/${account.id}/reactivate`)).json()).toMatchObject({
      code: "notFound",
    });
    expect((await owner.post(`/api/v1/accounts/${account.id}/deactivate`)).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/accounts/${account.id}/reactivate`)).statusCode).toBe(204);
    expect((await signedInClient(test, account.email, account.password)).cookies.size).toBeGreaterThan(0);
    const events = await test.runtime.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1 and name in ('account.sessionsEnded', 'account.reactivated') order by sequence",
      [account.id],
    );
    expect(events.rows.map((row) => row.name)).toEqual(["account.sessionsEnded", "account.reactivated"]);
  });

  it("ends a single session of another account and keeps the others", async () => {
    const { account, client } = await member("one-session@example.org");
    const second = await signedInClient(test, account.email, account.password);
    const detail = await owner.get(`/api/v1/instance/accounts/${account.id}`);
    const sessions = detail.json().sessions as { id: string }[];
    expect(sessions).toHaveLength(2);
    const [first, rest] = sessions;
    expect((await owner.post(`/api/v1/accounts/${account.id}/sessions/${first?.id}/end`)).statusCode).toBe(
      204,
    );
    const alive = [
      (await client.get("/api/v1/auth/session")).statusCode,
      (await second.get("/api/v1/auth/session")).statusCode,
    ].sort();
    expect(alive).toEqual([200, 401]);
    expect((await owner.post(`/api/v1/accounts/${account.id}/sessions/${first?.id}/end`)).statusCode).toBe(
      404,
    );
    const other = await member("other-session@example.org");
    expect(
      (await owner.post(`/api/v1/accounts/${other.account.id}/sessions/${rest?.id}/end`)).statusCode,
    ).toBe(404);
    expect(
      (await other.client.post(`/api/v1/accounts/${account.id}/sessions/${rest?.id}/end`)).statusCode,
    ).toBe(403);
    const ownSession = (await owner.get(`/api/v1/instance/accounts/${ownerId}`)).json().sessions[0]?.id;
    expect((await owner.post(`/api/v1/accounts/${ownerId}/sessions/${ownSession}/end`)).json()).toMatchObject(
      {
        code: "endOwnSessions",
      },
    );
    const activity = await owner.get(`/api/v1/instance/audit-events?personId=${account.id}&level=instance`);
    expect(activity.statusCode, activity.body).toBe(200);
    const items = activity.json().items as { name: string; scopeType: string; targetId: string }[];
    expect(items.map((item) => item.name)).toContain("account.sessionsEnded");
    expect(items.every((item) => item.scopeType === "instance" || item.targetId === account.id)).toBe(true);
  });
});
