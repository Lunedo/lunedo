import { generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { decodeJwt, importSPKI, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { createLogger } from "../logging/logger.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { CapturingTransport, testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { deliverMailJob, MailService, SmtpConfigurationError } from "./mail-service.js";
import {
  GOOGLE_MAIL_SCOPE,
  GOOGLE_TOKEN_URL,
  MailTokenError,
  MICROSOFT_SMTP_SCOPE,
  parseServiceAccountKey,
  requestMailToken,
} from "./oauth2.js";
import type { MailMessage, SmtpOptions } from "./transport.js";

const baseUrl = testDatabaseBaseUrl();

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const googleKey = JSON.stringify({
  type: "service_account",
  client_email: "mailer@project.iam.gserviceaccount.com",
  client_id: "1234567890",
  private_key: keys.privateKey,
  token_uri: "https://attacker.example/token",
});

interface TokenCall {
  url: string;
  form: URLSearchParams;
}

function tokenEndpoint(responses: Array<{ status: number; body: unknown } | "unreachable">) {
  const calls: TokenCall[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body ?? "")) });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (!next || next === "unreachable") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("requestMailToken", () => {
  it("uses client credentials with the Exchange Online scope for Microsoft 365", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "ms-token", expires_in: 3599 } }]);
    const token = await requestMailToken({
      configuration: {
        provider: "microsoft365",
        tenantId: "8a9c5e1f-0000-4000-8000-000000000001",
        clientId: "3f1e2d4c-0000-4000-8000-000000000002",
        authority: "https://login.microsoftonline.com",
      },
      mailbox: "wiki@contoso.com",
      secret: "client-secret",
      fetch: endpoint.fetcher,
      now: () => 1_000_000,
    });
    expect(token).toEqual({ token: "ms-token", expiresAt: 1_000_000 + 3_599_000 });
    expect(endpoint.calls[0]?.url).toBe(
      "https://login.microsoftonline.com/8a9c5e1f-0000-4000-8000-000000000001/oauth2/v2.0/token",
    );
    expect(Object.fromEntries(endpoint.calls[0]?.form ?? [])).toEqual({
      grant_type: "client_credentials",
      client_id: "3f1e2d4c-0000-4000-8000-000000000002",
      client_secret: "client-secret",
      scope: MICROSOFT_SMTP_SCOPE,
    });
  });

  it("signs a delegated assertion for the mailbox with the Google service account key", async () => {
    const endpoint = tokenEndpoint([
      { status: 200, body: { access_token: "google-token", expires_in: 3600 } },
    ]);
    const key = parseServiceAccountKey(googleKey);
    await requestMailToken({
      configuration: { provider: "google", serviceAccount: key.clientEmail, clientId: key.clientId },
      mailbox: "wiki@example.com",
      secret: key.privateKey,
      fetch: endpoint.fetcher,
    });
    const call = endpoint.calls[0];
    expect(call?.url).toBe(GOOGLE_TOKEN_URL);
    expect(call?.form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = call?.form.get("assertion") ?? "";
    await jwtVerify(assertion, await importSPKI(keys.publicKey, "RS256"));
    expect(decodeJwt(assertion)).toMatchObject({
      iss: "mailer@project.iam.gserviceaccount.com",
      sub: "wiki@example.com",
      aud: GOOGLE_TOKEN_URL,
      scope: GOOGLE_MAIL_SCOPE,
    });
  });

  it("names the cause when the token endpoint refuses or cannot be reached", async () => {
    const generic = {
      provider: "generic" as const,
      tokenUrl: "https://auth.example.org/token",
      clientId: "wiki",
      scope: "smtp",
    };
    const cases: Array<[Parameters<typeof tokenEndpoint>[0], string]> = [
      [[{ status: 401, body: { error: "invalid_client" } }], "oauthClientRejected"],
      [[{ status: 400, body: { error: "unauthorized_client" } }], "oauthNotAuthorized"],
      [[{ status: 400, body: { error: "invalid_scope" } }], "oauthScopeRejected"],
      [[{ status: 400, body: { error: "invalid_request" } }], "oauthTokenRefused"],
      [[{ status: 503, body: {} }], "oauthTokenUnreachable"],
      [["unreachable"], "oauthTokenUnreachable"],
    ];
    for (const [responses, code] of cases) {
      const endpoint = tokenEndpoint(responses);
      const failure = await requestMailToken({
        configuration: generic,
        mailbox: "wiki@example.org",
        secret: "s",
        fetch: endpoint.fetcher,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(MailTokenError);
      expect((failure as MailTokenError).code).toBe(code);
    }
  });

  it("accepts only keys of Google service accounts", () => {
    expect(() => parseServiceAccountKey("{")).toThrow("not JSON");
    expect(() => parseServiceAccountKey(JSON.stringify({ type: "authorized_user" }))).toThrow(
      "not a key of a Google service account",
    );
  });
});

describe.skipIf(!baseUrl)("SMTP with OAuth2", () => {
  let test: TestServices;
  const logs: string[] = [];
  const logger = createLogger({
    service: "test",
    level: "info",
    destination: { write: (line: string) => logs.push(line) },
  });

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  const generic = {
    host: "smtp.example.org",
    port: 587,
    security: "starttls" as const,
    username: "wiki@example.org",
    from: "wiki@example.org",
    oauth2: {
      provider: "generic" as const,
      tokenUrl: "https://auth.example.org/token",
      clientId: "wiki",
      scope: "smtp.send",
    },
  };

  function service(options: {
    fetcher: typeof fetch;
    send?: (options: SmtpOptions, message: MailMessage) => Promise<void>;
  }) {
    const used: SmtpOptions[] = [];
    const transport = new CapturingTransport();
    const mail = new MailService({
      database: test.database,
      encryption: test.encryption,
      settings: test.settings,
      audit: new AuditLog({ database: test.database, encryption: test.encryption }),
      jobs: undefined,
      logger,
      fetch: options.fetcher,
      transport: (smtp) => {
        used.push(smtp);
        return {
          send: async (message) => {
            if (options.send) await options.send(smtp, message);
            await transport.send(message);
          },
        };
      },
    });
    return { mail, used, transport };
  }

  async function queue(mail: MailService): Promise<string> {
    return test.database.transaction((tx) =>
      mail.queueMessage(tx, "test", {
        to: "someone@example.org",
        subject: "Hi",
        text: "Hi",
        html: "<p>Hi</p>",
      }),
    );
  }

  async function storedSecrets(): Promise<string> {
    const rows = await test.database.execute<{ value: Buffer }>(sql`select value from instance_secrets`);
    return rows.rows.map((row) => Buffer.from(row.value).toString("latin1")).join("");
  }

  it("fetches a token once, stores it encrypted, reuses it and refreshes it before it expires", async () => {
    const endpoint = tokenEndpoint([
      { status: 200, body: { access_token: "first-access-token", expires_in: 3600 } },
      { status: 200, body: { access_token: "second-access-token", expires_in: 3600 } },
    ]);
    const { mail, used } = service({ fetcher: endpoint.fetcher });
    await mail.configureSmtp(generic, undefined, { oauth2Secret: "oauth-client-secret" });
    logs.length = 0;
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: await queue(mail) }, 0, logger));
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: await queue(mail) }, 0, logger));
    expect(endpoint.calls).toHaveLength(1);
    expect(endpoint.calls[0]?.form.get("client_secret")).toBe("oauth-client-secret");
    expect(used.map((options) => [options.username, options.accessToken, options.password])).toEqual([
      ["wiki@example.org", "first-access-token", null],
      ["wiki@example.org", "first-access-token", null],
    ]);
    const secrets = await storedSecrets();
    expect(secrets).not.toContain("first-access-token");
    expect(secrets).not.toContain("oauth-client-secret");

    const nearlyExpired = service({ fetcher: endpoint.fetcher });
    const realNow = Date.now;
    Date.now = () => realNow() + 56 * 60_000;
    try {
      await nearlyExpired.mail.deliver(
        testJobContext(deliverMailJob.name, { mailId: await queue(nearlyExpired.mail) }, 0, logger),
      );
    } finally {
      Date.now = realNow;
    }
    expect(endpoint.calls).toHaveLength(2);
    expect(nearlyExpired.used.at(-1)?.accessToken).toBe("second-access-token");
    expect(logs.join("")).not.toContain("access-token");
  });

  it("gets a new token once when the server refuses the stored one", async () => {
    const endpoint = tokenEndpoint([
      { status: 200, body: { access_token: "revoked-token", expires_in: 3600 } },
      { status: 200, body: { access_token: "fresh-token", expires_in: 3600 } },
    ]);
    const warmup = service({ fetcher: endpoint.fetcher });
    await warmup.mail.configureSmtp(generic, undefined, { oauth2Secret: "oauth-client-secret" });
    await warmup.mail.deliver(testJobContext(deliverMailJob.name, { mailId: await queue(warmup.mail) }));
    const { mail, transport } = service({
      fetcher: endpoint.fetcher,
      send: async (options) => {
        if (options.accessToken === "revoked-token") {
          throw Object.assign(new Error("535 5.7.3 Authentication unsuccessful"), {
            code: "EAUTH",
            responseCode: 535,
          });
        }
      },
    });
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: await queue(mail) }));
    expect(endpoint.calls).toHaveLength(2);
    expect(transport.sent).toHaveLength(1);
  });

  it("keeps mails queued and shows the failing step when the token endpoint fails", async () => {
    const endpoint = tokenEndpoint([{ status: 401, body: { error: "invalid_client" } }]);
    const { mail, transport } = service({ fetcher: endpoint.fetcher });
    await mail.configureSmtp(generic, undefined, { oauth2Secret: "wrong-secret" });
    const mailId = await queue(mail);
    await expect(mail.deliver(testJobContext(deliverMailJob.name, { mailId }))).rejects.toThrow(
      "Mail delivery failed",
    );
    expect(transport.sent).toEqual([]);
    const outbox = await test.database.execute<{ status: string }>(
      sql`select status from mail_outbox where id = ${mailId}`,
    );
    expect(outbox.rows[0]?.status).toBe("pending");
    expect((await mail.deliveryState()).lastFailure).toMatchObject({
      code: "oauthClientRejected",
      responseCode: 401,
      step: "token",
    });

    const test2 = await runWithRequestContext({ requestId: "t", actor: { type: "anonymous" } }, () =>
      mail.sendTest("admin@example.org", "en"),
    );
    expect(test2).toEqual({
      delivered: false,
      error: { code: "oauthClientRejected", responseCode: 401, step: "token" },
    });
  });

  it("checks the whole path in a test with unsaved settings and names a failing sign-in", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "test-token", expires_in: 3600 } }]);
    const { mail } = service({
      fetcher: endpoint.fetcher,
      send: async () => {
        throw Object.assign(new Error("535 5.7.139 Authentication unsuccessful"), {
          code: "EAUTH",
          responseCode: 535,
        });
      },
    });
    const result = await runWithRequestContext({ requestId: "t", actor: { type: "anonymous" } }, () =>
      mail.sendTest("admin@example.org", "en", {
        configuration: { ...generic, oauth2: { ...generic.oauth2, clientId: "other-app" } },
        password: undefined,
        oauth2Secret: "typed-secret",
      }),
    );
    expect(result).toEqual({
      delivered: false,
      error: { code: "EAUTH", responseCode: 535, step: "authenticate" },
    });
    expect(endpoint.calls[0]?.form.get("client_secret")).toBe("typed-secret");
  });

  it("never sends a token from the stored secret to another server or mailbox in a test", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "t", expires_in: 3600 } }]);
    const { mail, used } = service({ fetcher: endpoint.fetcher });
    await mail.configureSmtp(generic, undefined, { oauth2Secret: "stored-secret" });
    for (const configuration of [
      { ...generic, host: "attacker.example" },
      { ...generic, port: 2525 },
      { ...generic, username: "boss@example.org" },
    ]) {
      await expect(
        runWithRequestContext({ requestId: "t", actor: { type: "anonymous" } }, () =>
          mail.sendTest("admin@example.org", "en", { configuration, password: undefined }),
        ),
      ).rejects.toBeInstanceOf(SmtpConfigurationError);
    }
    expect(endpoint.calls).toEqual([]);
    expect(used).toEqual([]);
  });

  it("never sends the stored secret to another client in a test", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "t", expires_in: 3600 } }]);
    const { mail } = service({ fetcher: endpoint.fetcher });
    await mail.configureSmtp(generic, undefined, { oauth2Secret: "stored-secret" });
    await expect(
      runWithRequestContext({ requestId: "t", actor: { type: "anonymous" } }, () =>
        mail.sendTest("admin@example.org", "en", {
          configuration: {
            ...generic,
            oauth2: { ...generic.oauth2, tokenUrl: "https://attacker.example/token" },
          },
          password: undefined,
        }),
      ),
    ).rejects.toBeInstanceOf(SmtpConfigurationError);
    expect(endpoint.calls).toEqual([]);
  });

  it("stores only the private key of a Google key file that belongs to the configured service account", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "g", expires_in: 3600 } }]);
    const { mail } = service({ fetcher: endpoint.fetcher });
    const google = {
      ...generic,
      host: "smtp.gmail.com",
      port: 465,
      security: "tls" as const,
      oauth2: {
        provider: "google" as const,
        serviceAccount: "other@project.iam.gserviceaccount.com",
        clientId: "1234567890",
      },
    };
    await expect(mail.configureSmtp(google, undefined, { oauth2Secret: googleKey })).rejects.toThrow(
      "another service account",
    );
    await mail.configureSmtp(
      { ...google, oauth2: { ...google.oauth2, serviceAccount: "mailer@project.iam.gserviceaccount.com" } },
      undefined,
      { oauth2Secret: googleKey },
    );
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: await queue(mail) }));
    expect(endpoint.calls[0]?.url).toBe(GOOGLE_TOKEN_URL);
    expect(await storedSecrets()).not.toContain("BEGIN PRIVATE KEY");
  });

  it("requires the secret when the OAuth2 client changes and drops it when going back to a password", async () => {
    const endpoint = tokenEndpoint([{ status: 200, body: { access_token: "t", expires_in: 3600 } }]);
    const { mail } = service({ fetcher: endpoint.fetcher });
    await mail.configureSmtp(generic, undefined, { oauth2Secret: "stored-secret" });
    await mail.configureSmtp({ ...generic, from: "docs@example.org" }, undefined);
    await expect(
      mail.configureSmtp({ ...generic, oauth2: { ...generic.oauth2, clientId: "new-app" } }, undefined),
    ).rejects.toThrow("Enter the client secret");
    await expect(
      mail.configureSmtp({ ...generic, username: null }, undefined, { oauth2Secret: "s" }),
    ).rejects.toThrow("mailbox");
    await mail.configureSmtp({ ...generic, oauth2: null }, "smtp-password");
    expect(await mail.hasSmtpOAuth2Secret()).toBe(false);
    expect(await mail.hasSmtpPassword()).toBe(true);
  });
});
