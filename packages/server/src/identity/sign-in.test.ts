import { randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import {
  ChallengeExpiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  RateLimitedError,
} from "../auth/errors.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider, type TokenOverrides } from "../testing/fake-oidc.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import type { CallbackResult } from "./sign-in.js";

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
  }) {
    const source = options.issuer ?? idp;
    const domains = options.domains ?? ["example.org"];
    await releaseDomains(domains);
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
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
