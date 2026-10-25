import { checkReachability, createLogger, type ProbeFetch } from "@lunedo/server";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";

const CLIENT_IP = "198.51.100.10";
const behindProxy = { host: "lunedo.test", "x-forwarded-proto": "https" };

async function issueCode(test: AuthTestApp): Promise<string> {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    level: "info",
    destination: { write: (line: string) => lines.push(line) },
  });
  await test.runtime.services.setup.issueCode(logger);
  const match = /setup#code=([0-9A-Z-]+)\./.exec(lines.join(""));
  if (!match?.[1]) throw new Error("No setup code was logged");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("setup through the API", () => {
  let test: AuthTestApp;
  let client: TestClient;
  let recoveryCodes: string[] = [];

  beforeAll(async () => {
    test = await createAuthTestApp({ LUNEDO_TRUSTED_PROXIES: CLIENT_IP });
    client = new TestClient(test.app, { remoteAddress: CLIENT_IP });
  });

  afterAll(async () => {
    await test?.close();
  });

  const post = (url: string, body?: unknown) => client.post(url, body, behindProxy);
  const get = (url: string) => client.get(url, behindProxy);

  it("sets up the instance with the owner, a second factor and the key backup", async () => {
    const earlierCode = await issueCode(test);
    const code = await issueCode(test);
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    expect((await get("/api/v1/setup")).json()).toEqual({ completed: false, session: false });
    expect((await get("/api/v1/setup/steps")).statusCode).toBe(401);
    expect((await post("/api/v1/setup/session", { code: earlierCode })).json()).toMatchObject({
      code: "invalidSetupCode",
    });
    const started = await post("/api/v1/setup/session", { code });
    expect(started.statusCode).toBe(204);
    expect(started.headers["set-cookie"]).toEqual([
      expect.stringMatching(
        /^__Host-lunedo-setup=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
      ),
    ]);
    expect(
      (await new TestClient(test.app).post("/api/v1/setup/session", { code }, behindProxy)).statusCode,
    ).toBe(401);
    expect((await get("/api/v1/setup")).json()).toEqual({ completed: false, session: true });

    const status = (await get("/api/v1/setup/steps")).json();
    expect(status.steps.map((step: { id: string }) => step.id)).toEqual([
      "instance",
      "systemCheck",
      "owner",
      "keyBackup",
      "organization",
    ]);
    expect(status.ready).toBe(false);
    const checks = async () =>
      (await get("/api/v1/setup/steps"))
        .json()
        .steps.find((step: { id: string }) => step.id === "systemCheck").details.checks;
    expect(status.steps[1].details.checks).toMatchObject({
      database: { status: "ok", migrationsUpToDate: true },
      fileStorage: { writable: true },
      instanceUrl: { status: "warning", configured: false },
      reachability: { status: "warning", cause: "notSet", url: null },
      clock: { status: "ok" },
    });
    expect((await post("/api/v1/setup/complete")).json()).toMatchObject({ code: "setupNotReady" });

    expect(
      (await post("/api/v1/setup/steps/instance/save", { url: "not a url", name: "x" })).statusCode,
    ).toBe(400);
    expect(
      (await post("/api/v1/setup/steps/instance/save", { url: TEST_ORIGIN, name: "Test wiki" })).statusCode,
    ).toBe(200);
    expect((await checks()).https).toMatchObject({ status: "ok" });
    expect((await post("/api/v1/setup/steps/systemCheck/acknowledge")).statusCode).toBe(200);

    expect(
      (
        await post("/api/v1/setup/steps/owner/createAccount", {
          email: "Owner@Example.org",
          name: "Olivia Owner",
          password: "password1234",
        })
      ).json(),
    ).toMatchObject({ code: "passwordPolicy", problem: "common" });
    expect(
      (
        await post("/api/v1/setup/steps/owner/createAccount", {
          email: "Owner@Example.org",
          name: "Olivia Owner",
          password: "violet tram umbrella",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await test.runtime.pool.query(
          "select 1 from setting_values where level = 'user' and key = 'locale.language'",
        )
      ).rowCount,
    ).toBe(0);
    expect((await post("/api/v1/setup/steps/keyBackup/download")).json()).toMatchObject({
      code: "totpMissing",
    });
    const totp = (await post("/api/v1/setup/steps/owner/beginTotp")).json();
    expect(totp.uri).toMatch(/^otpauth:\/\/totp\/Test%20wiki:Owner%40Example\.org\?/);
    expect((await post("/api/v1/setup/steps/owner/confirmTotp", { code: "000000" })).statusCode).toBe(401);
    const confirmed = await post("/api/v1/setup/steps/owner/confirmTotp", {
      code: TOTP.generate({ secret: Secret.fromBase32(totp.secret) }),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({});
    const stepOf = async (id: string) =>
      (await get("/api/v1/setup/steps")).json().steps.find((step: { id: string }) => step.id === id);
    expect(await stepOf("owner")).toMatchObject({ completed: true, details: { totpConfirmed: true } });
    expect((await post("/api/v1/setup/steps/owner/renewRecoveryCodes")).json()).toMatchObject({
      code: "unknownSetupAction",
    });

    const mail = await post("/api/v1/setup/steps/mail/save", {
      host: "smtp.lunedo.test",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@lunedo.test",
    });
    expect(mail.statusCode).toBe(404);

    expect((await post("/api/v1/setup/steps/keyBackup/confirm")).json()).toMatchObject({
      code: "keysNotDownloaded",
    });
    const download = await post("/api/v1/setup/steps/keyBackup/download");
    expect(download.statusCode).toBe(200);
    expect(download.headers["cache-control"]).toBe("no-store");
    const kit = download.json();
    expect(kit).toEqual({
      instanceUrl: TEST_ORIGIN,
      createdAt: expect.any(String),
      recoveryCodes: expect.any(Array),
      masterKeys: expect.stringMatching(/^1:[A-Za-z0-9+/=]{44}$/),
      backupKey: expect.stringMatching(/^1:[A-Za-z0-9+/=]{44}$/),
    });
    expect(kit.recoveryCodes).toHaveLength(10);
    expect((await post("/api/v1/setup/steps/keyBackup/download")).json()).toMatchObject({
      code: "keysAlreadyDownloaded",
    });
    expect((await post("/api/v1/setup/steps/keyBackup/confirm")).statusCode).toBe(200);
    expect((await get("/api/v1/setup/steps")).json().ready).toBe(false);
    const keyConfirmation = await test.runtime.pool.query(
      "select b.key_confirmed_at is not null as confirmed, a.email from backup_configuration b join accounts a on a.id = b.key_confirmed_by",
    );
    expect(keyConfirmation.rows).toEqual([{ confirmed: true, email: "Owner@Example.org" }]);
    recoveryCodes = kit.recoveryCodes;

    const organization = await post("/api/v1/setup/steps/organization/save", {
      name: "Platform Team",
      language: "de",
      timeZone: "Europe/Vienna",
    });
    expect(organization.statusCode).toBe(200);
    const organizationId = organization.json().organizationId;
    const formats = async () =>
      (
        await test.runtime.pool.query(
          "select key, value from setting_values where level = 'organization' and scope_id = $1 and key in ('locale.dateFormat', 'locale.timeFormat', 'locale.numberFormat', 'locale.firstDayOfWeek') order by key",
          [organizationId],
        )
      ).rows;
    expect(await formats()).toEqual([
      { key: "locale.dateFormat", value: "D MMM YYYY" },
      { key: "locale.firstDayOfWeek", value: "monday" },
      { key: "locale.numberFormat", value: "de-DE" },
      { key: "locale.timeFormat", value: "24h" },
    ]);
    expect(
      (await get("/api/v1/setup/steps"))
        .json()
        .steps.find((step: { id: string }) => step.id === "organization").details.formats,
    ).toEqual({
      dateFormat: "D MMM YYYY",
      timeFormat: "24h",
      numberFormat: "de-DE",
      firstDayOfWeek: "monday",
    });
    expect(
      (
        await post("/api/v1/setup/steps/organization/save", {
          name: "Platform Team",
          language: "de",
          timeZone: "Europe/Vienna",
          formats: {
            dateFormat: "YYYY-MM-DD",
            timeFormat: "24h",
            numberFormat: "de-CH",
            firstDayOfWeek: "monday",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(await formats()).toEqual([
      { key: "locale.dateFormat", value: "YYYY-MM-DD" },
      { key: "locale.firstDayOfWeek", value: "monday" },
      { key: "locale.numberFormat", value: "de-CH" },
      { key: "locale.timeFormat", value: "24h" },
    ]);
    expect(
      (
        await test.runtime.pool.query(
          "select key, value from setting_values where level = 'instance' and key like 'locale.%' order by key",
        )
      ).rows,
    ).toEqual([
      { key: "locale.dateFormat", value: "YYYY-MM-DD" },
      { key: "locale.firstDayOfWeek", value: "monday" },
      { key: "locale.language", value: "de" },
      { key: "locale.numberFormat", value: "de-CH" },
      { key: "locale.timeFormat", value: "24h" },
      { key: "locale.timeZone", value: "Europe/Vienna" },
    ]);
    expect(
      (
        await post("/api/v1/setup/steps/organization/save", {
          name: "Platform Team",
          language: "de",
          timeZone: "Europe/Vienna",
          formats: { dateFormat: "auto", timeFormat: "24h", numberFormat: "de-CH", firstDayOfWeek: "monday" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post("/api/v1/setup/steps/organization/save", {
          name: "Platform",
          language: "de",
          timeZone: "Mars/Olympus",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post("/api/v1/setup/steps/organization/save", {
          name: "Platform",
          language: "de",
          timeZone: "Europe/Vienna",
        })
      ).json(),
    ).toEqual({ organizationId });
    const ownerRow = await test.runtime.pool.query(
      "select a.home_organization_id, ra.built_in_role from accounts a join role_assignments ra on ra.principal_id = a.id where lower(a.email) = 'owner@example.org'",
    );
    expect(ownerRow.rows).toEqual([{ home_organization_id: organizationId, built_in_role: "owner" }]);
    expect((await get("/api/v1/setup/steps")).json().ready).toBe(true);

    expect(client.cookies.has("__Host-lunedo-session")).toBe(false);
    const completed = await post("/api/v1/setup/complete");
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ mailConfigured: false });
    expect(client.cookies.has("__Host-lunedo-setup")).toBe(false);
    const session = await get("/api/v1/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ sessionKind: "full", account: { email: "Owner@Example.org" } });
    const signedIn = await test.runtime.pool.query<{ fields: { methods: string[] } }>(
      "select fields from audit_events where name = 'auth.signedIn'",
    );
    expect(signedIn.rows.map((row) => row.fields.methods)).toEqual([["password", "totp"]]);
  });

  it("answers as if the setup endpoints did not exist afterwards", async () => {
    expect((await get("/api/v1/unknown")).json()).toEqual({
      type: "urn:lunedo:problem:notFound",
      title: "Not found",
      status: 404,
      code: "notFound",
    });
    for (const [method, url] of [
      ["GET", "/api/v1/setup"],
      ["GET", "/api/v1/setup/steps"],
      ["POST", "/api/v1/setup/session"],
      ["POST", "/api/v1/setup/steps/owner/createAccount"],
      ["POST", "/api/v1/setup/complete"],
    ] as const) {
      const response = method === "GET" ? await get(url) : await post(url, { code: "AAAA-AAAA-AAAA-AAAA" });
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toEqual({
        type: "urn:lunedo:problem:notFound",
        title: "Not found",
        status: 404,
        code: "notFound",
      });
    }
  });

  it("does not issue a setup code once setup is complete", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      level: "info",
      destination: { write: (line: string) => lines.push(line) },
    });
    await test.runtime.services.setup.issueCode(logger);
    expect(lines).toEqual([]);
  });

  it("records every step in an intact audit log", async () => {
    const results = await test.runtime.audit.verify();
    expect(results.every((result) => result.broken === null)).toBe(true);
    const events = await test.runtime.pool.query<{ name: string; actor_type: string }>(
      "select name, actor_type from audit_events order by sequence",
    );
    const names = events.rows.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "setup.sessionStarted",
        "setup.stepCompleted",
        "settings.changed",
        "account.created",
        "twoFactor.totpAdded",
        "twoFactor.recoveryCodesGenerated",
        "setup.keyBackupDownloaded",
        "setup.completed",
        "organization.created",
      ]),
    );
    expect(JSON.stringify(events.rows)).not.toMatch(/violet tram umbrella/);
  });

  it("lets the owner sign in with password and TOTP afterwards", async () => {
    const owner = new TestClient(test.app);
    const first = await owner.post("/api/v1/auth/sign-in", {
      email: "owner@example.org",
      password: "violet tram umbrella",
    });
    expect(first.json()).toEqual({ status: "secondFactorRequired", factors: ["totp", "recoveryCode"] });
  });

  it("accepts a recovery code from the emergency kit", async () => {
    const owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", {
      email: "owner@example.org",
      password: "violet tram umbrella",
    });
    const signedIn = await owner.post("/api/v1/auth/sign-in/second-factor", {
      type: "recoveryCode",
      code: recoveryCodes[0],
    });
    expect(signedIn.json()).toMatchObject({ status: "signedIn" });
  });
});

describe.skipIf(!databaseBaseUrl)("changing the owner after the emergency kit was downloaded", () => {
  let test: AuthTestApp;
  let client: TestClient;

  beforeAll(async () => {
    test = await createAuthTestApp({ LUNEDO_TRUSTED_PROXIES: CLIENT_IP });
    client = new TestClient(test.app, { remoteAddress: CLIENT_IP });
  });

  afterAll(async () => {
    await test?.close();
  });

  const post = (url: string, body?: unknown) => client.post(url, body, behindProxy);
  const get = (url: string) => client.get(url, behindProxy);

  it("asks for a new kit, because the codes in the first one no longer work", async () => {
    await post("/api/v1/setup/session", { code: await issueCode(test) });
    await post("/api/v1/setup/steps/instance/save", { url: TEST_ORIGIN, name: "Test wiki" });
    const owner = { email: "owner@example.org", name: "Olivia Owner", password: "violet tram umbrella" };
    const confirmOwner = async () => {
      expect((await post("/api/v1/setup/steps/owner/createAccount", owner)).statusCode).toBe(200);
      const totp = (await post("/api/v1/setup/steps/owner/beginTotp")).json();
      await post("/api/v1/setup/steps/owner/confirmTotp", {
        code: TOTP.generate({ secret: Secret.fromBase32(totp.secret) }),
      });
    };
    await confirmOwner();
    const first = (await post("/api/v1/setup/steps/keyBackup/download")).json();
    expect((await post("/api/v1/setup/steps/keyBackup/confirm")).statusCode).toBe(200);

    await confirmOwner();
    const keyBackup = (await get("/api/v1/setup/steps"))
      .json()
      .steps.find((step: { id: string }) => step.id === "keyBackup");
    expect(keyBackup).toMatchObject({ completed: false, details: { downloaded: false } });
    const second = (await post("/api/v1/setup/steps/keyBackup/download")).json();
    expect(second.recoveryCodes).toHaveLength(10);
    expect(second.recoveryCodes).not.toContain(first.recoveryCodes[0]);
    expect(second.masterKeys).toBe(first.masterKeys);
  });
});

describe.skipIf(!databaseBaseUrl)("setup with an instance URL that differs from the origin in use", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp({ LUNEDO_TRUSTED_PROXIES: CLIENT_IP });
  });

  afterAll(async () => {
    await test?.close();
  });

  it("confirms that the address of the instance leads to this instance", async () => {
    const resolve = async () => ["203.0.113.20"];
    const throughThisInstance: ProbeFetch = async (url) => {
      const answered = await test.app.inject({ method: "GET", url: new URL(url).pathname });
      return new Response(answered.body, { status: answered.statusCode });
    };
    expect(
      await checkReachability(test.runtime.database, `${TEST_ORIGIN}/`, {
        fetch: throughThisInstance,
        resolve,
      }),
    ).toMatchObject({ status: "ok", cause: null, url: `${TEST_ORIGIN}/` });

    const elsewhere: ProbeFetch = async () => new Response(JSON.stringify({ answer: "guessed" }));
    expect(
      await checkReachability(test.runtime.database, TEST_ORIGIN, { fetch: elsewhere, resolve }),
    ).toMatchObject({ status: "warning", cause: "otherServer" });

    const flooding: ProbeFetch = async () => new Response(`{"answer":"${"x".repeat(10_000)}"}`);
    expect(
      await checkReachability(test.runtime.database, TEST_ORIGIN, { fetch: flooding, resolve }),
    ).toMatchObject({ status: "warning", cause: "otherServer" });

    const nothing: ProbeFetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(
      await checkReachability(test.runtime.database, TEST_ORIGIN, { fetch: nothing, resolve }),
    ).toMatchObject({ status: "warning", cause: "unreachable" });

    let replayed = "";
    const recording: ProbeFetch = async (url, init) => {
      replayed = new URL(url).pathname;
      return throughThisInstance(url, init);
    };
    await checkReachability(test.runtime.database, TEST_ORIGIN, { fetch: recording, resolve });
    expect((await test.app.inject({ method: "GET", url: replayed })).statusCode).toBe(404);
    expect(
      (await test.app.inject({ method: "GET", url: `/api/v1/setup/probe/${"A".repeat(43)}` })).statusCode,
    ).toBe(404);
  });

  it("follows redirects of the probe only on the same host and never to link-local addresses", async () => {
    const requested: string[] = [];
    const redirecting =
      (location: (url: URL) => string): ProbeFetch =>
      async (url, init) => {
        requested.push(url);
        expect(init.redirect).toBe("manual");
        const target = new URL(url);
        if (target.protocol === "http:")
          return new Response(null, { status: 308, headers: { location: location(target) } });
        const answered = await test.app.inject({ method: "GET", url: target.pathname });
        return new Response(answered.body, { status: answered.statusCode });
      };
    const resolve = async () => ["203.0.113.20"];
    const httpOrigin = TEST_ORIGIN.replace(/^https:/, "http:");

    const sameHost = redirecting((url) => `https://${url.host}${url.pathname}`);
    expect(
      await checkReachability(test.runtime.database, httpOrigin, { fetch: sameHost, resolve }),
    ).toMatchObject({
      cause: null,
    });
    expect(requested.map((url) => new URL(url).protocol)).toEqual(["http:", "https:"]);

    requested.length = 0;
    const otherHost = redirecting((url) => `https://other.example${url.pathname}`);
    expect(
      await checkReachability(test.runtime.database, httpOrigin, { fetch: otherHost, resolve }),
    ).toMatchObject({
      cause: "otherServer",
    });
    expect(requested).toHaveLength(1);

    requested.length = 0;
    expect(
      await checkReachability(test.runtime.database, "http://metadata.example", {
        fetch: sameHost,
        resolve: async () => ["169.254.169.254"],
      }),
    ).toMatchObject({ cause: "unreachable" });
    expect(
      await checkReachability(test.runtime.database, "http://[fe80::1]", { fetch: sameHost, resolve }),
    ).toMatchObject({ cause: "unreachable" });
    expect(requested).toEqual([]);
  });

  it("keeps accepting the origin of the setup session until setup is complete", async () => {
    const client = new TestClient(test.app, { remoteAddress: CLIENT_IP });
    const post = (url: string, body?: unknown, origin = TEST_ORIGIN) =>
      client.post(url, body, { ...behindProxy, origin });
    expect((await post("/api/v1/setup/session", { code: await issueCode(test) })).statusCode).toBe(204);

    const wrongUrl = { url: "https://wiki.elsewhere.example", name: "Test wiki" };
    expect((await post("/api/v1/setup/steps/instance/save", wrongUrl)).statusCode).toBe(200);
    expect((await post("/api/v1/setup/steps/systemCheck/acknowledge")).statusCode).toBe(200);
    expect(
      (await post("/api/v1/setup/steps/instance/save", { url: TEST_ORIGIN, name: "Test wiki" })).statusCode,
    ).toBe(200);

    expect((await post("/api/v1/setup/steps/instance/save", wrongUrl)).statusCode).toBe(200);
    const foreign = await post(
      "/api/v1/setup/steps/systemCheck/acknowledge",
      undefined,
      "https://evil.example",
    );
    expect(foreign.json()).toMatchObject({ code: "csrfRejected" });
    const signIn = await post("/api/v1/auth/sign-in", {
      email: "someone@example.org",
      password: "whatever it is",
    });
    expect(signIn.json()).toMatchObject({
      code: "instanceMoved",
      instanceUrl: "https://wiki.elsewhere.example",
    });

    const anotherClient = new TestClient(test.app, { remoteAddress: CLIENT_IP });
    const restart = await anotherClient.post(
      "/api/v1/setup/session",
      { code: await issueCode(test) },
      { ...behindProxy, origin: TEST_ORIGIN },
    );
    expect(restart.statusCode).toBe(204);
  });
});
