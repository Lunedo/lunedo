import { randomUUID } from "node:crypto";
import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { PasswordSignInDisabledError } from "../auth/errors.js";
import { passwordSignInSetting } from "../auth/settings.js";
import { ForbiddenError } from "../authorization/service.js";
import { smtpSetting } from "../mail/mail-service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { IdentityProviderService } from "./providers.js";

const baseUrl = testDatabaseBaseUrl();
const PASSWORD = "a long test passphrase";
const DAY = 24 * 60 * 60 * 1000;

const GENERIC = {
  preset: "generic",
  issuer: "https://idp.example.org",
  clientId: "pagehall",
  domains: [] as string[],
};

function uniqueDomain(): string {
  return `${randomUUID().slice(0, 8)}.example.net`;
}

describe.skipIf(!baseUrl)("IdentityProviderService", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function account(home: string | null, email = `${randomUUID()}@example.org`) {
    return test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: "Person",
        password: PASSWORD,
        homeOrganizationId: home,
      }),
    );
  }

  async function organization() {
    const owner = await account(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner.id,
    });
    await test.pool.query("update accounts set home_organization_id = $1 where id = $2", [
      created.id,
      owner.id,
    ]);
    return { id: created.id, owner: owner.id };
  }

  async function instanceProvider(secretExpiresAt: Date | null = null, domains: string[] = []) {
    const { provider } = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: `Provider ${randomUUID().slice(0, 6)}`,
      config: { ...GENERIC, domains },
      credential: { kind: "clientSecret", secret: "s3cret-value", expiresAt: secretExpiresAt },
    });
    return provider;
  }

  it("declares what each provider can do with its configuration", async () => {
    const credential = { kind: "clientSecret" as const, secret: "x", expiresAt: null };
    const generic = await instanceProvider();
    expect(generic.capabilities).toEqual({
      groups: false,
      directorySync: false,
      disabledAccounts: false,
      groupsByName: false,
    });
    const withGroups = await test.services.identityProviders.update(SYSTEM, generic.id, {
      config: { ...GENERIC, claims: { groups: "groups" } },
    });
    expect(withGroups.capabilities).toEqual({
      groups: true,
      directorySync: false,
      disabledAccounts: false,
      groupsByName: false,
    });
    const entra = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: "Entra ID",
      config: { preset: "entraId", clientId: "c", tenantId: randomUUID(), domains: [uniqueDomain()] },
      credential,
    });
    expect(entra.provider.capabilities).toEqual({
      groups: true,
      directorySync: true,
      disabledAccounts: true,
      groupsByName: false,
    });
    const google = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: "Google",
      config: { preset: "google", clientId: "c", domains: [uniqueDomain()] },
      credential,
    });
    expect(google.provider.capabilities).toEqual({
      groups: false,
      directorySync: false,
      disabledAccounts: false,
      groupsByName: false,
    });
    const withDirectory = await test.services.identityProviders.update(SYSTEM, google.provider.id, {
      config: { ...google.provider.config, directory: { method: "adminRole" } },
    });
    expect(withDirectory.capabilities).toEqual({
      groups: true,
      directorySync: false,
      disabledAccounts: false,
      groupsByName: false,
    });
  });

  it("stores secrets encrypted and never returns them", async () => {
    const provider = await instanceProvider();
    const stored = await test.pool.query<{ secret: Buffer }>(
      "select secret from identity_provider_credentials where provider_id = $1",
      [provider.id],
    );
    expect(stored.rows[0]?.secret.toString("latin1")).not.toContain("s3cret-value");
    expect(JSON.stringify(provider)).not.toContain("s3cret-value");
    expect(provider.callbackPath).toBe(`/api/v1/auth/providers/${provider.id}/callback`);
    const loaded = await test.services.identityProviders.definition(provider.id);
    expect(loaded?.credentials.map((credential) => credential.secret)).toEqual(["s3cret-value"]);
  });

  it("generates a certificate whose private key stays inside and keeps old credentials until removed", async () => {
    const provider = await instanceProvider();
    const added = await test.services.identityProviders.addCredential(SYSTEM, provider.id, {
      kind: "certificate",
      validDays: 365,
    });
    const certificate = new x509.X509Certificate(added.certificate ?? "");
    expect(certificate.subject).toContain("Pagehall");
    expect(added.keyId).toMatch(/^[\w-]{27}$/);
    expect(await test.services.identityProviders.certificate(provider.id, added.id)).toBe(added.certificate);
    const summary = await test.services.identityProviders.get(provider.id);
    expect(summary.credentials.map((credential) => credential.kind)).toEqual(["certificate", "clientSecret"]);
    expect(JSON.stringify(summary)).not.toContain("PRIVATE KEY");
    const loaded = await test.services.identityProviders.definition(provider.id);
    expect(loaded?.credentials.map((credential) => credential.kind)).toEqual(["certificate", "clientSecret"]);

    const secret = summary.credentials.find((credential) => credential.kind === "clientSecret");
    await test.services.identityProviders.removeCredential(SYSTEM, provider.id, secret?.id ?? "");
    await expect(
      test.services.identityProviders.removeCredential(SYSTEM, provider.id, added.id),
    ).rejects.toMatchObject({ code: "lastCredential" });
  });

  it("uses the newest credential unless an administrator chooses another one, and audits the choice", async () => {
    const provider = await instanceProvider();
    const older = provider.credentials[0];
    if (!older) throw new Error("A credential expected");
    const newer = await test.services.identityProviders.addCredential(SYSTEM, provider.id, {
      kind: "certificate",
      validDays: 365,
    });
    const inUse = async () =>
      (await test.services.identityProviders.get(provider.id)).credentials
        .filter((credential) => credential.inUse)
        .map((credential) => credential.id);
    const first = async () =>
      (await test.services.identityProviders.definition(provider.id))?.credentials[0]?.id;
    expect(await inUse()).toEqual([newer.id]);
    expect(await first()).toBe(newer.id);

    const chosen = await test.services.identityProviders.chooseCredential(
      SYSTEM,
      provider.id,
      older.id,
      "this",
    );
    expect(chosen.credentials.find((credential) => credential.id === older.id)).toMatchObject({
      inUse: true,
      chosen: true,
    });
    expect(await inUse()).toEqual([older.id]);
    expect(await first()).toBe(older.id);
    const third = await test.services.identityProviders.addCredential(SYSTEM, provider.id, {
      kind: "clientSecret",
      secret: "third-secret",
      expiresAt: null,
    });
    expect(await inUse()).toEqual([older.id]);

    await test.pool.query(
      "update identity_provider_credentials set expires_at = now() - interval '1 day' where id = $1",
      [newer.id],
    );
    await expect(
      test.services.identityProviders.chooseCredential(SYSTEM, provider.id, newer.id, "this"),
    ).rejects.toMatchObject({ code: "credentialExpired" });
    await test.services.identityProviders.chooseCredential(SYSTEM, provider.id, older.id, "newest");
    expect(await inUse()).toEqual([third.id]);
    expect(await first()).toBe(third.id);
    const events = await test.pool.query<{ fields: { automatic: boolean } }>(
      "select fields from audit_events where name = 'identityProvider.credentialChosen' and target_id = $1 order by sequence",
      [provider.id],
    );
    expect(events.rows.map((row) => row.fields.automatic)).toEqual([false, true]);
  });

  it("warns about expiring credentials and reminds the owners once at 30 and 7 days", async () => {
    const { owner } = await organization();
    await test.pool.query("update instance set owner_account_id = $1", [owner]);
    try {
      const provider = await instanceProvider(new Date(Date.now() + 20 * DAY));
      expect(provider.warnings).toEqual(["credentialExpiring"]);
      const count = async () =>
        Number(
          (
            await test.pool.query<{ count: string }>(
              "select count(*) from notifications where type = 'identityProvider.credentialExpiring' and target_id = $1",
              [provider.id],
            )
          ).rows[0]?.count,
        );
      await test.services.identityProviders.sendCredentialReminders();
      await test.services.identityProviders.sendCredentialReminders();
      expect(await count()).toBe(1);
      await test.pool.query(
        "update identity_provider_credentials set expires_at = now() + interval '5 days' where provider_id = $1",
        [provider.id],
      );
      await test.services.identityProviders.sendCredentialReminders();
      expect(await count()).toBe(1);
      const sent = await test.pool.query(
        "select notified_thirty_days_at is not null as thirty, notified_seven_days_at is not null as seven from identity_provider_credentials where provider_id = $1",
        [provider.id],
      );
      expect(sent.rows).toEqual([{ thirty: true, seven: true }]);
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  it("assigns each e-mail domain to at most one provider, regardless of case", async () => {
    const domain = uniqueDomain();
    const first = await instanceProvider(null, [domain]);
    await expect(instanceProvider(null, [domain.toUpperCase()])).rejects.toMatchObject({
      code: "domainInUse",
    });
    const second = await instanceProvider(null, [uniqueDomain()]);
    await expect(
      test.services.identityProviders.update(SYSTEM, second.id, {
        config: { ...GENERIC, domains: [` ${domain.toUpperCase()} `] },
      }),
    ).rejects.toMatchObject({ code: "domainInUse" });
    expect(await test.services.identityProviders.providerForDomain(domain.toUpperCase())).toMatchObject({
      id: first.id,
    });

    await test.services.identityProviders.update(SYSTEM, first.id, {
      config: { ...GENERIC, domains: [uniqueDomain()] },
    });
    await test.services.identityProviders.update(SYSTEM, second.id, {
      config: { ...GENERIC, domains: [domain] },
    });
    expect(await test.services.identityProviders.providerForDomain(domain)).toMatchObject({ id: second.id });
    await test.services.identityProviders.remove(SYSTEM, second.id);
    expect(await test.services.identityProviders.providerForDomain(domain)).toBeNull();
  });

  it("does not let two providers claim the same domain at the same time", async () => {
    const domain = uniqueDomain();
    const results = await Promise.allSettled([
      instanceProvider(null, [domain]),
      instanceProvider(null, [domain]),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "domainInUse" }),
    });
  });

  it("refuses multi-tenant Entra ID endpoints, providers without HTTPS and foreign issuers for the presets", async () => {
    const strict = new IdentityProviderService({
      database: test.database,
      audit: test.services.audit,
      encryption: test.encryption,
      notifications: test.services.notifications,
      settings: test.settings,
      allowInsecure: false,
    });
    const credential = { kind: "clientSecret" as const, secret: "x", expiresAt: null };
    for (const tenantId of ["common", "organizations", "consumers"]) {
      await expect(
        strict.create(SYSTEM, {
          type: "oidc",
          name: "Entra",
          config: { preset: "entraId", tenantId, clientId: "c" },
          credential,
        }),
      ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    }
    await expect(
      strict.create(SYSTEM, {
        type: "oidc",
        name: "Plain",
        config: { ...GENERIC, issuer: "http://idp.example.org" },
        credential,
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    await expect(
      strict.create(SYSTEM, {
        type: "oidc",
        name: "Entra",
        config: {
          preset: "entraId",
          tenantId: randomUUID(),
          clientId: "c",
          authority: "https://login.attacker.example",
        },
        credential,
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    await expect(
      strict.create(SYSTEM, {
        type: "oidc",
        name: "Google",
        config: {
          preset: "google",
          clientId: "c",
          domains: [uniqueDomain()],
          issuer: "https://accounts.attacker.example",
        },
        credential,
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    await expect(
      strict.create(SYSTEM, {
        type: "oidc",
        name: "Entra",
        config: {
          preset: "entraId",
          tenantId: randomUUID(),
          clientId: "c",
          graphUrl: "https://collector.example",
        },
        credential,
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    for (const directory of [
      { adminEmail: "admin@example.org", url: "https://collector.example" },
      { adminEmail: "admin@example.org", tokenUrl: "https://collector.example/token" },
    ]) {
      await expect(
        strict.create(SYSTEM, {
          type: "oidc",
          name: "Google",
          config: { preset: "google", clientId: "c", domains: [uniqueDomain()], directory },
          credential,
        }),
      ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    }
    await expect(
      strict.create(SYSTEM, {
        type: "oidc",
        name: "Google",
        config: {
          preset: "google",
          clientId: "c",
          domains: [uniqueDomain()],
          directory: { method: "delegation" },
        },
        credential,
      }),
    ).rejects.toMatchObject({
      code: "invalidProviderConfiguration",
      details: { fields: ["directory.adminEmail"] },
    });
    const google = await strict.create(SYSTEM, {
      type: "oidc",
      name: "Google",
      config: { preset: "google", clientId: "c", domains: [uniqueDomain()] },
      credential,
    });
    expect(google.provider.issuer).toBe("https://accounts.google.com");
  });

  it("refuses plain directory connections and SAML metadata without HTTPS unless insecure providers are allowed", async () => {
    const strict = new IdentityProviderService({
      database: test.database,
      audit: test.services.audit,
      encryption: test.encryption,
      notifications: test.services.notifications,
      settings: test.settings,
      allowInsecure: false,
    });
    const directory = {
      preset: "generic",
      bindDn: "cn=pagehall,dc=example,dc=org",
      userBaseDn: "ou=people,dc=example,dc=org",
      groupBaseDn: "ou=groups,dc=example,dc=org",
    };
    const password = { kind: "bindPassword" as const, secret: "service password" };
    await expect(
      strict.create(SYSTEM, {
        type: "ldap",
        name: "Plain",
        config: { ...directory, url: "ldap://ldap.example.org" },
        credential: password,
      }),
    ).rejects.toMatchObject({
      code: "invalidProviderConfiguration",
      details: { fields: ["url", "startTls"] },
    });
    for (const url of ["ldaps://ldap.example.org", "ldap://ldap.example.org"]) {
      const created = await strict.create(SYSTEM, {
        type: "ldap",
        name: "Secure",
        config: { ...directory, url, startTls: url.startsWith("ldap:") },
        credential: password,
      });
      expect(created.provider.type).toBe("ldap");
    }
    await expect(
      strict.create(SYSTEM, {
        type: "ldap",
        name: "Twice",
        config: { ...directory, url: "ldaps://ldap.example.org", startTls: true },
        credential: password,
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    await expect(
      strict.create(SYSTEM, {
        type: "saml",
        name: "Plain metadata",
        config: { preset: "generic", metadata: { source: "url", url: "http://idp.example.org/metadata" } },
      }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration", details: { fields: ["metadata.url"] } });
    await expect(
      strict.create(SYSTEM, {
        type: "ldap",
        name: "Wrong credential",
        config: { ...directory, url: "ldaps://ldap.example.org" },
        credential: { kind: "clientSecret", secret: "x", expiresAt: null },
      }),
    ).rejects.toMatchObject({ code: "invalidInput" });
  });

  it("turns password sign-in off for the instance, but always lets the instance owner in and tells the administrators", async () => {
    const org = await organization();
    const member = await account(org.id);
    await test.database.transaction((tx) =>
      test.services.memberships
        .add(tx, SYSTEM, { organizationId: org.id, accountId: member.id, kind: "member" })
        .catch(() => undefined),
    );
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    await expect(
      test.services.signIn.signInWithPassword({ email: member.email ?? "", password: PASSWORD, client: {} }),
    ).rejects.toThrow(PasswordSignInDisabledError);

    const administrator = await account(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    await test.pool.query("update instance set owner_account_id = $1", [org.owner]);
    try {
      const setup = await test.services.totp.begin(org.owner, { issuer: "Test", account: "owner" });
      if (!setup) throw new Error("TOTP was not started");
      const secret = Secret.fromBase32(setup.secret);
      await test.services.totp.verify(test.database, org.owner, TOTP.generate({ secret }), {
        confirming: true,
      });
      const owner = await test.services.accounts.get(org.owner);
      const first = await test.services.signIn.signInWithPassword({
        email: owner?.email ?? "",
        password: PASSWORD,
        client: { ip: "203.0.113.9" },
      });
      if (first.status !== "secondFactorRequired") throw new Error("A second factor was expected");
      await test.services.signIn.completeSecondFactor({
        pendingToken: first.pendingToken,
        factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
        client: { ip: "203.0.113.9" },
      });
      const audited = await test.pool.query(
        "select actor_id from audit_events where name = 'auth.emergencySignIn'",
      );
      expect(audited.rows).toEqual([{ actor_id: org.owner }]);
      const notified = await test.pool.query(
        "select recipient_id from notifications where type = 'auth.emergencySignIn' order by recipient_id",
      );
      expect(notified.rows.map((row) => row.recipient_id).sort()).toEqual(
        [administrator.id, org.owner].sort(),
      );
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
    }
  });

  async function enableTotp(accountId: string) {
    const setup = await test.services.totp.begin(accountId, { issuer: "Test", account: "person" });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, accountId, TOTP.generate({ secret }), {
      confirming: true,
    });
    return secret;
  }

  it("tells the people and addresses the instance owner chose about an emergency sign-in", async () => {
    const org = await organization();
    const administrator = await account(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    const security = await account(null);
    await test.pool.query("update instance set owner_account_id = $1", [org.owner]);
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@example.org",
    });
    try {
      expect(await test.services.emergencyRecipients.get()).toEqual({
        instanceAdministrators: true,
        accounts: [],
        addresses: [],
      });
      const choice = {
        instanceAdministrators: false,
        accountIds: [security.id],
        addresses: ["Alarm@Example.net"],
      };
      await expect(
        test.services.emergencyRecipients.set(accountPrincipal(administrator.id), choice),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        test.services.emergencyRecipients.set(accountPrincipal(org.owner), {
          ...choice,
          accountIds: [randomUUID()],
        }),
      ).rejects.toMatchObject({ code: "invalidInput" });
      expect(await test.services.emergencyRecipients.set(accountPrincipal(org.owner), choice)).toMatchObject({
        instanceAdministrators: false,
        accounts: [{ id: security.id }],
        addresses: ["alarm@example.net"],
      });
      const audited = await test.pool.query(
        "select fields from audit_events where name = 'settings.changed' and target_id = 'auth.emergencySignInRecipients'",
      );
      expect(audited.rows).toHaveLength(1);

      const secret = await enableTotp(org.owner);
      const owner = await test.services.accounts.get(org.owner);
      const first = await test.services.signIn.signInWithPassword({
        email: owner?.email ?? "",
        password: PASSWORD,
        client: {},
      });
      if (first.status !== "secondFactorRequired") throw new Error("A second factor was expected");
      const signedIn = await test.services.signIn.completeSecondFactor({
        pendingToken: first.pendingToken,
        factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
        client: {},
      });
      const notified = await test.pool.query(
        "select recipient_id from notifications where type = 'auth.emergencySignIn' and target_id = $1",
        [org.owner],
      );
      expect(notified.rows.map((row) => row.recipient_id).sort()).toEqual([org.owner, security.id].sort());
      expect(signedIn.session.accountId).toBe(org.owner);
      await deliverPendingMail(test.services, test.database);
      expect(test.mail.sent.map((mail) => mail.to)).toContain("alarm@example.net");
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
      await test.settings.clear(smtpSetting, {}, "instance");
    }
  });

  it("lets administrators link and unlink identities but never the last way to sign in", async () => {
    const org = await organization();
    const provider = await instanceProvider();
    const target = await account(org.id);
    const admin = await account(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: admin.id },
    });
    const outsider = await account(null);
    await expect(
      test.services.administration.linkIdentity(accountPrincipal(outsider.id), target.id, {
        providerId: provider.id,
        subject: "abc",
      }),
    ).rejects.toThrow(ForbiddenError);
    const linked = await test.services.administration.linkIdentity(accountPrincipal(admin.id), target.id, {
      providerId: provider.id,
      subject: "abc",
    });
    expect(linked).toMatchObject({ providerId: provider.id, subject: "abc" });
    await expect(
      test.services.administration.linkIdentity(accountPrincipal(admin.id), admin.id, {
        providerId: provider.id,
        subject: "abc",
      }),
    ).rejects.toMatchObject({ code: "identityInUse" });

    await test.pool.query("update accounts set password_hash = null where id = $1", [target.id]);
    await expect(
      test.services.administration.unlinkIdentity(accountPrincipal(admin.id), target.id, linked.id),
    ).rejects.toMatchObject({ code: "lastSignInMethod" });
    await test.pool.query("update accounts set password_hash = 'x' where id = $1", [target.id]);
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    try {
      await expect(
        test.services.administration.unlinkIdentity(accountPrincipal(admin.id), target.id, linked.id),
      ).rejects.toMatchObject({ code: "lastSignInMethod" });
    } finally {
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
    }
    await expect(
      test.services.administration.unlinkIdentity(accountPrincipal(admin.id), target.id, linked.id),
    ).resolves.toEqual({ endedSessions: 0 });
    expect(await test.services.administration.identities(target.id)).toEqual([]);
  });

  it("lets people unlink their own identity only while another working way to sign in remains", async () => {
    const first = await instanceProvider(null, [uniqueDomain()]);
    const second = await instanceProvider(null, [uniqueDomain()]);
    const person = await account(null);
    await test.pool.query("update accounts set password_hash = null where id = $1", [person.id]);
    const own = await test.services.administration.linkIdentity(SYSTEM, person.id, {
      providerId: first.id,
      subject: randomUUID(),
    });
    const other = await test.services.administration.linkIdentity(SYSTEM, person.id, {
      providerId: second.id,
      subject: randomUUID(),
    });
    await test.services.identityProviders.deactivate(SYSTEM, second.id);
    await expect(test.services.administration.unlinkOwnIdentity(person.id, own.id)).rejects.toMatchObject({
      code: "lastSignInMethod",
    });
    await test.services.identityProviders.activate(SYSTEM, second.id);
    await expect(test.services.administration.unlinkOwnIdentity(person.id, own.id)).resolves.toEqual({
      endedSessions: 0,
    });
    await expect(test.services.administration.unlinkOwnIdentity(person.id, other.id)).rejects.toMatchObject({
      code: "lastSignInMethod",
    });
    const stranger = await account(null);
    await expect(test.services.administration.unlinkOwnIdentity(stranger.id, other.id)).rejects.toMatchObject(
      {
        code: "notFound",
      },
    );
    const audit = await test.pool.query<{ actor_id: string }>(
      "select actor_id from audit_events where name = 'identity.unlinked' and target_id = $1",
      [person.id],
    );
    expect(audit.rows).toEqual([{ actor_id: person.id }]);
  });
});
