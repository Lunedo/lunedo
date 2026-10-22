import {
  clientAttemptLimitSetting,
  clientLockoutFailuresSetting,
  PasswordHasher,
  twoFactorRequiredSetting,
} from "@lunedo/server";
import { VirtualAuthenticator } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
  totpNow,
} from "../testing/accounts.js";
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";

const SESSION_COOKIE = "__Host-lunedo-session";
const PENDING_COOKIE = "__Host-lunedo-pending";

async function auditNames(test: AuthTestApp): Promise<string[]> {
  const result = await test.runtime.pool.query<{ name: string }>(
    "select name from audit_events order by sequence",
  );
  return result.rows.map((row) => row.name);
}

async function auditEvents(test: AuthTestApp, name: string, targetId: string | null) {
  const result = await test.runtime.pool.query<{
    actor_type: string;
    actor_id: string | null;
    fields: unknown;
  }>(
    "select actor_type, actor_id, fields from audit_events where name = $1 and target_id is not distinct from $2 order by sequence",
    [name, targetId],
  );
  return result.rows;
}

async function registerPasskey(
  client: TestClient,
  authenticator = new VirtualAuthenticator(),
  name = "Laptop",
) {
  const options = (await client.post("/api/v1/account/passkeys/registration-options")).json();
  const response = await client.post("/api/v1/account/passkeys", {
    response: authenticator.register(options, TEST_ORIGIN),
    name,
  });
  if (response.statusCode !== 201) throw new Error(`Passkey registration failed: ${response.body}`);
  return { authenticator, body: response.json() };
}

describe.skipIf(!databaseBaseUrl)("sign-in", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(clientLockoutFailuresSetting, {}, "instance", 10_000);
  });

  afterAll(async () => {
    await test?.close();
  });

  describe("with a password only", () => {
    it("creates a session with a secure cookie and records the sign-in", async () => {
      const account = await createAccount(test, "Pat.Password@Example.org");
      const client = new TestClient(test.app);
      const response = await client.post("/api/v1/auth/sign-in", {
        email: "pat.password@example.org",
        password: account.password,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "signedIn",
        sessionKind: "full",
        account: { id: account.id, email: "Pat.Password@Example.org" },
      });
      const cookies = response.headers["set-cookie"] as string[];
      expect(cookies).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^__Host-lunedo-device=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
          ),
          expect.stringMatching(
            /^__Host-lunedo-session=[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/,
          ),
        ]),
      );
      expect(response.body).not.toContain(client.cookies.get(SESSION_COOKIE));

      const session = await client.get("/api/v1/auth/session");
      expect(session.json()).toMatchObject({
        sessionKind: "full",
        methods: ["password"],
        recentlyAuthenticated: true,
      });
      const stored = await test.runtime.pool.query<{ token_hash: Buffer }>(
        "select token_hash from sessions where account_id = $1",
        [account.id],
      );
      expect(stored.rows[0]?.token_hash).toHaveLength(32);
      expect(stored.rows[0]?.token_hash.toString("base64url")).not.toBe(client.cookies.get(SESSION_COOKIE));
      expect(await auditNames(test)).toContain("auth.signedIn");
    });

    it("gives unknown addresses and wrong passwords the same answer", async () => {
      const account = await createAccount(test, "same.answer@example.org");
      const verifyNothing = test.runtime.services.hasher.verifyNothing.bind(test.runtime.services.hasher);
      let dummyChecks = 0;
      test.runtime.services.hasher.verifyNothing = async (password) => {
        dummyChecks += 1;
        await verifyNothing(password);
      };
      try {
        const wrong = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
          email: account.email,
          password: "not the password",
        });
        const unknown = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
          email: "nobody@example.org",
          password: "not the password",
        });
        expect(wrong.statusCode).toBe(401);
        expect(unknown.statusCode).toBe(401);
        expect(unknown.json()).toEqual(wrong.json());
        expect(dummyChecks).toBe(1);
        expect(await auditEvents(test, "auth.signInFailed", account.id)).toEqual([
          {
            actor_type: "anonymous",
            actor_id: null,
            fields: { reason: "invalidCredentials", method: "password" },
          },
        ]);
        expect(await auditEvents(test, "auth.signInFailed", null)).toContainEqual({
          actor_type: "anonymous",
          actor_id: null,
          fields: { reason: "invalidCredentials", method: "password" },
        });
      } finally {
        test.runtime.services.hasher.verifyNothing = verifyNothing;
      }
    });

    it("re-hashes a password with outdated parameters at the next sign-in", async () => {
      const account = await createAccount(test, "rehash@example.org");
      const outdated = await new PasswordHasher({
        concurrency: 1,
        maxQueued: 1,
        parameters: { memory: 9216, passes: 4, parallelism: 1 },
      }).hash(account.password);
      await test.runtime.pool.query("update accounts set password_hash = $1 where id = $2", [
        outdated,
        account.id,
      ]);
      await signedInClient(test, account.email, account.password);
      const stored = await test.runtime.pool.query<{ password_hash: string }>(
        "select password_hash from accounts where id = $1",
        [account.id],
      );
      expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    });
  });

  describe("with password and TOTP", () => {
    it("asks for the second factor and signs in with a valid code once", async () => {
      const account = await createAccount(test, "tom.totp@example.org");
      const { secret } = await addTotp(await signedInClient(test, account.email, account.password));

      const client = new TestClient(test.app);
      const first = await client.post("/api/v1/auth/sign-in", {
        email: account.email,
        password: account.password,
      });
      expect(first.json()).toEqual({ status: "secondFactorRequired", factors: ["totp", "recoveryCode"] });
      expect(client.cookies.has(SESSION_COOKIE)).toBe(false);
      expect(client.cookies.has(PENDING_COOKIE)).toBe(true);
      expect((await client.get("/api/v1/auth/session")).statusCode).toBe(401);

      const wrong = await client.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code: "000000" });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).toMatchObject({ code: "invalidSecondFactor" });

      const code = totpNow(secret, 1);
      const signedIn = await client.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code });
      expect(signedIn.json()).toMatchObject({ status: "signedIn", sessionKind: "full" });
      expect(client.cookies.has(PENDING_COOKIE)).toBe(false);
      expect((await client.get("/api/v1/auth/session")).json().methods).toEqual(["password", "totp"]);

      const replay = new TestClient(test.app);
      await replay.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      expect(
        (await replay.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code })).statusCode,
      ).toBe(401);
    });

    it("rejects the second step without a pending sign-in and after five minutes", async () => {
      const account = await createAccount(test, "tina.timeout@example.org");
      const { secret } = await addTotp(await signedInClient(test, account.email, account.password));

      const none = await new TestClient(test.app).post("/api/v1/auth/sign-in/second-factor", {
        type: "totp",
        code: "123456",
      });
      expect(none.json()).toMatchObject({ code: "challengeExpired" });

      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      await test.runtime.pool.query(
        "update auth_challenges set expires_at = now() - interval '1 second' where account_id = $1",
        [account.id],
      );
      const expired = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "totp",
        code: totpNow(secret, 1),
      });
      expect(expired.json()).toMatchObject({ code: "challengeExpired" });
    });

    it("keeps counting wrong codes after each correct password and locks the account", async () => {
      const account = await createAccount(test, "totp.bruteforce@example.org");
      await addTotp(await signedInClient(test, account.email, account.password));
      const attacker = new TestClient(test.app);
      await attacker.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      for (let attempt = 0; attempt < 4; attempt++) {
        await attacker.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code: "000000" });
      }
      expect(
        (
          await attacker.post("/api/v1/auth/sign-in", { email: account.email, password: account.password })
        ).json(),
      ).toMatchObject({
        status: "secondFactorRequired",
      });
      await attacker.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code: "000000" });

      const locked = await attacker.post("/api/v1/auth/sign-in", {
        email: account.email,
        password: account.password,
      });
      expect(locked.json()).toMatchObject({ code: "locked" });
      const lockouts = await test.runtime.pool.query(
        "select fields from audit_events where name = 'auth.lockedOut' and target_id = $1",
        [account.id],
      );
      expect(lockouts.rows).toEqual([
        { fields: expect.objectContaining({ subject: "account", failures: 5 }) },
      ]);
    });

    it("ends the pending sign-in after five wrong codes", async () => {
      const account = await createAccount(test, "five.wrong@example.org");
      const { secret } = await addTotp(await signedInClient(test, account.email, account.password));
      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(
          (await client.post("/api/v1/auth/sign-in/second-factor", { type: "totp", code: "000000" }))
            .statusCode,
        ).toBe(401);
      }
      const after = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "totp",
        code: totpNow(secret, 1),
      });
      expect(after.json()).toMatchObject({ code: "challengeExpired" });
    });

    it("does not let a pending sign-in use anything but the second step", async () => {
      const account = await createAccount(test, "pending.only@example.org");
      await addTotp(await signedInClient(test, account.email, account.password));
      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      const pending = client.cookies.get(PENDING_COOKIE) ?? "";
      const asSession = await new TestClient(test.app).get("/api/v1/auth/session", {
        cookie: `${SESSION_COOKIE}=${pending}`,
      });
      expect(asSession.statusCode).toBe(401);
      expect((await client.get("/api/v1/account/security")).statusCode).toBe(401);
    });
  });

  describe("with password and passkey", () => {
    it("signs in with the registered passkey as second factor", async () => {
      const account = await createAccount(test, "paula.passkey@example.org");
      const { authenticator, body } = await registerPasskey(
        await signedInClient(test, account.email, account.password),
      );
      expect(body.passkey).toMatchObject({ name: "Laptop" });
      expect(await auditEvents(test, "twoFactor.passkeyAdded", account.id)).toEqual([
        {
          actor_type: "account",
          actor_id: account.id,
          fields: { credentialId: body.passkey.id, name: "Laptop" },
        },
      ]);
      expect(body.recoveryCodes).toHaveLength(10);

      const client = new TestClient(test.app);
      const first = await client.post("/api/v1/auth/sign-in", {
        email: account.email,
        password: account.password,
      });
      expect(first.json().factors).toEqual(["passkey", "recoveryCode"]);
      const options = (await client.post("/api/v1/auth/sign-in/second-factor/passkey-options")).json();
      expect(options.allowCredentials).toEqual([
        expect.objectContaining({ id: authenticator.credentialId.toString("base64url") }),
      ]);
      const signedIn = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "passkey",
        response: authenticator.assert(options, TEST_ORIGIN, { userVerified: false }),
      });
      expect(signedIn.json()).toMatchObject({ status: "signedIn" });
      expect((await client.get("/api/v1/auth/session")).json().methods).toEqual(["password", "passkey"]);
    });

    it("rejects another authenticator, a foreign origin and a reused challenge", async () => {
      const account = await createAccount(test, "peter.passkey@example.org");
      const { authenticator } = await registerPasskey(
        await signedInClient(test, account.email, account.password),
      );
      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });

      let options = (await client.post("/api/v1/auth/sign-in/second-factor/passkey-options")).json();
      const stranger = new VirtualAuthenticator();
      const fromStranger = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "passkey",
        response: stranger.assert(options, TEST_ORIGIN),
      });
      expect(fromStranger.json()).toMatchObject({ code: "invalidSecondFactor" });

      options = (await client.post("/api/v1/auth/sign-in/second-factor/passkey-options")).json();
      const phished = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "passkey",
        response: authenticator.assert(options, "https://lunedo.example"),
      });
      expect(phished.json()).toMatchObject({ code: "invalidSecondFactor" });

      const reused = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "passkey",
        response: authenticator.assert(options, TEST_ORIGIN),
      });
      expect(reused.json()).toMatchObject({ code: "invalidSecondFactor" });
    });
  });

  describe("passwordless with a passkey", () => {
    it("signs in with user verification, which counts as both factors", async () => {
      const account = await createAccount(test, "lea.passwordless@example.org");
      const { authenticator } = await registerPasskey(
        await signedInClient(test, account.email, account.password),
      );
      const client = new TestClient(test.app);
      const options = (await client.post("/api/v1/auth/sign-in/passkey-options")).json();
      expect(options.userVerification).toBe("required");
      expect(options.rpId).toBe("lunedo.test");
      expect(options.allowCredentials ?? []).toEqual([]);
      const response = await client.post("/api/v1/auth/sign-in/passkey", {
        response: authenticator.assert(options, TEST_ORIGIN),
      });
      expect(response.json()).toMatchObject({
        status: "signedIn",
        sessionKind: "full",
        account: { id: account.id },
      });
      expect((await client.get("/api/v1/auth/session")).json().methods).toEqual(["passkey"]);
    });

    it("rejects an assertion without user verification, an unknown passkey and a reused challenge", async () => {
      const account = await createAccount(test, "noah.noverify@example.org");
      const { authenticator } = await registerPasskey(
        await signedInClient(test, account.email, account.password),
      );

      const client = new TestClient(test.app);
      let options = (await client.post("/api/v1/auth/sign-in/passkey-options")).json();
      const unverified = await client.post("/api/v1/auth/sign-in/passkey", {
        response: authenticator.assert(options, TEST_ORIGIN, { userVerified: false }),
      });
      expect(unverified.json()).toMatchObject({ code: "invalidCredentials" });

      options = (await client.post("/api/v1/auth/sign-in/passkey-options")).json();
      const unknown = await client.post("/api/v1/auth/sign-in/passkey", {
        response: new VirtualAuthenticator().assert(options, TEST_ORIGIN),
      });
      expect(unknown.json()).toMatchObject({ code: "invalidCredentials" });

      const reused = await client.post("/api/v1/auth/sign-in/passkey", {
        response: authenticator.assert(options, TEST_ORIGIN),
      });
      expect(reused.json()).toMatchObject({ code: "challengeExpired" });
    });
  });

  describe("with password and recovery code", () => {
    it("signs in with a recovery code once and notifies the account by e-mail", async () => {
      const account = await createAccount(test, "rita.recovery@example.org");
      const { recoveryCodes } = await addTotp(await signedInClient(test, account.email, account.password));
      const code = recoveryCodes?.[0] ?? "";
      expect(code).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/);

      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      const wrong = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "recoveryCode",
        code: "0000-0000-0000-0000",
      });
      expect(wrong.json()).toMatchObject({ code: "invalidSecondFactor" });
      const signedIn = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "recoveryCode",
        code: code.toUpperCase().replaceAll("-", " "),
      });
      expect(signedIn.json()).toMatchObject({ status: "signedIn" });

      await test.deliverMail();
      const notice = test.mail.sent.find(
        (mail) => mail.to === account.email && mail.subject.startsWith("A recovery code"),
      );
      expect(notice?.subject).toBe("A recovery code was used for Test wiki");
      expect(notice?.text).toContain("9 unused codes are left");
      expect(notice?.html).toContain("9 unused codes are left");

      const again = new TestClient(test.app);
      await again.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      const reused = await again.post("/api/v1/auth/sign-in/second-factor", { type: "recoveryCode", code });
      expect(reused.json()).toMatchObject({ code: "invalidSecondFactor" });
      expect(await auditNames(test)).toContain("twoFactor.recoveryCodeUsed");
    });

    it("invalidates the old codes when new ones are generated", async () => {
      const account = await createAccount(test, "nina.newcodes@example.org");
      const signedIn = await signedInClient(test, account.email, account.password);
      const { recoveryCodes } = await addTotp(signedIn);
      const generated = await signedIn.post("/api/v1/account/recovery-codes");
      expect(generated.json().recoveryCodes).toHaveLength(10);

      const client = new TestClient(test.app);
      await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      const old = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "recoveryCode",
        code: recoveryCodes?.[1],
      });
      expect(old.json()).toMatchObject({ code: "invalidSecondFactor" });
      const fresh = await client.post("/api/v1/auth/sign-in/second-factor", {
        type: "recoveryCode",
        code: generated.json().recoveryCodes[0],
      });
      expect(fresh.json()).toMatchObject({ status: "signedIn" });
    });
  });

  describe("removing second factors", () => {
    it("removes TOTP and the last passkey when no second factor is required", async () => {
      const account = await createAccount(test, "remove.factors@example.org");
      const client = await signedInClient(test, account.email, account.password);
      await addTotp(client);
      const { body } = await registerPasskey(client);

      expect((await client.delete("/api/v1/account/totp")).statusCode).toBe(204);
      expect((await client.get("/api/v1/account/security")).json()).toMatchObject({ totp: false });
      expect((await client.delete(`/api/v1/account/passkeys/${body.passkey.id}`)).statusCode).toBe(204);
      expect((await client.get("/api/v1/account/security")).json()).toMatchObject({
        totp: false,
        passkeys: [],
      });

      expect(await auditEvents(test, "twoFactor.totpRemoved", account.id)).toEqual([
        { actor_type: "account", actor_id: account.id, fields: {} },
      ]);
      expect(await auditEvents(test, "twoFactor.passkeyRemoved", account.id)).toEqual([
        {
          actor_type: "account",
          actor_id: account.id,
          fields: { credentialId: body.passkey.id, name: "Laptop" },
        },
      ]);
      const signIn = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: account.email,
        password: account.password,
      });
      expect(signIn.json()).toMatchObject({ status: "signedIn", sessionKind: "full" });
    });

    it("removes a factor that is not the last one while a second factor is required", async () => {
      const account = await createAccount(test, "remove.required@example.org");
      const client = await signedInClient(test, account.email, account.password);
      await addTotp(client);
      const { body } = await registerPasskey(client);
      await test.runtime.settings.set(twoFactorRequiredSetting, {}, "instance", true);
      try {
        expect((await client.delete(`/api/v1/account/passkeys/${body.passkey.id}`)).statusCode).toBe(204);
        expect((await client.delete("/api/v1/account/totp")).json()).toMatchObject({
          code: "lastSecondFactor",
        });
        expect(await auditEvents(test, "twoFactor.passkeyRemoved", account.id)).toHaveLength(1);
        expect(await auditEvents(test, "twoFactor.totpRemoved", account.id)).toEqual([]);
      } finally {
        await test.runtime.settings.set(twoFactorRequiredSetting, {}, "instance", false);
      }
    });
  });

  describe("when a second factor is required", () => {
    it("lets the owner only set up a second factor until one exists", async () => {
      const client = new TestClient(test.app);
      const response = await client.post("/api/v1/auth/sign-in", OWNER);
      expect(response.json()).toMatchObject({ status: "signedIn", sessionKind: "secondFactorSetup" });
      const before = client.cookies.get(SESSION_COOKIE);

      const blocked = await client.get("/api/v1/account/sessions");
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({ code: "secondFactorSetupRequired" });
      expect((await client.get("/api/v1/account/security")).json()).toMatchObject({
        totp: false,
        secondFactorRequired: true,
        secondFactorRequiredBy: "instanceOwner",
      });

      const { recoveryCodes } = await addTotp(client);
      expect(recoveryCodes).toHaveLength(10);
      expect(client.cookies.get(SESSION_COOKIE)).not.toBe(before);
      expect((await client.get("/api/v1/auth/session")).json().sessionKind).toBe("full");
      expect((await client.get("/api/v1/account/sessions")).statusCode).toBe(200);

      const removed = await client.delete("/api/v1/account/totp");
      expect(removed.statusCode).toBe(409);
      expect(removed.json()).toMatchObject({ code: "lastSecondFactor" });
    });

    it("applies the instance setting to all accounts", async () => {
      const account = await createAccount(test, "required.later@example.org");
      await test.runtime.settings.set(twoFactorRequiredSetting, {}, "instance", true);
      try {
        const client = new TestClient(test.app);
        const response = await client.post("/api/v1/auth/sign-in", {
          email: account.email,
          password: account.password,
        });
        expect(response.json().sessionKind).toBe("secondFactorSetup");
        await registerPasskey(client);
        expect((await client.get("/api/v1/auth/session")).json().sessionKind).toBe("full");
        const passkeys = (await client.get("/api/v1/account/security")).json().passkeys;
        expect((await client.delete(`/api/v1/account/passkeys/${passkeys[0].id}`)).json()).toMatchObject({
          code: "lastSecondFactor",
        });
      } finally {
        await test.runtime.settings.set(twoFactorRequiredSetting, {}, "instance", false);
      }
    });
  });

  it("is not possible before setup is complete", async () => {
    const fresh = await createAuthTestApp();
    try {
      const response = await new TestClient(fresh.app, { origin: "http://localhost:80" }).post(
        "/api/v1/auth/sign-in",
        {
          email: "someone@example.org",
          password: "whatever it is",
        },
      );
      expect(response.json()).toMatchObject({ code: "setupIncomplete" });
    } finally {
      await fresh.close();
    }
  });
});
