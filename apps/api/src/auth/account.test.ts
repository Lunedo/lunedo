import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  languageSetting,
  passwordMinLengthSetting,
} from "@pagehall/server";
import { testJobContext } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  signedInClient,
  totpNow,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const SESSION_COOKIE = "__Host-pagehall-session";

/** Runs the password reset jobs the API queued, as the worker would. */
async function runPasswordResetJobs(test: AuthTestApp): Promise<number> {
  const jobs = await test.runtime.pool.query<{ id: string; data: { payload: { email: string } } }>(
    "delete from pgboss.job where name = 'auth.password-reset-request' returning id, data",
  );
  for (const job of jobs.rows) {
    await test.runtime.services.security.handlePasswordResetRequest(
      testJobContext("auth.password-reset-request", job.data.payload),
    );
  }
  await test.deliverMail();
  return jobs.rows.length;
}

function linkToken(text: string | undefined): string {
  const match = /#token=([\w-]{43})/.exec(text ?? "");
  if (!match?.[1]) throw new Error("The mail contains no link with a token");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("account security", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
  });

  afterAll(async () => {
    await test?.close();
  });

  describe("password change", () => {
    it("requires re-authentication, checks the policy and ends all other sessions", async () => {
      const account = await createAccount(test, "change.password@example.org");
      const client = await signedInClient(test, account.email, account.password);
      const other = await signedInClient(test, account.email, account.password);

      expect((await client.post("/api/v1/account/password", { password: "short" })).json()).toMatchObject({
        code: "passwordPolicy",
        problem: "tooShort",
        minLength: 12,
      });
      expect((await client.post("/api/v1/account/password", { password: "x".repeat(257) })).statusCode).toBe(
        400,
      );

      await test.runtime.pool.query(
        "update sessions set reauthenticated_at = now() - interval '1 hour' where token_hash = sha256($1::bytea)",
        [Buffer.from(client.cookies.get(SESSION_COOKIE) ?? "")],
      );
      expect(
        (await client.post("/api/v1/account/password", { password: "a new long passphrase" })).json(),
      ).toMatchObject({
        code: "reauthenticationRequired",
      });
      await client.post("/api/v1/auth/reauthenticate", { method: "password", password: account.password });

      const before = client.cookies.get(SESSION_COOKIE);
      expect(
        (await client.post("/api/v1/account/password", { password: "a new long passphrase" })).statusCode,
      ).toBe(204);
      expect(client.cookies.get(SESSION_COOKIE)).not.toBe(before);
      expect((await client.get("/api/v1/auth/session")).statusCode).toBe(200);
      expect((await other.get("/api/v1/auth/session")).statusCode).toBe(401);

      const old = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: account.email,
        password: account.password,
      });
      expect(old.statusCode).toBe(401);
      await signedInClient(test, account.email, "a new long passphrase");

      const events = await test.runtime.pool.query(
        "select fields from audit_events where name = 'account.passwordChanged' and target_id = $1",
        [account.id],
      );
      expect(events.rows).toEqual([{ fields: { endedSessions: 1 } }]);
    });

    it("ends pending sign-ins of the account", async () => {
      const account = await createAccount(test, "pending.change@example.org");
      const client = await signedInClient(test, account.email, account.password);
      const { secret } = await addTotp(client);
      const pending = new TestClient(test.app);
      await pending.post("/api/v1/auth/sign-in", { email: account.email, password: account.password });
      expect(
        (await client.post("/api/v1/account/password", { password: "changed while pending" })).statusCode,
      ).toBe(204);
      const second = await pending.post("/api/v1/auth/sign-in/second-factor", {
        type: "totp",
        code: totpNow(secret, 1),
      });
      expect(second.json()).toMatchObject({ code: "challengeExpired" });
    });

    it("follows a stricter minimum length set for the instance", async () => {
      const account = await createAccount(test, "longer.password@example.org");
      const client = await signedInClient(test, account.email, account.password);
      await test.runtime.settings.set(passwordMinLengthSetting, {}, "instance", 20);
      try {
        expect(
          (await client.post("/api/v1/account/password", { password: "only sixteen chr" })).json(),
        ).toMatchObject({
          code: "passwordPolicy",
          minLength: 20,
        });
      } finally {
        await test.runtime.settings.set(passwordMinLengthSetting, {}, "instance", 12);
      }
    });
  });

  describe("password reset", () => {
    it("works end to end and ends all sessions", async () => {
      const account = await createAccount(test, "Reset.Me@example.org");
      const signedIn = await signedInClient(test, account.email, account.password);
      await test.runtime.pool.query(
        "insert into sign_in_failures (key, failures, first_failure_at) values ('account:' || encode(sha256(convert_to('reset.me@example.org', 'UTF8')), 'hex'), 3, now())",
      );

      const anonymous = new TestClient(test.app);
      const requested = await anonymous.post("/api/v1/auth/password-reset", {
        email: "reset.me@EXAMPLE.org",
      });
      expect(requested.statusCode).toBe(202);
      expect(await runPasswordResetJobs(test)).toBe(1);
      const mail = test.mail.sent.findLast((sent) => sent.to === "Reset.Me@example.org");
      expect(mail?.subject).toBe("Reset your password for Test wiki");
      const token = linkToken(mail?.text);
      expect(mail?.text).toContain(`https://pagehall.test/reset-password#token=${token}`);

      expect(
        (
          await anonymous.post("/api/v1/auth/password-reset/complete", { token, password: "password1234" })
        ).json(),
      ).toMatchObject({
        code: "passwordPolicy",
      });
      const completed = await anonymous.post("/api/v1/auth/password-reset/complete", {
        token,
        password: "reset passphrase 2026",
      });
      expect(completed.statusCode).toBe(204);
      expect((await signedIn.get("/api/v1/auth/session")).statusCode).toBe(401);
      expect(
        (
          await anonymous.post("/api/v1/auth/password-reset/complete", {
            token,
            password: "another passphrase 99",
          })
        ).json(),
      ).toMatchObject({
        code: "invalidToken",
      });
      await signedInClient(test, account.email, "reset passphrase 2026");
      const failures = await test.runtime.pool.query(
        "select 1 from sign_in_failures where key like 'account:%' and failures > 0",
      );
      expect(failures.rows).toEqual([]);

      const names = await test.runtime.pool.query<{ name: string }>(
        "select name from audit_events where target_id = $1 order by sequence",
        [account.id],
      );
      expect(names.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(["account.passwordResetRequested", "account.passwordReset"]),
      );
    });

    it("answers the same for unknown addresses and sends nothing", async () => {
      const sentBefore = test.mail.sent.length;
      const unknown = await new TestClient(test.app).post("/api/v1/auth/password-reset", {
        email: "ghost@example.org",
      });
      const account = await createAccount(test, "known@example.org");
      const known = await new TestClient(test.app).post("/api/v1/auth/password-reset", {
        email: account.email,
      });
      expect(unknown.statusCode).toBe(202);
      expect(known.statusCode).toBe(202);
      expect(unknown.body).toBe(known.body);
      await runPasswordResetJobs(test);
      expect(test.mail.sent.slice(sentBefore).map((mail) => mail.to)).toEqual([account.email]);
    });

    it("rejects expired tokens and keeps only the newest token", async () => {
      const account = await createAccount(test, "expired.reset@example.org");
      await new TestClient(test.app).post("/api/v1/auth/password-reset", { email: account.email });
      await runPasswordResetJobs(test);
      const first = linkToken(test.mail.sent.findLast((mail) => mail.to === account.email)?.text);
      await new TestClient(test.app).post("/api/v1/auth/password-reset", { email: account.email });
      await runPasswordResetJobs(test);
      const second = linkToken(test.mail.sent.findLast((mail) => mail.to === account.email)?.text);

      const client = new TestClient(test.app);
      expect(
        (
          await client.post("/api/v1/auth/password-reset/complete", {
            token: first,
            password: "a fine passphrase",
          })
        ).json(),
      ).toMatchObject({
        code: "invalidToken",
      });
      await test.runtime.pool.query(
        "update account_tokens set expires_at = now() - interval '1 second' where account_id = $1",
        [account.id],
      );
      expect(
        (
          await client.post("/api/v1/auth/password-reset/complete", {
            token: second,
            password: "a fine passphrase",
          })
        ).json(),
      ).toMatchObject({
        code: "invalidToken",
      });
      const stored = await test.runtime.pool.query<{ token_hash: Buffer }>(
        "select token_hash from account_tokens where account_id = $1",
        [account.id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.token_hash.toString("base64url")).not.toContain(second);
    });

    it("limits requests per address without changing the answer", async () => {
      const account = await createAccount(test, "flooded@example.org");
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(
          (await new TestClient(test.app).post("/api/v1/auth/password-reset", { email: account.email }))
            .statusCode,
        ).toBe(202);
      }
      expect(await runPasswordResetJobs(test)).toBe(3);
    });
  });

  describe("e-mail change", () => {
    it("confirms the new address and notifies the old one", async () => {
      const account = await createAccount(test, "old.address@example.org");
      const client = await signedInClient(test, account.email, account.password);
      expect(
        (await client.post("/api/v1/account/email", { email: "OLD.address@example.org" })).json(),
      ).toMatchObject({
        code: "sameEmail",
      });
      expect(
        (await client.post("/api/v1/account/email", { email: "New.Address@example.org" })).statusCode,
      ).toBe(202);
      await test.deliverMail();
      const confirmation = test.mail.sent.findLast((mail) => mail.to === "New.Address@example.org");
      expect(confirmation?.subject).toBe("Confirm your new e-mail address for Test wiki");
      const token = linkToken(confirmation?.text);

      expect(
        (await new TestClient(test.app).post("/api/v1/auth/email-change/confirm", { token })).statusCode,
      ).toBe(204);
      await test.deliverMail();
      const notice = test.mail.sent.findLast((mail) => mail.to === "old.address@example.org");
      expect(notice?.subject).toBe("Your e-mail address on Test wiki was changed");
      expect(notice?.text).toContain("New.Address@example.org");
      const changed = await test.runtime.pool.query(
        "select actor_type, actor_id, fields from audit_events where name = 'account.emailChanged' and target_id = $1",
        [account.id],
      );
      expect(changed.rows).toEqual([
        {
          actor_type: "account",
          actor_id: account.id,
          fields: { previousEmail: "old.address@example.org", newEmail: "New.Address@example.org" },
        },
      ]);

      expect(
        (await new TestClient(test.app).post("/api/v1/auth/email-change/confirm", { token })).json(),
      ).toMatchObject({
        code: "invalidToken",
      });
      const signIn = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
        email: "new.address@example.org",
        password: account.password,
      });
      expect(signIn.json()).toMatchObject({
        status: "signedIn",
        account: { email: "New.Address@example.org" },
      });
    });

    it("does not reveal that the new address belongs to another account", async () => {
      await createAccount(test, "taken@example.org");
      const account = await createAccount(test, "wants.taken@example.org");
      const client = await signedInClient(test, account.email, account.password);
      const response = await client.post("/api/v1/account/email", { email: "TAKEN@example.org" });
      expect(response.statusCode).toBe(202);
      await test.deliverMail();
      const mail = test.mail.sent.findLast((sent) => sent.to === "TAKEN@example.org");
      expect(mail?.subject).toBe("E-mail address already in use on Test wiki");
      expect(mail?.text).not.toContain("#token=");
    });

    it("fails when another account took the address before the confirmation", async () => {
      const account = await createAccount(test, "slow.confirm@example.org");
      const client = await signedInClient(test, account.email, account.password);
      await client.post("/api/v1/account/email", { email: "race@example.org" });
      await test.deliverMail();
      const token = linkToken(test.mail.sent.findLast((mail) => mail.to === "race@example.org")?.text);
      await createAccount(test, "Race@example.org");
      const confirmed = await new TestClient(test.app).post("/api/v1/auth/email-change/confirm", { token });
      expect(confirmed.statusCode).toBe(409);
      expect(confirmed.json()).toMatchObject({ code: "emailInUse" });
      const stored = await test.runtime.pool.query("select email from accounts where id = $1", [account.id]);
      expect(stored.rows).toEqual([{ email: "slow.confirm@example.org" }]);
    });

    it("writes mails in the language of the account", async () => {
      const account = await createAccount(test, "deutsch@example.org");
      await test.runtime.settings.set(languageSetting, { user: account.id }, "user", "de");
      const client = await signedInClient(test, account.email, account.password);
      await client.post("/api/v1/account/email", { email: "neu@example.org" });
      await test.deliverMail();
      const mail = test.mail.sent.findLast((sent) => sent.to === "neu@example.org");
      expect(mail?.subject).toBe("Neue E-Mail-Adresse für Test wiki bestätigen");
      expect(mail?.html).toContain('<html lang="de">');
    });
  });

  it("keeps e-mail addresses unique regardless of case and stores them as entered", async () => {
    const account = await createAccount(test, "MiXeD.Case@Example.org");
    expect(account.email).toBe("MiXeD.Case@Example.org");
    await expect(createAccount(test, "mixed.case@example.org")).rejects.toThrow("already in use");
  });
});
