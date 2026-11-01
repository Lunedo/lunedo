import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  tokenMaxLifetimeSetting,
  tokenRequestsPerMinuteSetting,
} from "@lunedo/server";
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

const DAY_MS = 24 * 60 * 60 * 1000;

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe.skipIf(!databaseBaseUrl)("API tokens and service accounts through the API", () => {
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

  async function member(email: string) {
    const account = await createAccount(test, email);
    return { account, client: await signedInClient(test, account.email, account.password) };
  }

  async function personalToken(client: TestClient, scopes: object, extra: object = {}) {
    const response = await client.post("/api/v1/account/tokens", { name: "Script", scopes, ...extra });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as {
      token: string;
      apiToken: { id: string; prefix: string; expiresAt: string | null };
    };
  }

  async function customRole(name: string, areas: object) {
    const response = await owner.post(`/api/v1/organizations/${organizationId}/roles`, { name, areas });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  }

  async function assign(client: TestClient, roleId: string, accountId: string) {
    const response = await client.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { customRoleId: roleId },
      principal: { kind: "account", id: accountId },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  }

  it("lets a service account act within its scopes and its own roles, whoever created it", async () => {
    const { account: creator, client: creatorClient } = await member("integrator@lunedo.test");
    const integrator = await customRole("Integrator", {
      integrationsAndApi: "manage",
      membersAndGroups: "manage",
    });
    const creatorAssignment = await assign(owner, integrator, creator.id);

    const created = await creatorClient.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: "Directory bot",
      description: "Keeps groups in sync",
    });
    expect(created.statusCode, created.body).toBe(201);
    const serviceAccount = created.json();
    expect(serviceAccount).toMatchObject({
      name: "Directory bot",
      responsibleAccountIds: [creator.id],
      unattended: false,
    });

    const directory = await customRole("Directory", { membersAndGroups: "manage", settings: "view" });
    const beyondCreator = await creatorClient.post(
      `/api/v1/organizations/${organizationId}/role-assignments`,
      {
        role: { customRoleId: directory },
        principal: { kind: "account", id: serviceAccount.id },
      },
    );
    expect(beyondCreator.json()).toMatchObject({ code: "forbidden", denials: ["roleExceedsOwnPermissions"] });
    await assign(owner, directory, serviceAccount.id);

    expect(
      (await creatorClient.get(`/api/v1/service-accounts/${serviceAccount.id}/tokens/lifetime`)).json(),
    ).toEqual({ maxLifetimeDays: null });
    const tokenResponse = await creatorClient.post(`/api/v1/service-accounts/${serviceAccount.id}/tokens`, {
      name: "Sync job",
      scopes: { organization: { membersAndGroups: "manage" } },
    });
    expect(tokenResponse.statusCode, tokenResponse.body).toBe(201);
    const { token } = tokenResponse.json();
    expect(token).toMatch(/^ld_[0-9A-Za-z]{49}$/);

    const bot = new TestClient(test.app);
    expect((await bot.get(`/api/v1/organizations/${organizationId}/members`, bearer(token))).statusCode).toBe(
      200,
    );
    const group = await bot.post(
      `/api/v1/organizations/${organizationId}/groups`,
      { name: "Synced" },
      bearer(token),
    );
    expect(group.statusCode, group.body).toBe(201);

    const settings = await bot.get(`/api/v1/organizations/${organizationId}/settings`, bearer(token));
    expect(settings.statusCode).toBe(403);
    expect(settings.json()).toMatchObject({ code: "forbidden", denials: ["tokenScope"] });

    const other = await owner.post("/api/v1/organizations", { name: "Elsewhere" });
    expect((await bot.get(`/api/v1/organizations/${other.json().id}`, bearer(token))).statusCode).toBe(404);

    expect(
      (await owner.delete(`/api/v1/organizations/${organizationId}/role-assignments/${creatorAssignment}`))
        .statusCode,
    ).toBe(204);
    const stillAllowed = await bot.post(
      `/api/v1/organizations/${organizationId}/groups`,
      { name: "Later" },
      bearer(token),
    );
    expect(stillAllowed.statusCode, stillAllowed.body).toBe(201);

    const handedOver = await owner.patch(`/api/v1/service-accounts/${serviceAccount.id}`, {
      responsibleAccountIds: [],
    });
    expect(handedOver.json()).toMatchObject({ responsibleAccountIds: [], unattended: true });
    const listed = await owner.get(`/api/v1/organizations/${organizationId}/service-accounts`);
    expect(listed.json().items).toEqual([
      expect.objectContaining({ id: serviceAccount.id, unattended: true }),
    ]);
    const outsider = await owner.patch(`/api/v1/service-accounts/${serviceAccount.id}`, {
      responsibleAccountIds: [other.json().id],
    });
    expect(outsider.json()).toMatchObject({ code: "invalidResponsible" });

    const deactivated = await owner.post(`/api/v1/service-accounts/${serviceAccount.id}/deactivate`);
    expect(deactivated.json()).toEqual({ revokedTokens: 1 });
    const afterwards = await bot.get(`/api/v1/organizations/${organizationId}/members`, bearer(token));
    expect(afterwards.statusCode).toBe(401);
    expect(afterwards.json()).toMatchObject({ type: "urn:lunedo:problem:invalidApiToken" });
  });

  it("creates a service account token only for spaces the creator can reach with the same role", async () => {
    const { account: creator, client: creatorClient } = await member("integrations-only@lunedo.test");
    await assign(owner, await customRole("Integrations only", { integrationsAndApi: "manage" }), creator.id);
    const created = await creatorClient.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: "Board sync",
      description: "Reads the board space",
    });
    expect(created.statusCode, created.body).toBe(201);
    const serviceAccountId = created.json().id as string;
    const board = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: "Board",
      key: "BRDSYNC",
      visibility: "private",
      grants: [{ principalKind: "account", principalId: serviceAccountId, role: "editor" }],
    });
    expect(board.statusCode, board.body).toBe(201);
    const boardId = board.json().id as string;
    const create = (body: object) =>
      creatorClient.post(`/api/v1/service-accounts/${serviceAccountId}/tokens`, { name: "Board", ...body });

    const hidden = await create({ scopes: { organization: { spaces: "view" } } });
    expect(hidden.statusCode, hidden.body).toBe(403);
    expect(hidden.json()).toMatchObject({ code: "forbidden", denials: ["roleExceedsOwnPermissions"] });

    const grant = await owner.post(`/api/v1/spaces/${boardId}/permissions/grants`, {
      holders: [{ principalKind: "account", principalId: creator.id }],
      role: "reader",
    });
    expect(grant.statusCode, grant.body).toBeLessThan(300);
    const reading = await create({ scopes: { organization: { spaces: "view" } } });
    expect(reading.statusCode, reading.body).toBe(201);

    const writing = await create({ scopes: { organization: { spaces: "manage" } }, contentLevel: "publish" });
    expect(writing.statusCode, writing.body).toBe(403);
    expect(writing.json()).toMatchObject({ denials: ["roleExceedsOwnPermissions"] });
    const readOnly = await create({ scopes: { organization: { spaces: "manage" } }, contentLevel: "read" });
    expect(readOnly.statusCode, readOnly.body).toBe(201);
    const raised = await creatorClient.put(
      `/api/v1/service-accounts/${serviceAccountId}/tokens/${readOnly.json().apiToken.id}/content-access`,
      { contentLevel: "publish", knowledgeBaseIds: null },
    );
    expect(raised.statusCode, raised.body).toBe(403);
    expect(raised.json()).toMatchObject({ denials: ["roleExceedsOwnPermissions"] });
  });

  it("refuses a service account token that reaches pages through shares or restriction lists beyond its creator", async () => {
    const { account: creator, client: creatorClient } = await member("page-reach@lunedo.test");
    await assign(
      owner,
      await customRole("Integrations for pages", { integrationsAndApi: "manage" }),
      creator.id,
    );
    const created = await creatorClient.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: "Page sync",
      description: "Reads shared pages",
    });
    expect(created.statusCode, created.body).toBe(201);
    const serviceAccountId = created.json().id as string;
    const create = () =>
      creatorClient.post(`/api/v1/service-accounts/${serviceAccountId}/tokens`, {
        name: "Pages",
        scopes: { organization: { spaces: "view" } },
      });
    const newSpace = async (key: string, grants: object[]) => {
      const response = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: key,
        key,
        visibility: "private",
        grants,
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().id as string;
    };
    const newPage = async (spaceId: string, title: string) => {
      const response = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title,
        parentId: null,
        mode: "live",
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().id as string;
    };
    const access = async (pageId: string, changes: object[]) => {
      const response = await owner.post(`/api/v1/pages/${pageId}/access`, { changes });
      expect(response.statusCode, response.body).toBe(200);
    };

    const hidden = await newSpace("SHRPRV", []);
    const shared = await newPage(hidden, "Supplier contracts");
    await access(shared, [
      { action: "share", holderKind: "account", holderId: serviceAccountId, role: "reader" },
    ]);
    const viaShare = await create();
    expect(viaShare.statusCode, viaShare.body).toBe(403);
    expect(viaShare.json()).toMatchObject({ denials: ["roleExceedsOwnPermissions"] });
    await access(shared, [{ action: "share", holderKind: "account", holderId: creator.id, role: "reader" }]);
    expect((await create()).statusCode).toBe(201);

    const team = await newSpace("RSTPRV", [
      { principalKind: "account", principalId: serviceAccountId, role: "reader" },
      { principalKind: "account", principalId: creator.id, role: "reader" },
    ]);
    const restricted = await newPage(team, "Salary bands");
    await access(restricted, [
      { action: "restrict", kind: "view" },
      { action: "share", holderKind: "account", holderId: serviceAccountId, role: "reader" },
    ]);
    const viaList = await create();
    expect(viaList.statusCode, viaList.body).toBe(403);
    expect(viaList.json()).toMatchObject({ denials: ["roleExceedsOwnPermissions"] });
  });

  it("keeps a token limited to knowledge bases out of the organization's spaces list and trash", async () => {
    const help = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: "Help",
      key: "HLPKBT",
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(help.statusCode, help.body).toBe(201);
    const wiki = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: "Team wiki",
      key: "WIKKBT",
      visibility: "organization",
      grants: [],
    });
    expect(wiki.statusCode, wiki.body).toBe(201);
    const page = await owner.post(`/api/v1/spaces/${wiki.json().id}/items`, {
      kind: "page",
      title: "Old travel policy",
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    expect((await owner.delete(`/api/v1/items/${page.json().id}`)).statusCode).toBeLessThan(300);
    const trash = await owner.get(`/api/v1/organizations/${organizationId}/trash`);
    const entry = (trash.json() as { id: string; title: string }[]).find(
      (item) => item.title === "Old travel policy",
    );
    expect(entry).toBeDefined();
    const { token } = await personalToken(
      owner,
      { organization: { spaces: "manage" } },
      { organizationId, contentLevel: "publish", knowledgeBaseIds: [help.json().id] },
    );

    const bot = new TestClient(test.app);
    expect((await bot.get(`/api/v1/spaces/${help.json().id}`, bearer(token))).statusCode).toBe(200);
    for (const path of [
      `/organizations/${organizationId}/trash`,
      `/organizations/${organizationId}/spaces`,
    ]) {
      const response = await bot.get(`/api/v1${path}`, bearer(token));
      expect(response.statusCode, path).toBe(403);
      expect(response.json()).toMatchObject({ denials: ["tokenScope"] });
    }
    const restore = await bot.post(
      `/api/v1/organizations/${organizationId}/trash/${entry?.id}/restore`,
      undefined,
      bearer(token),
    );
    expect(restore.statusCode).toBe(403);
    expect((await owner.get(`/api/v1/items/${page.json().id}`)).statusCode).toBe(404);
  });

  it("refuses service account management without the integrations area", async () => {
    const { client } = await member("no.integrations@lunedo.test");
    const response = await client.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: "Nope",
    });
    expect(response.statusCode).toBe(403);
  });

  it("shows a personal token once and lists it without the secret", async () => {
    const { client } = await member("lister@lunedo.test");
    const { token, apiToken } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    expect(apiToken.prefix).toBe(token.slice(0, 9));
    expect(apiToken.expiresAt).toBeNull();
    const listed = await client.get("/api/v1/account/tokens");
    expect(listed.json().items).toHaveLength(1);
    expect(listed.body).not.toContain(token);

    const scriptClient = new TestClient(test.app);
    expect(
      (await scriptClient.get(`/api/v1/organizations/${organizationId}/members`, bearer(token))).statusCode,
    ).toBe(200);
    const used = (await client.get("/api/v1/account/tokens")).json().items[0];
    expect(used.lastUsedAt).not.toBeNull();
    expect(used.lastUsedIp).toBe("198.51.100.10");
  });

  it("stops a personal token at expiry", async () => {
    const { client } = await member("expiry@lunedo.test");
    const { token, apiToken } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const script = new TestClient(test.app);
    const url = `/api/v1/organizations/${organizationId}/members`;
    expect((await script.get(url, bearer(token))).statusCode).toBe(200);
    await test.runtime.pool.query(
      "update api_tokens set expires_at = now() - interval '1 second' where id = $1",
      [apiToken.id],
    );
    const expired = await script.get(url, bearer(token));
    expect(expired.statusCode).toBe(401);
    expect(expired.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
  });

  it("stops a personal token on revocation", async () => {
    const { client } = await member("revoke@lunedo.test");
    const { token, apiToken } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const script = new TestClient(test.app);
    const url = `/api/v1/organizations/${organizationId}/members`;
    expect((await script.get(url, bearer(token))).statusCode).toBe(200);
    expect((await client.delete(`/api/v1/account/tokens/${apiToken.id}`)).statusCode).toBe(204);
    expect((await script.get(url, bearer(token))).statusCode).toBe(401);
    expect((await client.delete(`/api/v1/account/tokens/${apiToken.id}`)).statusCode).toBe(404);
  });

  it("stops a personal token on deactivation", async () => {
    const { account, client } = await member("deactivate@lunedo.test");
    const { token } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const script = new TestClient(test.app);
    const url = `/api/v1/organizations/${organizationId}/members`;
    expect((await script.get(url, bearer(token))).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/accounts/${account.id}/deactivate`)).statusCode).toBe(200);
    expect((await script.get(url, bearer(token))).statusCode).toBe(401);
  });

  it("lets owners rename tokens, but not the tokens of others", async () => {
    const { client } = await member("rename@lunedo.test");
    const { client: stranger } = await member("stranger@lunedo.test");
    const { apiToken } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const renamed = await client.patch(`/api/v1/account/tokens/${apiToken.id}`, { name: "Nightly export" });
    expect(renamed.json()).toMatchObject({ name: "Nightly export" });
    expect((await stranger.patch(`/api/v1/account/tokens/${apiToken.id}`, { name: "Mine" })).statusCode).toBe(
      404,
    );
    expect((await stranger.delete(`/api/v1/account/tokens/${apiToken.id}`)).statusCode).toBe(404);
  });

  it("validates expiry and scopes", async () => {
    const { client } = await member("validation@lunedo.test");
    const post = (body: object) => client.post("/api/v1/account/tokens", { name: "Bad", ...body });
    const scopes = { organization: { membersAndGroups: "view" } };
    expect((await client.get("/api/v1/account/tokens/lifetime")).json()).toEqual({ maxLifetimeDays: null });
    const unlimited = await post({ scopes, expiresAt: null });
    expect(unlimited.statusCode, unlimited.body).toBe(201);
    expect(unlimited.json().apiToken.expiresAt).toBeNull();

    await test.runtime.settings.set(tokenMaxLifetimeSetting, {}, "instance", 365);
    try {
      expect((await client.get("/api/v1/account/tokens/lifetime")).json()).toEqual({ maxLifetimeDays: 365 });
      expect((await post({ scopes, expiresAt: null })).json()).toMatchObject({
        code: "expiryRequired",
        maxLifetimeDays: 365,
      });
      expect(
        (await post({ scopes, expiresAt: new Date(Date.now() + 400 * DAY_MS).toISOString() })).json(),
      ).toMatchObject({ code: "expiryTooLate", maxLifetimeDays: 365 });
    } finally {
      await test.runtime.settings.clear(tokenMaxLifetimeSetting, {}, "instance");
    }
    expect((await post({ scopes: { organization: { membersAndGroups: "edit" } } })).statusCode).toBe(400);
    expect((await post({ scopes: {} })).statusCode).toBe(400);
  });

  it("accepts tokens only in the Authorization header and never together with a session", async () => {
    const { client } = await member("header@lunedo.test");
    const { token } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const url = `/api/v1/organizations/${organizationId}/members`;
    const both = await client.get(url, bearer(token));
    expect(both.statusCode).toBe(400);
    expect(both.json()).toMatchObject({ code: "ambiguousCredentials" });
    const query = await new TestClient(test.app).get(`${url}?access_token=${token}`);
    expect(query.statusCode).toBe(401);
    expect(query.json()).toMatchObject({ code: "notSignedIn" });
    const malformed = await new TestClient(test.app).get(
      url,
      bearer(`${token.slice(0, -1)}${token.endsWith("x") ? "y" : "x"}`),
    );
    expect(malformed.statusCode).toBe(401);
    const unknownScheme = await new TestClient(test.app).get(url, { authorization: `Basic ${token}` });
    expect(unknownScheme.statusCode).toBe(401);
  });

  it("refuses tokens on session routes and on routes that need recent authentication", async () => {
    const { client } = await member("session.only@lunedo.test");
    const { token } = await personalToken(client, { organization: { membersAndGroups: "manage" } });
    const script = new TestClient(test.app);
    const listed = await script.get("/api/v1/account/tokens", bearer(token));
    expect(listed.statusCode).toBe(403);
    expect(listed.json()).toMatchObject({ code: "sessionRequired" });
    const created = await script.post("/api/v1/account/tokens", { name: "Copy", scopes: {} }, bearer(token));
    expect(created.json()).toMatchObject({ code: "sessionRequired" });
    expect(
      (await script.get(`/api/v1/organizations/${organizationId}/api-tokens`, bearer(token))).statusCode,
    ).toBe(403);
  });

  it("exempts token requests from the cross-site check, but not session requests", async () => {
    const { token } = await personalToken(owner, { organization: { membersAndGroups: "manage" } });
    const url = `/api/v1/organizations/${organizationId}/groups`;
    const withToken = await test.app.inject({
      method: "POST",
      url,
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: { name: "Created by a script" },
    });
    expect(withToken.statusCode, withToken.body).toBe(201);
    const cookie = [...owner.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const withSession = await test.app.inject({
      method: "POST",
      url,
      headers: { cookie, "content-type": "application/json", origin: TEST_ORIGIN },
      payload: { name: "Created cross-site" },
    });
    expect(withSession.statusCode).toBe(403);
    expect(withSession.json()).toMatchObject({ code: "csrfRejected" });
    expect(withSession.headers["content-type"]).toContain("application/problem+json");
  });

  it("limits the requests per token", async () => {
    const { client } = await member("busy@lunedo.test");
    const { token } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const { token: other } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    await test.runtime.settings.set(tokenRequestsPerMinuteSetting, {}, "instance", 2);
    try {
      const script = new TestClient(test.app);
      const url = `/api/v1/organizations/${organizationId}/members`;
      expect((await script.get(url, bearer(token))).statusCode).toBe(200);
      expect((await script.get(url, bearer(token))).statusCode).toBe(200);
      const limited = await script.get(url, bearer(token));
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect((await script.get(url, bearer(other))).statusCode).toBe(200);
    } finally {
      await test.runtime.settings.set(tokenRequestsPerMinuteSetting, {}, "instance", 600);
    }
  });

  it("lets holders of the integrations area list and revoke all tokens of the organization", async () => {
    const { account, client } = await member("member.token@lunedo.test");
    const { token, apiToken } = await personalToken(client, { organization: { membersAndGroups: "view" } });
    const listed = await owner.get(`/api/v1/organizations/${organizationId}/api-tokens?limit=200`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toContain(apiToken.id);
    expect((await client.get(`/api/v1/organizations/${organizationId}/api-tokens`)).statusCode).toBe(403);
    expect(
      (await owner.delete(`/api/v1/organizations/${organizationId}/api-tokens/${apiToken.id}`)).statusCode,
    ).toBe(204);
    expect(
      (await new TestClient(test.app).get(`/api/v1/organizations/${organizationId}/members`, bearer(token)))
        .statusCode,
    ).toBe(401);
    const events = await test.runtime.pool.query<{ name: string; actor_id: string }>(
      "select name, actor_id from audit_events where target_id = $1 order by occurred_at, sequence",
      [apiToken.id],
    );
    expect(events.rows.map((row) => row.name)).toEqual([
      "apiToken.created",
      "apiToken.revoked",
      "apiToken.rejected",
    ]);
    expect(events.rows[0]?.actor_id).toBe(account.id);
  });
});
