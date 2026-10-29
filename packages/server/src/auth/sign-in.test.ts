import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { InvalidCredentialsError, LockedError, RateLimitedError } from "./errors.js";
import { TotpService } from "./two-factor.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("SignInService", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function accountWithRecoveryCodes(email: string) {
    const { services, database } = test;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email,
        name: "Recovery",
        password: "a long recovery passphrase",
        homeOrganizationId: null,
      }),
    );
    const setup = await services.totp.begin(account.id, { issuer: "Test", account: email });
    if (!setup) throw new Error("TOTP was not started");
    await services.totp.verify(
      database,
      account.id,
      TOTP.generate({ secret: Secret.fromBase32(setup.secret) }),
      {
        confirming: true,
      },
    );
    const codes = await services.recoveryCodes.generate(database, account.id);
    return { account, codes };
  }

  it("accepts authenticator codes of one step around now, each only once and never an older one", async () => {
    const { services, database, encryption } = test;
    const now = new Date("2030-01-01T12:00:10Z");
    const totp = new TotpService({ database, encryption, clock: () => now });
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "totp.window@example.org",
        name: "Window",
        password: "a long window passphrase",
        homeOrganizationId: null,
      }),
    );
    const setup = await totp.begin(account.id, { issuer: "Test", account: "totp.window@example.org" });
    if (!setup) throw new Error("TOTP was not started");
    const secret = Secret.fromBase32(setup.secret);
    const at = (steps: number) => TOTP.generate({ secret, timestamp: now.getTime() + steps * 30_000 });

    expect(await totp.verify(database, account.id, at(-1), { confirming: true })).toBe(true);
    expect(await totp.verify(database, account.id, at(-1))).toBe(false);
    expect(await totp.verify(database, account.id, at(-2))).toBe(false);
    expect(await totp.verify(database, account.id, at(2))).toBe(false);
    expect(await totp.verify(database, account.id, at(0))).toBe(true);
    expect(await totp.verify(database, account.id, at(0))).toBe(false);
    expect(await totp.verify(database, account.id, at(-1))).toBe(false);
    expect(await totp.verify(database, account.id, at(1))).toBe(true);
    expect(await totp.verify(database, account.id, at(1))).toBe(false);
  });

  it("takes the account lock before the audit lock when a recovery code is used", async () => {
    const { services, database } = test;
    const { account, codes } = await accountWithRecoveryCodes("lock.order@example.org");
    const first = await services.signIn.signInWithPassword({
      email: account.email ?? "",
      password: "a long recovery passphrase",
      client: {},
    });
    if (first.status !== "secondFactorRequired") throw new Error("A second factor was expected");

    let locked!: () => void;
    const accountLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const concurrentChange = database.transaction(async (tx) => {
      await tx.execute(sql`select id from accounts where id = ${account.id} for update`);
      locked();
      await released;
      await services.audit.record(tx, {
        name: "account.passwordChanged",
        actor: SYSTEM,
        targetId: account.id,
        fields: { endedSessions: 0 },
      });
    });
    await accountLocked;
    const signIn = services.signIn.completeSecondFactor({
      pendingToken: first.pendingToken,
      factor: { type: "recoveryCode", code: codes[0] ?? "" },
      client: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();

    await expect(concurrentChange).resolves.toBeUndefined();
    await expect(signIn).resolves.toMatchObject({ status: "signedIn" });
    const notice = await test.pool.query<{ message: Buffer; id: string }>(
      "select id, message from mail_outbox where template = 'recoveryCodeUsed' order by created_at desc limit 1",
    );
    const stored = notice.rows[0];
    const message = JSON.parse(
      test.encryption.decryptString(stored?.message ?? Buffer.alloc(0), `mail_outbox.message:${stored?.id}`),
    );
    expect(message.text).toContain("You receive this mail for your account's security.");
    expect(message.headers).toBeUndefined();
  });

  it("tells the account about a sign-in from a browser it has not used before", async () => {
    const { services, database } = test;
    const password = "a long browser passphrase";
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "browsers@example.org",
        name: "Browsers",
        password,
        homeOrganizationId: null,
      }),
    );
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const signIn = (deviceToken: string | undefined) =>
      services.signIn.signInWithPassword({
        email: "browsers@example.org",
        password,
        client: { ip: "198.51.100.7", userAgent, ...(deviceToken ? { deviceToken } : {}) },
      });
    const notices = async () =>
      (
        await test.pool.query<{ params: unknown }>(
          "select params from notifications where recipient_id = $1 and type = 'signIn.newBrowser'",
          [account.id],
        )
      ).rows;

    await signIn("first-browser-token-0000000000000000000000000");
    await signIn("first-browser-token-0000000000000000000000000");
    await signIn(undefined);
    expect(await notices()).toEqual([]);

    await signIn("second-browser-token-000000000000000000000000");
    expect(await notices()).toEqual([
      { params: { browser: "Chrome", operatingSystem: "Windows", clientIp: "198.51.100.7" } },
    ]);
    await signIn("second-browser-token-000000000000000000000000");
    await signIn("first-browser-token-0000000000000000000000000");
    expect(await notices()).toHaveLength(1);
  });

  it("offers passkey sign-in to a whole office behind one address and limits a flood", async () => {
    for (let attempt = 0; attempt < 300; attempt++) {
      await test.services.signIn.passkeyOptions("203.0.113.30");
    }
    await expect(test.services.signIn.passkeyOptions("203.0.113.30")).rejects.toThrow(RateLimitedError);
    await expect(test.services.signIn.passkeyOptions("203.0.113.31")).resolves.toMatchObject({
      token: expect.stringMatching(/^[\w-]{43}$/),
    });
    const challenges = await test.pool.query(
      "select count(*)::int as count from auth_challenges where purpose = 'passkeySignIn'",
    );
    expect(challenges.rows[0]?.count).toBe(301);
  });

  it("signs in 250 people from one office address and still limits wrong passwords from it", async () => {
    const { services, database } = test;
    const office = "198.51.100.40";
    const run = randomUUID().slice(0, 8);
    const emails = Array.from({ length: 250 }, (_, index) => `office-${run}-${index}@example.org`);
    for (let start = 0; start < emails.length; start += 5) {
      await Promise.all(
        emails.slice(start, start + 5).map((email) =>
          database.transaction((tx) =>
            services.accounts.createStandard(tx, {
              email,
              name: "Office",
              password: "a long office passphrase",
              homeOrganizationId: null,
            }),
          ),
        ),
      );
    }
    for (const email of emails) {
      const result = await services.signIn.signInWithPassword({
        email,
        password: "a long office passphrase",
        client: { ip: office },
      });
      expect(result.status).toBe("signedIn");
    }
    let refusedAfter = 0;
    for (let attempt = 1; attempt <= 40 && refusedAfter === 0; attempt++) {
      const refusal = await services.signIn
        .signInWithPassword({
          email: emails[attempt] ?? "",
          password: "a wrong guess",
          client: { ip: office },
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      if (refusal instanceof RateLimitedError || refusal instanceof LockedError) refusedAfter = attempt;
      else expect(refusal).toBeInstanceOf(InvalidCredentialsError);
    }
    expect(refusedAfter).toBeGreaterThan(1);
    expect(refusedAfter).toBeLessThanOrEqual(31);
    const blocked = await services.signIn
      .signInWithPassword({
        email: emails[100] ?? "",
        password: "a long office passphrase",
        client: { ip: office },
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(blocked instanceof RateLimitedError || blocked instanceof LockedError).toBe(true);
  }, 120_000);
});
