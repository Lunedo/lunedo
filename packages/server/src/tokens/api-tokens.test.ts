import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { TokenRejectedError } from "./api-tokens.js";
import { apiTokenPrefix, generateApiToken, isValidApiTokenFormat } from "./format.js";
import { tokenMaxLifetimeSetting, tokenRequestsPerMinuteSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("API token format", () => {
  it("has the prefix, 256 bits of randomness and a checksum", () => {
    const token = generateApiToken();
    expect(token).toMatch(/^ph_[0-9A-Za-z]{49}$/);
    expect(isValidApiTokenFormat(token)).toBe(true);
    expect(apiTokenPrefix(token)).toBe(token.slice(0, 9));
    expect(generateApiToken()).not.toBe(token);
    expect(62 ** 43).toBeGreaterThan(2 ** 256);
  });

  it("rejects tokens with a wrong checksum or shape", () => {
    const token = generateApiToken();
    const last = token.at(-1) === "a" ? "b" : "a";
    expect(isValidApiTokenFormat(`${token.slice(0, -1)}${last}`)).toBe(false);
    const changed = `${token.slice(0, 10)}${token[10] === "x" ? "y" : "x"}${token.slice(11)}`;
    expect(isValidApiTokenFormat(changed)).toBe(false);
    expect(isValidApiTokenFormat(`xx_${token.slice(3)}`)).toBe(false);
    expect(isValidApiTokenFormat(token.slice(0, -1))).toBe(false);
    expect(isValidApiTokenFormat("")).toBe(false);
  });
});

describe.skipIf(!baseUrl)("API tokens and service accounts", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.pool.query(
      "insert into setting_values (id, level, scope_id, key, value) values (gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'mail.smtp', $1)",
      [
        JSON.stringify({
          host: "smtp.example.org",
          port: 25,
          security: "none",
          username: null,
          from: "wiki@example.org",
        }),
      ],
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function standard(home: string | null, email = `${randomUUID()}@example.org`): Promise<string> {
    const account = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
    return account.id;
  }

  async function organization() {
    const owner = await standard(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    return { id: created.id, owner };
  }

  async function member(organizationId: string, areas?: Record<string, "view" | "manage">) {
    const id = await standard(organizationId);
    if (areas) {
      const role = await test.services.roles.createCustom(SYSTEM, "organization", organizationId, {
        name: `Role ${randomUUID().slice(0, 6)}`,
        areas,
      });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId,
        role: { customRoleId: role.id },
        principal: { kind: "account", id },
      });
    }
    return id;
  }

  async function principalFor(token: string): Promise<Principal> {
    const authenticated = await test.services.apiTokens.authenticate(token, "192.0.2.1");
    return { type: "account", id: authenticated.accountId, token: authenticated.grant };
  }

  async function auditNames(targetId: string): Promise<string[]> {
    const result = await test.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1 order by sequence",
      [targetId],
    );
    return result.rows.map((row) => row.name);
  }

  it("stores only a hash and returns the token once", async () => {
    const org = await organization();
    const created = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Script",
      scopes: { organization: { spaces: "view" } },
    });
    expect(isValidApiTokenFormat(created.token)).toBe(true);
    const stored = await test.pool.query<{ token_hash: Buffer; token_prefix: string }>(
      "select token_hash, token_prefix from api_tokens where id = $1",
      [created.apiToken.id],
    );
    expect(stored.rows[0]?.token_hash.toString("utf8")).not.toContain(created.token);
    expect(stored.rows[0]?.token_prefix).toBe(created.token.slice(0, 9));
    expect(JSON.stringify(await test.services.apiTokens.listForAccount(org.owner))).not.toContain(
      created.token,
    );
    expect(await auditNames(created.apiToken.id)).toEqual(["apiToken.created"]);
    const event = await test.pool.query<{ fields: unknown }>(
      "select fields from audit_events where target_id = $1",
      [created.apiToken.id],
    );
    expect(JSON.stringify(event.rows[0]?.fields)).not.toContain(created.token);
  });

  it("creates tokens without expiry unless a maximum lifetime applies", async () => {
    const org = await organization();
    const actor = accountPrincipal(org.owner);
    const base = {
      accountId: org.owner,
      name: "Expiry",
      scopes: { organization: { spaces: "view" as const } },
    };
    expect(await test.services.apiTokens.maxLifetimeDays(org.owner)).toBeNull();
    const defaulted = await test.services.apiTokens.create(actor, base);
    expect(defaulted.apiToken.expiresAt).toBeNull();
    const explicit = await test.services.apiTokens.create(actor, { ...base, expiresAt: null });
    expect(explicit.apiToken.expiresAt).toBeNull();
    const far = await test.services.apiTokens.create(actor, {
      ...base,
      expiresAt: new Date(Date.now() + 4000 * DAY_MS),
    });
    expect(far.apiToken.expiresAt).not.toBeNull();
    await expect(
      test.services.apiTokens.create(actor, { ...base, expiresAt: new Date(Date.now() - 1000) }),
    ).rejects.toMatchObject({ code: "expiryInPast" });

    await test.settings.set(tokenMaxLifetimeSetting, { organization: org.id }, "organization", 30);
    expect(await test.services.apiTokens.maxLifetimeDays(org.owner)).toBe(30);
    const capped = await test.services.apiTokens.create(actor, base);
    expect(Math.round(((capped.apiToken.expiresAt?.getTime() ?? 0) - Date.now()) / DAY_MS)).toBe(30);
    await expect(test.services.apiTokens.create(actor, { ...base, expiresAt: null })).rejects.toMatchObject({
      code: "expiryRequired",
      details: { maxLifetimeDays: 30 },
    });
    await expect(
      test.services.apiTokens.create(actor, { ...base, expiresAt: new Date(Date.now() + 60 * DAY_MS) }),
    ).rejects.toMatchObject({ code: "expiryTooLate", details: { maxLifetimeDays: 30 } });
  });

  it("lets lower levels only shorten the maximum lifetime", async () => {
    const org = await organization();
    await test.settings.set(tokenMaxLifetimeSetting, {}, "instance", 90);
    try {
      await expect(
        test.settings.set(tokenMaxLifetimeSetting, { organization: org.id }, "organization", 120),
      ).rejects.toThrow("stricter");
      await expect(
        test.settings.set(tokenMaxLifetimeSetting, { organization: org.id }, "organization", null),
      ).rejects.toThrow("stricter");
      await test.settings.set(tokenMaxLifetimeSetting, { organization: org.id }, "organization", 60);
      expect(await test.services.apiTokens.maxLifetimeDays(org.owner)).toBe(60);
    } finally {
      await test.settings.clear(tokenMaxLifetimeSetting, { organization: org.id }, "organization");
      await test.settings.clear(tokenMaxLifetimeSetting, {}, "instance");
    }
  });

  it("rejects invalid scopes", async () => {
    const org = await organization();
    const actor = accountPrincipal(org.owner);
    for (const scopes of [{}, { organization: {} }, { organization: { spaces: "edit" } }, { other: {} }]) {
      await expect(
        test.services.apiTokens.create(actor, { accountId: org.owner, name: "Bad", scopes: scopes as never }),
      ).rejects.toThrow();
    }
  });

  it("limits a token to the intersection of its scopes and the owner's permissions", async () => {
    const org = await organization();
    const person = await member(org.id, { spaces: "view", settings: "manage" });
    const { token } = await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Limited",
      scopes: { organization: { spaces: "manage", settings: "view" } },
    });
    const principal = await principalFor(token);
    const resource = { type: "organization", id: org.id };
    const auth = test.services.authorization;
    expect(await auth.authorize(principal, "organization.spaces.view", resource)).toBe(true);
    expect(await auth.authorize(principal, "organization.spaces.manage", resource)).toBe(false);
    expect(await auth.authorize(principal, "organization.settings.view", resource)).toBe(true);
    expect(await auth.authorize(principal, "organization.settings.manage", resource)).toBe(false);
    expect(await auth.authorize(principal, "organization.view", resource)).toBe(true);
    expect(await auth.authorize(principal, "organization.leave", resource)).toBe(false);
    const denied = await auth.explain(principal, "organization.settings.manage", resource);
    expect(denied.denials).toEqual(["tokenScope"]);
  });

  it("limits a token to one organization when asked", async () => {
    const first = await organization();
    const second = await organization();
    const person = await member(first.id, { spaces: "view" });
    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: second.id,
        accountId: person,
        kind: "member",
      }),
    );
    const role = await test.services.roles.createCustom(SYSTEM, "organization", second.id, {
      name: "Spaces",
      areas: { spaces: "view" },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: second.id,
      role: { customRoleId: role.id },
      principal: { kind: "account", id: person },
    });
    const { token } = await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "One organization",
      organizationId: first.id,
      scopes: { organization: { spaces: "view" } },
    });
    const principal = await principalFor(token);
    const auth = test.services.authorization;
    expect(
      await auth.authorize(principal, "organization.spaces.view", { type: "organization", id: first.id }),
    ).toBe(true);
    expect(
      await auth.authorize(principal, "organization.spaces.view", { type: "organization", id: second.id }),
    ).toBe(false);
    expect(
      await auth.authorize(accountPrincipal(person), "organization.spaces.view", {
        type: "organization",
        id: second.id,
      }),
    ).toBe(true);
  });

  it("does not let a token assign roles beyond its scopes", async () => {
    const org = await organization();
    const target = await member(org.id);
    const { token } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Roles",
      scopes: { organization: { membersAndGroups: "manage" } },
    });
    const principal = await principalFor(token);
    await expect(
      test.services.roles.assign(principal, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: target },
      }),
    ).rejects.toMatchObject({ decision: { denials: ["roleExceedsOwnPermissions"] } });
    await expect(
      test.services.roles.assign(principal, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "owner" },
        principal: { kind: "account", id: target },
      }),
    ).rejects.toMatchObject({ decision: { denials: ["tokenScope"] } });
    await expect(
      test.services.roles.createCustom(principal, "organization", org.id, {
        name: "Wide",
        areas: { spaces: "view" },
      }),
    ).rejects.toMatchObject({ decision: { denials: ["roleExceedsOwnPermissions"] } });
    const narrow = await test.services.roles.createCustom(principal, "organization", org.id, {
      name: "Directory",
      areas: { membersAndGroups: "view" },
    });
    const assigned = await test.services.roles.assign(principal, {
      scope: "organization",
      organizationId: org.id,
      role: { customRoleId: narrow.id },
      principal: { kind: "account", id: target },
    });
    expect(assigned.id).toBeTruthy();
  });

  it("stops a personal token at expiry", async () => {
    const org = await organization();
    const { token, apiToken } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Short",
      scopes: { organization: { spaces: "view" } },
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    await expect(test.services.apiTokens.authenticate(token, undefined)).resolves.toMatchObject({
      accountId: org.owner,
    });
    await test.pool.query("update api_tokens set expires_at = now() - interval '1 second' where id = $1", [
      apiToken.id,
    ]);
    await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toMatchObject({
      reason: "expired",
    });
    expect(await test.services.apiTokens.recordExpired()).toBeGreaterThanOrEqual(1);
    expect(await test.services.apiTokens.recordExpired()).toBe(0);
    expect(await auditNames(apiToken.id)).toEqual([
      "apiToken.created",
      "apiToken.rejected",
      "apiToken.expired",
    ]);
  });

  it("stops a personal token on revocation", async () => {
    const org = await organization();
    const { token, apiToken } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Revoked",
      scopes: { organization: { spaces: "view" } },
    });
    await test.services.apiTokens.authenticate(token, undefined);
    expect(await test.services.apiTokens.revoke(accountPrincipal(org.owner), apiToken.id)).toBe(true);
    expect(await test.services.apiTokens.revoke(accountPrincipal(org.owner), apiToken.id)).toBe(false);
    await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toMatchObject({
      reason: "revoked",
    });
    expect((await test.services.apiTokens.listForAccount(org.owner)).items).toEqual([]);
    expect(await auditNames(apiToken.id)).toEqual([
      "apiToken.created",
      "apiToken.revoked",
      "apiToken.rejected",
    ]);
  });

  it("stops a personal token when the account is deactivated", async () => {
    const org = await organization();
    const person = await member(org.id, { spaces: "view" });
    const { token, apiToken } = await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Deactivated",
      scopes: { organization: { spaces: "view" } },
    });
    await test.services.memberships.deactivate(SYSTEM, person);
    await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toBeInstanceOf(
      TokenRejectedError,
    );
    await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toMatchObject({
      reason: "revoked",
    });
    expect(await auditNames(apiToken.id)).toContain("apiToken.revoked");
  });

  it("refuses a token whose owner became inactive without revocation", async () => {
    const org = await organization();
    const { token } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Inactive",
      scopes: { organization: { spaces: "view" } },
    });
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [org.owner]);
    await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toMatchObject({
      reason: "accountInactive",
    });
  });

  it("rejects unknown and malformed tokens", async () => {
    await expect(test.services.apiTokens.authenticate(generateApiToken(), undefined)).rejects.toMatchObject({
      reason: "unknown",
    });
    await expect(test.services.apiTokens.authenticate("ph_short", undefined)).rejects.toMatchObject({
      reason: "malformed",
    });
    const events = await test.pool.query<{ fields: { reason: string } }>(
      "select fields from audit_events where name = 'apiToken.rejected' and target_id is null",
    );
    expect(events.rows.some((row) => row.fields.reason === "unknown")).toBe(true);
  });

  it("limits audit events for rejected tokens per client", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const before = await test.pool.query<{ count: string }>(
      "select count(*) from audit_events where name = 'apiToken.rejected'",
    );
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await expect(test.services.apiTokens.authenticate(generateApiToken(), ip)).rejects.toBeInstanceOf(
        TokenRejectedError,
      );
    }
    const after = await test.pool.query<{ count: string }>(
      "select count(*) from audit_events where name = 'apiToken.rejected'",
    );
    expect(Number(after.rows[0]?.count) - Number(before.rows[0]?.count)).toBe(10);
  });

  it("applies the rate limit per token", async () => {
    const org = await organization();
    const create = () =>
      test.services.apiTokens.create(accountPrincipal(org.owner), {
        accountId: org.owner,
        name: "Busy",
        scopes: { organization: { spaces: "view" } },
      });
    const first = await create();
    const second = await create();
    await test.settings.set(tokenRequestsPerMinuteSetting, {}, "instance", 3);
    try {
      for (let request = 0; request < 3; request += 1) {
        await test.services.apiTokens.authenticate(first.token, undefined);
      }
      await expect(test.services.apiTokens.authenticate(first.token, undefined)).rejects.toMatchObject({
        code: "rateLimited",
      });
      await expect(test.services.apiTokens.authenticate(second.token, undefined)).resolves.toBeTruthy();
    } finally {
      await test.settings.set(tokenRequestsPerMinuteSetting, {}, "instance", 600);
    }
  });

  it("records the last use at most once per minute", async () => {
    const org = await organization();
    const { token, apiToken } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: org.owner,
      name: "Used",
      scopes: { organization: { spaces: "view" } },
    });
    await test.services.apiTokens.authenticate(token, "192.0.2.10");
    const first = await test.services.apiTokens.get(apiToken.id);
    expect(first?.lastUsedIp).toBe("192.0.2.10");
    await Promise.all([
      test.services.apiTokens.authenticate(token, "192.0.2.11"),
      test.services.apiTokens.authenticate(token, "192.0.2.12"),
    ]);
    const second = await test.services.apiTokens.get(apiToken.id);
    expect(second?.lastUsedAt).toEqual(first?.lastUsedAt);
    expect(second?.lastUsedIp).toBe("192.0.2.10");
    await test.pool.query("update api_tokens set last_used_at = now() - interval '2 minutes' where id = $1", [
      apiToken.id,
    ]);
    await test.services.apiTokens.authenticate(token, "192.0.2.13");
    expect((await test.services.apiTokens.get(apiToken.id))?.lastUsedIp).toBe("192.0.2.13");
  });

  it("renames tokens and lists them per organization", async () => {
    const org = await organization();
    const person = await member(org.id);
    const own = await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Mine",
      scopes: { organization: { membersAndGroups: "view" } },
    });
    const renamed = await test.services.apiTokens.rename(
      accountPrincipal(person),
      own.apiToken.id,
      "Renamed",
    );
    expect(renamed.name).toBe("Renamed");
    const listed = (await test.services.apiTokens.listForOrganization(org.id)).items;
    expect(listed.map((token) => token.id)).toContain(own.apiToken.id);
    const other = await organization();
    expect(
      (await test.services.apiTokens.listForOrganization(other.id)).items.map((token) => token.id),
    ).not.toContain(own.apiToken.id);
    expect(await auditNames(own.apiToken.id)).toEqual(["apiToken.created", "apiToken.updated"]);
  });

  it("reminds the owner before a token expires, once", async () => {
    const org = await organization();
    const email = `${randomUUID()}@example.org`;
    const person = await standard(org.id, email);
    await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Nightly export",
      scopes: { organization: { membersAndGroups: "view" } },
      expiresAt: new Date(Date.now() + 3 * DAY_MS),
    });
    await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Later",
      scopes: { organization: { membersAndGroups: "view" } },
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    expect(await test.services.apiTokens.sendReminders()).toBeGreaterThanOrEqual(1);
    expect(await test.services.apiTokens.sendReminders()).toBe(0);
    await deliverPendingMail(test.services, test.database);
    const mails = test.mail.sent.filter((mail) => mail.to === email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toContain("Nightly export");
  });

  async function unusedNotices(tokenId: string): Promise<string[]> {
    const result = await test.pool.query<{ recipient_id: string }>(
      "select recipient_id from notifications where type = 'apiToken.unused' and target_id = $1 order by recipient_id",
      [tokenId],
    );
    return result.rows.map((row) => row.recipient_id);
  }

  async function idleFor(tokenId: string, days: number, used: boolean): Promise<void> {
    await test.pool.query(
      `update api_tokens set created_at = now() - make_interval(days => $2::int + 5),
         last_used_at = case when $3 then now() - make_interval(days => $2::int) else null end
       where id = $1`,
      [tokenId, days, used],
    );
  }

  it("tells the owner once per idle period about a token that is not used", async () => {
    const org = await organization();
    const person = await standard(org.id);
    const { apiToken, token } = await test.services.apiTokens.create(accountPrincipal(person), {
      accountId: person,
      name: "Forgotten script",
      scopes: { organization: { membersAndGroups: "view" } },
    });
    await idleFor(apiToken.id, 30, true);
    await test.services.apiTokens.notifyUnused();
    expect(await unusedNotices(apiToken.id)).toEqual([]);

    await idleFor(apiToken.id, 91, false);
    await test.services.apiTokens.notifyUnused();
    await test.services.apiTokens.notifyUnused();
    expect(await unusedNotices(apiToken.id)).toEqual([person]);
    const [notice] = (
      await test.pool.query<{ params: Record<string, unknown> }>(
        "select params from notifications where type = 'apiToken.unused' and target_id = $1",
        [apiToken.id],
      )
    ).rows;
    expect(notice?.params).toMatchObject({ tokenName: "Forgotten script", lastUsedAt: null, days: 90 });
    expect((await test.services.apiTokens.authenticate(token, "192.0.2.1")).accountId).toBe(person);

    await test.pool.query("delete from notifications where target_id = $1", [apiToken.id]);
    await test.pool.query("update api_tokens set last_used_at = now() where id = $1", [apiToken.id]);
    await test.services.apiTokens.notifyUnused();
    expect(await unusedNotices(apiToken.id)).toEqual([]);
    await test.pool.query(
      "update api_tokens set unused_noticed_at = now() - interval '200 days' where id = $1",
      [apiToken.id],
    );
    await idleFor(apiToken.id, 95, true);
    await test.services.apiTokens.notifyUnused();
    expect(await unusedNotices(apiToken.id)).toEqual([person]);
  });

  it("tells the owners about an unused service account token without responsible people", async () => {
    const org = await organization();
    const service = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Lonely bot" });
    await test.pool.query(
      "update service_accounts set unattended_notified_at = now() where account_id = $1",
      [service.id],
    );
    const { apiToken } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
      accountId: service.id,
      name: "Bot token",
      scopes: { organization: { spaces: "view" } },
    });
    await idleFor(apiToken.id, 100, true);
    await test.services.apiTokens.notifyUnused();
    expect(await unusedNotices(apiToken.id)).toEqual([org.owner]);
  });

  async function ownerEmail(organizationId: string): Promise<string> {
    const result = await test.pool.query<{ email: string }>(
      `select a.email from role_assignments ra join accounts a on a.id = ra.principal_id
       where ra.organization_id = $1 and ra.built_in_role = 'owner'`,
      [organizationId],
    );
    return result.rows[0]?.email ?? "";
  }

  describe("service accounts", () => {
    it("act only through their own roles, independent of their responsible people", async () => {
      const org = await organization();
      const creator = await member(org.id, { integrationsAndApi: "manage", spaces: "manage" });
      const service = await test.services.serviceAccounts.create(accountPrincipal(creator), org.id, {
        name: "Deploy bot",
        description: "Publishes release notes",
      });
      expect(service.responsibleAccountIds).toEqual([creator]);
      const role = await test.services.roles.createCustom(SYSTEM, "organization", org.id, {
        name: "Bot",
        areas: { spaces: "manage", settings: "manage" },
      });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { customRoleId: role.id },
        principal: { kind: "account", id: service.id },
      });
      await expect(
        test.services.apiTokens.create(accountPrincipal(creator), {
          accountId: service.id,
          name: "Too strong",
          scopes: { organization: { spaces: "manage", settings: "manage" } },
        }),
      ).rejects.toMatchObject({ decision: { denials: ["roleExceedsOwnPermissions"] } });
      const { token } = await test.services.apiTokens.create(accountPrincipal(org.owner), {
        accountId: service.id,
        name: "CI",
        scopes: { organization: { spaces: "manage", settings: "manage" } },
      });
      const principal = await principalFor(token);
      expect(principal.type === "account" && principal.token?.organizationId).toBe(org.id);
      const resource = { type: "organization", id: org.id };
      const auth = test.services.authorization;
      expect(await auth.authorize(principal, "organization.spaces.manage", resource)).toBe(true);
      expect(await auth.authorize(principal, "organization.settings.manage", resource)).toBe(true);
      expect(await auth.authorize(principal, "organization.members.manage", resource)).toBe(false);
      const other = await organization();
      expect(
        await auth.authorize(principal, "organization.view", { type: "organization", id: other.id }),
      ).toBe(false);

      const assignments = (await test.services.roles.listAssignments("organization", org.id)).items;
      const creatorAssignment = assignments.find(
        (assignment) => assignment.principalKind === "account" && assignment.principalId === creator,
      );
      if (!creatorAssignment) throw new Error("The creator has no role");
      await test.services.roles.unassign(SYSTEM, "organization", org.id, creatorAssignment.id);
      expect(await auth.authorize(principal, "organization.spaces.manage", resource)).toBe(true);
      expect(await auth.authorize(principal, "organization.settings.manage", resource)).toBe(true);
    });

    it("have zero, one or several responsible people, and changes are audited", async () => {
      const org = await organization();
      const first = await member(org.id);
      const second = await member(org.id);
      const service = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Unowned" });
      expect(service.responsibleAccountIds).toEqual([]);
      const both = await test.services.serviceAccounts.update(SYSTEM, service.id, {
        responsibleAccountIds: [first, second, first],
      });
      expect([...both.responsibleAccountIds].sort()).toEqual([first, second].sort());
      await test.services.serviceAccounts.update(SYSTEM, service.id, {
        responsibleAccountIds: [second, first],
      });
      const outsider = await standard(null);
      await expect(
        test.services.serviceAccounts.update(SYSTEM, service.id, {
          responsibleAccountIds: [first, outsider],
        }),
      ).rejects.toMatchObject({ code: "invalidResponsible" });
      const collaborator = await standard(null);
      await test.database.transaction((tx) =>
        test.services.memberships.add(tx, SYSTEM, {
          organizationId: org.id,
          accountId: collaborator,
          kind: "collaborator",
        }),
      );
      await expect(
        test.services.serviceAccounts.update(SYSTEM, service.id, { responsibleAccountIds: [collaborator] }),
      ).rejects.toMatchObject({ code: "invalidResponsible" });
      const renamed = await test.services.serviceAccounts.update(SYSTEM, service.id, { name: "Owned" });
      expect(renamed.name).toBe("Owned");
      expect(await auditNames(service.id)).toEqual([
        "serviceAccount.created",
        "serviceAccount.responsiblesChanged",
        "serviceAccount.updated",
      ]);
      const listed = (await test.services.serviceAccounts.list(org.id)).items;
      expect(listed).toHaveLength(1);
      expect([...(listed[0]?.responsibleAccountIds ?? [])].sort()).toEqual([first, second].sort());
    });

    it("tell the owners once when the last responsible person leaves, without changing permissions", async () => {
      const org = await organization();
      const creator = await member(org.id, { integrationsAndApi: "manage" });
      const visitor = await standard(null);
      await test.database.transaction((tx) =>
        test.services.memberships.add(tx, SYSTEM, {
          organizationId: org.id,
          accountId: visitor,
          kind: "member",
        }),
      );
      const service = await test.services.serviceAccounts.create(accountPrincipal(creator), org.id, {
        name: "Sync",
        responsibleAccountIds: [creator, visitor],
      });
      const resource = { type: "organization", id: org.id };
      const canViewMembers = () =>
        test.services.authorization.authorize(
          accountPrincipal(service.id),
          "organization.members.view",
          resource,
        );
      expect(await canViewMembers()).toBe(true);

      expect(await test.services.memberships.remove(SYSTEM, org.id, visitor)).toBe(true);
      expect((await test.services.serviceAccounts.get(service.id))?.responsibleAccountIds).toEqual([creator]);
      expect(await test.services.serviceAccounts.notifyUnattended()).toBe(0);

      await test.services.memberships.deactivate(SYSTEM, creator);
      expect((await test.services.serviceAccounts.get(service.id))?.responsibleAccountIds).toEqual([]);
      expect(await test.services.serviceAccounts.notifyUnattended()).toBe(1);
      expect(await test.services.serviceAccounts.notifyUnattended()).toBe(0);
      await deliverPendingMail(test.services, test.database);
      const owner = await ownerEmail(org.id);
      const mails = test.mail.sent.filter((mail) => mail.to === owner);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.subject).toContain("Sync");
      expect(await canViewMembers()).toBe(true);
      expect(await auditNames(service.id)).toEqual([
        "serviceAccount.created",
        "serviceAccount.responsiblesChanged",
        "serviceAccount.responsiblesChanged",
        "serviceAccount.unattended",
      ]);

      const successor = await member(org.id);
      await test.services.serviceAccounts.update(SYSTEM, service.id, { responsibleAccountIds: [successor] });
      await test.services.memberships.deactivate(SYSTEM, successor);
      expect(await test.services.serviceAccounts.notifyUnattended()).toBe(1);
    });

    it("remind the owners before a token expires when nobody is responsible", async () => {
      const org = await organization();
      const service = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Lonely reporter" });
      await test.pool.query(
        "update service_accounts set unattended_notified_at = now() where account_id = $1",
        [service.id],
      );
      await test.services.apiTokens.create(SYSTEM, {
        accountId: service.id,
        name: "Nightly export",
        scopes: { organization: { membersAndGroups: "view" } },
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
      });
      expect(await test.services.apiTokens.sendReminders()).toBeGreaterThanOrEqual(1);
      await deliverPendingMail(test.services, test.database);
      const owner = await ownerEmail(org.id);
      const mails = test.mail.sent.filter((mail) => mail.to === owner);
      expect(mails.map((mail) => mail.subject)).toEqual([expect.stringContaining("Nightly export")]);
    });

    it("remind every responsible person before a token expires", async () => {
      const org = await organization();
      const firstEmail = `${randomUUID()}@example.org`;
      const secondEmail = `${randomUUID()}@example.org`;
      const first = await standard(org.id, firstEmail);
      const second = await standard(org.id, secondEmail);
      const service = await test.services.serviceAccounts.create(SYSTEM, org.id, {
        name: "Reporter",
        responsibleAccountIds: [first, second],
      });
      await test.services.apiTokens.create(SYSTEM, {
        accountId: service.id,
        name: "Weekly report",
        scopes: { organization: { membersAndGroups: "view" } },
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
      });
      expect(await test.services.apiTokens.sendReminders()).toBeGreaterThanOrEqual(2);
      await deliverPendingMail(test.services, test.database);
      for (const address of [firstEmail, secondEmail]) {
        const mails = test.mail.sent.filter((mail) => mail.to === address);
        expect(mails, address).toHaveLength(1);
        expect(mails[0]?.subject).toContain("Weekly report");
      }
    });

    it("lose all tokens at once when deactivated", async () => {
      const org = await organization();
      const service = await test.services.serviceAccounts.create(accountPrincipal(org.owner), org.id, {
        name: "Old bot",
      });
      const tokens = await Promise.all(
        ["one", "two"].map((name) =>
          test.services.apiTokens.create(accountPrincipal(org.owner), {
            accountId: service.id,
            name,
            scopes: { organization: { spaces: "view" } },
          }),
        ),
      );
      expect(await test.services.serviceAccounts.deactivate(accountPrincipal(org.owner), service.id)).toBe(2);
      for (const { token } of tokens) {
        await expect(test.services.apiTokens.authenticate(token, undefined)).rejects.toMatchObject({
          reason: "revoked",
        });
      }
      await expect(
        test.services.serviceAccounts.deactivate(accountPrincipal(org.owner), service.id),
      ).rejects.toMatchObject({ code: "notFound" });
    });

    it("have no password and cannot sign in", async () => {
      const org = await organization();
      const service = await test.services.serviceAccounts.create(accountPrincipal(org.owner), org.id, {
        name: "Silent",
      });
      const row = await test.pool.query<{ password_hash: unknown; email: unknown; type: string }>(
        "select password_hash, email, type from accounts where id = $1",
        [service.id],
      );
      expect(row.rows[0]).toMatchObject({ password_hash: null, email: null, type: "service" });
    });

    it("cannot hold instance scopes or tokens for another organization", async () => {
      const org = await organization();
      const other = await organization();
      const service = await test.services.serviceAccounts.create(accountPrincipal(org.owner), org.id, {
        name: "Scoped",
      });
      await expect(
        test.services.apiTokens.create(accountPrincipal(org.owner), {
          accountId: service.id,
          name: "Instance",
          scopes: { instance: { operations: "view" } },
        }),
      ).rejects.toMatchObject({ code: "invalidScopes" });
      await expect(
        test.services.apiTokens.create(accountPrincipal(org.owner), {
          accountId: service.id,
          name: "Elsewhere",
          organizationId: other.id,
          scopes: { organization: { spaces: "view" } },
        }),
      ).rejects.toMatchObject({ code: "invalidScopes" });
    });
  });
});
