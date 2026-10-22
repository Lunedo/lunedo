import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  clientLockoutFailuresSetting,
  maxSessionsSetting,
  reauthenticationSetting,
} from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
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
const DEVICE_COOKIE = "__Host-lunedo-device";

async function sessionCount(test: AuthTestApp, accountId: string): Promise<number> {
  const result = await test.runtime.pool.query<{ count: string }>(
    "select count(*) from sessions where account_id = $1",
    [accountId],
  );
  return Number(result.rows[0]?.count);
}

async function auditEvents(test: AuthTestApp, name: string, targetId: string) {
  const result = await test.runtime.pool.query<{ fields: Record<string, unknown>; actor_type: string }>(
    "select fields, actor_type from audit_events where name = $1 and target_id = $2 order by sequence",
    [name, targetId],
  );
  return result.rows;
}

describe.skipIf(!databaseBaseUrl)("sessions", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(clientLockoutFailuresSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
  });

  afterAll(async () => {
    await test?.close();
  });

  it("ends the least recently used session when an account exceeds ten", async () => {
    const account = await createAccount(test, "many.sessions@example.org");
    const clients: TestClient[] = [];
    for (let i = 0; i < 10; i++) clients.push(await signedInClient(test, account.email, account.password));
    expect(await sessionCount(test, account.id)).toBe(10);

    await test.runtime.pool.query(
      "update sessions set last_used_at = now() - interval '1 hour' where token_hash = sha256($1::bytea)",
      [Buffer.from(clients[3]?.cookies.get(SESSION_COOKIE) ?? "")],
    );
    for (const [index, client] of clients.entries()) {
      if (index !== 3) {
        await test.runtime.pool.query(
          "update sessions set last_used_at = now() - make_interval(mins => $2) where token_hash = sha256($1::bytea)",
          [Buffer.from(client.cookies.get(SESSION_COOKIE) ?? ""), 10 - index],
        );
      }
    }

    const eleventh = await signedInClient(test, account.email, account.password);
    expect(await sessionCount(test, account.id)).toBe(10);
    expect((await clients[3]?.get("/api/v1/auth/session"))?.statusCode).toBe(401);
    for (const [index, client] of clients.entries()) {
      if (index !== 3)
        expect((await client.get("/api/v1/auth/session")).statusCode, `client ${index}`).toBe(200);
    }
    expect((await eleventh.get("/api/v1/auth/session")).statusCode).toBe(200);
    expect(await auditEvents(test, "auth.sessionEnded", account.id)).toEqual([
      { fields: { sessionId: expect.any(String), reason: "sessionLimit" }, actor_type: "system" },
    ]);
  });

  it("keeps the limit when many sign-ins of one account arrive at once", async () => {
    const account = await createAccount(test, "parallel.sessions@example.org");
    await test.runtime.settings.set(maxSessionsSetting, {}, "instance", 3);
    try {
      await Promise.all(
        Array.from({ length: 8 }, () => signedInClient(test, account.email, account.password)),
      );
      expect(await sessionCount(test, account.id)).toBe(3);
    } finally {
      await test.runtime.settings.set(maxSessionsSetting, {}, "instance", 10);
    }
  });

  it("replaces the session of the same browser instead of adding one", async () => {
    const account = await createAccount(test, "same.browser@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const firstSession = client.cookies.get(SESSION_COOKIE);
    const device = client.cookies.get(DEVICE_COOKIE);
    const again = await client.post("/api/v1/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(again.json().status).toBe("signedIn");
    expect(client.cookies.get(DEVICE_COOKIE)).toBe(device);
    expect(client.cookies.get(SESSION_COOKIE)).not.toBe(firstSession);
    expect(await sessionCount(test, account.id)).toBe(1);
    const stale = await new TestClient(test.app).get("/api/v1/auth/session", {
      cookie: `${SESSION_COOKIE}=${firstSession}`,
    });
    expect(stale.statusCode).toBe(401);
    expect(await auditEvents(test, "auth.sessionEnded", account.id)).toEqual([
      { fields: { sessionId: expect.any(String), reason: "replacedOnDevice" }, actor_type: "system" },
    ]);
  });

  it("records client address, browser and operating system", async () => {
    const account = await createAccount(test, "describe.client@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const [session] = (await client.get("/api/v1/account/sessions")).json().items;
    expect(session).toMatchObject({
      current: true,
      clientIp: "198.51.100.10",
      browser: "Chrome",
      operatingSystem: "Windows",
      methods: ["password"],
    });
  });

  it("lists, ends one and ends all other sessions of the account", async () => {
    const account = await createAccount(test, "manage.sessions@example.org");
    const main = await signedInClient(test, account.email, account.password);
    const second = await signedInClient(test, account.email, account.password);
    const third = await signedInClient(test, account.email, account.password);

    const listed = (await main.get("/api/v1/account/sessions")).json().items;
    expect(listed).toHaveLength(3);
    const secondId = (await second.get("/api/v1/account/sessions"))
      .json()
      .items.find((s: { current: boolean }) => s.current).id;

    expect((await main.delete(`/api/v1/account/sessions/${secondId}`)).statusCode).toBe(204);
    expect((await second.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await main.delete(`/api/v1/account/sessions/${secondId}`)).statusCode).toBe(404);

    const other = await createAccount(test, "other.owner@example.org");
    const foreign = await signedInClient(test, other.email, other.password);
    const foreignId = (await foreign.get("/api/v1/account/sessions")).json().items[0].id;
    expect((await main.delete(`/api/v1/account/sessions/${foreignId}`)).statusCode).toBe(404);
    expect((await foreign.get("/api/v1/auth/session")).statusCode).toBe(200);

    expect((await main.post("/api/v1/account/sessions/end-others")).json()).toEqual({ ended: 1 });
    expect((await third.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await main.get("/api/v1/auth/session")).statusCode).toBe(200);
    expect(
      (await auditEvents(test, "auth.sessionEnded", account.id)).map((row) => row.fields.reason),
    ).toEqual(["endedByAccount", "endedByAccount"]);
  });

  it("signs out and clears the cookie", async () => {
    const account = await createAccount(test, "sign.out@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const token = client.cookies.get(SESSION_COOKIE);
    const response = await client.post("/api/v1/auth/sign-out");
    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toEqual([
      expect.stringMatching(/^__Host-lunedo-session=; Path=\/; Max-Age=0;/),
    ]);
    const reused = await new TestClient(test.app).get("/api/v1/auth/session", {
      cookie: `${SESSION_COOKIE}=${token}`,
    });
    expect(reused.statusCode).toBe(401);
    expect(await auditEvents(test, "auth.signedOut", account.id)).toHaveLength(1);
  });

  it("ends sessions after the idle timeout and the maximum lifetime", async () => {
    const account = await createAccount(test, "expiring@example.org");
    const idle = await signedInClient(test, account.email, account.password);
    const lifetime = await signedInClient(test, account.email, account.password);
    await test.runtime.pool.query(
      "update sessions set last_used_at = now() - interval '7 days 1 minute' where token_hash = sha256($1::bytea)",
      [Buffer.from(idle.cookies.get(SESSION_COOKIE) ?? "")],
    );
    await test.runtime.pool.query(
      "update sessions set created_at = now() - interval '30 days 1 minute' where token_hash = sha256($1::bytea)",
      [Buffer.from(lifetime.cookies.get(SESSION_COOKIE) ?? "")],
    );
    expect((await idle.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await lifetime.get("/api/v1/auth/session")).statusCode).toBe(401);
  });

  it("writes the time of last use at most once per minute", async () => {
    const account = await createAccount(test, "touch@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const lastUsed = async () =>
      (
        await test.runtime.pool.query<{ last_used_at: Date }>(
          "select last_used_at from sessions where account_id = $1",
          [account.id],
        )
      ).rows[0]?.last_used_at.getTime();
    const before = await lastUsed();
    await client.get("/api/v1/auth/session");
    expect(await lastUsed()).toBe(before);
    await test.runtime.pool.query(
      "update sessions set last_used_at = now() - interval '61 seconds' where account_id = $1",
      [account.id],
    );
    const moved = await lastUsed();
    await client.get("/api/v1/auth/session");
    expect(await lastUsed()).toBeGreaterThan(moved ?? 0);
  });

  it("ends the sessions of a deactivated account", async () => {
    const account = await createAccount(test, "deactivated@example.org");
    const client = await signedInClient(test, account.email, account.password);
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [account.id]);
    expect((await client.get("/api/v1/auth/session")).statusCode).toBe(401);
    const signIn = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(signIn.json()).toMatchObject({ code: "invalidCredentials" });
  });

  describe("re-authentication", () => {
    it("is required for sensitive actions once the period has passed, and changes the session ID", async () => {
      const account = await createAccount(test, "reauth@example.org");
      const client = await signedInClient(test, account.email, account.password);
      const { secret } = await addTotp(client);
      await test.runtime.pool.query(
        "update sessions set reauthenticated_at = now() - interval '11 minutes' where account_id = $1",
        [account.id],
      );

      const blocked = await client.post("/api/v1/account/recovery-codes");
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({ code: "reauthenticationRequired" });
      expect((await client.delete("/api/v1/account/totp")).json()).toMatchObject({
        code: "reauthenticationRequired",
      });

      const wrong = await client.post("/api/v1/auth/reauthenticate", {
        method: "password",
        password: "wrong one",
      });
      expect(wrong.statusCode).toBe(401);
      expect(await auditEvents(test, "auth.reauthenticationFailed", account.id)).toHaveLength(1);

      const before = client.cookies.get(SESSION_COOKIE);
      const confirmed = await client.post("/api/v1/auth/reauthenticate", {
        method: "totp",
        code: totpNow(secret, 1),
      });
      expect(confirmed.statusCode).toBe(204);
      expect(client.cookies.get(SESSION_COOKIE)).not.toBe(before);
      const stale = await new TestClient(test.app).get("/api/v1/auth/session", {
        cookie: `${SESSION_COOKIE}=${before}`,
      });
      expect(stale.statusCode).toBe(401);
      expect((await client.post("/api/v1/account/recovery-codes")).statusCode).toBe(200);
      expect(await auditEvents(test, "auth.reauthenticated", account.id)).toEqual([
        { fields: { sessionId: expect.any(String), method: "totp" }, actor_type: "account" },
      ]);
    });

    it("follows the configured period", async () => {
      const account = await createAccount(test, "reauth.period@example.org");
      const client = await signedInClient(test, account.email, account.password);
      await test.runtime.pool.query(
        "update sessions set reauthenticated_at = now() - interval '3 minutes' where account_id = $1",
        [account.id],
      );
      expect((await client.post("/api/v1/account/totp")).statusCode).toBe(200);
      await test.runtime.settings.set(reauthenticationSetting, {}, "instance", 2);
      try {
        expect((await client.post("/api/v1/account/totp")).json()).toMatchObject({
          code: "reauthenticationRequired",
        });
        await client.post("/api/v1/auth/reauthenticate", { method: "password", password: account.password });
        expect((await client.post("/api/v1/account/totp")).statusCode).toBe(200);
      } finally {
        await test.runtime.settings.set(reauthenticationSetting, {}, "instance", 10);
      }
    });
  });
});

describe.skipIf(!databaseBaseUrl)("brute-force protection", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  it("locks an account address after five failures, longer each time, also for the right password", async () => {
    const account = await createAccount(test, "brute.force@example.org");
    for (let attempt = 0; attempt < 5; attempt++) {
      const client = new TestClient(test.app, { remoteAddress: `203.0.113.${attempt + 1}` });
      const response = await client.post("/api/v1/auth/sign-in", { email: account.email, password: "guess" });
      expect(response.json()).toMatchObject({ code: "invalidCredentials" });
    }
    const locked = await new TestClient(test.app, { remoteAddress: "203.0.113.50" }).post(
      "/api/v1/auth/sign-in",
      {
        email: account.email,
        password: account.password,
      },
    );
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: "locked" });
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(locked.headers["retry-after"])).toBeLessThanOrEqual(60);

    const first = await auditEvents(test, "auth.lockedOut", account.id);
    expect(first).toEqual([
      {
        fields: { subject: "account", failures: 5, lockedUntil: expect.any(String) },
        actor_type: "anonymous",
      },
    ]);

    await test.runtime.pool.query("update sign_in_failures set locked_until = now() - interval '1 second'");
    await test.runtime.pool.query("delete from rate_limits");
    for (let attempt = 0; attempt < 5; attempt++) {
      await new TestClient(test.app, { remoteAddress: `203.0.113.${attempt + 60}` }).post(
        "/api/v1/auth/sign-in",
        {
          email: account.email,
          password: "guess",
        },
      );
    }
    const second = await auditEvents(test, "auth.lockedOut", account.id);
    expect(second).toHaveLength(2);
    const until = new Date(String(second[1]?.fields.lockedUntil)).getTime();
    expect(until - Date.now()).toBeGreaterThan(60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(120_000);
  });

  it("locks unknown addresses the same way", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new TestClient(test.app, { remoteAddress: `192.0.2.${attempt + 1}` }).post(
        "/api/v1/auth/sign-in",
        {
          email: "Nobody.Here@example.org",
          password: "guess",
        },
      );
    }
    const locked = await new TestClient(test.app, { remoteAddress: "192.0.2.99" }).post(
      "/api/v1/auth/sign-in",
      {
        email: "nobody.here@example.org",
        password: "guess",
      },
    );
    expect(locked.json()).toMatchObject({ code: "locked" });
  });

  it("locks a client address after twenty failures across accounts", async () => {
    const attacker = new TestClient(test.app, { remoteAddress: "2001:db8:1:2::10" });
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await attacker.post("/api/v1/auth/sign-in", {
        email: `victim${attempt}@example.org`,
        password: "guess",
      });
      expect(response.json().code, `attempt ${attempt}`).toBe("invalidCredentials");
    }
    const account = await createAccount(test, "innocent@example.org");
    const sameNetwork = new TestClient(test.app, { remoteAddress: "2001:db8:1:2::99" });
    const blocked = await sameNetwork.post("/api/v1/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(blocked.json()).toMatchObject({ code: "locked" });
    const elsewhere = new TestClient(test.app, { remoteAddress: "2001:db8:1:3::1" });
    expect(
      (
        await elsewhere.post("/api/v1/auth/sign-in", { email: account.email, password: account.password })
      ).json().status,
    ).toBe("signedIn");
  });

  it("slows down attempts per account and per client with a rate limit", async () => {
    const account = await createAccount(test, "rate.limited@example.org");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const client = new TestClient(test.app, { remoteAddress: `198.18.0.${attempt + 1}` });
      statuses.push(
        (await client.post("/api/v1/auth/sign-in", { email: account.email, password: account.password }))
          .statusCode,
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    const busy = new TestClient(test.app, { remoteAddress: "198.18.1.1" });
    const responses = [];
    for (let attempt = 0; attempt < 31; attempt++) {
      responses.push(
        await busy.post("/api/v1/auth/sign-in", { email: `rate${attempt}@example.org`, password: "x" }),
      );
    }
    expect(responses.at(-1)?.json()).toMatchObject({ code: "rateLimited" });
  });

  it("takes the client address from forwarding headers only behind a trusted proxy", async () => {
    const proxied = await createAuthTestApp({
      ...configuredSetupEnv,
      LUNEDO_TRUSTED_PROXIES: "10.0.0.0/8",
    });
    try {
      await completeConfiguredSetup(proxied);
      const account = await createAccount(proxied, "proxied@example.org");
      const viaProxy = new TestClient(proxied.app, { remoteAddress: "10.1.2.3" });
      await viaProxy.post(
        "/api/v1/auth/sign-in",
        { email: account.email, password: account.password },
        {
          "x-forwarded-for": "203.0.113.77",
        },
      );
      const direct = new TestClient(proxied.app, { remoteAddress: "198.51.100.99" });
      await direct.post(
        "/api/v1/auth/sign-in",
        { email: account.email, password: account.password },
        {
          "x-forwarded-for": "203.0.113.88",
        },
      );
      const addresses = await proxied.runtime.pool.query<{ client_ip: string }>(
        "select client_ip from sessions where account_id = $1 order by created_at",
        [account.id],
      );
      expect(addresses.rows.map((row) => row.client_ip)).toEqual(["203.0.113.77", "198.51.100.99"]);
    } finally {
      await proxied.close();
    }
  });

  it("ignores forwarding headers when no proxy is trusted", async () => {
    const unproxied = await createAuthTestApp(configuredSetupEnv);
    try {
      await completeConfiguredSetup(unproxied);
      const account = await createAccount(unproxied, "unproxied@example.org");
      for (let attempt = 0; attempt < 31; attempt++) {
        const client = new TestClient(unproxied.app, { remoteAddress: "127.0.0.1" });
        const response = await client.post(
          "/api/v1/auth/sign-in",
          { email: `nobody-${attempt}@example.org`, password: "not a password of anyone" },
          { "x-forwarded-for": `203.0.113.${attempt + 1}` },
        );
        if (attempt === 30) expect(response.statusCode).toBe(429);
      }
      const signedIn = await new TestClient(unproxied.app, { remoteAddress: "198.51.100.7" }).post(
        "/api/v1/auth/sign-in",
        { email: account.email, password: account.password },
        { "x-forwarded-for": "203.0.113.99" },
      );
      expect(signedIn.statusCode).toBe(200);
      const addresses = await unproxied.runtime.pool.query<{ client_ip: string }>(
        "select client_ip from sessions where account_id = $1",
        [account.id],
      );
      expect(addresses.rows.map((row) => row.client_ip)).toEqual(["198.51.100.7"]);
    } finally {
      await unproxied.close();
    }
  });
});

describe.skipIf(!databaseBaseUrl)("CSRF protection", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  it("rejects state-changing requests without the header or with a foreign origin", async () => {
    const account = await createAccount(test, "csrf@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const cookie = [...client.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const attempts = [
      { origin: TEST_ORIGIN },
      { "x-lunedo-request": "1" },
      { "x-lunedo-request": "1", origin: "https://evil.example" },
      { "x-lunedo-request": "1", origin: "http://lunedo.test" },
      { "x-lunedo-request": "0", origin: TEST_ORIGIN },
    ];
    for (const headers of attempts) {
      const response = await test.app.inject({
        method: "POST",
        url: "/api/v1/account/sessions/end-others",
        headers: { cookie, ...headers },
      });
      expect(response.statusCode, JSON.stringify(headers)).toBe(403);
      expect(response.json()).toMatchObject({ code: "csrfRejected" });
    }
    const signIn = await test.app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in",
      headers: { origin: "https://evil.example", "x-lunedo-request": "1" },
      payload: { email: account.email, password: account.password },
    });
    expect(signIn.statusCode).toBe(403);
    expect((await client.post("/api/v1/account/sessions/end-others")).statusCode).toBe(200);
  });

  it("lets reading requests through without the header", async () => {
    const account = await createAccount(test, "csrf.read@example.org");
    const client = await signedInClient(test, account.email, account.password);
    const cookie = [...client.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await test.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe.skipIf(!databaseBaseUrl)("request validation", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  it("rejects malformed, unknown and oversized input at the boundary", async () => {
    const headers = { "x-lunedo-request": "1", origin: TEST_ORIGIN, "content-type": "application/json" };
    const send = (payload: string, extra: Record<string, string> = {}) =>
      test.app.inject({
        method: "POST",
        url: "/api/v1/auth/sign-in",
        headers: { ...headers, ...extra },
        payload,
      });
    const malformed = await send("{not json");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers["content-type"]).toContain("application/problem+json");
    expect(malformed.json()).toEqual({
      type: "urn:lunedo:problem:invalidInput",
      title: "The request is not valid",
      status: 400,
      code: "invalidInput",
    });
    const unknownField = await send(JSON.stringify({ email: "a@example.org", password: "b", admin: true }));
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json()).toMatchObject({ code: "invalidInput" });
    const longPassword = await send(JSON.stringify({ email: "a@example.org", password: "x".repeat(257) }));
    expect(longPassword.json()).toMatchObject({ code: "invalidInput", fields: ["body.password"] });
    const oversized = await send("x".repeat(2_000_000));
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ type: "urn:lunedo:problem:payloadTooLarge" });
    expect((await send("hello", { "content-type": "text/plain" })).statusCode).toBe(400);
  });
});
