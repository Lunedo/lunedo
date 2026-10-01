import { sql } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { RateLimitedError } from "./errors.js";

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
  });

  it("limits passkey sign-in options per client", async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await test.services.signIn.passkeyOptions("203.0.113.30");
    }
    await expect(test.services.signIn.passkeyOptions("203.0.113.30")).rejects.toThrow(RateLimitedError);
    await expect(test.services.signIn.passkeyOptions("203.0.113.31")).resolves.toMatchObject({
      token: expect.stringMatching(/^[\w-]{43}$/),
    });
    const challenges = await test.pool.query(
      "select count(*)::int as count from auth_challenges where purpose = 'passkeySignIn'",
    );
    expect(challenges.rows[0]?.count).toBe(31);
  });
});
