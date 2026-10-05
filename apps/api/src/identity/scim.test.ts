import { randomUUID } from "node:crypto";
import { accountPrincipal, SYSTEM } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  firstOrganizationId,
  OWNER,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";
import {
  entraAddMembers,
  entraDisable,
  entraEnable,
  entraGroup,
  entraRemoveMembers,
  entraRenameGroup,
  entraReplaceAttributes,
  entraUser,
  testConnectionFilter,
} from "../testing/entra-scim.js";

const SCIM_JSON = "application/scim+json";
const TENANT = "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17";

describe.skipIf(!databaseBaseUrl)("SCIM provisioning", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;
  let providerId: string;
  let otherProviderId: string;
  let token: string;
  let otherToken: string;
  const domain = "contoso.example";

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    organizationId = await firstOrganizationId(test);
    const create = async (name: string, domains: string[]) =>
      (
        await test.runtime.services.identityProviders.create(SYSTEM, {
          type: "oidc",
          name,
          config: { preset: "entraId", clientId: randomUUID(), tenantId: TENANT, domains },
          credential: { kind: "clientSecret", secret: "client-secret", expiresAt: null },
        })
      ).provider.id;
    providerId = await create("Entra ID", [domain]);
    otherProviderId = await create("Other Entra ID", ["fabrikam.example"]);
    const created = await owner.post(`/api/v1/instance/identity-providers/${providerId}/scim/tokens`);
    expect(created.statusCode).toBe(201);
    token = created.json().token;
    otherToken = (
      await owner.post(`/api/v1/instance/identity-providers/${otherProviderId}/scim/tokens`)
    ).json().token;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function scim(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    options: { token?: string | null; provider?: string } = {},
  ) {
    const bearer = options.token === undefined ? token : options.token;
    return test.app.inject({
      method,
      url: `/scim/v2/${options.provider ?? providerId}${path}`,
      remoteAddress: "203.0.113.50",
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body !== undefined ? { "content-type": SCIM_JSON } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  }

  function person() {
    const objectId = randomUUID();
    const local = `p${objectId.slice(0, 8)}`;
    return {
      objectId,
      upn: `${local}@${domain}`,
      mail: `${local}@${domain}`,
      given: "Ada",
      family: "Lovelace",
    };
  }

  async function provision(input = person()) {
    const response = await scim("POST", "/Users", entraUser(input));
    expect(response.statusCode).toBe(201);
    const user = response.json();
    const account = await test.runtime.pool.query<{ account_id: string }>(
      "select account_id from identities where id = $1",
      [user.id],
    );
    return { ...input, id: user.id as string, accountId: account.rows[0]?.account_id ?? "" };
  }

  async function accountState(accountId: string) {
    const result = await test.runtime.pool.query<{ state: string }>(
      "select state from accounts where id = $1",
      [accountId],
    );
    return result.rows[0]?.state;
  }

  async function membership(accountId: string) {
    const result = await test.runtime.pool.query<{ kind: string }>(
      "select kind from memberships where account_id = $1 and organization_id = $2",
      [accountId, organizationId],
    );
    return result.rows[0]?.kind ?? null;
  }

  it("answers the connection test of Entra ID with an empty list", async () => {
    const response = await scim("GET", `/Users?filter=${encodeURIComponent(testConnectionFilter())}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(SCIM_JSON);
    expect(response.json()).toMatchObject({ totalResults: 0, Resources: [], startIndex: 1 });
  });

  it("creates a user as an account that has not signed in, finds it by userName and externalId and updates it", async () => {
    const input = person();
    const created = await scim("POST", "/Users", entraUser(input));
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toBe(
      `${configuredSetupEnv.PAGEHALL_INSTANCE_URL}/scim/v2/${providerId}/Users/${created.json().id}`,
    );
    expect(created.json()).toMatchObject({ userName: input.upn, externalId: input.objectId, active: true });
    const { id } = created.json();
    const account = (
      await test.runtime.pool.query<{
        state: string;
        email: string;
        last_sign_in_at: Date | null;
        subject: string;
      }>(
        "select a.state, a.email, a.last_sign_in_at, i.subject from identities i join accounts a on a.id = i.account_id where i.id = $1",
        [id],
      )
    ).rows[0];
    expect(account).toEqual({
      state: "active",
      email: input.mail,
      last_sign_in_at: null,
      subject: `${TENANT}:${input.objectId}`,
    });
    expect(test.mail.sent.filter((mail) => mail.to === input.mail)).toEqual([]);

    const byName = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent(`userName eq "${input.upn.toUpperCase()}"`)}`,
    );
    expect(byName.json().Resources.map((user: { id: string }) => user.id)).toEqual([id]);
    const byExternal = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent(`externalId eq "${input.objectId}"`)}`,
    );
    expect(byExternal.json().totalResults).toBe(1);
    expect((await scim("POST", "/Users", entraUser(input))).json()).toMatchObject({
      status: "409",
      scimType: "uniqueness",
    });

    const updated = await scim(
      "PATCH",
      `/Users/${id}`,
      entraReplaceAttributes(`renamed.${input.mail}`, "Byron"),
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().emails).toEqual([{ value: `renamed.${input.mail}`, type: "work", primary: true }]);
  });

  it("never grants an instance role from attributes or groups without a rule", async () => {
    const user = await provision();
    const group = await scim("POST", "/Groups", entraGroup(randomUUID(), "Global Administrators"));
    expect(group.statusCode).toBe(201);
    await scim("PATCH", `/Groups/${group.json().id}`, entraAddMembers([user.id]));
    const roles = await test.runtime.pool.query(
      "select 1 from role_assignments where principal_kind = 'account' and principal_id = $1",
      [user.accountId],
    );
    expect(roles.rowCount).toBe(0);
  });

  it("grants and withdraws access through rules when Entra ID changes group members in batches", async () => {
    const first = await provision();
    const second = await provision();
    const objectId = randomUUID();
    const created = await scim("POST", "/Groups", entraGroup(objectId, "Engineering"));
    const groupId = created.json().id;
    await test.runtime.services.mappingRules.create(accountPrincipal(ownerId), providerId, {
      target: "organization",
      group: { id: objectId, name: "Engineering" },
      organizationId,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const listed = await scim("GET", `/Groups/${groupId}?excludedAttributes=members`);
    expect(listed.json().members).toBeUndefined();
    const found = await scim(
      "GET",
      `/Groups?excludedAttributes=members&filter=${encodeURIComponent('displayName eq "Engineering"')}`,
    );
    expect(found.json().Resources.map((group: { id: string }) => group.id)).toContain(groupId);

    const added = await scim(
      "PATCH",
      `/Groups/${groupId}`,
      entraAddMembers([first.id, second.id, randomUUID()]),
    );
    expect(added.statusCode).toBe(200);
    expect(
      added
        .json()
        .members.map((member: { value: string }) => member.value)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    expect(await membership(first.accountId)).toBe("member");
    expect(await membership(second.accountId)).toBe("member");

    await scim("PATCH", `/Groups/${groupId}`, entraRenameGroup("Engineering Department"));
    await scim("PATCH", `/Groups/${groupId}`, entraRemoveMembers([first.id]));
    expect(await membership(first.accountId)).toBeNull();
    expect(await membership(second.accountId)).toBe("member");

    expect((await scim("DELETE", `/Groups/${groupId}`)).statusCode).toBe(204);
    expect(await membership(second.accountId)).toBeNull();
    expect((await scim("GET", `/Groups/${groupId}`)).statusCode).toBe(404);
  });

  it("deactivates instead of deleting and reactivates only what it deactivated", async () => {
    const user = await provision();
    expect((await scim("PATCH", `/Users/${user.id}`, entraDisable(true))).json()).toMatchObject({
      active: false,
    });
    expect(await accountState(user.accountId)).toBe("deactivated");
    expect((await scim("PATCH", `/Users/${user.id}`, entraEnable())).json()).toMatchObject({ active: true });
    expect(await accountState(user.accountId)).toBe("active");

    expect((await scim("DELETE", `/Users/${user.id}`)).statusCode).toBe(204);
    expect(await accountState(user.accountId)).toBe("deactivated");
    const kept = await scim("GET", `/Users/${user.id}`);
    expect(kept.json()).toMatchObject({ id: user.id, active: false });

    const manual = await provision();
    await test.runtime.services.memberships.deactivate(accountPrincipal(ownerId), manual.accountId);
    expect((await scim("PATCH", `/Users/${manual.id}`, entraEnable())).json()).toMatchObject({
      active: false,
    });
    expect(await accountState(manual.accountId)).toBe("deactivated");
    expect((await scim("PATCH", `/Users/${manual.id}`, entraDisable())).statusCode).toBe(200);
  });

  it("refuses requests without a token, with a wrong, old or removed token and with the token of another provider", async () => {
    const path = "/Users";
    for (const options of [{ token: null }, { token: "phscim_wrong" }, { token: otherToken }]) {
      const response = await scim("GET", path, undefined, options);
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toContain(SCIM_JSON);
      expect(response.json()).toMatchObject({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "401",
      });
    }
    expect(
      (await scim("GET", path, undefined, { token: otherToken, provider: otherProviderId })).statusCode,
    ).toBe(200);

    const status = (await owner.get(`/api/v1/instance/identity-providers/${providerId}/scim`)).json();
    const renewed = await owner.post(
      `/api/v1/instance/identity-providers/${providerId}/scim/tokens/${status.tokens[0].id}/renew`,
    );
    expect(renewed.statusCode).toBe(201);
    const fresh = renewed.json().token as string;
    expect((await scim("GET", path, undefined, { token })).statusCode).toBe(200);
    await test.runtime.pool.query(
      "update scim_tokens set expires_at = now() - interval '1 minute' where id = $1",
      [status.tokens[0].id],
    );
    expect((await scim("GET", path, undefined, { token })).statusCode).toBe(401);
    expect((await scim("GET", path, undefined, { token: fresh })).statusCode).toBe(200);

    const removed = (
      await owner.post(`/api/v1/instance/identity-providers/${providerId}/scim/tokens`)
    ).json();
    expect(
      (await owner.delete(`/api/v1/instance/identity-providers/${providerId}/scim/tokens/${removed.id}`))
        .statusCode,
    ).toBe(204);
    expect((await scim("GET", path, undefined, { token: removed.token })).statusCode).toBe(401);
    token = fresh;

    const events = await test.runtime.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1 and name like 'identityProvider.scimToken%' order by sequence",
      [providerId],
    );
    expect(events.rows.map((row) => row.name)).toEqual([
      "identityProvider.scimTokenCreated",
      "identityProvider.scimTokenRenewed",
      "identityProvider.scimTokenCreated",
      "identityProvider.scimTokenRemoved",
    ]);
    const stored = await test.runtime.pool.query("select 1 from scim_tokens where token_hash::text like $1", [
      `%${fresh}%`,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it("refuses users of domains the provider does not own and Entra ID users without the object ID", async () => {
    const outside = { ...person(), mail: "someone@fabrikam.example" };
    expect((await scim("POST", "/Users", entraUser(outside))).json()).toMatchObject({
      status: "400",
      scimType: "invalidValue",
    });
    const withoutObjectId = { ...entraUser(person()), externalId: "mailNickname" };
    const refused = (await scim("POST", "/Users", withoutObjectId)).json();
    expect(refused).toMatchObject({ status: "400", scimType: "invalidValue" });
    expect(refused.detail).toContain('"mailNickname" was sent');
    expect(refused.detail).toContain("set the source attribute of externalId to objectId");
  });

  it("refuses an externalId in PATCH and PUT that is not the object ID of the user and stores nothing of the request", async () => {
    const user = await provision();
    const replace = (externalId: string) => ({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "Replace", path: "externalId", value: externalId },
        { op: "Replace", path: "displayName", value: "Changed Name" },
      ],
    });
    for (const sent of ["mailNickname", randomUUID()]) {
      const patched = await scim("PATCH", `/Users/${user.id}`, replace(sent));
      expect(patched.statusCode).toBe(400);
      expect(patched.json()).toMatchObject({ status: "400", scimType: "invalidValue" });
      expect(patched.json().detail).toContain(`"${sent}" was sent, "${user.objectId}" was expected`);
      expect(patched.json().detail).toContain("set the source attribute of externalId to objectId");
      const replaced = await scim("PUT", `/Users/${user.id}`, {
        ...entraUser(user),
        externalId: sent,
        displayName: "Changed Name",
      });
      expect(replaced.statusCode).toBe(400);
      expect(replaced.json().detail).toContain(`"${user.objectId}" was expected`);
    }
    const stored = await test.runtime.pool.query<{ scim_external_id: string; display_name: string }>(
      "select scim_external_id, display_name from identities where id = $1",
      [user.id],
    );
    expect(stored.rows[0]).toEqual({ scim_external_id: user.objectId, display_name: "Ada Lovelace" });
  });

  it("accepts the object ID as externalId although a wrong value was stored earlier", async () => {
    const first = await provision();
    const second = await provision();
    await test.runtime.pool.query(
      "update identities set scim_external_id = 'mailNickname' where id = any($1::uuid[])",
      [[first.id, second.id]],
    );
    const patched = await scim("PATCH", `/Users/${first.id}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "externalId", value: first.objectId.toUpperCase() }],
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().externalId).toBe(first.objectId.toUpperCase());
    const replaced = await scim("PUT", `/Users/${second.id}`, entraUser(second));
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().externalId).toBe(second.objectId);
  });

  it("tells open clients about every SCIM change so that lists reload without a reload of the page", async () => {
    const listener = await test.runtime.pool.connect();
    const signals: { providerId: string; runId: string }[] = [];
    try {
      listener.on("notification", (notification) => {
        if (notification.channel === "pagehall_sync_runs" && notification.payload)
          signals.push(JSON.parse(notification.payload));
      });
      await listener.query("listen pagehall_sync_runs");
      const user = await provision();
      await expect.poll(() => signals.length, { timeout: 5000 }).toBe(1);
      await scim("PATCH", `/Users/${user.id}`, entraDisable());
      await expect.poll(() => signals.length, { timeout: 5000 }).toBe(2);
      expect(signals.every((signal) => signal.providerId === providerId)).toBe(true);
      const runs = await test.runtime.pool.query<{ id: string }>(
        "select id from provider_sync_runs where id = any($1::uuid[]) and trigger = 'scim'",
        [signals.map((signal) => signal.runId)],
      );
      expect(runs.rowCount).toBe(2);
    } finally {
      await listener.query("unlisten pagehall_sync_runs");
      listener.release();
    }
  });

  it("shows SCIM requests in the sync log as their own trigger, without the token", async () => {
    await provision();
    const runs = await test.runtime.pool.query<{ trigger: string; changes: unknown; error: string | null }>(
      "select trigger, changes, error from provider_sync_runs where provider_id = $1 and trigger = 'scim'",
      [providerId],
    );
    expect(runs.rowCount).toBeGreaterThan(0);
    expect(JSON.stringify(runs.rows)).not.toContain(token);
    const log = (await owner.get(`/api/v1/instance/identity-providers/${providerId}/sync-runs`)).json();
    expect(log.items.some((run: { trigger: string }) => run.trigger === "scim")).toBe(true);
    const status = (await owner.get(`/api/v1/instance/identity-providers/${providerId}/scim`)).json();
    expect(status).toMatchObject({
      url: `${configuredSetupEnv.PAGEHALL_INSTANCE_URL}/scim/v2/${providerId}`,
    });
    expect(status.lastRequestAt).not.toBeNull();
    expect(status.lastDay.changes).toBeGreaterThan(0);
  });

  it("refuses SCIM for a deactivated provider", async () => {
    await test.runtime.services.identityProviders.deactivate(SYSTEM, otherProviderId);
    const response = await scim("GET", "/Users", undefined, { token: otherToken, provider: otherProviderId });
    expect(response.statusCode).toBe(403);
    await test.runtime.services.identityProviders.activate(SYSTEM, otherProviderId);
  });
});
