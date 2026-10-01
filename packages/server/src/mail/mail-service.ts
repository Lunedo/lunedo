import { smtpConfigurationSchema, uuidv7 } from "@pagehall/shared";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { instanceNameSetting } from "../accounts/instance-settings.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Transaction } from "../database/database.js";
import { defineJob, type JobContext, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import { languageSetting } from "../settings/builtin.js";
import { defineSetting } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";
import { instanceSecrets, mailOutbox } from "./schema.js";
import { type Language, type MailTemplate, type MailTemplates, renderMail } from "./templates.js";
import {
  describeMailError,
  type MailMessage,
  type MailTransport,
  type SmtpOptions,
  SmtpTransport,
} from "./transport.js";

export { smtpConfigurationSchema };

export type SmtpConfiguration = z.infer<typeof smtpConfigurationSchema>;

export const smtpSetting = defineSetting({
  key: "mail.smtp",
  schema: smtpConfigurationSchema.nullable(),
  default: null,
  levels: ["instance"],
  lockable: false,
});

const SMTP_PASSWORD = "mail.smtpPassword";

export const deliverMailJob = defineJob({
  name: "mail.deliver",
  payload: z.object({ mailId: z.uuid() }),
  retryLimit: 8,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 5 * 60,
});

export const dispatchPendingMailJob = defineJob({
  name: "mail.dispatch-pending",
  payload: z.object({}),
  retryLimit: 1,
});

export const DISPATCH_PENDING_MAIL_SCHEDULE = "* * * * *";

const storedMessage = z.object({ to: z.string(), subject: z.string(), text: z.string(), html: z.string() });

function messageContext(id: string): string {
  return `mail_outbox.message:${id}`;
}

function secretContext(name: string): string {
  return `instance_secrets.value:${name}`;
}

export class MailNotConfiguredError extends Error {
  override name = "MailNotConfiguredError";

  constructor() {
    super("No SMTP server is configured");
  }
}

export class SmtpConfigurationError extends Error {
  override name = "SmtpConfigurationError";
}

function checkSmtpCredentials(configuration: SmtpConfiguration, hasPassword: boolean): void {
  if (configuration.security === "none" && (configuration.username !== null || hasPassword)) {
    throw new SmtpConfigurationError("SMTP credentials require a TLS connection");
  }
}

export class MailService {
  readonly #database: Database;
  readonly #encryption: Encryption;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;
  readonly #jobs: JobQueue | undefined;
  readonly #logger: Logger;
  readonly #transport: (options: SmtpOptions) => MailTransport;

  constructor(options: {
    database: Database;
    encryption: Encryption;
    settings: SettingsService;
    audit: AuditLog;
    jobs: JobQueue | undefined;
    logger: Logger;
    transport?: (options: SmtpOptions) => MailTransport;
  }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
    this.#transport = options.transport ?? ((smtp) => new SmtpTransport(smtp));
  }

  async languageOf(accountId: string): Promise<Language> {
    const chain = await accountScopeChain(this.#database, accountId);
    return this.#settings.get(languageSetting, { ...chain, user: accountId });
  }

  async queue<T extends MailTemplate>(
    tx: Transaction,
    mail: { to: string; template: T; language: Language; params: Omit<MailTemplates[T], "instanceName"> },
  ): Promise<string> {
    const instanceName = await this.#settings.get(instanceNameSetting, {});
    const message = renderMail(
      mail.template,
      mail.language,
      { ...mail.params, instanceName } as MailTemplates[T],
      mail.to,
    );
    const id = uuidv7();
    await tx.insert(mailOutbox).values({
      id,
      template: mail.template,
      message: this.#encryption.encrypt(JSON.stringify(message), messageContext(id)),
    });
    return id;
  }

  async dispatch(mailIds: readonly string[]): Promise<void> {
    if (!this.#jobs) return;
    for (const mailId of mailIds) {
      try {
        await this.#jobs.enqueue(deliverMailJob, { mailId }, { idempotencyKey: mailId });
      } catch (error) {
        this.#logger.warn({ mailId, err: error }, "Queuing a mail for delivery failed");
      }
    }
  }

  async dispatchPending(): Promise<number> {
    const pending = await this.#database
      .select({ id: mailOutbox.id })
      .from(mailOutbox)
      .where(and(eq(mailOutbox.status, "pending"), lt(mailOutbox.createdAt, new Date(Date.now() - 60_000))))
      .limit(1000);
    await this.dispatch(pending.map((row) => row.id));
    return pending.length;
  }

  deliver = async (job: JobContext<{ mailId: string }>): Promise<void> => {
    const { mailId } = job.payload;
    const [row] = await this.#database
      .select({ template: mailOutbox.template, message: mailOutbox.message, status: mailOutbox.status })
      .from(mailOutbox)
      .where(eq(mailOutbox.id, mailId));
    if (!row?.message || row.status !== "pending") return;
    const message = storedMessage.parse(
      JSON.parse(this.#encryption.decryptString(row.message, messageContext(mailId))),
    );
    try {
      await (await this.#transportOrThrow()).send(message);
    } catch (error) {
      const last = job.retryCount >= deliverMailJob.retryLimit;
      await this.#database
        .update(mailOutbox)
        .set({
          attempts: job.retryCount + 1,
          ...(last ? { status: "failed" as const, message: null } : {}),
        })
        .where(eq(mailOutbox.id, mailId));
      const details =
        error instanceof MailNotConfiguredError ? { code: "notConfigured" } : describeMailError(error);
      job.logger.warn(
        { mailId, template: row.template, attempt: job.retryCount + 1, ...details },
        last ? "Mail delivery failed for good" : "Mail delivery failed",
      );
      if (last) return;
      throw new Error("Mail delivery failed");
    }
    await this.#database.delete(mailOutbox).where(eq(mailOutbox.id, mailId));
  };

  async smtpConfiguration(): Promise<SmtpConfiguration | null> {
    return this.#settings.get(smtpSetting, {});
  }

  async hasSmtpPassword(): Promise<boolean> {
    return (await this.#smtpPassword()) !== null;
  }

  async #transportOrThrow(): Promise<MailTransport> {
    const configuration = await this.smtpConfiguration();
    if (!configuration) throw new MailNotConfiguredError();
    return this.#transport({ ...configuration, password: await this.#smtpPassword() });
  }

  async #smtpPassword(): Promise<string | null> {
    const [row] = await this.#database
      .select({ value: instanceSecrets.value })
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, SMTP_PASSWORD));
    return row ? this.#encryption.decryptString(row.value, secretContext(SMTP_PASSWORD)) : null;
  }

  async configureSmtp(
    configuration: SmtpConfiguration,
    password: string | null | undefined,
    options: { tx?: Transaction } = {},
  ): Promise<void> {
    const parsed = smtpConfigurationSchema.parse(configuration);
    const run = async (tx: Transaction) => {
      if (password === null || (password !== undefined && parsed.username === null)) {
        await tx.delete(instanceSecrets).where(eq(instanceSecrets.name, SMTP_PASSWORD));
      }
      if (password !== undefined && password !== null && parsed.username !== null) {
        const value = this.#encryption.encrypt(password, secretContext(SMTP_PASSWORD));
        await tx
          .insert(instanceSecrets)
          .values({ name: SMTP_PASSWORD, value })
          .onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } });
      }
      const [stored] = await tx
        .select({ name: instanceSecrets.name })
        .from(instanceSecrets)
        .where(eq(instanceSecrets.name, SMTP_PASSWORD));
      checkSmtpCredentials(parsed, stored !== undefined);
      await this.#settings.set(smtpSetting, {}, "instance", parsed, { tx, audit: false });
      await this.#audit.record(tx, {
        name: "mail.smtpChanged",
        targetId: null,
        fields: {
          host: parsed.host,
          port: parsed.port,
          security: parsed.security,
          username: parsed.username,
          passwordChanged: password !== undefined,
          from: parsed.from,
        },
      });
    };
    await (options.tx ? run(options.tx) : this.#database.transaction(run));
  }

  async sendTest(
    to: string,
    language: Language,
    smtp?: { configuration: SmtpConfiguration; password: string | null | undefined },
  ): Promise<{ delivered: boolean; error: { code: string | null; responseCode: number | null } | null }> {
    const instanceName = await this.#settings.get(instanceNameSetting, {});
    const message: MailMessage = renderMail("smtpTest", language, { instanceName }, to);
    const adHoc = smtp ? smtpConfigurationSchema.parse(smtp.configuration) : undefined;
    const password =
      adHoc?.username === null
        ? null
        : smtp?.password === undefined
          ? await this.#smtpPassword()
          : smtp.password;
    if (adHoc) checkSmtpCredentials(adHoc, password !== null);
    let error: { code: string | null; responseCode: number | null } | null = null;
    try {
      const transport = adHoc ? this.#transport({ ...adHoc, password }) : await this.#transportOrThrow();
      await transport.send(message);
    } catch (failure) {
      error =
        failure instanceof MailNotConfiguredError
          ? { code: "notConfigured", responseCode: null }
          : describeMailError(failure);
      this.#logger.warn({ template: "smtpTest", ...error }, "Test mail failed");
    }
    await this.#audit.recordAlone({
      name: "mail.testSent",
      targetId: null,
      fields: { recipient: to, delivered: error === null },
    });
    return { delivered: error === null, error };
  }

  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(mailOutbox)
      .where(
        and(
          eq(mailOutbox.status, "failed"),
          lt(mailOutbox.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        ),
      );
    return deleted.rowCount ?? 0;
  }
}
