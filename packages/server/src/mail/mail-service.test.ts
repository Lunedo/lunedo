import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { Secret } from "../config/secret.js";
import { Encryption } from "../crypto/envelope.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import { createLogger } from "../logging/logger.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { SettingsService } from "../settings/service.js";
import { CapturingTransport, testJobContext } from "../testing/jobs.js";
import { Mailpit, testMailpitUrl } from "../testing/mailpit.js";
import {
  deliverMailJob,
  deliverMailWork,
  MailService,
  mailSendRateSetting,
  SmtpConfigurationError,
  sendRatePerMinute,
} from "./mail-service.js";
import { instanceSecrets, mailOutbox, mailSends } from "./schema.js";
import { renderMail } from "./templates.js";
import { SmtpTransport } from "./transport.js";

const databaseUrl = inject("databaseUrl");
const mailpitUrl = testMailpitUrl();

describe("mail templates", () => {
  it("render plain text and escaped HTML in both languages", () => {
    const english = renderMail(
      "passwordReset",
      "en",
      {
        instanceName: "Docs <b>&</b>",
        link: "https://wiki.example.org/reset-password#token=a&b",
        minutes: 30,
      },
      "a@example.org",
    );
    expect(english.subject).toBe("Reset your password for Docs <b>&</b>");
    expect(english.text).toContain("Reset password: https://wiki.example.org/reset-password#token=a&b");
    expect(english.html).toContain("Docs &lt;b&gt;&amp;&lt;/b&gt;");
    expect(english.html).toContain('href="https://wiki.example.org/reset-password#token=a&amp;b"');
    const german = renderMail(
      "recoveryCodeUsed",
      "de",
      { instanceName: "Docs", remaining: 3 },
      "a@example.org",
    );
    expect(german.subject).toBe("Ein Wiederherstellungscode wurde für Docs verwendet");
    expect(german.html).toContain('<html lang="de">');
  });

  it("name the kind of an expiring provider credential", () => {
    const render = (language: "en" | "de", credential: "signingCertificate" | "graphCredential" | null) =>
      renderMail(
        "providerCredentialExpiring",
        language,
        { instanceName: "Docs", providerName: "Entra", date: "1 Nov 2026", credential },
        "a@example.org",
      );
    expect(render("en", "signingCertificate").subject).toBe(
      "Signing certificate for Entra on Docs expires soon",
    );
    expect(render("en", "graphCredential").text).toContain("through Microsoft Graph expires on 1 Nov 2026");
    expect(render("en", null).subject).toBe("Credential of Entra on Docs expires soon");
    expect(render("de", "signingCertificate").subject).toBe(
      "Signaturzertifikat für Entra auf Docs läuft bald ab",
    );
    expect(render("de", "graphCredential").subject).toBe(
      "Zugangsdaten für Microsoft Graph von Entra auf Docs laufen bald ab",
    );
  });
});

describe("mail layout", () => {
  it("shows the organization's logo, accent color and a link to the notification preferences", () => {
    const mail = renderMail(
      "guestInactive",
      "en",
      { instanceName: "Docs", organizationName: "Team", guestName: "Gina", days: 30 },
      "a@example.org",
      {
        organizationName: 'Team "A"',
        logoUrl: 'https://wiki.example.org/api/v1/organizations/x/logo?v=1&"',
        accentColor: "#6B4FB3",
        preferencesUrl: "https://wiki.example.org/settings/notifications",
      },
    );
    expect(mail.html).toContain(
      '<img src="https://wiki.example.org/api/v1/organizations/x/logo?v=1&amp;&quot;" alt="Team &quot;A&quot;"',
    );
    expect(mail.html).toContain("border-top:4px solid #6B4FB3");
    expect(mail.html).toContain('href="https://wiki.example.org/settings/notifications"');
    expect(mail.text).toContain(
      "Choose which notifications you receive: https://wiki.example.org/settings/notifications",
    );
    expect(mail.text).toContain("Sent by Docs.");
  });

  it("keeps the action and its plain address fixed and shows the instance name without a logo", () => {
    const mail = renderMail(
      "passwordReset",
      "de",
      { instanceName: "Docs", link: "https://wiki.example.org/reset-password#token=t", minutes: 30 },
      "a@example.org",
    );
    expect(mail.html).toContain(">Docs</span>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain(">Passwort zurücksetzen</a>");
    expect(mail.html).toContain(">https://wiki.example.org/reset-password#token=t</p>");
    expect(mail.html).not.toContain("settings/notifications");
    expect(mail.text).toContain("Gesendet von Docs.");
  });

  it("describes a sign-in from a new browser in both languages", () => {
    const params = {
      instanceName: "Docs",
      browser: "Firefox",
      operatingSystem: "Linux",
      clientIp: "203.0.113.4",
    };
    expect(renderMail("signInNewBrowser", "en", params, "a@example.org").text).toContain(
      "Firefox on Linux, address 203.0.113.4",
    );
    expect(
      renderMail("signInNewBrowser", "de", { ...params, browser: null, clientIp: null }, "a@example.org")
        .text,
    ).toContain("nicht verwendet wurde: Linux.");
  });
});

describe.skipIf(!databaseUrl)("MailService", () => {
  let pool: DatabasePool;
  let database: Database;
  const ring = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
  const encryption = new Encryption(() => ring);
  const logs: string[] = [];
  const logger = createLogger({
    service: "test",
    level: "info",
    destination: { write: (line: string) => logs.push(line) },
  });

  beforeAll(async () => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
    await service().configureSmtp(
      { host: "smtp.example.org", port: 25, security: "none", username: null, from: "wiki@example.org" },
      null,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  function service(
    transport = new CapturingTransport(),
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>,
  ) {
    const settings = new SettingsService({ database, logger });
    const audit = new AuditLog({ database });
    return new MailService({
      database,
      encryption,
      settings,
      audit,
      jobs: undefined,
      logger,
      transport: () => transport,
      ...(sleep ? { sleep } : {}),
    });
  }

  async function fillSendWindow(count: number) {
    await new SettingsService({ database, logger }).set(mailSendRateSetting, {}, "instance", count);
    await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
    await database
      .insert(mailSends)
      .values(Array.from({ length: count }, () => ({ sender: "wiki@example.org" })));
  }

  async function queue(mail: MailService, to: string): Promise<string> {
    return database.transaction((tx) =>
      mail.queue(tx, {
        to,
        template: "passwordReset",
        language: "en",
        params: { link: "https://wiki.example.org/reset-password#token=secret-token-value", minutes: 30 },
      }),
    );
  }

  it("stores queued mails encrypted and deletes them after delivery", async () => {
    const transport = new CapturingTransport();
    const mail = service(transport);
    const id = await queue(mail, "stored@example.org");
    const [row] = await database.select().from(mailOutbox).where(eq(mailOutbox.id, id));
    expect(row?.message?.toString("latin1")).not.toContain("secret-token-value");
    expect(row?.message?.toString("latin1")).not.toContain("stored@example.org");

    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: id }));
    expect(transport.sent.map((sent) => sent.to)).toEqual(["stored@example.org"]);
    expect(await database.select().from(mailOutbox).where(eq(mailOutbox.id, id))).toEqual([]);
  });

  it("waits for a free slot of the sender instead of failing when the send rate is used up", async () => {
    const transport = new CapturingTransport();
    const waits: number[] = [];
    const mail = service(transport, async (ms) => {
      waits.push(ms);
      expect(transport.sent).toHaveLength(0);
      await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
    });
    await fillSendWindow(30);
    const id = await queue(mail, "waiting@example.org");
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: id }));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits[0]).toBeLessThanOrEqual(60_000);
    expect(transport.sent.map((sent) => sent.to)).toEqual(["waiting@example.org"]);
    expect(await database.select().from(mailOutbox).where(eq(mailOutbox.id, id))).toEqual([]);
    await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
    await new SettingsService({ database, logger }).clear(mailSendRateSetting, {}, "instance");
  });

  it("sends over SMTP without a send rate unless one is set", async () => {
    const transport = new CapturingTransport();
    const mail = service(transport, async () => {
      throw new Error("Delivery must not wait");
    });
    await fillSendWindow(30);
    await new SettingsService({ database, logger }).clear(mailSendRateSetting, {}, "instance");
    const id = await queue(mail, "unlimited@example.org");
    await mail.deliver(testJobContext(deliverMailJob.name, { mailId: id }));
    expect(transport.sent.map((sent) => sent.to)).toEqual(["unlimited@example.org"]);
    await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
  });

  it("limits Microsoft Graph to 30 e-mails per minute and SMTP to nothing by default", () => {
    expect(sendRatePerMinute(null, "graph")).toBe(30);
    expect(sendRatePerMinute(null, "smtp")).toBeNull();
    expect(sendRatePerMinute(120, "graph")).toBe(120);
    expect(sendRatePerMinute(10, "smtp")).toBe(10);
  });

  it("puts a waiting mail back in the queue when the worker stops", async () => {
    const transport = new CapturingTransport();
    const mail = service(transport, async () => {
      throw new DOMException("The worker stopped", "AbortError");
    });
    await fillSendWindow(30);
    const id = await queue(mail, "stopped@example.org");
    await expect(mail.deliver(testJobContext(deliverMailJob.name, { mailId: id }))).rejects.toThrow(
      "The worker stopped",
    );
    const [row] = await database.select().from(mailOutbox).where(eq(mailOutbox.id, id));
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(transport.sent).toHaveLength(0);
    await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
    await database.delete(mailOutbox).where(eq(mailOutbox.id, id));
    await new SettingsService({ database, logger }).clear(mailSendRateSetting, {}, "instance");
  });

  async function deliverInWorker(perMinute: number, count: number, until: (sent: number) => boolean) {
    await new SettingsService({ database, logger }).set(mailSendRateSetting, {}, "instance", perMinute);
    await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
    const transport = new CapturingTransport();
    const mail = service(transport);
    const ids: string[] = [];
    for (let index = 0; index < count; index++) ids.push(await queue(mail, `bulk-${index}@example.org`));
    const job = { ...deliverMailJob, name: `test.deliver-${randomBytes(4).toString("hex")}` };
    const worker = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "worker" });
    await worker.start();
    try {
      for (const mailId of ids) await worker.enqueue(job, { mailId });
      const started = Date.now();
      await worker.work(job, mail.deliver, deliverMailWork);
      while (!until(transport.sent.length) && Date.now() - started < 90_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { sent: transport.sent.length, seconds: (Date.now() - started) / 1000 };
    } finally {
      await worker.stop({ timeoutSeconds: 1 });
      await database.delete(mailOutbox).where(inArray(mailOutbox.id, ids));
      await database.delete(mailSends).where(eq(mailSends.sender, "wiki@example.org"));
      await new SettingsService({ database, logger }).clear(mailSendRateSetting, {}, "instance");
    }
  }

  it("reaches the configured send rate with the worker's batches", { timeout: 120_000 }, async () => {
    const result = await deliverInWorker(600, 600, (sent) => sent >= 600);
    expect(result.sent).toBe(600);
    expect(result.seconds).toBeLessThan(70);
  });

  it("never sends more than the configured rate within a minute", { timeout: 60_000 }, async () => {
    let reached: number | null = null;
    const result = await deliverInWorker(30, 45, (sent) => {
      if (sent >= 30) reached ??= Date.now();
      return reached !== null && Date.now() - reached > 5_000;
    });
    expect(result.sent).toBe(30);
    expect(result.seconds).toBeLessThan(55);
  });

  it("retries failed deliveries and gives up after the last attempt without logging the content", async () => {
    const failing = {
      send: async () => {
        throw Object.assign(new Error("550 rejected secret-token-value"), {
          code: "EENVELOPE",
          responseCode: 550,
        });
      },
    };
    const mail = service(failing as unknown as CapturingTransport);
    const id = await queue(mail, "failing@example.org");
    logs.length = 0;
    await expect(
      mail.deliver(testJobContext(deliverMailJob.name, { mailId: id }, 0, logger)),
    ).rejects.toThrow("Mail delivery failed");
    let [row] = await database.select().from(mailOutbox).where(eq(mailOutbox.id, id));
    expect(row).toMatchObject({ status: "pending", attempts: 1 });

    await mail.deliver(
      testJobContext(deliverMailJob.name, { mailId: id }, deliverMailJob.retryLimit, logger),
    );
    [row] = await database.select().from(mailOutbox).where(eq(mailOutbox.id, id));
    expect(row).toMatchObject({ status: "failed", message: null });
    expect(logs.join("")).not.toContain("secret-token-value");
    expect(logs.join("")).not.toContain("failing@example.org");
    expect(logs.join("")).toContain('"responseCode":550');
  });

  it("keeps the SMTP password encrypted and refuses credentials over plain text", async () => {
    const mail = service();
    await expect(
      mail.configureSmtp(
        { host: "smtp.example.org", port: 25, security: "none", username: "wiki", from: "wiki@example.org" },
        "pw",
      ),
    ).rejects.toThrow(SmtpConfigurationError);
    await mail.configureSmtp(
      {
        host: "smtp.example.org",
        port: 587,
        security: "starttls",
        username: "wiki",
        from: "wiki@example.org",
      },
      "smtp-password-value",
    );
    const [secret] = await database
      .select()
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, "mail.smtpPassword"));
    expect(secret?.value.toString("latin1")).not.toContain("smtp-password-value");
    const settings = await pool.query<{ value: unknown }>(
      "select value from setting_values where key = 'mail.smtp'",
    );
    expect(JSON.stringify(settings.rows)).not.toContain("smtp-password-value");
    await expect(
      mail.configureSmtp(
        { host: "smtp.example.org", port: 25, security: "none", username: null, from: "wiki@example.org" },
        undefined,
      ),
    ).rejects.toThrow("TLS");
    await mail.configureSmtp(
      { host: "smtp.example.org", port: 25, security: "none", username: null, from: "wiki@example.org" },
      null,
    );
    const events = await pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'mail.smtpChanged' order by sequence",
    );
    expect(JSON.stringify(events.rows)).not.toContain("smtp-password-value");
    expect(events.rows.at(-1)?.fields).toMatchObject({
      security: "none",
      username: null,
      passwordChanged: true,
    });
  });

  it.skipIf(!mailpitUrl)("delivers through SMTP to the mail catcher", async () => {
    const mailpit = new Mailpit(mailpitUrl ?? "");
    const to = `smtp-${randomBytes(4).toString("hex")}@example.org`;
    await new SmtpTransport({
      host: mailpit.smtpHost,
      port: mailpit.smtpPort,
      security: "none",
      username: null,
      password: null,
      from: "wiki@example.org",
    }).send(renderMail("smtpTest", "en", { instanceName: "Docs" }, to));
    expect((await mailpit.waitFor(to)).subject).toBe("Test e-mail from Docs");
  });

  it("uses the stored SMTP password only for the stored server in a test mail", async () => {
    const used: (string | null)[] = [];
    const settings = new SettingsService({ database, logger });
    const mail = new MailService({
      database,
      encryption,
      settings,
      audit: new AuditLog({ database }),
      jobs: undefined,
      logger,
      transport: (options) => {
        used.push(options.password);
        return new CapturingTransport();
      },
    });
    const stored = {
      host: "smtp.example.org",
      port: 465,
      security: "tls" as const,
      username: "wiki",
      from: "wiki@example.org",
    };
    await mail.configureSmtp(stored, "stored-smtp-secret");
    await runWithRequestContext({ requestId: "test", actor: { type: "anonymous" } }, async () => {
      await mail.sendTest("someone@example.org", "en", { configuration: stored, password: undefined });
      await mail.sendTest("someone@example.org", "en", {
        configuration: { ...stored, host: "attacker.example" },
        password: undefined,
      });
    });
    expect(used).toEqual(["stored-smtp-secret", null]);
    await mail.configureSmtp(
      { host: "smtp.example.org", port: 25, security: "none", username: null, from: "wiki@example.org" },
      null,
    );
  });

  it("refuses STARTTLS servers that do not offer it", async () => {
    if (!mailpitUrl) return;
    const mailpit = new Mailpit(mailpitUrl);
    const transport = new SmtpTransport({
      host: mailpit.smtpHost,
      port: mailpit.smtpPort,
      security: "starttls",
      username: "wiki",
      password: new Secret("x").reveal(),
      from: "wiki@example.org",
    });
    await expect(
      transport.send(renderMail("smtpTest", "en", { instanceName: "Docs" }, "x@example.org")),
    ).rejects.toThrow();
  });
});
