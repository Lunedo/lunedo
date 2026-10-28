import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ManagedAccountError } from "../auth/errors.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { organizationSettingsChain, selfRegistrationSetting } from "../organizations/settings.js";
import { testDatabaseBaseUrl, waitForLockWait } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { VirtualAuthenticator } from "../testing/webauthn.js";
import { managedAccountCounts, managedStateOf, refreshManagedAccounts } from "./managed.js";

const baseUrl = testDatabaseBaseUrl();

const GENERIC = {
  preset: "generic",
  issuer: "https://idp.example.org",
  clientId: "lunedo",
};

function uniqueDomain(): string {
  return `${randomUUID().slice(0, 8)}.example.net`;
}

describe.skipIf(!baseUrl)("managed accounts", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function account(email: string, type: "standard" | "guest" | "portal" = "standard") {
    return test.database.transaction((tx) =>
      test.services.accounts.create(tx, {
        type,
        email,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
  }

  async function provider(domains: string[] = []) {
    const { provider } = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: `Provider ${randomUUID().slice(0, 6)}`,
      config: { ...GENERIC, domains },
      credential: { kind: "clientSecret", secret: "s3cret-value", expiresAt: null },
    });
    return provider;
  }

  async function events(accountId: string) {
    const result = await test.pool.query<{ name: string; fields: Record<string, unknown> }>(
      "select name, fields from audit_events where target_id = $1 and name in ('account.managed', 'account.unmanaged') order by occurred_at, sequence",
      [accountId],
    );
    return result.rows;
  }

  async function localMails(): Promise<number> {
    const result = await test.pool.query("select 1 from mail_outbox where template = 'accountMadeLocal'");
    return result.rowCount ?? 0;
  }

  async function administrator() {
    const admin = await account(`${randomUUID()}@admins.example`);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: admin.id },
    });
    return admin;
  }

  it("manages the accounts of a domain, also while the provider is deactivated, and audits every change", async () => {
    const domain = uniqueDomain();
    const inDomain = await account(`person@${domain}`);
    const guest = await account(`guest@${domain}`, "guest");
    const portal = await account(`reader@${domain}`, "portal");
    const elsewhere = await account(`person@${uniqueDomain()}`);
    const created = await provider([domain]);

    expect(await managedStateOf(test.database, inDomain.id)).toMatchObject({
      providerId: created.id,
      providerType: "oidc",
      source: "domain",
    });
    expect(await managedStateOf(test.database, guest.id)).toMatchObject({ source: "domain" });
    expect(await managedStateOf(test.database, portal.id)).toBeNull();
    expect(await managedStateOf(test.database, elsewhere.id)).toBeNull();
    expect(await events(inDomain.id)).toEqual([
      { name: "account.managed", fields: { providerId: created.id, source: "domain" } },
    ]);
    expect((await managedAccountCounts(test.database)).get(created.id)).toBe(2);

    await test.services.identityProviders.deactivate(SYSTEM, created.id);
    expect(await managedStateOf(test.database, inDomain.id)).toMatchObject({ source: "domain" });
    await test.services.identityProviders.activate(SYSTEM, created.id);

    await test.services.identityProviders.update(SYSTEM, created.id, {
      config: { ...GENERIC, domains: [uniqueDomain()] },
    });
    expect(await managedStateOf(test.database, inDomain.id)).toBeNull();
    expect((await events(inDomain.id)).map((event) => event.name)).toEqual([
      "account.managed",
      "account.unmanaged",
    ]);
  });

  it("manages new accounts of a managed domain from their creation", async () => {
    const domain = uniqueDomain();
    const created = await provider([domain]);
    const later = await account(`later@${domain}`);
    expect(await managedStateOf(test.database, later.id)).toMatchObject({
      providerId: created.id,
      source: "domain",
    });
  });

  it("ignores providers whose setup is not finished", async () => {
    const domain = uniqueDomain();
    const person = await account(`person@${domain}`);
    const created = await provider([domain]);
    await test.pool.query("update identity_providers set setup_completed_at = null where id = $1", [
      created.id,
    ]);
    await test.database.transaction((tx) =>
      refreshManagedAccounts(tx, test.services.audit, { providerId: created.id }, SYSTEM),
    );
    expect(await managedStateOf(test.database, person.id)).toBeNull();
  });

  it("prefers the most recently linked provider over the provider of the domain", async () => {
    const domain = uniqueDomain();
    const byDomain = await provider([domain]);
    const byIdentity = await provider([uniqueDomain()]);
    const person = await account(`person@${domain}`);
    const admin = await administrator();
    const linked = await test.services.administration.linkIdentity(accountPrincipal(admin.id), person.id, {
      providerId: byIdentity.id,
      subject: randomUUID(),
    });
    expect(await managedStateOf(test.database, person.id)).toMatchObject({
      providerId: byIdentity.id,
      source: "identity",
    });
    const moved = await provider([uniqueDomain()]);
    await test.services.identityProviders.deactivate(SYSTEM, byIdentity.id);
    const second = await test.services.administration.linkIdentity(accountPrincipal(admin.id), person.id, {
      providerId: moved.id,
      subject: randomUUID(),
    });
    expect(await managedStateOf(test.database, person.id)).toMatchObject({
      providerId: moved.id,
      source: "identity",
    });

    await test.services.administration.unlinkIdentity(accountPrincipal(admin.id), person.id, second.id);
    expect(await managedStateOf(test.database, person.id)).toMatchObject({
      providerId: byIdentity.id,
      source: "identity",
    });
    await test.services.administration.unlinkIdentity(accountPrincipal(admin.id), person.id, linked.id);
    expect(await managedStateOf(test.database, person.id)).toMatchObject({
      providerId: byDomain.id,
      source: "domain",
    });
  });

  it("makes the account local when an administrator unlinks its last provider", async () => {
    const created = await provider([uniqueDomain()]);
    const person = await account(`person@${uniqueDomain()}`);
    const admin = await administrator();
    const first = await test.services.administration.linkIdentity(accountPrincipal(admin.id), person.id, {
      providerId: created.id,
      subject: randomUUID(),
    });
    await test.services.identityProviders.deactivate(SYSTEM, created.id);
    expect(await managedStateOf(test.database, person.id)).toMatchObject({ providerId: created.id });

    const mailsBefore = await localMails();
    await test.services.administration.unlinkIdentity(accountPrincipal(admin.id), person.id, first.id);
    expect(await managedStateOf(test.database, person.id)).toBeNull();
    expect(await events(person.id)).toEqual([
      { name: "account.managed", fields: { providerId: created.id, source: "identity" } },
      { name: "account.unmanaged", fields: { providerId: created.id } },
    ]);
    expect(await localMails()).toBe(mailsBefore + 1);
    const tokens = await test.pool.query(
      "select 1 from account_tokens where account_id = $1 and purpose = 'passwordReset'",
      [person.id],
    );
    expect(tokens.rowCount).toBe(1);
  });

  it("removes the local credentials when an administrator links an account and leaves none after unlinking", async () => {
    const created = await provider([uniqueDomain()]);
    const person = await account(`person@${uniqueDomain()}`);
    const admin = await administrator();
    const before = await test.pool.query<{ count: number }>(
      "select count(*)::int as count from mail_outbox where template = 'accountManaged'",
    );
    const identity = await test.services.administration.linkIdentity(accountPrincipal(admin.id), person.id, {
      providerId: created.id,
      subject: randomUUID(),
    });
    expect((await test.services.accounts.get(person.id))?.passwordHash).toBeNull();
    const after = await test.pool.query<{ count: number }>(
      "select count(*)::int as count from mail_outbox where template = 'accountManaged'",
    );
    expect(after.rows[0]?.count).toBe((before.rows[0]?.count ?? 0) + 1);
    const removed = await test.pool.query<{ actor_id: string }>(
      "select actor_id from audit_events where name = 'account.localCredentialsRemoved' and target_id = $1",
      [person.id],
    );
    expect(removed.rows).toEqual([{ actor_id: admin.id }]);

    await test.services.administration.unlinkIdentity(accountPrincipal(admin.id), person.id, identity.id);
    expect(await managedStateOf(test.database, person.id)).toBeNull();
    await expect(
      test.services.signIn.signInWithPassword({
        email: person.email ?? "",
        password: "a long test passphrase",
        client: {},
      }),
    ).rejects.toMatchObject({ code: "invalidCredentials" });
  });

  it("refuses to make a deactivated account local and keeps a domain-managed account managed", async () => {
    const domain = uniqueDomain();
    const byDomain = await provider([domain]);
    const linkedProvider = await provider([uniqueDomain()]);
    const inDomain = await account(`person@${domain}`);
    const deactivated = await account(`gone@${uniqueDomain()}`);
    const admin = await administrator();
    const domainIdentity = await test.services.administration.linkIdentity(SYSTEM, inDomain.id, {
      providerId: linkedProvider.id,
      subject: randomUUID(),
    });
    const goneIdentity = await test.services.administration.linkIdentity(SYSTEM, deactivated.id, {
      providerId: linkedProvider.id,
      subject: randomUUID(),
    });
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [deactivated.id]);

    await expect(
      test.services.administration.unlinkIdentity(
        accountPrincipal(admin.id),
        deactivated.id,
        goneIdentity.id,
      ),
    ).rejects.toMatchObject({ code: "accountNotActive" });
    expect(await managedStateOf(test.database, deactivated.id)).toMatchObject({
      providerId: linkedProvider.id,
    });

    const mailsBefore = await localMails();
    await test.services.administration.unlinkIdentity(
      accountPrincipal(admin.id),
      inDomain.id,
      domainIdentity.id,
    );
    expect(await managedStateOf(test.database, inDomain.id)).toMatchObject({
      providerId: byDomain.id,
      source: "domain",
    });
    expect(await localMails()).toBe(mailsBefore);
  });

  it("refuses to remove a provider with linked accounts and releases the accounts of its domains", async () => {
    const domain = uniqueDomain();
    const created = await provider([domain]);
    const byDomain = await account(`person@${domain}`);
    const linked = await account(`linked@${uniqueDomain()}`);
    const identity = await test.services.administration.linkIdentity(SYSTEM, linked.id, {
      providerId: created.id,
      subject: randomUUID(),
    });
    await test.services.identityProviders.deactivate(SYSTEM, created.id);
    await expect(test.services.identityProviders.remove(SYSTEM, created.id)).rejects.toMatchObject({
      code: "providerHasAccounts",
      details: { accounts: 1 },
    });
    expect(await managedStateOf(test.database, linked.id)).toMatchObject({ providerId: created.id });

    await test.services.administration.unlinkIdentity(SYSTEM, linked.id, identity.id);
    await test.services.identityProviders.remove(SYSTEM, created.id);
    expect(await managedStateOf(test.database, byDomain.id)).toBeNull();
    expect((await events(byDomain.id)).at(-1)).toEqual({
      name: "account.unmanaged",
      fields: { providerId: created.id },
    });
  });

  it("does not let people unlink the identity of the provider that manages them", async () => {
    const created = await provider([uniqueDomain()]);
    const person = await account(`person@${uniqueDomain()}`);
    const identity = await test.services.administration.linkIdentity(SYSTEM, person.id, {
      providerId: created.id,
      subject: randomUUID(),
    });
    await expect(
      test.services.administration.unlinkOwnIdentity(person.id, identity.id),
    ).rejects.toMatchObject({ code: "managedIdentity" });
    expect(await managedStateOf(test.database, person.id)).toMatchObject({ providerId: created.id });
  });

  it("never manages the instance owner and refuses managed accounts as new owner", async () => {
    const domain = uniqueDomain();
    const owner = await account(`owner@${domain}`);
    const managed = await account(`managed@${domain}`);
    const local = await account(`local@${uniqueDomain()}`);
    for (const candidate of [managed, local]) {
      await test.services.roles.assign(SYSTEM, {
        scope: "instance",
        organizationId: null,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: candidate.id },
      });
    }
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    try {
      const created = await provider([domain]);
      await test.services.administration.linkIdentity(SYSTEM, owner.id, {
        providerId: created.id,
        subject: randomUUID(),
      });
      expect(await managedStateOf(test.database, owner.id)).toBeNull();
      expect(await managedStateOf(test.database, managed.id)).toMatchObject({ source: "domain" });

      await expect(
        test.services.memberships.transferOwnership(accountPrincipal(owner.id), managed.id),
      ).rejects.toMatchObject({ code: "ownerManaged" });

      await test.services.memberships.transferOwnership(accountPrincipal(owner.id), local.id);
      expect(await managedStateOf(test.database, owner.id)).toMatchObject({
        providerId: created.id,
        source: "identity",
      });
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  it("keeps one row when the same account is refreshed at the same time", async () => {
    const domain = uniqueDomain();
    const person = await account(`person@${domain}`);
    const created = await provider([domain]);
    await test.pool.query("delete from managed_accounts where account_id = $1", [person.id]);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        test.database.transaction((tx) =>
          refreshManagedAccounts(tx, test.services.audit, { accountIds: [person.id] }, SYSTEM),
        ),
      ),
    );
    const rows = await test.pool.query("select provider_id from managed_accounts where account_id = $1", [
      person.id,
    ]);
    expect(rows.rows).toEqual([{ provider_id: created.id }]);
    expect((await events(person.id)).filter((event) => event.name === "account.managed")).toHaveLength(2);
  });

  it("refuses passkey sign-in for managed accounts, also for directory accounts", async () => {
    const domain = uniqueDomain();
    const person = await account(`person@${domain}`);
    const authenticator = new VirtualAuthenticator();
    const origin = "https://wiki.example.org";
    const options = await test.services.webauthn.registrationOptions({
      id: person.id,
      email: person.email ?? "",
      name: person.name,
    });
    await test.services.webauthn.register(test.database, {
      accountId: person.id,
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      name: "Laptop",
    });
    const signInWithPasskey = async () => {
      const started = await test.services.signIn.passkeyOptions("203.0.113.80");
      return test.services.signIn.signInWithPasskey({
        token: started.token,
        response: authenticator.assert(started.options, origin),
        client: { ip: "203.0.113.80" },
      });
    };
    await expect(signInWithPasskey()).resolves.toMatchObject({ status: "signedIn" });

    const created = await provider([domain]);
    await test.pool.query("update identity_providers set type = 'ldap' where id = $1", [created.id]);
    await expect(signInWithPasskey()).rejects.toThrow(ManagedAccountError);
    const sessions = await test.pool.query("select 1 from sessions where account_id = $1", [person.id]);
    expect(sessions.rows).toHaveLength(1);
  });

  it("refuses to complete a registration once the domain belongs to a provider", async () => {
    const domain = uniqueDomain();
    const owner = await account(`owner@${uniqueDomain()}`);
    const organization = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Registering ${randomUUID().slice(0, 6)}`,
      ownerAccountId: owner.id,
    });
    await test.settings.set(
      selfRegistrationSetting,
      organizationSettingsChain(organization.id),
      "organization",
      true,
    );
    const token = generateToken();
    await test.pool.query(
      "insert into registration_tokens (id, organization_id, email, token_hash, expires_at) values (gen_random_uuid(), $1, $2, $3, now() + interval '1 hour')",
      [organization.id, `new.person@${domain}`, hashToken(token)],
    );
    const created = await provider([domain]);
    await expect(
      test.services.invitations.completeRegistration(
        token,
        { name: "New Person", password: "a long test passphrase" },
        undefined,
      ),
    ).rejects.toMatchObject({ code: "managedDomain", details: { providerId: created.id } });
    const accountRows = await test.pool.query("select 1 from accounts where email = $1", [
      `new.person@${domain}`,
    ]);
    expect(accountRows.rowCount).toBe(0);
  });

  it("counts failed sign-ins of the instance owner per client address, so nobody locks the owner out", async () => {
    const owner = await account(`owner@${uniqueDomain()}`);
    const other = await account(`other@${uniqueDomain()}`);
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    try {
      for (const target of [owner, other]) {
        for (let attempt = 0; attempt < 6; attempt++) {
          await test.services.signIn
            .signInWithPassword({
              email: target.email ?? "",
              password: "not the passphrase",
              client: { ip: `203.0.113.${attempt + 100}` },
            })
            .catch(() => undefined);
        }
      }
      await expect(
        test.services.signIn.signInWithPassword({
          email: owner.email ?? "",
          password: "a long test passphrase",
          client: { ip: "198.51.100.200" },
        }),
      ).resolves.toMatchObject({ status: "signedIn" });
      await expect(
        test.services.signIn.signInWithPassword({
          email: other.email ?? "",
          password: "a long test passphrase",
          client: { ip: "198.51.100.201" },
        }),
      ).rejects.toMatchObject({ code: "locked" });
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  it("still counts wrong second factors of the instance owner per account", async () => {
    const owner = await account(`owner@${uniqueDomain()}`);
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    try {
      const setup = await test.services.totp.begin(owner.id, { issuer: "Test", account: "owner" });
      if (!setup) throw new Error("TOTP was not started");
      const secret = Secret.fromBase32(setup.secret);
      await test.services.totp.verify(test.database, owner.id, TOTP.generate({ secret }), {
        confirming: true,
      });
      const wrongCode = async (attempt: number) => {
        const client = { ip: `203.0.113.${attempt + 150}` };
        const first = await test.services.signIn.signInWithPassword({
          email: owner.email ?? "",
          password: "a long test passphrase",
          client,
        });
        if (first.status !== "secondFactorRequired") throw new Error("A second factor was expected");
        return test.services.signIn.completeSecondFactor({
          pendingToken: first.pendingToken,
          factor: { type: "totp", code: "000000" },
          client,
        });
      };
      const outcomes: string[] = [];
      for (let attempt = 0; attempt < 7; attempt++) {
        outcomes.push(
          await wrongCode(attempt).then(
            () => "signedIn",
            (error: { code?: string }) => error.code ?? "",
          ),
        );
      }
      expect(outcomes).toContain("locked");
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });
  it("refuses a new owner whose first provider sign-in commits while the transfer runs", async () => {
    const owner = await account(`owner@${uniqueDomain()}`);
    const candidate = await account(`next@${uniqueDomain()}`);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: candidate.id },
    });
    const created = await provider();
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    const signIn = await test.pool.connect();
    try {
      await signIn.query("begin");
      await signIn.query("select id from accounts where id = $1 for update", [candidate.id]);
      const transfer = test.services.memberships
        .transferOwnership(accountPrincipal(owner.id), candidate.id)
        .then(
          () => null,
          (error: unknown) => error,
        );
      await Promise.race([transfer, waitForLockWait(test.pool)]);
      await signIn.query(
        "insert into identities (id, account_id, provider_id, subject) values (gen_random_uuid(), $1, $2, $3)",
        [candidate.id, created.id, randomUUID()],
      );
      await signIn.query(
        "insert into managed_accounts (account_id, provider_id, source) values ($1, $2, 'identity')",
        [candidate.id, created.id],
      );
      await signIn.query("commit");
      expect(await transfer).toMatchObject({ code: "ownerManaged" });
      const current = await test.pool.query("select owner_account_id from instance");
      expect(current.rows[0]?.owner_account_id).toBe(owner.id);
    } finally {
      await signIn.query("rollback");
      signIn.release();
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  it("manages an account created in a domain while the domain is being assigned", async () => {
    const domain = uniqueDomain();
    const created = await provider();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let createdId: string | null = null;
    const creating = test.database.transaction(async (tx) => {
      const person = await test.services.accounts.create(tx, {
        type: "standard",
        email: `late@${domain}`,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: null,
      });
      createdId = person.id;
      await gate;
    });
    await vi.waitFor(() => expect(createdId).not.toBeNull());
    const assigning = test.services.identityProviders.update(SYSTEM, created.id, {
      config: { ...GENERIC, domains: [domain] },
    });
    await Promise.race([assigning, waitForLockWait(test.pool)]);
    release();
    await Promise.all([creating, assigning]);
    expect(await managedStateOf(test.database, createdId ?? "")).toMatchObject({
      providerId: created.id,
      source: "domain",
    });
  });

  it("manages an account whose new address moves into a domain while the domain is being assigned", async () => {
    const domain = uniqueDomain();
    const person = await account(`person@${uniqueDomain()}`);
    const created = await provider();
    const token = generateToken();
    await test.pool.query(
      "insert into account_tokens (id, account_id, purpose, token_hash, new_email, expires_at) values (gen_random_uuid(), $1, 'emailChange', $2, $3, now() + interval '1 hour')",
      [person.id, hashToken(token), `person@${domain}`],
    );
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = false;
    const recordMany = test.services.audit.recordMany.bind(test.services.audit);
    const spy = vi.spyOn(test.services.audit, "recordMany").mockImplementation(async (tx, inputs) => {
      await recordMany(tx, inputs);
      if (inputs.length === 0 && !reached) {
        reached = true;
        await gate;
      }
    });
    try {
      const changing = test.services.security.confirmEmailChange(token, undefined);
      await vi.waitFor(() => expect(reached).toBe(true));
      const assigning = test.services.identityProviders.update(SYSTEM, created.id, {
        config: { ...GENERIC, domains: [domain] },
      });
      await Promise.race([assigning, waitForLockWait(test.pool)]);
      release();
      await Promise.all([changing, assigning]);
    } finally {
      spy.mockRestore();
    }
    expect(await managedStateOf(test.database, person.id)).toMatchObject({
      providerId: created.id,
      source: "domain",
    });
  });

  it("assigns a domain with ten thousand accounts in one pass and audits each account", async () => {
    const domain = uniqueDomain();
    await test.pool.query(
      "insert into accounts (id, type, state, name, email) select gen_random_uuid(), 'standard', 'active', 'Person ' || n, 'p' || n || '@' || $1 from generate_series(1, 10000) n",
      [domain],
    );
    const created = await provider();
    await test.services.identityProviders.update(SYSTEM, created.id, {
      config: { ...GENERIC, domains: [domain] },
    });
    expect((await managedAccountCounts(test.database, [created.id])).get(created.id)).toBe(10_000);
    const audited = await test.pool.query<{ count: number }>(
      "select count(*)::int as count from audit_events where name = 'account.managed' and fields->>'providerId' = $1",
      [created.id],
    );
    expect(audited.rows[0]?.count).toBe(10_000);
    const verification = await test.services.audit.verify();
    expect(verification.every((chain) => chain.broken === null)).toBe(true);
  }, 120_000);
});
