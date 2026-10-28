import { randomUUID } from "node:crypto";
import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { smtpSetting } from "../mail/mail-service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createFakeSamlIdp } from "../testing/fakes/saml-idp.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { IdentityProviderService } from "./providers.js";

const baseUrl = testDatabaseBaseUrl();
const PASSWORD = "a long test passphrase";
const DAY = 24 * 60 * 60 * 1000;

const GENERIC = {
  preset: "generic",
  issuer: "https://idp.example.org",
  clientId: "lunedo",
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

  it("checks the discovery document and the metadata address before saving", async () => {
    const answers = new Map<string, () => Response>([
      [
        "https://id.example.org/realms/wrong/.well-known/openid-configuration",
        () => new Response("", { status: 404 }),
      ],
      [
        "https://id.example.org/realms/other/.well-known/openid-configuration",
        () => Response.json({ issuer: "https://id.example.org/realms/main" }),
      ],
      [
        "https://id.example.org/realms/main/.well-known/openid-configuration",
        () => Response.json({ issuer: "https://id.example.org/realms/main" }),
      ],
      ["https://id.example.org/saml/missing", () => new Response("", { status: 404 })],
      ["https://id.example.org/saml/broken", () => new Response("<not-metadata/>")],
    ]);
    const service = new IdentityProviderService({
      database: test.database,
      audit: test.services.audit,
      encryption: test.encryption,
      notifications: test.services.notifications,
      allowInsecure: false,
      fetch: async (input) => {
        const answer = answers.get(String(input));
        if (!answer) throw new Error("getaddrinfo ENOTFOUND unknown.example.org");
        return answer();
      },
    });
    const oidc = (issuer: string) =>
      service.checkDiscovery(service.parseConnection("oidc", { ...GENERIC, issuer }) as never);
    expect(await oidc("https://id.example.org/realms/wrong/")).toEqual({
      ok: false,
      check: "discovery",
      url: "https://id.example.org/realms/wrong/.well-known/openid-configuration",
      status: 404,
      problem: "status",
      detail: null,
    });
    expect(await oidc("https://id.example.org/realms/other")).toMatchObject({
      ok: false,
      problem: "issuerMismatch",
      detail: "https://id.example.org/realms/main",
    });
    expect(await oidc("https://unknown.example.org")).toMatchObject({
      ok: false,
      problem: "unreachable",
      status: null,
    });
    expect(await oidc("https://id.example.org/realms/main")).toMatchObject({ ok: true, problem: null });
    const saml = (url: string) =>
      service.checkMetadata(
        service.parseConnection("saml", { preset: "generic", metadata: { source: "url", url } }) as never,
      );
    expect(await saml("https://id.example.org/saml/missing")).toMatchObject({
      ok: false,
      check: "metadata",
      status: 404,
      problem: "status",
    });
    expect(await saml("https://id.example.org/saml/broken")).toMatchObject({
      ok: false,
      problem: "invalidDocument",
    });
  });

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
    expect(certificate.subject).toContain("Lunedo");
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
      expect(provider.expiringCredentials).toEqual([
        { purpose: "clientCredential", expiresAt: expect.any(Date) },
      ]);
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

  describe("credentials of different purposes", () => {
    async function asOwner<T>(run: () => Promise<T>): Promise<T> {
      const { owner } = await organization();
      await test.pool.query("update instance set owner_account_id = $1", [owner]);
      try {
        return await run();
      } finally {
        await test.pool.query("update instance set owner_account_id = null");
      }
    }

    async function entraSaml() {
      const idp = await createFakeSamlIdp();
      const { provider } = await test.services.identityProviders.create(SYSTEM, {
        type: "saml",
        name: `Entra SAML ${randomUUID().slice(0, 6)}`,
        config: { preset: "entraId", tenantId: randomUUID(), metadata: { source: "file" } },
        metadataXml: idp.metadata(),
      });
      await test.services.identityProviders.update(SYSTEM, provider.id, {
        config: { ...provider.config, graphClientId: "graph-client" },
      });
      return provider.id;
    }

    async function expireIn(credentialId: string, days: number) {
      await test.pool.query(
        "update identity_provider_credentials set expires_at = now() + make_interval(days => $2) where id = $1",
        [credentialId, days],
      );
    }

    async function signingCredentials(providerId: string): Promise<string[]> {
      const result = await test.pool.query<{ id: string }>(
        "select id from identity_provider_credentials where provider_id = $1 and kind = 'samlSigning' order by created_at, id",
        [providerId],
      );
      return result.rows.map((row) => row.id);
    }

    async function graphSecret(providerId: string, days: number) {
      return test.services.identityProviders.addCredential(SYSTEM, providerId, {
        kind: "clientSecret",
        secret: `graph-secret-${randomUUID()}`,
        expiresAt: new Date(Date.now() + days * DAY),
      });
    }

    async function reminders(providerId: string) {
      const result = await test.pool.query<{ params: { credential: string | null }; count: number }>(
        "select params, count from notifications where type = 'identityProvider.credentialExpiring' and target_id = $1 order by created_at, id",
        [providerId],
      );
      return result.rows.map((row) => ({ credential: row.params.credential, count: row.count }));
    }

    it("warns about an expiring signing certificate although the Graph credential is valid much longer", async () => {
      await asOwner(async () => {
        const id = await entraSaml();
        const [signing] = await signingCredentials(id);
        if (!signing) throw new Error("No signing certificate was created");
        await expireIn(signing, 5);
        await graphSecret(id, 300);
        const provider = await test.services.identityProviders.get(id);
        expect(provider.warnings).toContain("credentialExpiring");
        expect(provider.expiringCredentials).toEqual([
          { purpose: "signingCertificate", expiresAt: expect.any(Date) },
        ]);
        await test.services.identityProviders.sendCredentialReminders();
        await test.services.identityProviders.sendCredentialReminders();
        expect(await reminders(id)).toEqual([{ credential: "signingCertificate", count: 2 }]);
      });
    });

    it("keeps the reminders of each purpose apart and sends each only once", async () => {
      await asOwner(async () => {
        const id = await entraSaml();
        const [signing] = await signingCredentials(id);
        if (!signing) throw new Error("No signing certificate was created");
        await expireIn(signing, 20);
        const graph = await graphSecret(id, 20);
        await test.services.identityProviders.sendCredentialReminders();
        await test.services.identityProviders.sendCredentialReminders();
        const first = await reminders(id);
        expect(first.map((row) => row.credential).sort()).toEqual(["graphCredential", "signingCertificate"]);
        expect(first.every((row) => row.count === 1)).toBe(true);
        expect((await test.services.identityProviders.get(id)).expiringCredentials).toEqual([
          { purpose: "signingCertificate", expiresAt: expect.any(Date) },
          { purpose: "graphCredential", expiresAt: expect.any(Date) },
        ]);
        await expireIn(graph.id, 5);
        await test.services.identityProviders.sendCredentialReminders();
        await test.services.identityProviders.sendCredentialReminders();
        const second = await reminders(id);
        expect(second).toHaveLength(2);
        expect(second.find((row) => row.credential === "graphCredential")?.count).toBe(2);
        expect(second.find((row) => row.credential === "signingCertificate")?.count).toBe(1);
      });
    });

    it("stays silent about a signing certificate replaced by a newer one, but not about the Graph credential", async () => {
      await asOwner(async () => {
        const id = await entraSaml();
        const [older] = await signingCredentials(id);
        if (!older) throw new Error("No signing certificate was created");
        await test.services.identityProviders.addCredential(SYSTEM, id, {
          kind: "samlSigning",
          validDays: 730,
        });
        await expireIn(older, 5);
        await graphSecret(id, 10);
        const provider = await test.services.identityProviders.get(id);
        expect(provider.expiringCredentials).toEqual([
          { purpose: "graphCredential", expiresAt: expect.any(Date) },
        ]);
        await test.services.identityProviders.sendCredentialReminders();
        expect(await reminders(id)).toEqual([{ credential: "graphCredential", count: 1 }]);
      });
    });

    it("reminds once about two credentials of one purpose that expire at the same moment", async () => {
      await asOwner(async () => {
        const id = await entraSaml();
        await graphSecret(id, 300);
        await graphSecret(id, 300);
        await test.pool.query(
          "update identity_provider_credentials set expires_at = date_trunc('second', now()) + interval '10 days' where provider_id = $1 and kind = 'clientSecret'",
          [id],
        );
        await test.services.identityProviders.sendCredentialReminders();
        expect(await reminders(id)).toEqual([{ credential: "graphCredential", count: 1 }]);
      });
    });

    it("does not count an expired credential as a valid one of its purpose", async () => {
      await asOwner(async () => {
        const id = await entraSaml();
        const [signing] = await signingCredentials(id);
        if (!signing) throw new Error("No signing certificate was created");
        await expireIn(signing, 5);
        const graph = await graphSecret(id, 300);
        await test.pool.query(
          "update identity_provider_credentials set expires_at = now() - interval '1 day' where id = $1",
          [graph.id],
        );
        const provider = await test.services.identityProviders.get(id);
        expect(provider.warnings).toEqual(
          expect.arrayContaining(["credentialExpiring", "credentialExpired"]),
        );
        expect(provider.expiringCredentials).toEqual([
          { purpose: "signingCertificate", expiresAt: expect.any(Date) },
        ]);
      });
    });

    it("names an expiring CA certificate of a directory next to its bind password", async () => {
      const { provider } = await test.services.identityProviders.create(SYSTEM, {
        type: "ldap",
        name: `Directory ${randomUUID().slice(0, 6)}`,
        config: {
          preset: "generic",
          url: "ldaps://ldap.example.org",
          bindDn: "cn=lunedo,dc=example,dc=org",
          userBaseDn: "ou=people,dc=example,dc=org",
          groupBaseDn: "ou=groups,dc=example,dc=org",
        },
        credential: { kind: "bindPassword", secret: "service password" },
      });
      await test.pool.query(
        `insert into identity_provider_ca_certificates (provider_id, certificates, fingerprint, subject, expires_at)
         values ($1, 'certificate', '12:34', 'CN=Root CA', now() + interval '10 days')`,
        [provider.id],
      );
      const expiring = await test.services.identityProviders.get(provider.id);
      expect(expiring.warnings).toEqual(["caCertificateExpiring"]);
      expect(expiring.expiringCredentials).toEqual([
        { purpose: "caCertificate", expiresAt: expect.any(Date) },
      ]);
      await test.pool.query(
        "update identity_provider_ca_certificates set expires_at = now() + interval '400 days' where provider_id = $1",
        [provider.id],
      );
      const renewed = await test.services.identityProviders.get(provider.id);
      expect(renewed.warnings).toEqual([]);
      expect(renewed.expiringCredentials).toEqual([]);
    });
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
      allowInsecure: false,
    });
    const directory = {
      preset: "generic",
      bindDn: "cn=lunedo,dc=example,dc=org",
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

  async function enableTotp(accountId: string) {
    const setup = await test.services.totp.begin(accountId, { issuer: "Test", account: "person" });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, accountId, TOTP.generate({ secret }), {
      confirming: true,
    });
    return secret;
  }

  it("counts a local sign-in of the instance owner as emergency sign-in only while a provider is active", async () => {
    const org = await organization();
    const administrator = await account(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    await test.pool.query("update instance set owner_account_id = $1", [org.owner]);
    const paused = await test.pool.query<{ id: string }>(
      "update identity_providers set deactivated_at = now() where deactivated_at is null returning id",
    );
    const provider = await instanceProvider();
    try {
      const secret = await enableTotp(org.owner);
      const owner = await test.services.accounts.get(org.owner);
      const signInOwner = async (offset: number) => {
        await test.pool.query("update totp_credentials set last_used_step = null where account_id = $1", [
          org.owner,
        ]);
        const first = await test.services.signIn.signInWithPassword({
          email: owner?.email ?? "",
          password: PASSWORD,
          client: { ip: "203.0.113.9" },
        });
        if (first.status !== "secondFactorRequired") throw new Error("A second factor was expected");
        await test.services.signIn.completeSecondFactor({
          pendingToken: first.pendingToken,
          factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + offset }) },
          client: { ip: "203.0.113.9" },
        });
      };
      await test.services.identityProviders.deactivate(SYSTEM, provider.id);
      await signInOwner(30_000);
      const quiet = await test.pool.query("select 1 from audit_events where name = 'auth.emergencySignIn'");
      expect(quiet.rows).toEqual([]);
      await test.services.identityProviders.activate(SYSTEM, provider.id);
      await signInOwner(30_000);
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
      await test.services.identityProviders.remove(SYSTEM, provider.id);
      await test.pool.query("update identity_providers set deactivated_at = null where id = any($1)", [
        paused.rows.map((row) => row.id),
      ]);
    }
  });

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
    const provider = await instanceProvider();
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@example.org",
      oauth2: null,
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
      await test.services.identityProviders.remove(SYSTEM, provider.id);
      await test.settings.clear(smtpSetting, {}, "instance");
    }
  });

  it("lets administrators link and unlink identities, also the last way to sign in", async () => {
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
      code: "managedIdentity",
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
