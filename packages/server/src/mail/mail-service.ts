import {
  clientSecretSchema,
  type DateFormat,
  type GraphMailConfiguration,
  graphMailConfigurationSchema,
  type MailMethod,
  mailMethods,
  smtpConfigurationSchema,
  uuidv7,
} from "@pagehall/shared";
import designTokens from "@pagehall/tokens/design-tokens.json" with { type: "json" };
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import type { Principal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import { builtInRoleAreas } from "../authorization/areas.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { generateCertificate } from "../identity/certificates.js";
import { foreignGraphEndpoint } from "../identity/directory.js";
import { defineJob, type JobContext, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { NotificationService } from "../notifications/service.js";
import type { BuiltInRoleKey } from "../organizations/access-schema.js";
import { OrganizationError } from "../organizations/organizations.js";
import { organizations } from "../organizations/schema.js";
import { languageSetting, timeZoneSetting } from "../settings/builtin.js";
import { defineSetting } from "../settings/definition.js";
import { accentColorSetting, dateFormatSetting } from "../settings/preferences.js";
import type { SettingsService } from "../settings/service.js";
import { GraphMailError, GraphMailTransport } from "./graph.js";
import { instanceSecrets, mailCredentials, mailOutbox } from "./schema.js";
import {
  type Language,
  type MailBranding,
  type MailTemplate,
  type MailTemplates,
  renderMail,
} from "./templates.js";
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

export const mailMethodSetting = defineSetting({
  key: "mail.method",
  schema: z.enum(mailMethods),
  default: "smtp" as MailMethod,
  levels: ["instance"],
  lockable: false,
});

export const graphMailSetting = defineSetting({
  key: "mail.graph",
  schema: graphMailConfigurationSchema.nullable(),
  default: null,
  levels: ["instance"],
  lockable: false,
});

export const mailCredentialReminderJob = defineJob({
  name: "mail.send-credential-reminders",
  payload: z.object({}),
  retryLimit: 2,
});

export const MAIL_CREDENTIAL_REMINDER_SCHEDULE = "43 * * * *";

const MICROSOFT_AUTHORITIES: readonly string[] = [
  "https://login.microsoftonline.com",
  "https://login.microsoftonline.us",
  "https://login.partner.microsoftonline.cn",
];
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLDS = [
  { days: 30, column: "notifiedThirtyDaysAt" },
  { days: 7, column: "notifiedSevenDaysAt" },
] as const;

export type MailCredentialInput =
  | { kind: "clientSecret"; secret: string; expiresAt: Date | null }
  | { kind: "certificate"; validDays: number };

export interface MailCredentialSummary {
  id: string;
  kind: "clientSecret" | "certificate";
  keyId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface MailTestResult {
  delivered: boolean;
  error: { code: string | null; responseCode: number | null } | null;
}

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

function credentialContext(id: string): string {
  return `mail_credentials.secret:${id}`;
}

function describeFailure(error: unknown): { code: string | null; responseCode: number | null } {
  if (error instanceof MailNotConfiguredError) return { code: "notConfigured", responseCode: null };
  if (error instanceof GraphMailError) return { code: error.code, responseCode: error.status };
  return describeMailError(error);
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
  readonly #fetch: typeof fetch | undefined;
  readonly #allowInsecure: boolean;
  readonly #graphTokens = new Map<string, { token: string; expiresAt: number }>();
  #notifications: NotificationService | undefined;

  constructor(options: {
    database: Database;
    encryption: Encryption;
    settings: SettingsService;
    audit: AuditLog;
    jobs: JobQueue | undefined;
    logger: Logger;
    transport?: (options: SmtpOptions) => MailTransport;
    fetch?: typeof fetch;
    allowInsecure?: boolean;
  }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
    this.#transport = options.transport ?? ((smtp) => new SmtpTransport(smtp));
    this.#fetch = options.fetch;
    this.#allowInsecure = options.allowInsecure ?? false;
  }

  useNotifications(notifications: NotificationService): void {
    this.#notifications = notifications;
  }

  async languageOf(accountId: string, executor: Executor = this.#database): Promise<Language> {
    const chain = await accountScopeChain(executor, accountId);
    return this.#settings.get(languageSetting, { ...chain, user: accountId }, { executor });
  }

  async dateFormatOf(accountId: string, executor: Executor = this.#database): Promise<DateFormat> {
    const chain = await accountScopeChain(executor, accountId);
    return this.#settings.get(dateFormatSetting, { ...chain, user: accountId }, { executor });
  }

  async timeZoneOf(accountId: string, executor: Executor = this.#database): Promise<string> {
    const chain = await accountScopeChain(executor, accountId);
    return this.#settings.get(timeZoneSetting, { ...chain, user: accountId }, { executor });
  }

  async branding(
    executor: Executor,
    options: { organizationId?: string | null; notification?: boolean },
  ): Promise<MailBranding> {
    const url = await this.#settings.get(instanceUrlSetting, {}, { executor });
    const organizationId = options.organizationId ?? null;
    const [organization] = organizationId
      ? await executor
          .select({ name: organizations.name, logoRef: organizations.logoRef })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
      : [];
    const accent = await this.#settings.get(
      accentColorSetting,
      organization && organizationId ? { organization: organizationId } : {},
      { executor },
    );
    return {
      organizationName: organization?.name ?? null,
      logoUrl:
        url && organization?.logoRef
          ? `${url}/api/v1/organizations/${organizationId}/logo?v=${organization.logoRef}`
          : null,
      accentColor: designTokens.color.palette.light[accent],
      preferencesUrl: options.notification && url ? `${url}/settings/notifications` : null,
    };
  }

  async queue<T extends MailTemplate>(
    tx: Transaction,
    mail: {
      to: string;
      template: T;
      language: Language;
      params: Omit<MailTemplates[T], "instanceName">;
      organizationId?: string | null;
      notification?: boolean;
    },
  ): Promise<string> {
    const instanceName = await this.#settings.get(instanceNameSetting, {}, { executor: tx });
    const message = renderMail(
      mail.template,
      mail.language,
      { ...mail.params, instanceName } as MailTemplates[T],
      mail.to,
      await this.branding(tx, {
        organizationId: mail.organizationId ?? null,
        notification: mail.notification ?? false,
      }),
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
      const details = describeFailure(error);
      job.logger.warn(
        { mailId, template: row.template, attempt: job.retryCount + 1, ...details },
        last ? "Mail delivery failed for good" : "Mail delivery failed",
      );
      if (last) return;
      throw new Error("Mail delivery failed");
    }
    await this.#database.delete(mailOutbox).where(eq(mailOutbox.id, mailId));
  };

  async smtpConfiguration(executor: Executor = this.#database): Promise<SmtpConfiguration | null> {
    return this.#settings.get(smtpSetting, {}, { executor });
  }

  async hasSmtpPassword(): Promise<boolean> {
    return (await this.#smtpPassword()) !== null;
  }

  async method(executor: Executor = this.#database): Promise<MailMethod> {
    return this.#settings.get(mailMethodSetting, {}, { executor });
  }

  async graphConfiguration(executor: Executor = this.#database): Promise<GraphMailConfiguration | null> {
    return this.#settings.get(graphMailSetting, {}, { executor });
  }

  async #transportOrThrow(): Promise<MailTransport> {
    if ((await this.method()) === "graph") {
      const graph = await this.graphConfiguration();
      if (!graph) throw new MailNotConfiguredError();
      return this.#graphTransport(graph);
    }
    const configuration = await this.smtpConfiguration();
    if (!configuration) throw new MailNotConfiguredError();
    return this.#transport({ ...configuration, password: await this.#smtpPassword() });
  }

  async #graphTransport(
    configuration: GraphMailConfiguration,
    storedCredentials = true,
  ): Promise<GraphMailTransport> {
    this.#checkGraph(configuration);
    const rows = !storedCredentials
      ? []
      : await this.#database
          .select()
          .from(mailCredentials)
          .where(or(isNull(mailCredentials.expiresAt), gt(mailCredentials.expiresAt, new Date())))
          .orderBy(desc(mailCredentials.createdAt), desc(mailCredentials.id));
    return new GraphMailTransport({
      configuration,
      credentials: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        keyId: row.keyId,
        secret: this.#encryption.decryptString(row.secret, credentialContext(row.id)),
      })),
      tokens: this.#graphTokens,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
  }

  #checkGraph(configuration: GraphMailConfiguration): void {
    if (this.#allowInsecure) return;
    if (!MICROSOFT_AUTHORITIES.includes(configuration.authority)) {
      throw new OrganizationError("invalidMailConfiguration", "The authority is not a Microsoft cloud", {
        fields: ["authority"],
      });
    }
    if (foreignGraphEndpoint(configuration.authority, configuration.graphUrl)) {
      throw new OrganizationError(
        "invalidMailConfiguration",
        "The Graph endpoint does not belong to the Microsoft cloud of the authority",
        { fields: ["graphUrl"] },
      );
    }
  }

  async configureGraph(actor: Principal, input: unknown): Promise<GraphMailConfiguration> {
    const parsed = graphMailConfigurationSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrganizationError(
        "invalidMailConfiguration",
        "The Microsoft Graph configuration is not valid",
        {
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        },
      );
    }
    const configuration = parsed.data;
    this.#checkGraph(configuration);
    await this.#database.transaction(async (tx) => {
      const previous = await this.graphConfiguration(tx);
      await this.#settings.set(graphMailSetting, {}, "instance", configuration, { tx, audit: false });
      await this.#audit.record(tx, {
        name: "mail.graphChanged",
        actor,
        targetId: null,
        fields: {
          tenantId: configuration.tenantId,
          clientId: configuration.clientId,
          sender: configuration.sender,
          senderName: configuration.senderName,
          previous: previous
            ? {
                tenantId: previous.tenantId,
                clientId: previous.clientId,
                sender: previous.sender,
                senderName: previous.senderName,
              }
            : null,
        },
      });
    });
    return configuration;
  }

  async setMethod(actor: Principal, method: MailMethod): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const previous = await this.method(tx);
      if (previous === method) return;
      if (method === "graph") {
        if (!(await this.graphConfiguration(tx))) {
          throw new OrganizationError("mailNotReady", "Save the Microsoft Graph settings first");
        }
        const [usable] = await tx
          .select({ id: mailCredentials.id })
          .from(mailCredentials)
          .where(or(isNull(mailCredentials.expiresAt), gt(mailCredentials.expiresAt, new Date())));
        if (!usable) throw new OrganizationError("mailNotReady", "Add a client secret or certificate first");
      }
      if (method === "smtp" && !(await this.smtpConfiguration(tx))) {
        throw new OrganizationError("mailNotReady", "Save the SMTP settings first");
      }
      await this.#settings.set(mailMethodSetting, {}, "instance", method, { tx, audit: false });
      await this.#audit.record(tx, {
        name: "mail.methodChanged",
        actor,
        targetId: null,
        fields: { method, previousMethod: previous },
      });
    });
  }

  async graphCredentials(): Promise<MailCredentialSummary[]> {
    return this.#database
      .select({
        id: mailCredentials.id,
        kind: mailCredentials.kind,
        keyId: mailCredentials.keyId,
        expiresAt: mailCredentials.expiresAt,
        createdAt: mailCredentials.createdAt,
      })
      .from(mailCredentials)
      .orderBy(desc(mailCredentials.createdAt), desc(mailCredentials.id));
  }

  async addGraphCredential(
    actor: Principal,
    input: MailCredentialInput,
  ): Promise<MailCredentialSummary & { certificate: string | null }> {
    const id = uuidv7();
    let secret: string;
    let certificate: string | null = null;
    let keyId: string | null = null;
    let expiresAt: Date | null;
    if (input.kind === "clientSecret") {
      secret = clientSecretSchema.parse(input.secret);
      expiresAt = input.expiresAt;
      if (expiresAt && expiresAt <= new Date()) {
        throw new OrganizationError("expiryInPast", "The client secret has already expired");
      }
    } else {
      if (!Number.isInteger(input.validDays) || input.validDays < 30 || input.validDays > 3 * 365) {
        throw new OrganizationError("invalidInput", "A certificate is valid for 30 days to 3 years");
      }
      const generated = await generateCertificate({
        commonName: "Pagehall e-mail",
        validDays: input.validDays,
      });
      secret = generated.privateKey;
      certificate = generated.certificate;
      keyId = generated.thumbprint;
      expiresAt = generated.expiresAt;
    }
    return this.#database.transaction(async (tx) => {
      const [row] = await tx
        .insert(mailCredentials)
        .values({
          id,
          kind: input.kind,
          secret: this.#encryption.encrypt(secret, credentialContext(id)),
          certificate,
          keyId,
          expiresAt,
        })
        .returning({ createdAt: mailCredentials.createdAt });
      if (!row) throw new Error("The credential was not stored");
      await this.#audit.record(tx, {
        name: "mail.credentialAdded",
        actor,
        targetId: null,
        fields: { credentialId: id, kind: input.kind, expiresAt: expiresAt?.toISOString() ?? null },
      });
      return { id, kind: input.kind, keyId, expiresAt, createdAt: row.createdAt, certificate };
    });
  }

  async removeGraphCredential(actor: Principal, credentialId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mail_credentials'))`);
      const credentials = await tx
        .select({ id: mailCredentials.id, kind: mailCredentials.kind })
        .from(mailCredentials);
      const credential = credentials.find((candidate) => candidate.id === credentialId);
      if (!credential) throw new OrganizationError("notFound", "The credential does not exist");
      if (credentials.length === 1 && (await this.method(tx)) === "graph") {
        throw new OrganizationError("lastCredential", "Add a new credential before removing the last one");
      }
      await tx.delete(mailCredentials).where(eq(mailCredentials.id, credentialId));
      await this.#audit.record(tx, {
        name: "mail.credentialRemoved",
        actor,
        targetId: null,
        fields: { credentialId, kind: credential.kind },
      });
    });
    this.#graphTokens.clear();
  }

  async graphCertificate(credentialId: string): Promise<string> {
    const [row] = await this.#database
      .select({ certificate: mailCredentials.certificate })
      .from(mailCredentials)
      .where(eq(mailCredentials.id, credentialId));
    if (!row?.certificate) throw new OrganizationError("notFound", "The credential has no certificate");
    return row.certificate;
  }

  async sendGraphTest(
    actor: Principal,
    to: string,
    language: Language,
    input?: unknown,
  ): Promise<MailTestResult> {
    const stored = await this.graphConfiguration();
    let configuration = stored;
    if (input !== undefined) {
      const parsed = graphMailConfigurationSchema.safeParse(input);
      if (!parsed.success) {
        throw new OrganizationError(
          "invalidMailConfiguration",
          "The Microsoft Graph configuration is not valid",
          {
            fields: parsed.error.issues.map((issue) => issue.path.join(".")),
          },
        );
      }
      this.#checkGraph(parsed.data);
      configuration = parsed.data;
    }
    const sameApp =
      stored !== null &&
      configuration !== null &&
      stored.tenantId === configuration.tenantId &&
      stored.clientId === configuration.clientId &&
      stored.authority === configuration.authority &&
      stored.graphUrl === configuration.graphUrl;
    const instanceName = await this.#settings.get(instanceNameSetting, {});
    let error: MailTestResult["error"] = null;
    try {
      if (!configuration) throw new MailNotConfiguredError();
      await (await this.#graphTransport(configuration, sameApp)).send(
        renderMail("smtpTest", language, { instanceName }, to),
      );
    } catch (failure) {
      error = describeFailure(failure);
      this.#logger.warn({ template: "smtpTest", method: "graph", ...error }, "Test mail failed");
    }
    await this.#audit.recordAlone({
      name: "mail.testSent",
      actor,
      targetId: null,
      fields: { recipient: to, delivered: error === null, method: "graph" },
    });
    return { delivered: error === null, error };
  }

  async sendCredentialReminders(): Promise<number> {
    if (!this.#notifications) return 0;
    const now = new Date();
    let sent = 0;
    for (const [index, threshold] of REMINDER_THRESHOLDS.entries()) {
      const column = mailCredentials[threshold.column];
      const closer = REMINDER_THRESHOLDS[index + 1];
      const due = await this.#database
        .select({ id: mailCredentials.id })
        .from(mailCredentials)
        .where(
          and(
            isNotNull(mailCredentials.expiresAt),
            gt(mailCredentials.expiresAt, closer ? new Date(now.getTime() + closer.days * DAY_MS) : now),
            lte(mailCredentials.expiresAt, new Date(now.getTime() + threshold.days * DAY_MS)),
            isNull(column),
          ),
        )
        .limit(50);
      for (const { id } of due) {
        const notifications = this.#notifications;
        const result = await this.#database.transaction(async (tx) => {
          const [marked] = await tx
            .update(mailCredentials)
            .set({ [threshold.column]: now })
            .where(and(eq(mailCredentials.id, id), isNull(column)))
            .returning({ expiresAt: mailCredentials.expiresAt });
          if (!marked?.expiresAt) return null;
          const newer = await tx.execute(sql`
            select 1 from mail_credentials where id <> ${id}
              and (expires_at is null or expires_at > ${marked.expiresAt})`);
          if (newer.rows.length > 0) return null;
          return notifications.notify(tx, {
            type: "mail.credentialExpiring",
            recipients: await settingsAdministrators(tx),
            organizationId: null,
            targetId: null,
            params: { expiresAt: marked.expiresAt.toISOString() },
          });
        });
        if (!result) continue;
        await notifications.dispatch(result.mailIds);
        sent += result.recipients;
      }
    }
    return sent;
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
    const stored = adHoc && smtp?.password === undefined ? await this.smtpConfiguration() : null;
    const sameServer =
      stored !== null &&
      adHoc !== undefined &&
      stored.host.toLowerCase() === adHoc.host.toLowerCase() &&
      stored.port === adHoc.port &&
      stored.username === adHoc.username;
    const password =
      adHoc?.username === null
        ? null
        : smtp?.password === undefined
          ? !adHoc || sameServer
            ? await this.#smtpPassword()
            : null
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
      fields: { recipient: to, delivered: error === null, method: "smtp" },
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

export async function settingsAdministrators(executor: Executor): Promise<string[]> {
  const owner = await executor.execute<{ id: string }>(sql`
    select a.id from instance i join accounts a on a.id = i.owner_account_id where a.state = 'active'`);
  const roles = await executor.execute<{
    id: string;
    built_in_role: BuiltInRoleKey | null;
    areas: Record<string, string> | null;
  }>(sql`
    select a.id, ra.built_in_role, cr.areas from role_assignments ra
    join accounts a on a.id = ra.principal_id
    left join custom_roles cr on cr.id = ra.custom_role_id
    where ra.scope = 'instance' and ra.principal_kind = 'account' and a.state = 'active'
      and (ra.expires_at is null or ra.expires_at > now())`);
  const holders = roles.rows
    .filter((row) => {
      const areas = row.built_in_role ? builtInRoleAreas("instance", row.built_in_role) : (row.areas ?? {});
      return areas.settings === "manage";
    })
    .map((row) => row.id);
  return [...new Set([...owner.rows.map((row) => row.id), ...holders])].sort();
}
