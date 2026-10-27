import { randomUUID } from "node:crypto";
import { testJobContext } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
  totpNow,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const PASSWORD = "a long enough passphrase";
const kinds = ["local", "guest", "oidc", "saml", "ldap"] as const;
type Kind = (typeof kinds)[number];
const managedKinds = ["oidc", "saml", "ldap"] as const;
const providerOnlyKinds = ["oidc", "saml"] as const;

function linkToken(text: string | undefined): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text ?? "");
  if (!match?.[1]) throw new Error("No token in the mail");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("sign-in rules for managed accounts", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  const accounts = new Map<Kind, { id: string; email: string }>();
  const clients = new Map<Kind, TestClient>();
  const providers = new Map<string, string>();
  let pendingResetToken = "";

  async function runPasswordResetJobs(): Promise<void> {
    const jobs = await test.runtime.pool.query<{ data: { payload: { email: string } } }>(
      "delete from pgboss.job where name = 'auth.password-reset-request' returning data",
    );
    for (const job of jobs.rows) {
      await test.runtime.services.security.handlePasswordResetRequest(
        testJobContext("auth.password-reset-request", job.data.payload),
      );
    }
    await test.deliverMail();
  }

  async function provider(type: "oidc" | "saml" | "ldap", domain: string): Promise<string> {
    const id = randomUUID();
    await test.runtime.pool.query(
      `insert into identity_providers (id, type, preset, name, config, setup_completed_at)
       values ($1, $2, $3, $4, '{}', now())`,
      [id, type, type === "ldap" ? "activeDirectory" : "generic", `Managed ${type}`],
    );
    await test.runtime.pool.query(
      "insert into identity_provider_domains (domain, provider_id) values ($1, $2)",
      [domain, id],
    );
    return id;
  }

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);

    for (const kind of kinds) {
      const email = `${kind}.person@${kind === "guest" ? "local" : kind}.test`;
      const created =
        kind === "guest"
          ? await test.runtime.database.transaction((tx) =>
              test.runtime.services.accounts.create(tx, {
                type: "guest",
                email,
                name: "Guest",
                password: PASSWORD,
                homeOrganizationId: null,
              }),
            )
          : await createAccount(test, email, PASSWORD);
      accounts.set(kind, { id: created.id, email });
      clients.set(kind, await signedInClient(test, email, PASSWORD));
    }

    const anonymous = new TestClient(test.app, { remoteAddress: "198.51.100.71" });
    await anonymous.post("/api/v1/auth/password-reset", { email: accounts.get("ldap")?.email });
    await runPasswordResetJobs();
    pendingResetToken = linkToken(
      test.mail.sent.findLast((mail) => mail.to === accounts.get("ldap")?.email)?.text,
    );

    for (const type of managedKinds) {
      const id = await provider(type, `${type}.test`);
      providers.set(type, id);
      await test.runtime.pool.query(
        "insert into managed_accounts (account_id, provider_id, source) values ($1, $2, 'domain')",
        [accounts.get(type)?.id, id],
      );
    }
  });

  afterAll(async () => {
    await test?.close();
  });

  function client(kind: Kind): TestClient {
    const found = clients.get(kind);
    if (!found) throw new Error(`No client for ${kind}`);
    return found;
  }

  function email(kind: Kind): string {
    return accounts.get(kind)?.email ?? "";
  }

  it("signs local accounts and guests in with a password and refuses managed accounts", async () => {
    for (const kind of kinds) {
      const response = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: email(kind),
        password: PASSWORD,
      });
      if (kind === "local" || kind === "guest") {
        expect(response.json(), kind).toMatchObject({ status: "signedIn" });
        continue;
      }
      expect(response.statusCode, kind).toBe(403);
      expect(response.json(), kind).toMatchObject({
        code: "managedAccount",
        providerId: providers.get(kind),
        providerName: `Managed ${kind}`,
      });
      const wrong = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: email(kind),
        password: "not the passphrase at all",
      });
      expect(wrong.statusCode, kind).toBe(401);
      expect(wrong.json(), kind).toMatchObject({ code: "invalidCredentials" });
    }
  });

  it("names the managing provider in the own security overview", async () => {
    for (const kind of managedKinds) {
      expect((await client(kind).get("/api/v1/account/security")).json().managedBy, kind).toEqual({
        providerId: providers.get(kind),
        providerName: `Managed ${kind}`,
        providerType: kind,
        source: "domain",
        since: expect.any(String),
      });
    }
    for (const kind of ["local", "guest"] as const) {
      expect((await client(kind).get("/api/v1/account/security")).json().managedBy, kind).toBeNull();
    }
  });

  it("keeps the break-glass account of the instance owner local with password and second factor", async () => {
    const response = await new TestClient(test.app).post("/api/v1/auth/sign-in", OWNER);
    expect(response.json()).toMatchObject({ status: "secondFactorRequired" });
    const managed = await test.runtime.pool.query(
      "select 1 from managed_accounts m join instance i on i.owner_account_id = m.account_id",
    );
    expect(managed.rows).toEqual([]);
  });

  it("sends password reset links only to local accounts, guests and the instance owner", async () => {
    const before = test.mail.sent.length;
    for (const address of [...kinds.map(email), OWNER.email]) {
      expect(
        (
          await new TestClient(test.app, { remoteAddress: "198.51.100.72" }).post(
            "/api/v1/auth/password-reset",
            {
              email: address,
            },
          )
        ).statusCode,
      ).toBe(202);
    }
    await runPasswordResetJobs();
    const recipients = test.mail.sent
      .slice(before)
      .filter((mail) => mail.subject.startsWith("Reset your password"))
      .map((mail) => mail.to);
    expect(recipients.sort()).toEqual([email("guest"), email("local"), OWNER.email].sort());

    const refused = await new TestClient(test.app).post("/api/v1/auth/password-reset/complete", {
      token: pendingResetToken,
      password: "a brand new passphrase",
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "invalidToken" });
  });

  it("refuses the password and e-mail routes for every managed account", async () => {
    for (const kind of managedKinds) {
      const password = await client(kind).post("/api/v1/account/password", {
        password: "another long passphrase",
      });
      expect(password.statusCode, kind).toBe(403);
      expect(password.json(), kind).toMatchObject({ code: "managedAccount" });
      const changed = await client(kind).post("/api/v1/account/email", {
        email: `new.${kind}@elsewhere.test`,
      });
      expect(changed.json(), kind).toMatchObject({ code: "managedAccount" });
      const reauthenticated = await client(kind).post("/api/v1/auth/reauthenticate", {
        method: "password",
        password: PASSWORD,
      });
      expect(reauthenticated.json(), kind).toMatchObject({ code: "managedAccount" });
    }
    expect(
      (await client("guest").post("/api/v1/account/email", { email: "new.guest@local.test" })).statusCode,
    ).toBe(202);
  });

  it("refuses second factors in Lunedo for OIDC and SAML accounts but keeps them for LDAP and local accounts", async () => {
    for (const kind of providerOnlyKinds) {
      for (const path of ["/api/v1/account/totp", "/api/v1/account/passkeys/registration-options"]) {
        const refused = await client(kind).post(path);
        expect(refused.statusCode, `${kind} ${path}`).toBe(403);
        expect(refused.json(), `${kind} ${path}`).toMatchObject({ code: "managedAccount" });
      }
      const codes = await client(kind).post("/api/v1/account/recovery-codes");
      expect(codes.json(), kind).toMatchObject({ code: "managedAccount" });
      const totp = await client(kind).post("/api/v1/auth/reauthenticate", { method: "totp", code: "123456" });
      expect(totp.json(), kind).toMatchObject({ code: "managedAccount" });
      const security = await client(kind).get("/api/v1/account/security");
      expect(security.json(), kind).toMatchObject({ secondFactorRequired: false });
    }
    for (const kind of ["ldap", "local"] as const) {
      const setup = await addTotp(client(kind));
      expect(setup.recoveryCodes, kind).toHaveLength(10);
      expect(
        (await client(kind).post("/api/v1/account/passkeys/registration-options")).statusCode,
        kind,
      ).toBe(200);
      const reauthenticated = await client(kind).post("/api/v1/auth/reauthenticate", {
        method: "totp",
        code: totpNow(setup.secret, 1),
      });
      expect(reauthenticated.statusCode, kind).toBe(204);
    }
  });

  it("lets administrators reset the second factor of LDAP and local accounts only", async () => {
    for (const kind of providerOnlyKinds) {
      const refused = await owner.post(`/api/v1/accounts/${accounts.get(kind)?.id}/second-factor/reset`, {
        reason: "Lost phone",
      });
      expect(refused.statusCode, kind).toBe(403);
      expect(refused.json(), kind).toMatchObject({ code: "managedAccount" });
    }
    const reset = await owner.post(`/api/v1/accounts/${accounts.get("ldap")?.id}/second-factor/reset`, {
      reason: "Lost phone",
    });
    expect(reset.statusCode).toBe(200);
  });

  it("keeps refusing password sign-in and resets while the provider is deactivated", async () => {
    await test.runtime.pool.query("update identity_providers set deactivated_at = now() where id = $1", [
      providers.get("oidc"),
    ]);
    const response = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
      email: email("oidc"),
      password: PASSWORD,
    });
    expect(response.json()).toMatchObject({ code: "managedAccount" });
    const before = test.mail.sent.length;
    await new TestClient(test.app, { remoteAddress: "198.51.100.73" }).post("/api/v1/auth/password-reset", {
      email: email("oidc"),
    });
    await runPasswordResetJobs();
    expect(
      test.mail.sent.slice(before).filter((mail) => mail.subject.startsWith("Reset your password")),
    ).toEqual([]);
  });

  it("makes an account managed when its owner moves it into a domain of a provider", async () => {
    const moving = await createAccount(test, "moving.person@local.test", PASSWORD);
    const mover = await signedInClient(test, moving.email, PASSWORD);
    expect((await mover.get("/api/v1/account/security")).json()).toMatchObject({ managedBy: null });
    expect((await mover.post("/api/v1/account/email", { email: "moving.person@saml.test" })).statusCode).toBe(
      202,
    );
    await test.deliverMail();
    const token = linkToken(test.mail.sent.findLast((mail) => mail.to === "moving.person@saml.test")?.text);
    expect(
      (await new TestClient(test.app).post("/api/v1/auth/email-change/confirm", { token })).statusCode,
    ).toBe(204);
    const state = await test.runtime.pool.query<{ provider_id: string; source: string }>(
      "select provider_id, source from managed_accounts where account_id = $1",
      [moving.id],
    );
    expect(state.rows).toEqual([{ provider_id: providers.get("saml"), source: "domain" }]);
    const refused = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
      email: "moving.person@saml.test",
      password: PASSWORD,
    });
    expect(refused.json()).toMatchObject({ code: "managedAccount" });
  });

  it("creates an invited account of a managed domain without a password and sends the person to the provider", async () => {
    const organizationId = await firstOrganizationId(test);
    const invite = async (address: string) => {
      const invited = await owner.post(`/api/v1/organizations/${organizationId}/invitations`, {
        email: address,
        kind: "member",
      });
      expect(invited.statusCode).toBe(201);
      await test.deliverMail();
      return linkToken(test.mail.sent.findLast((mail) => mail.to === address)?.text);
    };
    const managedToken = await invite("invited.person@oidc.test");
    const preview = await new TestClient(test.app).post("/api/v1/invitations/preview", {
      token: managedToken,
    });
    expect(preview.json()).toMatchObject({
      newAccount: true,
      provider: { id: providers.get("oidc"), name: "Managed oidc", type: "oidc" },
    });
    const missing = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token: managedToken,
    });
    expect(missing.json()).toMatchObject({ code: "accountDetailsRequired" });
    const accepted = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token: managedToken,
      name: "Invited Person",
      password: "a password that is ignored",
    });
    expect(accepted.json()).toMatchObject({
      accountCreated: true,
      provider: { id: providers.get("oidc"), type: "oidc" },
    });
    const created = await test.runtime.pool.query<{ password: boolean; source: string }>(
      `select a.password_hash is not null as password, m.source from accounts a
       join managed_accounts m on m.account_id = a.id where lower(a.email) = 'invited.person@oidc.test'`,
    );
    expect(created.rows).toEqual([{ password: false, source: "domain" }]);

    const localToken = await invite("invited.person@local.test");
    expect(
      (await new TestClient(test.app).post("/api/v1/invitations/preview", { token: localToken })).json(),
    ).toMatchObject({ newAccount: true, provider: null });
    const withoutPassword = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token: localToken,
      name: "Local Person",
    });
    expect(withoutPassword.json()).toMatchObject({ code: "accountDetailsRequired" });
  });

  it("refuses self-registration for addresses of a managed domain and names the provider", async () => {
    const refused = await new TestClient(test.app, { remoteAddress: "198.51.100.74" }).post(
      "/api/v1/registrations",
      { email: "someone.new@saml.test" },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "managedDomain",
      providerId: providers.get("saml"),
      providerName: "Managed saml",
    });
    const open = await new TestClient(test.app, { remoteAddress: "198.51.100.75" }).post(
      "/api/v1/registrations",
      {
        email: "someone.new@local.test",
      },
    );
    expect(open.statusCode).toBe(202);
  });

  it("refuses the removed password sign-in setting", async () => {
    const refused = await owner.put("/api/v1/instance/settings/auth.passwordSignIn", { value: false });
    expect(refused.statusCode).toBe(404);
  });
});
