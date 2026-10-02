import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { instanceUrlSetting } from "./instance-settings.js";
import { accountPrincipal, SYSTEM } from "./principal.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("resetting another account's second factor", () => {
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
    await test.pool.query("update accounts set home_organization_id = $1 where id = $2", [created.id, owner]);
    return { id: created.id, owner };
  }

  async function role(
    accountId: string,
    scope: "instance" | "organization",
    builtIn: "owner" | "administrator" | "securityAuditor",
    organizationId: string | null = null,
  ) {
    await test.services.roles.assign(SYSTEM, {
      scope,
      organizationId,
      role: { builtIn },
      principal: { kind: "account", id: accountId },
    });
  }

  async function withFactors(accountId: string) {
    await test.services.totp.begin(accountId, { issuer: "Test", account: "person@example.org" });
    await test.pool.query("update totp_credentials set confirmed_at = now() where account_id = $1", [
      accountId,
    ]);
    await test.pool.query(
      "insert into webauthn_credentials (id, account_id, credential_id, public_key, sign_count, device_type, backed_up, name) values (gen_random_uuid(), $1, $2, '\\x00', 0, 'singleDevice', false, 'Key')",
      [accountId, randomUUID()],
    );
    await test.database.transaction((tx) => test.services.recoveryCodes.generate(tx, accountId));
    await test.database.transaction((tx) =>
      test.services.sessions.create(tx, { accountId, kind: "full", methods: ["password"], client: {} }),
    );
  }

  async function count(table: string, accountId: string): Promise<number> {
    const result = await test.pool.query<{ count: number }>(
      `select count(*)::int as count from ${table} where account_id = $1`,
      [accountId],
    );
    return result.rows[0]?.count ?? 0;
  }

  it("removes every factor, ends the sessions, requires a new factor, mails and audits the reason", async () => {
    const org = await organization();
    const admin = await standard(org.id);
    await role(admin, "organization", "administrator", org.id);
    const email = `${randomUUID()}@example.org`;
    const person = await standard(org.id, email);
    await withFactors(person);
    expect(await test.services.signIn.secondFactorRequired(person)).toBe(false);

    const result = await test.services.administration.resetSecondFactor(
      accountPrincipal(admin),
      person,
      "Lost phone, confirmed by video call",
    );

    expect(result).toEqual({ endedSessions: 1 });
    for (const table of ["totp_credentials", "webauthn_credentials", "recovery_codes", "sessions"]) {
      expect(await count(table, person), table).toBe(0);
    }
    expect(await test.services.signIn.secondFactorRequired(person)).toBe(true);
    const audit = await test.pool.query(
      "select actor_id, scope_id, fields from audit_events where name = 'account.secondFactorReset' and target_id = $1",
      [person],
    );
    expect(audit.rows).toEqual([
      {
        actor_id: admin,
        scope_id: org.id,
        fields: expect.objectContaining({
          reason: "Lost phone, confirmed by video call",
          endedSessions: 1,
          authenticatorApp: true,
          passkeys: 1,
          recoveryLeft: 10,
        }),
      },
    ]);
    await deliverPendingMail(test.services, test.database);
    const mails = test.mail.sent.filter((mail) => mail.to === email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.text).toContain("Lost phone, confirmed by video call");
  });

  it("refuses to reset the own second factor", async () => {
    const org = await organization();
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(org.owner), org.owner, "Myself"),
    ).rejects.toMatchObject({ code: "resetOwnSecondFactor" });
  });

  it("recognizes the own account by its stored ID when the request uses capital letters", async () => {
    const org = await organization();
    const admin = await standard(org.id);
    await role(admin, "organization", "administrator", org.id);
    const upper = admin.toUpperCase();
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(admin), upper, "Myself"),
    ).rejects.toMatchObject({ code: "resetOwnSecondFactor" });
    await expect(
      test.services.administration.endSessions(accountPrincipal(admin), upper),
    ).rejects.toMatchObject({ code: "endOwnSessions" });
    await expect(test.services.memberships.deactivate(accountPrincipal(admin), upper)).rejects.toMatchObject({
      code: "deactivateSelf",
    });
  });

  it("decides through the authorization service and refuses people without the permission", async () => {
    const org = await organization();
    const member = await standard(org.id);
    const person = await standard(org.id);
    const require = vi.spyOn(test.services.authorization, "require");
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(member), person, "No right"),
    ).rejects.toThrow(ForbiddenError);
    expect(require).toHaveBeenCalledWith(
      accountPrincipal(member),
      "account.secondFactor.reset",
      { type: "account", id: person },
      expect.anything(),
    );
    require.mockRestore();
    const other = await organization();
    const outsider = await standard(other.id);
    await role(outsider, "organization", "administrator", other.id);
    await expect(
      test.services.administration.resetSecondFactor(
        accountPrincipal(outsider),
        person,
        "Wrong organization",
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets only owners reset owners", async () => {
    const org = await organization();
    const admin = await standard(org.id);
    await role(admin, "organization", "administrator", org.id);
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(admin), org.owner, "Admin over owner"),
    ).rejects.toThrow(ForbiddenError);
    const secondOwner = await standard(org.id);
    await role(secondOwner, "organization", "owner", org.id);
    await expect(
      test.services.administration.resetSecondFactor(
        accountPrincipal(secondOwner),
        org.owner,
        "Owner over owner",
      ),
    ).resolves.toEqual({ endedSessions: 0 });

    const instanceAdmin = await standard(null);
    await role(instanceAdmin, "instance", "administrator");
    await expect(
      test.services.administration.resetSecondFactor(
        accountPrincipal(instanceAdmin),
        secondOwner,
        "Instance administrator over owner",
      ),
    ).rejects.toThrow(ForbiddenError);
    const member = await standard(org.id);
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(instanceAdmin), member, "Member"),
    ).resolves.toEqual({ endedSessions: 0 });

    const instanceOwner = await standard(null);
    await test.pool.query("update instance set owner_account_id = $1", [instanceOwner]);
    await expect(
      test.services.administration.resetSecondFactor(
        accountPrincipal(instanceOwner),
        secondOwner,
        "Instance owner over owner",
      ),
    ).resolves.toEqual({ endedSessions: 0 });
    await expect(
      test.services.administration.resetSecondFactor(
        accountPrincipal(instanceAdmin),
        instanceOwner,
        "Administrator over the instance owner",
      ),
    ).rejects.toThrow(ForbiddenError);
    await test.pool.query("update instance set owner_account_id = null");
  });

  it("lets only owners deactivate owners of the home organization", async () => {
    const org = await organization();
    const secondOwner = await standard(org.id);
    await role(secondOwner, "organization", "owner", org.id);
    const instanceAdmin = await standard(null);
    await role(instanceAdmin, "instance", "administrator");
    await expect(
      test.services.memberships.deactivate(accountPrincipal(instanceAdmin), secondOwner),
    ).rejects.toThrow(ForbiddenError);
    const member = await standard(org.id);
    await expect(test.services.memberships.deactivate(accountPrincipal(instanceAdmin), member)).resolves.toBe(
      0,
    );

    const instanceOwner = await standard(null);
    await test.pool.query("update instance set owner_account_id = $1", [instanceOwner]);
    try {
      await expect(
        test.services.memberships.deactivate(accountPrincipal(instanceOwner), secondOwner),
      ).resolves.toBe(0);
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  it("does not let organization administrators reset holders of instance roles", async () => {
    const org = await organization();
    const admin = await standard(org.id);
    await role(admin, "organization", "administrator", org.id);
    const auditor = await standard(org.id);
    await role(auditor, "instance", "securityAuditor");
    await expect(
      test.services.administration.resetSecondFactor(accountPrincipal(admin), auditor, "Auditor"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("ends sessions and reactivates accounts only with the rank over the account", async () => {
    const org = await organization();
    const admin = await standard(org.id);
    await role(admin, "organization", "administrator", org.id);
    await withFactors(org.owner);
    await expect(
      test.services.administration.endSessions(accountPrincipal(admin), org.owner),
    ).rejects.toThrow(ForbiddenError);
    const person = await standard(org.id);
    await withFactors(person);
    await expect(test.services.administration.endSessions(accountPrincipal(admin), person)).resolves.toEqual({
      endedSessions: 1,
    });
    await expect(
      test.services.administration.endSessions(accountPrincipal(admin), admin),
    ).rejects.toMatchObject({ code: "endOwnSessions" });

    await test.pool.query("update accounts set state = 'deactivated' where id = any($1)", [
      [org.owner, person],
    ]);
    await expect(test.services.administration.reactivate(accountPrincipal(admin), org.owner)).rejects.toThrow(
      ForbiddenError,
    );
    await test.services.administration.reactivate(accountPrincipal(admin), person);
    const states = await test.pool.query("select id, state from accounts where id = any($1)", [
      [org.owner, person],
    ]);
    expect(Object.fromEntries(states.rows.map((row) => [row.id, row.state]))).toEqual({
      [org.owner]: "deactivated",
      [person]: "active",
    });
    const outsider = await standard(null);
    await expect(
      test.services.administration.reactivate(accountPrincipal(outsider), org.owner),
    ).rejects.toThrow(ForbiddenError);
  });

  it("ignores service accounts and inactive accounts", async () => {
    const org = await organization();
    const service = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
    await expect(
      test.services.administration.resetSecondFactor(SYSTEM, service.id, "Bot"),
    ).rejects.toMatchObject({ code: "notFound" });
    const person = await standard(org.id);
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [person]);
    await expect(
      test.services.administration.resetSecondFactor(SYSTEM, person, "Gone"),
    ).rejects.toMatchObject({ code: "notFound" });
  });
});
