import { randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import {
  ChallengeExpiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  LockedError,
  RateLimitedError,
} from "../auth/errors.js";
import { accountLockoutFailuresSetting, twoFactorRequiredSetting } from "../auth/settings.js";
import { ForbiddenError } from "../authorization/service.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { testDatabaseBaseUrl, waitForLockWait } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider, type TokenOverrides } from "../testing/fake-oidc.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { VirtualAuthenticator } from "../testing/webauthn.js";
import { managedStateOf } from "./managed.js";
import { type CallbackResult, providerProvedSecondFactor } from "./sign-in.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://lunedo.test";
const PASSWORD = "a long test passphrase";

describe.skipIf(!baseUrl)("signing in through an OpenID Connect provider", () => {
  let test: TestServices;
  let idp: FakeOidcProvider;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    idp = await startFakeOidcProvider();
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  afterEach(async () => {
    await test.pool.query("update instance set owner_account_id = null");
  });

  async function asOwner(accountId: string) {
    await test.pool.query("update instance set owner_account_id = $1", [accountId]);
  }

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
    return created.id;
  }

  async function provider(options: {
    accountCreation?: boolean;
    requiredGroups?: string[];
    domains?: string[];
    issuer?: FakeOidcProvider;
    secondFactor?: { mode: "provider" | "providerProof"; proofValues?: string[] };
  }) {
    const source = options.issuer ?? idp;
    const domains = options.domains ?? ["example.org"];
    await releaseDomains(domains);
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: "Test provider",
      config: {
        preset: "generic",
        issuer: source.issuer,
        clientId: source.clientId,
        domains,
        accountCreation: {
          enabled: options.accountCreation ?? false,
          requiredGroups: options.requiredGroups ?? [],
        },
        ...(options.secondFactor ? { secondFactor: options.secondFactor } : {}),
        claims: {
          email: "email",
          signInName: "preferred_username",
          displayName: "name",
          groups: "groups",
          groupNames: "group_names",
        },
      },
      credential: { kind: "clientSecret", secret: source.clientSecret, expiresAt: null },
    });
    return created.id;
  }

  async function releaseDomains(domains: string[]) {
    await test.pool.query("delete from identity_provider_domains where domain = any($1)", [domains]);
  }

  async function signIn(
    providerId: string,
    claims: Record<string, unknown>,
    options: { overrides?: TokenOverrides; issuer?: FakeOidcProvider } = {},
  ): Promise<CallbackResult> {
    const started = await test.services.providerSignIn.start({
      providerId,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const callback = await (options.issuer ?? idp).authorize(started.url, claims, options.overrides);
    return test.services.providerSignIn.callback({
      providerId,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
  }

  it("signs a person in to the placeholder an administrator created for them", async () => {
    const org = await organization();
    const domain = `${randomUUID().slice(0, 8)}.example.org`;
    const id = await provider({ accountCreation: true, domains: [domain] });
    const email = `dave@${domain}`;
    const placeholder = await test.services.accountLifecycle.createPlaceholder(SYSTEM, {
      name: "Dave",
      email,
    });
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values (gen_random_uuid(), $1, $2, 'member')",
      [org, placeholder.id],
    );
    const group = randomUUID();
    for (const homeOrganization of [true, false]) {
      await test.services.mappingRules.create(SYSTEM, id, {
        target: "organization",
        group: { id: group, name: "Staff" },
        organizationId: org,
        role: { builtIn: "administrator" },
        synchronizedGroup: homeOrganization,
        homeOrganization,
      });
    }
    const result = await runWithRequestContext({ requestId: randomUUID(), actor: ANONYMOUS }, () =>
      signIn(id, { sub: randomUUID(), email, name: "Dave Example", groups: [group] }),
    );
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session.accountId).toBe(placeholder.id);
    expect(await test.services.accounts.get(placeholder.id)).toMatchObject({
      state: "active",
      name: "Dave Example",
    });
    const events = await test.pool.query(
      "select name from audit_events where target_id = $1 and name = 'account.placeholderMerged'",
      [placeholder.id],
    );
    expect(events.rowCount).toBe(1);
    expect(await managedStateOf(test.database, placeholder.id)).toMatchObject({
      providerId: id,
      source: "identity",
    });
  });

  it("creates an account at the first sign-in and signs it in again by its identifier", async () => {
    const org = await organization();
    const home = `${randomUUID().slice(0, 8)}.example.org`;
    await test.pool.query("insert into organization_domains (domain, organization_id) values ($1, $2)", [
      home,
      org,
    ]);
    const id = await provider({ accountCreation: true, domains: ["example.org", home] });
    const subject = randomUUID();
    const email = `new.${subject.slice(0, 8)}@${home}`;
    const first = await signIn(id, { sub: subject, email, name: "New Person", preferred_username: "new" });
    if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
    const created = await test.services.accounts.get(first.signedIn.session.accountId);
    expect(created).toMatchObject({ email, name: "New Person", homeOrganizationId: org, passwordHash: null });
    expect(first.signedIn.session.methods).toEqual(["identityProvider"]);

    const second = await signIn(id, {
      sub: subject,
      email: `renamed.${subject.slice(0, 8)}@example.org`,
      name: "Renamed",
    });
    if (second.kind !== "signedIn") throw new Error("Signed in expected");
    expect(second.signedIn.session.accountId).toBe(created?.id);
    const identity = await test.pool.query("select email, display_name from identities where subject = $1", [
      subject,
    ]);
    expect(identity.rows).toEqual([
      { email: `renamed.${subject.slice(0, 8)}@example.org`, display_name: "Renamed" },
    ]);
  });

  it("uses PKCE, a single-use state bound to the browser and a single-use nonce", async () => {
    const id = await provider({ accountCreation: true });
    const started = await test.services.providerSignIn.start({
      providerId: id,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const authorization = new URL(started.url).searchParams;
    expect(authorization.get("code_challenge_method")).toBe("S256");
    expect(authorization.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(authorization.get("nonce")).toBeTruthy();
    const callback = await idp.authorize(started.url, {
      sub: randomUUID(),
      email: `p.${randomUUID()}@example.org`,
    });

    await expect(
      test.services.providerSignIn.callback({
        providerId: id,
        query: callback.searchParams,
        browserToken: "another browser",
        client: {},
      }),
    ).rejects.toThrow(ChallengeExpiredError);
    await expect(
      test.services.providerSignIn.callback({
        providerId: id,
        query: callback.searchParams,
        browserToken: started.browserToken,
        client: {},
      }),
    ).rejects.toThrow(ChallengeExpiredError);

    const again = await test.services.providerSignIn.start({
      providerId: id,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const replayed = await idp.authorize(again.url, {
      sub: randomUUID(),
      email: `q.${randomUUID()}@example.org`,
    });
    const result = await test.services.providerSignIn.callback({
      providerId: id,
      query: replayed.searchParams,
      browserToken: again.browserToken,
      client: {},
    });
    expect(result.kind).toBe("signedIn");
    expect(idp.tokenRequests().at(-1)?.get("code_verifier")).toMatch(/^[\w-]{43}$/);
    await expect(
      test.services.providerSignIn.callback({
        providerId: id,
        query: replayed.searchParams,
        browserToken: again.browserToken,
        client: {},
      }),
    ).rejects.toThrow(ChallengeExpiredError);
  });

  it.each<[string, TokenOverrides]>([
    ["a nonce from another sign-in", { nonce: "an-old-nonce" }],
    ["no nonce", { omitNonce: true }],
    ["another issuer", { issuer: "https://attacker.example" }],
    ["another audience", { audience: "another-client" }],
    ["no signature", { algorithm: "none" }],
    ["a signature with the client secret", { algorithm: "HS256" }],
    ["an expired token", { expiresInSeconds: -600 }],
  ])("refuses an ID token with %s", async (_name, overrides) => {
    const id = await provider({ accountCreation: true });
    const result = await signIn(
      id,
      { sub: randomUUID(), email: `x.${randomUUID()}@example.org` },
      {
        overrides,
      },
    );
    expect(result).toMatchObject({ kind: "refused", reason: "invalidResponse" });
    const refusal = await test.services.providerSignIn.refusal(
      result.kind === "refused" ? result.reference : "",
    );
    expect(refusal).toMatchObject({ reason: "invalidResponse", providerId: id });
  });

  it("never links or creates accounts through an e-mail address outside the configured domains", async () => {
    const org = await organization();
    const existing = await account(org, `owner.${randomUUID().slice(0, 8)}@other.example`);
    const closed = await provider({});
    expect(await signIn(closed, { sub: randomUUID(), email: existing.email })).toMatchObject({
      kind: "refused",
      reason: "accountCreationDisabled",
    });
    const open = await provider({ accountCreation: true });
    expect(await signIn(open, { sub: randomUUID(), email: existing.email })).toMatchObject({
      kind: "refused",
      reason: "domainNotAllowed",
    });
    const identities = await test.pool.query("select 1 from identities where account_id = $1", [existing.id]);
    expect(identities.rows).toEqual([]);
  });

  it("creates accounts without an organization, tells the administrators and lets them assign one", async () => {
    const administrator = await account(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    const org = await organization();
    const domain = `${randomUUID().slice(0, 8)}.example.net`;
    const id = await provider({ accountCreation: true, domains: [domain] });
    const subject = randomUUID();
    const result = await signIn(id, { sub: subject, email: `lost@${domain}`, name: "Lost Person" });
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    const accountId = result.signedIn.session.accountId;
    expect(await test.services.accounts.get(accountId)).toMatchObject({ homeOrganizationId: null });
    const notified = await test.pool.query<{ recipient_id: string; params: Record<string, unknown> }>(
      "select recipient_id, params from notifications where type = 'account.withoutOrganization' and target_id = $1",
      [accountId],
    );
    expect(notified.rows).toEqual([
      {
        recipient_id: administrator.id,
        params: { accountName: "Lost Person", email: `lost@${domain}`, providerName: "Test provider" },
      },
    ]);
    const without = await test.services.overview.listAccounts({ limit: 200 }, { withoutOrganization: true });
    expect(without.items.map((item) => item.id)).toContain(accountId);
    expect(without.items.every((item) => item.organizations.length === 0)).toBe(true);

    await expect(
      test.services.administration.assignOrganization(accountPrincipal(accountId), accountId, org),
    ).rejects.toThrow(ForbiddenError);
    await test.services.administration.assignOrganization(accountPrincipal(administrator.id), accountId, org);
    expect(await test.services.accounts.get(accountId)).toMatchObject({ homeOrganizationId: org });
    const membership = await test.pool.query(
      "select kind from memberships where organization_id = $1 and account_id = $2",
      [org, accountId],
    );
    expect(membership.rows).toEqual([{ kind: "member" }]);
    await expect(
      test.services.administration.assignOrganization(accountPrincipal(administrator.id), accountId, org),
    ).rejects.toMatchObject({ code: "accountHasOrganization" });
    const audited = await test.pool.query(
      "select fields from audit_events where name = 'account.organizationAssigned' and target_id = $1",
      [accountId],
    );
    expect(audited.rows).toEqual([{ fields: { organizationId: org } }]);
  });

  it("refuses a sign-in without proof of a second factor when the provider is set to require one", async () => {
    const id = await provider({ accountCreation: true, secondFactor: { mode: "providerProof" } });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@example.org` };
    const refused = await signIn(id, claims);
    expect(refused).toMatchObject({ kind: "refused", reason: "secondFactorMissing" });
    const audited = await test.pool.query(
      "select fields from audit_events where name = 'auth.signInRefused' and target_id = $1",
      [id],
    );
    expect(audited.rows.map((row) => row.fields.reason)).toEqual(["secondFactorMissing"]);
    const created = await test.pool.query("select 1 from identities where subject = $1", [subject]);
    expect(created.rows).toEqual([]);

    const proven = await signIn(id, { ...claims, amr: ["pwd", "mfa"] });
    if (proven.kind !== "signedIn") throw new Error(`Signed in expected, got ${proven.kind}`);
    expect(proven.signedIn.session).toMatchObject({ kind: "full", methods: ["identityProvider"] });
  });

  it("never asks managed accounts of a provider for a Lunedo second factor, also when 2FA is enforced", async () => {
    const id = await provider({ accountCreation: true });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@example.org` };
    await test.settings.set(twoFactorRequiredSetting, {}, "instance", true);
    try {
      const first = await signIn(id, claims);
      if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
      expect(first.signedIn.session.kind).toBe("full");
      expect(await test.services.signIn.secondFactorRequirement(first.signedIn.session.accountId)).toBeNull();
    } finally {
      await test.settings.clear(twoFactorRequiredSetting, {}, "instance");
    }
  });

  it("accepts the configured proof values of a provider", () => {
    const setting = { mode: "providerProof" as const, proofValues: ["hwk", "otp"] };
    expect(providerProvedSecondFactor(setting, ["pwd", "otp"])).toBe(true);
    expect(providerProvedSecondFactor(setting, ["pwd", "mfa"])).toBe(false);
    expect(providerProvedSecondFactor({ mode: "provider", proofValues: ["mfa"] }, [])).toBe(true);
  });

  it("keeps a pending link of the instance owner for 15 minutes and refuses it afterwards", async () => {
    const existing = await account(null);
    await asOwner(existing.id);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    const stored = await test.pool.query<{ minutes: number }>(
      `select extract(epoch from expires_at - now()) / 60 as minutes from auth_challenges
        where purpose = 'identityLink' and account_id = $1`,
      [existing.id],
    );
    expect(Number(stored.rows[0]?.minutes)).toBeGreaterThan(14.5);
    expect(Number(stored.rows[0]?.minutes)).toBeLessThanOrEqual(15);
    await test.pool.query(
      "update auth_challenges set expires_at = now() - interval '1 second' where purpose = 'identityLink' and account_id = $1",
      [existing.id],
    );
    await expect(test.services.providerSignIn.linkInfo(result.pendingToken)).rejects.toThrow(
      ChallengeExpiredError,
    );
  });

  it("links the account of the instance owner only after its password and second factor and keeps it local", async () => {
    const org = await organization();
    const existing = await account(org);
    await asOwner(existing.id);
    const setup = await test.services.totp.begin(existing.id, {
      issuer: "Test",
      account: existing.email ?? "",
    });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, existing.id, TOTP.generate({ secret }), {
      confirming: true,
    });
    const id = await provider({});
    const subject = randomUUID();
    const result = await signIn(id, { sub: subject, email: existing.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({
      providerName: "Test provider",
      email: existing.email,
      factors: ["totp"],
    });

    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: result.pendingToken,
        password: "wrong",
        factor: null,
        client: {},
      }),
    ).rejects.toThrow(InvalidCredentialsError);
    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: result.pendingToken,
        password: PASSWORD,
        factor: null,
        client: {},
      }),
    ).rejects.toThrow(InvalidSecondFactorError);
    const linked = await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      password: PASSWORD,
      factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
      client: {},
    });
    expect(linked.session).toMatchObject({
      accountId: existing.id,
      methods: ["password", "totp", "identityProvider"],
    });
    const again = await signIn(id, { sub: subject, email: existing.email });
    expect(again.kind).toBe("secondFactorRequired");
    expect(await managedStateOf(test.database, existing.id)).toBeNull();
    expect((await test.services.accounts.get(existing.id))?.passwordHash).not.toBeNull();
  });

  it("counts wrong second factors against the owner's account when linking, from any address", async () => {
    const existing = await account(null);
    await asOwner(existing.id);
    const secret = await enableTotp(existing.id);
    const id = await provider({});
    const subject = randomUUID();
    const first = await signIn(id, { sub: subject, email: existing.email });
    if (first.kind !== "linkRequired") throw new Error(`Linking expected, got ${first.kind}`);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        test.services.signIn.confirmIdentityLink({
          pendingToken: first.pendingToken,
          password: PASSWORD,
          factor: { type: "totp", code: "000000" },
          client: { ip: `198.51.100.${attempt + 10}` },
        }),
      ).rejects.toThrow(InvalidSecondFactorError);
    }

    const second = await signIn(id, { sub: subject, email: existing.email });
    if (second.kind !== "linkRequired") throw new Error(`Linking expected, got ${second.kind}`);
    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: second.pendingToken,
        password: PASSWORD,
        factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
        client: { ip: "198.51.100.99" },
      }),
    ).rejects.toThrow(LockedError);
    expect(await localCredentials(existing.id)).toMatchObject({ sessions: 0 });
  });

  it("limits the second factors tried for the owner's account per minute when linking, from any address", async () => {
    await test.settings.set(accountLockoutFailuresSetting, {}, "instance", 1000);
    try {
      const existing = await account(null);
      await asOwner(existing.id);
      await enableTotp(existing.id);
      const id = await provider({});
      const subject = randomUUID();
      const outcomes: unknown[] = [];
      for (let round = 0; round < 3; round += 1) {
        const pending = await signIn(id, { sub: subject, email: existing.email });
        if (pending.kind !== "linkRequired") throw new Error(`Linking expected, got ${pending.kind}`);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          outcomes.push(
            await test.services.signIn
              .confirmIdentityLink({
                pendingToken: pending.pendingToken,
                password: PASSWORD,
                factor: { type: "totp", code: "000000" },
                client: { ip: `198.51.100.${round * 10 + attempt + 120}` },
              })
              .catch((error: unknown) => error),
          );
        }
      }
      expect(outcomes.filter((outcome) => outcome instanceof InvalidSecondFactorError)).toHaveLength(10);
      expect(outcomes.slice(10).every((outcome) => outcome instanceof RateLimitedError)).toBe(true);
    } finally {
      await test.settings.clear(accountLockoutFailuresSetting, {}, "instance");
    }
  });

  async function localCredentials(accountId: string) {
    const result = await test.pool.query<{
      password: boolean;
      totp: number;
      passkeys: number;
      codes: number;
      sessions: number;
    }>(
      `select (select password_hash is not null from accounts where id = $1) as password,
        (select count(*)::int from totp_credentials where account_id = $1) as totp,
        (select count(*)::int from webauthn_credentials where account_id = $1) as passkeys,
        (select count(*)::int from recovery_codes where account_id = $1) as codes,
        (select count(*)::int from sessions where account_id = $1) as sessions`,
      [accountId],
    );
    return result.rows[0];
  }

  async function enableTotp(accountId: string) {
    const setup = await test.services.totp.begin(accountId, { issuer: "Test", account: "person" });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, accountId, TOTP.generate({ secret }), {
      confirming: true,
    });
    return secret;
  }

  it("links an existing local account at its first provider sign-in and removes its local credentials", async () => {
    const org = await organization();
    const existing = await account(org);
    await enableTotp(existing.id);
    await test.database.transaction((tx) => test.services.recoveryCodes.generate(tx, existing.id));
    const authenticator = new VirtualAuthenticator();
    const options = await test.services.webauthn.registrationOptions({
      id: existing.id,
      email: existing.email ?? "",
      name: existing.name,
    });
    await test.services.webauthn.register(test.database, {
      accountId: existing.id,
      response: authenticator.register(options, "https://wiki.example.org"),
      expectedChallenge: options.challenge,
      name: "Laptop",
    });
    await test.database.transaction((tx) =>
      test.services.sessions.create(tx, {
        accountId: existing.id,
        kind: "full",
        methods: ["password", "totp"],
        client: {},
      }),
    );
    expect(await localCredentials(existing.id)).toEqual({
      password: true,
      totp: 1,
      passkeys: 1,
      codes: 10,
      sessions: 1,
    });
    const id = await provider({});
    expect(await managedStateOf(test.database, existing.id)).toMatchObject({
      providerId: id,
      source: "domain",
    });

    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session).toMatchObject({
      accountId: existing.id,
      kind: "full",
      methods: ["identityProvider"],
    });
    expect(await managedStateOf(test.database, existing.id)).toMatchObject({
      providerId: id,
      source: "identity",
    });
    expect(await localCredentials(existing.id)).toEqual({
      password: false,
      totp: 0,
      passkeys: 0,
      codes: 0,
      sessions: 1,
    });
    const membership = await test.pool.query(
      "select kind from memberships where organization_id = $1 and account_id = $2",
      [org, existing.id],
    );
    expect(membership.rows).toEqual([{ kind: "member" }]);
    const removed = await test.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'account.localCredentialsRemoved' and target_id = $1",
      [existing.id],
    );
    expect(removed.rows.map((row) => row.fields)).toEqual([
      {
        providerId: id,
        localSignIn: true,
        authenticatorApp: true,
        passkeys: 1,
        recoveryLeft: 10,
        endedSessions: 1,
      },
    ]);
    const mails = await test.pool.query("select 1 from mail_outbox where template = 'accountManaged'");
    expect(mails.rowCount).toBeGreaterThanOrEqual(1);
    await expect(
      test.services.signIn.signInWithPassword({
        email: existing.email ?? "",
        password: PASSWORD,
        client: {},
      }),
    ).rejects.toThrow(InvalidCredentialsError);

    const again = await signIn(id, { sub: randomUUID(), email: existing.email });
    expect(again).toMatchObject({ kind: "refused", reason: "linkAmbiguous" });
    const refused = await test.pool.query(
      "select 1 from audit_events where name = 'auth.signInRefused' and target_id = $1 and fields ->> 'reason' = 'linkAmbiguous'",
      [id],
    );
    expect(refused.rowCount).toBe(1);
    expect(await localCredentials(existing.id)).toMatchObject({ sessions: 1 });
  });

  it("does not link an account when the provider says the address is not verified", async () => {
    const existing = await account(null);
    const id = await provider({});
    const unverified = await signIn(id, { sub: randomUUID(), email: existing.email, email_verified: false });
    expect(unverified).toMatchObject({ kind: "refused", reason: "emailNotVerified" });
    const linked = await test.pool.query("select 1 from identities where account_id = $1", [existing.id]);
    expect(linked.rowCount).toBe(0);
    expect(await localCredentials(existing.id)).toMatchObject({ password: true });

    const verified = await signIn(id, { sub: randomUUID(), email: existing.email, email_verified: true });
    expect(verified).toMatchObject({ kind: "signedIn" });
  });

  it("does not take over a placeholder when the provider says the address is not verified", async () => {
    const domain = `${randomUUID().slice(0, 8)}.example.org`;
    const id = await provider({ accountCreation: true, domains: [domain] });
    const email = `imported@${domain}`;
    const placeholder = await test.services.accountLifecycle.createPlaceholder(SYSTEM, {
      name: "Imported",
      email,
    });
    const result = await signIn(id, { sub: randomUUID(), email, email_verified: false });
    expect(result).toMatchObject({ kind: "refused", reason: "emailNotVerified" });
    expect(await test.services.accounts.get(placeholder.id)).toMatchObject({ state: "placeholder" });
  });

  it("still creates new accounts for addresses in its domains that the provider leaves unverified", async () => {
    const id = await provider({ accountCreation: true });
    const email = `unverified.${randomUUID().slice(0, 8)}@example.org`;
    const result = await signIn(id, { sub: randomUUID(), email, email_verified: false });
    expect(result).toMatchObject({ kind: "signedIn" });
  });

  it("removes local credentials left from before when a linked account signs in through its provider", async () => {
    const existing = await account(null);
    await enableTotp(existing.id);
    const id = await provider({});
    const subject = randomUUID();
    await test.pool.query(
      "insert into identities (id, account_id, provider_id, subject, email_verified) values (gen_random_uuid(), $1, $2, $3, true)",
      [existing.id, id, subject],
    );
    await test.pool.query(
      "insert into managed_accounts (account_id, provider_id, source) values ($1, $2, 'identity') on conflict (account_id) do update set source = 'identity', provider_id = $2",
      [existing.id, id],
    );
    expect(await localCredentials(existing.id)).toMatchObject({ password: true, totp: 1 });

    const result = await signIn(id, { sub: subject, email: existing.email });
    expect(result).toMatchObject({ kind: "signedIn" });
    expect(await localCredentials(existing.id)).toMatchObject({ password: false, totp: 0, sessions: 1 });
    const removed = await test.pool.query(
      "select 1 from audit_events where name = 'account.localCredentialsRemoved' and target_id = $1",
      [existing.id],
    );
    expect(removed.rowCount).toBe(1);
  });

  it("asks an administrator to confirm the link once and then takes the account over", async () => {
    const org = await organization();
    const existing = await account(org);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: existing.id },
    });
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await localCredentials(existing.id)).toMatchObject({ password: true });
    expect(await managedStateOf(test.database, existing.id)).toMatchObject({ source: "domain" });

    const linked = await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      password: PASSWORD,
      factor: null,
      client: {},
    });
    expect(linked.session).toMatchObject({ accountId: existing.id });
    expect(await managedStateOf(test.database, existing.id)).toMatchObject({
      providerId: id,
      source: "identity",
    });
    expect(await localCredentials(existing.id)).toMatchObject({ password: false, sessions: 1 });
  });

  it("asks for a confirmation when an administrator role comes through a group", async () => {
    const org = await organization();
    const existing = await account(org);
    const group = await test.services.groups.create(SYSTEM, org, {
      name: `Admins ${randomUUID().slice(0, 6)}`,
    });
    await test.services.groups.addMember(SYSTEM, group.id, existing.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org,
      role: { builtIn: "administrator" },
      principal: { kind: "group", id: group.id },
    });
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    expect(result.kind).toBe("linkRequired");
  });

  it("links a plain member without asking", async () => {
    const org = await organization();
    const existing = await account(org);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    expect(result.kind).toBe("signedIn");
  });

  it("drops the enforced second factor once linking makes the account managed", async () => {
    const org = await organization();
    await test.settings.set(twoFactorRequiredSetting, { organization: org }, "organization", true);
    const existing = await account(org);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session).toMatchObject({ accountId: existing.id, kind: "full" });
    expect(await test.services.signIn.secondFactorRequirement(existing.id)).toBeNull();
  });

  it("does not link an account whose address the provider cannot vouch for", async () => {
    const id = await provider({ accountCreation: true, domains: ["example.org"] });
    const existing = await account(null, `${randomUUID().slice(0, 8)}@elsewhere.example`);
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    expect(result).toMatchObject({ kind: "refused", reason: "domainNotAllowed" });
    expect(await managedStateOf(test.database, existing.id)).toBeNull();
    expect(await localCredentials(existing.id)).toMatchObject({ password: true });
    const linked = await test.pool.query("select 1 from identities where account_id = $1", [existing.id]);
    expect(linked.rowCount).toBe(0);
  });

  it("does not link a deactivated account", async () => {
    const existing = await account(null);
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [existing.id]);
    const id = await provider({});
    expect(await signIn(id, { sub: randomUUID(), email: existing.email })).toMatchObject({
      kind: "refused",
      reason: "accountInactive",
    });
    expect(await localCredentials(existing.id)).toMatchObject({ password: true });
  });

  it("asks for a confirmation when the account becomes the instance owner while its first sign-in waits", async () => {
    const existing = await account(null);
    const id = await provider({});
    const other = await test.pool.connect();
    let result: CallbackResult;
    try {
      await other.query("begin");
      await other.query("select id from accounts where id = $1 for update", [existing.id]);
      const pending = signIn(id, { sub: randomUUID(), email: existing.email });
      await Promise.race([pending, waitForLockWait(test.pool)]);
      await other.query("update instance set owner_account_id = $1", [existing.id]);
      await other.query("commit");
      result = await pending;
    } finally {
      other.release();
    }
    expect(result.kind).toBe("linkRequired");
    const linked = await test.pool.query("select 1 from identities where account_id = $1", [existing.id]);
    expect(linked.rowCount).toBe(0);
    expect(await localCredentials(existing.id)).toMatchObject({ password: true });
  });

  it("links once when the first sign-in arrives twice at the same moment", async () => {
    const existing = await account(null);
    const id = await provider({});
    const subject = randomUUID();
    const results = await Promise.all([
      signIn(id, { sub: subject, email: existing.email }),
      signIn(id, { sub: subject, email: existing.email }),
    ]);
    expect(results.map((result) => result.kind)).toEqual(["signedIn", "signedIn"]);
    const linked = await test.pool.query("select 1 from identities where account_id = $1", [existing.id]);
    expect(linked.rowCount).toBe(1);
    const removed = await test.pool.query(
      "select 1 from audit_events where name = 'account.localCredentialsRemoved' and target_id = $1",
      [existing.id],
    );
    expect(removed.rowCount).toBe(1);
  });

  it("asks the provider again for proof of a second factor when it confirms the identity", async () => {
    const id = await provider({ accountCreation: true, secondFactor: { mode: "providerProof" } });
    const subject = randomUUID();
    const first = await signIn(id, { sub: subject, email: `p.${randomUUID()}@example.org`, amr: ["mfa"] });
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    const session = first.signedIn.session;
    const reauthenticate = async (amr: string[]) => {
      const started = await test.services.providerSignIn.start({
        providerId: id,
        purpose: "reauthentication",
        baseUrl: BASE,
        sessionId: session.id,
        accountId: session.accountId,
      });
      const callback = await idp.authorize(started.url, {
        sub: subject,
        auth_time: Math.floor(Date.now() / 1000),
        amr,
      });
      return test.services.providerSignIn.callback({
        providerId: id,
        query: callback.searchParams,
        browserToken: started.browserToken,
        client: {},
      });
    };
    await expect(reauthenticate(["pwd"])).rejects.toThrow(ChallengeExpiredError);
    expect(await reauthenticate(["pwd", "mfa"])).toMatchObject({ kind: "reauthenticated" });
  });

  async function accountFromProvider(secondFactor?: { mode: "provider" | "providerProof" }) {
    const domain = `${randomUUID().slice(0, 8)}.example`;
    const first = await provider({
      accountCreation: true,
      domains: [domain],
      ...(secondFactor ? { secondFactor } : {}),
    });
    const subject = randomUUID();
    const email = `moved@${domain}`;
    const created = await signIn(first, { sub: subject, email });
    if (created.kind !== "signedIn" && created.kind !== "secondFactorRequired") {
      throw new Error(`Account expected, got ${created.kind}`);
    }
    const [row] = (
      await test.pool.query<{ account_id: string }>(
        "select account_id from identities where provider_id = $1 and subject = $2",
        [first, subject],
      )
    ).rows;
    await releaseDomains([domain]);
    const second = await provider({ domains: [domain] });
    return { first, subject, email, accountId: row?.account_id ?? "", second };
  }

  async function linkedProviders(accountId: string) {
    const result = await test.pool.query<{ provider_id: string }>(
      "select provider_id from identities where account_id = $1",
      [accountId],
    );
    return result.rows.map((row) => row.provider_id).sort();
  }

  async function confirmThrough(providerId: string, pendingToken: string, subject: string, authTime: number) {
    const started = await test.services.providerSignIn.startLinkConfirmation({
      pendingToken,
      providerId,
      baseUrl: BASE,
    });
    const authorization = new URL(started.url).searchParams;
    expect(authorization.get("prompt")).toBe("login");
    expect(authorization.get("max_age")).toBe("0");
    const callback = await idp.authorize(started.url, { sub: subject, auth_time: authTime });
    return test.services.providerSignIn.callback({
      providerId,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
  }

  it("links the owner's account without a password after a fresh sign-in through a provider it is linked to", async () => {
    const moved = await accountFromProvider();
    await asOwner(moved.accountId);
    const result = await signIn(moved.second, { sub: randomUUID(), email: moved.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({
      password: false,
      passkey: false,
      providers: [{ id: moved.first, name: "Test provider", directory: false }],
      confirmed: false,
    });
    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: result.pendingToken,
        factor: null,
        client: {},
      }),
    ).rejects.toThrow(InvalidCredentialsError);

    const now = Math.floor(Date.now() / 1000);
    await expect(confirmThrough(moved.first, result.pendingToken, moved.subject, now - 3600)).rejects.toThrow(
      ChallengeExpiredError,
    );
    await expect(confirmThrough(moved.first, result.pendingToken, randomUUID(), now)).rejects.toThrow(
      ChallengeExpiredError,
    );
    expect(await linkedProviders(moved.accountId)).toEqual([moved.first]);

    const confirmed = await confirmThrough(moved.first, result.pendingToken, moved.subject, now);
    if (confirmed.kind !== "signedIn") throw new Error(`Signed in expected, got ${confirmed.kind}`);
    expect(confirmed.signedIn.session).toMatchObject({
      accountId: moved.accountId,
      kind: "secondFactorSetup",
      methods: ["identityProvider"],
    });
    expect(await linkedProviders(moved.accountId)).toEqual([moved.first, moved.second].sort());
  });

  it("offers only the signature algorithms the sign-in request limits are sized for", async () => {
    const moved = await accountFromProvider();
    const options = await test.services.webauthn.registrationOptions({
      id: moved.accountId,
      email: moved.email,
      name: "",
    });
    expect(options.pubKeyCredParams.map((parameter) => parameter.alg)).toEqual([-8, -7, -257]);
  });

  it("links the owner's account without a password with one of its passkeys", async () => {
    const moved = await accountFromProvider();
    await asOwner(moved.accountId);
    const authenticator = new VirtualAuthenticator();
    const account = await test.services.accounts.get(moved.accountId);
    const options = await test.services.webauthn.registrationOptions({
      id: moved.accountId,
      email: moved.email,
      name: account?.name ?? "",
    });
    const origin = "https://wiki.example.org";
    await test.services.webauthn.register(test.database, {
      accountId: moved.accountId,
      response: authenticator.register(options, origin),
      expectedChallenge: options.challenge,
      name: "Laptop",
    });
    const result = await signIn(moved.second, { sub: randomUUID(), email: moved.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({ passkey: true });

    const unverified = await test.services.signIn.identityLinkPasskeyOptions(result.pendingToken, "signIn");
    expect(unverified.userVerification).toBe("required");
    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: result.pendingToken,
        passkey: authenticator.assert(unverified, origin, { userVerified: false }),
        factor: null,
        client: {},
      }),
    ).rejects.toThrow(InvalidCredentialsError);
    const verified = await test.services.signIn.identityLinkPasskeyOptions(result.pendingToken, "signIn");
    const linked = await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      passkey: authenticator.assert(verified, origin),
      factor: null,
      client: {},
    });
    expect(linked.session).toMatchObject({
      accountId: moved.accountId,
      kind: "full",
      methods: ["passkey", "identityProvider"],
    });
  });

  it("refuses linking when the owner's account has no way to confirm it", async () => {
    const moved = await accountFromProvider();
    await asOwner(moved.accountId);
    await test.pool.query("delete from identities where account_id = $1", [moved.accountId]);
    const result = await signIn(moved.second, { sub: randomUUID(), email: moved.email });
    expect(result).toMatchObject({ kind: "refused", reason: "linkUnavailable" });
  });

  it("records a reference when the person says the account is not theirs", async () => {
    const org = await organization();
    const existing = await account(org);
    await asOwner(existing.id);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email, name: "Somebody" });
    if (result.kind !== "linkRequired") throw new Error("Linking expected");
    const { reference } = await test.services.providerSignIn.declineLink(result.pendingToken);
    expect(await test.services.providerSignIn.refusal(reference)).toMatchObject({
      reason: "linkDeclined",
      accountId: existing.id,
      email: existing.email,
      displayName: "Somebody",
    });
    await expect(test.services.providerSignIn.linkInfo(result.pendingToken)).rejects.toThrow(
      ChallengeExpiredError,
    );
  });

  describe("a provider that omits the groups claim", () => {
    async function mappedProvider() {
      const org = await organization();
      const id = await provider({ accountCreation: true });
      const group = randomUUID();
      await test.services.mappingRules.create(SYSTEM, id, {
        target: "organization",
        group: { id: group, name: "Staff" },
        organizationId: org,
        role: null,
        synchronizedGroup: false,
        homeOrganization: false,
      });
      return { id, org, group };
    }

    async function memberOf(org: string, result: CallbackResult): Promise<boolean> {
      if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
      const rows = await test.pool.query(
        "select 1 from memberships where organization_id = $1 and account_id = $2",
        [org, result.signedIn.session.accountId],
      );
      return rows.rowCount === 1;
    }

    async function missingEvents(id: string): Promise<number> {
      const rows = await test.pool.query(
        "select 1 from audit_events where name = 'auth.groupsClaimMissing' and target_id = $1",
        [id],
      );
      return rows.rowCount ?? 0;
    }

    it("records the missing claim without the address or browser of the person", async () => {
      const { id } = await mappedProvider();
      await runWithRequestContext(
        { requestId: randomUUID(), clientIp: "198.51.100.7", userAgent: "Test agent", actor: ANONYMOUS },
        () => signIn(id, { sub: randomUUID(), email: `i.${randomUUID().slice(0, 8)}@example.org` }),
      );
      const rows = await test.pool.query<{ client_ip: string | null; user_agent: string | null }>(
        "select client_ip, user_agent from audit_events where name = 'auth.groupsClaimMissing' and target_id = $1",
        [id],
      );
      expect(rows.rows).toEqual([{ client_ip: null, user_agent: null }]);
    });

    it("treats the missing claim as no groups, records it and warns once the claim was seen before", async () => {
      const { id, org, group } = await mappedProvider();
      const subject = randomUUID();
      const email = `m.${subject.slice(0, 8)}@example.org`;
      expect(await memberOf(org, await signIn(id, { sub: subject, email, groups: [group] }))).toBe(true);
      expect(await missingEvents(id)).toBe(0);
      expect((await test.services.identityProviders.get(id)).warnings).not.toContain("groupsClaimMissing");

      expect(await memberOf(org, await signIn(id, { sub: subject, email }))).toBe(false);
      expect(await missingEvents(id)).toBe(1);
      const warned = await test.services.identityProviders.get(id);
      expect(warned.warnings).toContain("groupsClaimMissing");
      expect(warned.groupsClaimMissingSince).toBeInstanceOf(Date);

      await signIn(id, { sub: subject, email });
      expect(await missingEvents(id)).toBe(2);

      expect(await memberOf(org, await signIn(id, { sub: subject, email, groups: [group] }))).toBe(true);
      const cleared = await test.services.identityProviders.get(id);
      expect(cleared.warnings).not.toContain("groupsClaimMissing");
      expect(cleared.groupsClaimMissingSince).toBeNull();
    });

    it("records the missing claim but shows no warning while the provider never sent one", async () => {
      const { id } = await mappedProvider();
      await signIn(id, { sub: randomUUID(), email: `n.${randomUUID().slice(0, 8)}@example.org` });
      expect(await missingEvents(id)).toBe(1);
      expect((await test.services.identityProviders.get(id)).warnings).not.toContain("groupsClaimMissing");
    });

    it("keeps the groups unknown when the groups are distributed claims", async () => {
      const { id, org, group } = await mappedProvider();
      const subject = randomUUID();
      const email = `d.${subject.slice(0, 8)}@example.org`;
      await signIn(id, { sub: subject, email, groups: [group] });
      const result = await signIn(id, { sub: subject, email, _claim_names: { groups: "src1" } });
      expect(await memberOf(org, result)).toBe(true);
      expect(await missingEvents(id)).toBe(0);
    });

    it("forgets what it saw when the groups claim setting changes", async () => {
      const { id, group } = await mappedProvider();
      const subject = randomUUID();
      const email = `c.${subject.slice(0, 8)}@example.org`;
      await signIn(id, { sub: subject, email, groups: [group] });
      await signIn(id, { sub: subject, email });
      expect((await test.services.identityProviders.get(id)).warnings).toContain("groupsClaimMissing");
      const current = (await test.services.identityProviders.get(id)).config;
      if (!("claims" in current)) throw new Error("A provider with a claims setting is expected");
      await test.services.identityProviders.update(SYSTEM, id, {
        config: { ...current, claims: { ...current.claims, groups: "roles" } },
      });
      const updated = await test.services.identityProviders.get(id);
      expect(updated.warnings).not.toContain("groupsClaimMissing");
      expect(updated.groupsClaimMissingSince).toBeNull();
    });
  });

  it("suggests the groups seen at sign-in, with their names, but not values only typed into a rule", async () => {
    const id = await provider({ accountCreation: true });
    const staff = randomUUID();
    const typed = `typed-${randomUUID().slice(0, 8)}`;
    await test.services.mappingRules.create(SYSTEM, id, {
      target: "instance",
      group: { id: typed, name: null },
      role: { builtIn: "securityAuditor" },
    });
    expect(await test.services.mappingRules.searchGroups(id, "")).toEqual([]);
    const result = await signIn(id, {
      sub: randomUUID(),
      email: `s.${randomUUID()}@example.org`,
      groups: [staff],
      group_names: ["Staff"],
    });
    expect(result.kind).toBe("signedIn");
    expect(await test.services.mappingRules.searchGroups(id, "")).toEqual([
      expect.objectContaining({ id: staff, name: "Staff", accounts: 1 }),
    ]);
    expect(await test.services.mappingRules.searchGroups(id, "sta")).toHaveLength(1);
    expect(await test.services.mappingRules.searchGroups(id, typed)).toEqual([]);
  });

  it("explains a failed test sign-in with the message of the provider and a reason", async () => {
    const id = await provider({});
    const failedTest = async (query: (state: string) => URLSearchParams, browserToken?: string) => {
      const started = await test.services.providerSignIn.start({
        providerId: id,
        purpose: "test",
        baseUrl: BASE,
      });
      const state = new URL(started.url).searchParams.get("state") ?? "";
      const result = await test.services.providerSignIn.callback({
        providerId: id,
        query: query(state),
        browserToken: browserToken ?? started.browserToken,
        client: {},
      });
      if (result.kind !== "tested") throw new Error(`Tested expected, got ${result.kind}`);
      return (
        await test.pool.query<{ result: unknown }>("select result from provider_flows where id = $1", [
          result.flowId,
        ])
      ).rows[0]?.result;
    };
    expect(
      await failedTest(
        (state) =>
          new URLSearchParams({
            state,
            error: "access_denied",
            error_description:
              "AADSTS50105: The signed in user is not assigned to a role for the application.",
          }),
      ),
    ).toEqual({
      error: "access_denied: AADSTS50105: The signed in user is not assigned to a role for the application.",
      reason: "userNotAssigned",
    });
    expect(await failedTest((state) => new URLSearchParams({ state, error: "server_error" }))).toEqual({
      error: "server_error",
      reason: "providerRefused",
    });
    expect(
      await failedTest((state) => new URLSearchParams({ state, code: "x" }), "another browser"),
    ).toMatchObject({
      reason: "browserChanged",
    });
  });

  it("requires one of the configured groups when accounts are created", async () => {
    const id = await provider({ accountCreation: true, requiredGroups: ["wiki-users"] });
    expect(
      await signIn(id, { sub: randomUUID(), email: `g.${randomUUID()}@example.org`, groups: ["others"] }),
    ).toMatchObject({ kind: "refused", reason: "groupRequired" });
    expect(
      await signIn(id, {
        sub: randomUUID(),
        email: `n.${randomUUID()}@example.org`,
        groups: [randomUUID()],
        group_names: ["wiki-users"],
      }),
    ).toMatchObject({ kind: "refused", reason: "groupRequired" });
    expect(
      (
        await signIn(id, {
          sub: randomUUID(),
          email: `h.${randomUUID()}@example.org`,
          groups: ["wiki-users"],
        })
      ).kind,
    ).toBe("signedIn");
  });

  it("ends the sessions of a person when the provider signs them out", async () => {
    const id = await provider({ accountCreation: true });
    const subject = randomUUID();
    const first = await signIn(id, {
      sub: subject,
      sid: "provider-session",
      email: `l.${randomUUID()}@example.org`,
    });
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    const accountId = first.signedIn.session.accountId;
    await expect(
      test.services.providerSignIn.backchannelLogout(
        id,
        await idp.logoutToken({ sid: "provider-session" }, { algorithm: "none" }),
      ),
    ).rejects.toThrow();
    await expect(
      test.services.providerSignIn.backchannelLogout(
        id,
        await idp.logoutToken({ sid: "provider-session", nonce: "x" }),
      ),
    ).rejects.toThrow();
    const token = await idp.logoutToken({ sid: "provider-session" });
    expect(await test.services.providerSignIn.backchannelLogout(id, token)).toBe(1);
    await expect(test.services.providerSignIn.backchannelLogout(id, token)).rejects.toThrow();
    await signIn(id, { sub: subject, email: `l.${randomUUID()}@example.org` });
    expect(
      await test.services.providerSignIn.backchannelLogout(id, await idp.logoutToken({ sub: subject })),
    ).toBe(1);
    const left = await test.pool.query("select 1 from sessions where account_id = $1", [accountId]);
    expect(left.rows).toEqual([]);
  });

  it("lets a whole office start sign-ins from one address and limits floods and invalid logouts", async () => {
    const id = await provider({ accountCreation: true });
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    for (let attempt = 0; attempt < 300; attempt++) {
      await test.services.providerSignIn.start({
        providerId: id,
        purpose: "signIn",
        baseUrl: BASE,
        clientIp,
      });
    }
    await expect(
      test.services.providerSignIn.start({ providerId: id, purpose: "signIn", baseUrl: BASE, clientIp }),
    ).rejects.toThrow(RateLimitedError);
    for (let attempt = 0; attempt < 60; attempt++) {
      await expect(
        test.services.providerSignIn.backchannelLogout(id, "not-a-token", clientIp),
      ).rejects.toThrow();
    }
    await expect(test.services.providerSignIn.backchannelLogout(id, "not-a-token", clientIp)).rejects.toThrow(
      RateLimitedError,
    );
  });

  it("confirms the identity again through the provider only with a fresh sign-in", async () => {
    const id = await provider({ accountCreation: true });
    const subject = randomUUID();
    const first = await signIn(id, { sub: subject, email: `r.${randomUUID()}@example.org` });
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    const session = first.signedIn.session;
    const reauthenticate = async (authTime: number) => {
      const started = await test.services.providerSignIn.start({
        providerId: id,
        purpose: "reauthentication",
        baseUrl: BASE,
        sessionId: session.id,
        accountId: session.accountId,
      });
      const authorization = new URL(started.url).searchParams;
      expect(authorization.get("prompt")).toBe("login");
      expect(authorization.get("max_age")).toBe("0");
      const callback = await idp.authorize(started.url, { sub: subject, auth_time: authTime });
      return test.services.providerSignIn.callback({
        providerId: id,
        query: callback.searchParams,
        browserToken: started.browserToken,
        client: {},
      });
    };
    await expect(reauthenticate(Math.floor(Date.now() / 1000) - 3600)).rejects.toThrow(ChallengeExpiredError);
    expect(await reauthenticate(Math.floor(Date.now() / 1000))).toMatchObject({ kind: "reauthenticated" });
  });

  it("identifies Entra ID accounts by tenant and object ID and refuses other tenants", async () => {
    const tenant = randomUUID();
    const entra = await startFakeOidcProvider({ path: `/${tenant}/v2.0` });
    try {
      await releaseDomains(["example.org"]);
      const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
        type: "oidc",
        name: "Microsoft",
        config: {
          preset: "entraId",
          tenantId: tenant,
          authority: entra.issuer.slice(0, -`/${tenant}/v2.0`.length),
          clientId: entra.clientId,
          domains: ["example.org"],
          accountCreation: { enabled: true, requiredGroups: [] },
        },
        credential: { kind: "clientSecret", secret: entra.clientSecret, expiresAt: null },
      });
      const objectId = randomUUID();
      const email = `entra.${objectId.slice(0, 8)}@example.org`;
      const result = await signIn(
        created.id,
        {
          sub: "pairwise",
          tid: tenant,
          oid: objectId,
          email,
          preferred_username: email,
          name: "Entra Person",
        },
        { issuer: entra },
      );
      expect(result.kind).toBe("signedIn");
      const identity = await test.pool.query(
        "select subject, sign_in_name from identities where provider_id = $1",
        [created.id],
      );
      expect(identity.rows).toEqual([{ subject: `${tenant}:${objectId}`, sign_in_name: email }]);
      expect(
        await signIn(created.id, { sub: "x", tid: randomUUID(), oid: objectId, email }, { issuer: entra }),
      ).toMatchObject({ kind: "refused", reason: "invalidResponse" });
    } finally {
      await entra.close();
    }
  });

  it("refuses Google accounts outside the configured Workspace domains", async () => {
    const google = await startFakeOidcProvider();
    try {
      await releaseDomains(["example.org"]);
      const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
        type: "oidc",
        name: "Google",
        config: {
          preset: "google",
          issuer: google.issuer,
          clientId: google.clientId,
          domains: ["example.org"],
          accountCreation: { enabled: true, requiredGroups: [] },
        },
        credential: { kind: "clientSecret", secret: google.clientSecret, expiresAt: null },
      });
      const started = await test.services.providerSignIn.start({
        providerId: created.id,
        purpose: "signIn",
        baseUrl: BASE,
      });
      expect(new URL(started.url).searchParams.get("hd")).toBe("example.org");
      const outside = await google.authorize(started.url, { sub: randomUUID(), email: "someone@gmail.com" });
      expect(
        await test.services.providerSignIn.callback({
          providerId: created.id,
          query: outside.searchParams,
          browserToken: started.browserToken,
          client: {},
        }),
      ).toMatchObject({ kind: "refused", reason: "domainNotAllowed" });
      const refusals = async () =>
        Number(
          (
            await test.pool.query("select count(*) from sign_in_refusals where provider_id = $1", [
              created.id,
            ])
          ).rows[0]?.count ?? 0,
        );
      const before = await refusals();
      const testStart = await test.services.providerSignIn.start({
        providerId: created.id,
        purpose: "test",
        baseUrl: BASE,
      });
      const tested = await google.authorize(testStart.url, { sub: randomUUID(), email: "someone@gmail.com" });
      const result = await test.services.providerSignIn.callback({
        providerId: created.id,
        query: tested.searchParams,
        browserToken: testStart.browserToken,
        client: {},
      });
      expect(result.kind).toBe("tested");
      expect(await refusals()).toBe(before);
      expect(
        (
          await signIn(
            created.id,
            { sub: randomUUID(), email: `g.${randomUUID().slice(0, 8)}@example.org`, hd: "example.org" },
            { issuer: google },
          )
        ).kind,
      ).toBe("signedIn");
    } finally {
      await google.close();
    }
  });
});
