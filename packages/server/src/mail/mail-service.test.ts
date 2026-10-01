import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { Secret } from "../config/secret.js";
import { Encryption } from "../crypto/envelope.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { SettingsService } from "../settings/service.js";
import { CapturingTransport, testJobContext } from "../testing/jobs.js";
import { Mailpit, testMailpitUrl } from "../testing/mailpit.js";
import { deliverMailJob, MailService, SmtpConfigurationError } from "./mail-service.js";
import { instanceSecrets, mailOutbox } from "./schema.js";
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
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    await service().configureSmtp(
      { host: "smtp.example.org", port: 25, security: "none", username: null, from: "wiki@example.org" },
      null,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  function service(transport = new CapturingTransport()) {
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
    });
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
