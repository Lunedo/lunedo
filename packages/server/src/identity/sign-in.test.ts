import { randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import {
  ChallengeExpiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  PasswordSignInDisabledError,
  RateLimitedError,
} from "../auth/errors.js";
import { passwordSignInSetting, twoFactorRequiredSetting } from "../auth/settings.js";
import { ForbiddenError } from "../authorization/service.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider, type TokenOverrides } from "../testing/fake-oidc.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { VirtualAuthenticator } from "../testing/webauthn.js";
import { type CallbackResult, needsPagehallFactor } from "./sign-in.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://pagehall.test";
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
    secondFactor?: { mode: "provider" | "providerProof" | "pagehall"; proofValues?: string[] };
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

  async function enableTotp(accountId: string) {
    const setup = await test.services.totp.begin(accountId, { issuer: "Test", account: "person" });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, accountId, TOTP.generate({ secret }), {
      confirming: true,
    });
    return secret;
  }

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

  it("asks for a Pagehall second factor when the provider shows no proof of one", async () => {
    const id = await provider({ accountCreation: true, secondFactor: { mode: "providerProof" } });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@example.org` };
    const first = await signIn(id, claims);
    if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
    expect(first.signedIn.session.kind).toBe("secondFactorSetup");
    const accountId = first.signedIn.session.accountId;

    const secret = await enableTotp(accountId);
    const second = await signIn(id, claims);
    if (second.kind !== "secondFactorRequired") throw new Error(`Second factor expected, got ${second.kind}`);
    expect(second.factors).toEqual(["totp"]);
    const completed = await test.services.signIn.completeSecondFactor({
      pendingToken: second.pendingToken,
      factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
      client: {},
    });
    expect(completed.session).toMatchObject({
      accountId,
      kind: "full",
      methods: ["identityProvider", "totp"],
    });
    const stored = await test.pool.query<{ identity_id: string | null }>(
      "select identity_id from sessions where id = $1",
      [completed.session.id],
    );
    expect(stored.rows[0]?.identity_id).not.toBeNull();

    const proven = await signIn(id, { ...claims, amr: ["pwd", "mfa"] });
    if (proven.kind !== "signedIn") throw new Error(`Signed in expected, got ${proven.kind}`);
    expect(proven.signedIn.session).toMatchObject({ kind: "full", methods: ["identityProvider"] });
  });

  it("always asks for a Pagehall second factor when the provider is set to", async () => {
    const id = await provider({ accountCreation: true, secondFactor: { mode: "pagehall" } });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@example.org`, amr: ["mfa"] };
    const first = await signIn(id, claims);
    if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
    await enableTotp(first.signedIn.session.accountId);
    expect((await signIn(id, claims)).kind).toBe("secondFactorRequired");
  });

  it("accepts the configured proof values of a provider", () => {
    const setting = { mode: "providerProof" as const, proofValues: ["hwk", "otp"] };
    expect(needsPagehallFactor(setting, ["pwd", "otp"])).toBe(false);
    expect(needsPagehallFactor(setting, ["pwd", "mfa"])).toBe(true);
    expect(needsPagehallFactor({ mode: "provider", proofValues: ["mfa"] }, [])).toBe(false);
    expect(needsPagehallFactor({ mode: "pagehall", proofValues: ["mfa"] }, ["mfa"])).toBe(true);
  });

  it("keeps a pending link for 15 minutes and refuses it afterwards", async () => {
    const existing = await account(null);
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

  it("links an existing account only after its password and second factor", async () => {
    const org = await organization();
    const existing = await account(org);
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
    expect(again.kind === "signedIn" && again.signedIn.session.accountId).toBe(existing.id);
  });

  it("asks to set up the required second factor after linking an account that has none", async () => {
    const org = await organization();
    await test.settings.set(twoFactorRequiredSetting, { organization: org }, "organization", true);
    const existing = await account(org);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    const linked = await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      password: PASSWORD,
      factor: null,
      client: {},
    });
    expect(linked.session).toMatchObject({ accountId: existing.id, kind: "secondFactorSetup" });
  });

  async function accountFromProvider(secondFactor?: { mode: "provider" | "pagehall" }) {
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

  it("links an account without a password after a fresh sign-in through a provider it is linked to", async () => {
    const moved = await accountFromProvider();
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
      kind: "full",
      methods: ["identityProvider"],
    });
    expect(await linkedProviders(moved.accountId)).toEqual([moved.first, moved.second].sort());
  });

  it("asks for the Pagehall second factor after a provider confirmed a link and the provider needs one", async () => {
    const moved = await accountFromProvider({ mode: "pagehall" });
    const setup = await test.services.totp.begin(moved.accountId, { issuer: "Test", account: moved.email });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    await test.services.totp.verify(test.database, moved.accountId, TOTP.generate({ secret }), {
      confirming: true,
    });
    const result = await signIn(moved.second, { sub: randomUUID(), email: moved.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);

    const confirmed = await confirmThrough(
      moved.first,
      result.pendingToken,
      moved.subject,
      Math.floor(Date.now() / 1000),
    );
    expect(confirmed).toEqual({ kind: "linkConfirmed" });
    expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({
      confirmed: true,
      factors: ["totp"],
    });
    expect(await linkedProviders(moved.accountId)).toEqual([moved.first]);
    await expect(
      test.services.signIn.confirmIdentityLink({
        pendingToken: result.pendingToken,
        factor: null,
        client: {},
      }),
    ).rejects.toThrow(InvalidSecondFactorError);
    const linked = await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      factor: { type: "totp", code: TOTP.generate({ secret, timestamp: Date.now() + 30_000 }) },
      client: {},
    });
    expect(linked.session).toMatchObject({ kind: "full", methods: ["identityProvider", "totp"] });
    expect(await linkedProviders(moved.accountId)).toEqual([moved.first, moved.second].sort());
  });

  it("links an account without a password with one of its passkeys", async () => {
    const moved = await accountFromProvider();
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

  it("accepts a password for linking only while it is a way to sign in", async () => {
    const org = await organization();
    const existing = await account(org);
    const id = await provider({});
    const result = await signIn(id, { sub: randomUUID(), email: existing.email });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    try {
      expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({
        password: false,
      });
      await expect(
        test.services.signIn.confirmIdentityLink({
          pendingToken: result.pendingToken,
          password: PASSWORD,
          factor: null,
          client: {},
        }),
      ).rejects.toThrow(PasswordSignInDisabledError);
    } finally {
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
    }
  });

  it("refuses linking when the account has no way to confirm it", async () => {
    const moved = await accountFromProvider();
    await test.pool.query("delete from identities where account_id = $1", [moved.accountId]);
    const result = await signIn(moved.second, { sub: randomUUID(), email: moved.email });
    expect(result).toMatchObject({ kind: "refused", reason: "linkUnavailable" });
  });

  it("records a reference when the person says the account is not theirs", async () => {
    const org = await organization();
    const existing = await account(org);
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

  it("limits sign-in starts and logout requests per client", async () => {
    const id = await provider({ accountCreation: true });
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    for (let attempt = 0; attempt < 20; attempt++) {
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
