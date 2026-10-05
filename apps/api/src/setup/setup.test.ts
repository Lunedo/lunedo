import { createLogger } from "@pagehall/server";
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
const behindProxy = { host: "pagehall.test", "x-forwarded-proto": "https" };

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

  beforeAll(async () => {
    test = await createAuthTestApp({ PAGEHALL_TRUSTED_PROXIES: CLIENT_IP });
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
        /^__Host-pagehall-setup=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
      ),
    ]);
    expect(
      (await new TestClient(test.app).post("/api/v1/setup/session", { code }, behindProxy)).statusCode,
    ).toBe(401);
    expect((await get("/api/v1/setup")).json()).toEqual({ completed: false, session: true });

    const status = (await get("/api/v1/setup/steps")).json();
    expect(status.steps.map((step: { id: string }) => step.id)).toEqual([
      "systemCheck",
      "instance",
      "owner",
      "keyBackup",
      "organization",
    ]);
    expect(status.ready).toBe(false);
    expect(status.steps[0].details.checks).toMatchObject({
      database: { status: "ok", migrationsUpToDate: true },
      fileStorage: { writable: true },
      instanceUrl: { status: "warning", configured: false },
      clock: { status: "ok" },
    });
    expect((await post("/api/v1/setup/complete")).json()).toMatchObject({ code: "setupNotReady" });

    expect((await post("/api/v1/setup/steps/systemCheck/acknowledge")).statusCode).toBe(200);
    expect(
      (await post("/api/v1/setup/steps/instance/save", { url: "not a url", name: "x" })).statusCode,
    ).toBe(400);
    expect(
      (await post("/api/v1/setup/steps/instance/save", { url: TEST_ORIGIN, name: "Test wiki" })).statusCode,
    ).toBe(200);
    expect((await get("/api/v1/setup/steps")).json().steps[0].details.checks.https).toMatchObject({
      status: "ok",
    });

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
    expect((await post("/api/v1/setup/steps/owner/renewRecoveryCodes")).json()).toMatchObject({
      code: "totpMissing",
    });
    const totp = (await post("/api/v1/setup/steps/owner/beginTotp")).json();
    expect(totp.uri).toMatch(/^otpauth:\/\/totp\/Test%20wiki:Owner%40Example\.org\?/);
    expect((await post("/api/v1/setup/steps/owner/confirmTotp", { code: "000000" })).statusCode).toBe(401);
    const confirmed = await post("/api/v1/setup/steps/owner/confirmTotp", {
      code: TOTP.generate({ secret: Secret.fromBase32(totp.secret) }),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().recoveryCodes).toHaveLength(10);
    const ownerStep = async () =>
      (await get("/api/v1/setup/steps")).json().steps.find((step: { id: string }) => step.id === "owner");
    expect(await ownerStep()).toMatchObject({
      completed: false,
      details: { totpConfirmed: true },
    });
    const renewed = (await post("/api/v1/setup/steps/owner/renewRecoveryCodes")).json().recoveryCodes;
    expect(renewed).toHaveLength(10);
    expect(renewed).not.toContain(confirmed.json().recoveryCodes[0]);
    expect((await ownerStep()).completed).toBe(false);
    expect((await post("/api/v1/setup/steps/owner/acknowledgeRecoveryCodes")).statusCode).toBe(200);
    expect((await ownerStep()).completed).toBe(true);

    const mail = await post("/api/v1/setup/steps/mail/save", {
      host: "smtp.pagehall.test",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@pagehall.test",
    });
    expect(mail.statusCode).toBe(404);

    expect((await post("/api/v1/setup/steps/keyBackup/confirm")).json()).toMatchObject({
      code: "keysNotDownloaded",
    });
    const download = await post("/api/v1/setup/steps/keyBackup/download");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toBe('attachment; filename="pagehall-keys.env"');
    expect(download.body).toMatch(/^PAGEHALL_MASTER_KEYS=1:[A-Za-z0-9+/=]{44}$/m);
    expect(download.body).toMatch(/^PAGEHALL_BACKUP_KEY=1:[A-Za-z0-9+/=]{44}$/m);
    expect((await post("/api/v1/setup/steps/keyBackup/download")).json()).toMatchObject({
      code: "keysAlreadyDownloaded",
    });
    expect((await post("/api/v1/setup/steps/keyBackup/confirm")).statusCode).toBe(200);
    expect((await get("/api/v1/setup/steps")).json().ready).toBe(false);

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
      { key: "locale.dateFormat", value: "DD.MM.YYYY" },
      { key: "locale.firstDayOfWeek", value: "monday" },
      { key: "locale.numberFormat", value: "de-DE" },
      { key: "locale.timeFormat", value: "24h" },
    ]);
    expect(
      (await get("/api/v1/setup/steps"))
        .json()
        .steps.find((step: { id: string }) => step.id === "organization").details.formats,
    ).toEqual({
      dateFormat: "DD.MM.YYYY",
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

    expect((await post("/api/v1/setup/complete")).statusCode).toBe(204);
    expect(client.cookies.has("__Host-pagehall-setup")).toBe(false);
  });

  it("answers as if the setup endpoints did not exist afterwards", async () => {
    expect((await get("/api/v1/unknown")).json()).toEqual({
      type: "urn:pagehall:problem:notFound",
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
        type: "urn:pagehall:problem:notFound",
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
});

describe.skipIf(!databaseBaseUrl)("setup with an instance URL that differs from the origin in use", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp({ PAGEHALL_TRUSTED_PROXIES: CLIENT_IP });
  });

  afterAll(async () => {
    await test?.close();
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
