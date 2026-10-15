import {
  clientSecretSchema,
  type DateFormat,
  type GraphMailConfiguration,
  graphMailConfigurationSchema,
  type MailDeliveryStep,
  type MailMethod,
  mailMethods,
  type SmtpConfigurationInput,
  type SmtpOAuth2Configuration,
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
import {
  checkOAuth2Configuration,
  MailOAuth2ConfigurationError,
  MailTokenError,
  MICROSOFT_AUTHORITIES,
  parseServiceAccountKey,
  requestMailToken,
  tokenFingerprint,
} from "./oauth2.js";
import { instanceSecrets, mailCredentials, mailDeliveryStatus, mailOutbox } from "./schema.js";
import {
  type Language,
  type MailBranding,
  type MailTemplate,
  type MailTemplates,
  renderMail,
  unsubscribeHeaders,
} from "./templates.js";
import {
  describeMailError,
  type MailMessage,
  type MailTransport,
  type SmtpOptions,
  SmtpTransport,
  smtpStepOf,
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

export interface MailFailure {
  code: string | null;
  responseCode: number | null;
  step: MailDeliveryStep | null;
}

export interface MailTestResult {
  delivered: boolean;
  error: MailFailure | null;
}

export interface MailDeliveryState {
  lastSuccessAt: Date | null;
  lastFailure: (MailFailure & { at: Date }) | null;
}

const SMTP_PASSWORD = "mail.smtpPassword";
const SMTP_OAUTH_SECRET = "mail.smtpOAuthSecret";
const SMTP_OAUTH_TOKEN = "mail.smtpOAuthToken";
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const CLAIM_SECONDS = 10 * 60;
const GRAPH_TOKEN_CODES = new Set([
  "graphCredentialExpired",
  "graphCredentialInvalid",
  "graphCredentialMissing",
  "graphTenantUnknown",
  "graphApplicationUnknown",
]);

const storedToken = z.object({ fingerprint: z.string(), token: z.string(), expiresAt: z.number() });

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

const storedMessage = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

function messageContext(id: string): string {
  return `mail_outbox.message:${id}`;
}

function secretContext(name: string): string {
  return `instance_secrets.value:${name}`;
}

function credentialContext(id: string): string {
  return `mail_credentials.secret:${id}`;
}

export function describeFailure(error: unknown): MailFailure {
  if (error instanceof MailNotConfiguredError)
    return { code: "notConfigured", responseCode: null, step: null };
  if (error instanceof MailTokenError)
    return { code: error.code, responseCode: error.responseCode, step: "token" };
  if (error instanceof GraphMailError) {
    return {
      code: error.code,
      responseCode: error.status,
      step: GRAPH_TOKEN_CODES.has(error.code)
        ? "token"
        : error.code === "graphUnreachable"
          ? "connect"
          : "send",
    };
  }
  const details = describeMailError(error);
  return { ...details, step: smtpStepOf(details.code) };
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
  if (configuration.oauth2 && configuration.username === null) {
    throw new SmtpConfigurationError("OAuth2 needs the mailbox as user name");
  }
}

function sameOAuth2Client(a: SmtpOAuth2Configuration | null, b: SmtpOAuth2Configuration | null): boolean {
  if (!a || !b || a.provider !== b.provider) return false;
  if (a.provider === "microsoft365" && b.provider === "microsoft365") {
    return a.tenantId === b.tenantId && a.clientId === b.clientId && a.authority === b.authority;
  }
  if (a.provider === "google" && b.provider === "google") return a.serviceAccount === b.serviceAccount;
  if (a.provider === "generic" && b.provider === "generic") {
    return a.tokenUrl === b.tokenUrl && a.clientId === b.clientId;
  }
  return false;
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
      unsubscribe?: { label: string; page: string; oneClick: string } | null;
      security?: boolean;
      operations?: boolean;
    },
  ): Promise<string> {
    const instanceName = await this.#settings.get(instanceNameSetting, {}, { executor: tx });
    const branding = await this.branding(tx, {
      organizationId: mail.organizationId ?? null,
      notification: mail.notification ?? false,
    });
    const message = renderMail(
      mail.template,
      mail.language,
      { ...mail.params, instanceName } as MailTemplates[T],
      mail.to,
      {
        ...branding,
        unsubscribe: mail.unsubscribe ? { label: mail.unsubscribe.label, url: mail.unsubscribe.page } : null,
        security: mail.security ?? false,
        operations: mail.operations ?? false,
      },
    );
    return this.queueMessage(
      tx,
      mail.template,
      mail.unsubscribe ? { ...message, headers: unsubscribeHeaders(mail.unsubscribe.oneClick) } : message,
    );
  }

  async queueMessage(tx: Transaction, template: string, message: MailMessage): Promise<string> {
    const id = uuidv7();
    await tx.insert(mailOutbox).values({
      id,
      template,
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
      .where(
        or(
          and(eq(mailOutbox.status, "pending"), lt(mailOutbox.createdAt, new Date(Date.now() - 60_000))),
          and(
            eq(mailOutbox.status, "sending"),
            lt(mailOutbox.updatedAt, new Date(Date.now() - CLAIM_SECONDS * 1000)),
          ),
        ),
      )
      .limit(1000);
    await this.dispatch(pending.map((row) => row.id));
    return pending.length;
  }

  deliver = async (job: JobContext<{ mailId: string }>): Promise<void> => {
    const { mailId } = job.payload;
    const [row] = await this.#database
      .update(mailOutbox)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(mailOutbox.id, mailId),
          or(
            eq(mailOutbox.status, "pending"),
            and(
              eq(mailOutbox.status, "sending"),
              lt(mailOutbox.updatedAt, new Date(Date.now() - CLAIM_SECONDS * 1000)),
            ),
          ),
        ),
      )
      .returning({ template: mailOutbox.template, message: mailOutbox.message });
    if (!row?.message) return;
    const message = storedMessage.parse(
      JSON.parse(this.#encryption.decryptString(row.message, messageContext(mailId))),
    );
    try {
      await this.#send({ ...message, messageId: await this.#messageId(mailId) });
    } catch (error) {
      const last = job.retryCount >= deliverMailJob.retryLimit;
      await this.#database
        .update(mailOutbox)
        .set({
          attempts: job.retryCount + 1,
          updatedAt: new Date(),
          ...(last ? { status: "failed" as const, message: null } : { status: "pending" as const }),
        })
        .where(eq(mailOutbox.id, mailId));
      const details = describeFailure(error);
      await this.#recordDelivery(details);
      job.logger.warn(
        { mailId, template: row.template, attempt: job.retryCount + 1, ...details },
        last ? "Mail delivery failed for good" : "Mail delivery failed",
      );
      if (last) return;
      throw new Error("Mail delivery failed");
    }
    await this.#database.delete(mailOutbox).where(eq(mailOutbox.id, mailId));
    await this.#recordDelivery(null);
  };

  async #messageId(mailId: string): Promise<string> {
    const url = await this.#settings.get(instanceUrlSetting, {});
    const host = url ? new URL(url).hostname : "pagehall.invalid";
    return `<${mailId}@${host}>`;
  }

  async #recordDelivery(failure: MailFailure | null): Promise<void> {
    const now = new Date();
    const values = failure
      ? {
          lastFailureAt: now,
          lastFailureCode: failure.code,
          lastFailureResponseCode: failure.responseCode,
          lastFailureStep: failure.step,
        }
      : { lastSuccessAt: now };
    await this.#database
      .insert(mailDeliveryStatus)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: mailDeliveryStatus.id, set: values });
  }

  async deliveryState(): Promise<MailDeliveryState> {
    const [row] = await this.#database.select().from(mailDeliveryStatus);
    return {
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastFailure: row?.lastFailureAt
        ? {
            at: row.lastFailureAt,
            code: row.lastFailureCode,
            responseCode: row.lastFailureResponseCode,
            step: (row.lastFailureStep as MailDeliveryStep | null) ?? null,
          }
        : null,
    };
  }

  async smtpConfiguration(executor: Executor = this.#database): Promise<SmtpConfiguration | null> {
    return this.#settings.get(smtpSetting, {}, { executor });
  }

  async configuredMethod(executor: Executor = this.#database): Promise<MailMethod | null> {
    const method = await this.method(executor);
    const configured =
      method === "graph" ? await this.graphConfiguration(executor) : await this.smtpConfiguration(executor);
    return configured ? method : null;
  }

  async hasSmtpPassword(): Promise<boolean> {
    return (await this.#smtpPassword()) !== null;
  }

  async hasSmtpOAuth2Secret(): Promise<boolean> {
    return (await this.#readSecret(SMTP_OAUTH_SECRET)) !== null;
  }

  async method(executor: Executor = this.#database): Promise<MailMethod> {
    return this.#settings.get(mailMethodSetting, {}, { executor });
  }

  async graphConfiguration(executor: Executor = this.#database): Promise<GraphMailConfiguration | null> {
    return this.#settings.get(graphMailSetting, {}, { executor });
  }

  async #send(message: MailMessage): Promise<void> {
    if ((await this.method()) === "graph") {
      const graph = await this.graphConfiguration();
      if (!graph) throw new MailNotConfiguredError();
      await (await this.#graphTransport(graph)).send(message);
      return;
    }
    const configuration = await this.smtpConfiguration();
    if (!configuration) throw new MailNotConfiguredError();
    const { oauth2, ...smtp } = configuration;
    if (!oauth2) {
      await this.#transport({ ...smtp, password: await this.#smtpPassword() }).send(message);
      return;
    }
    const token = await this.#smtpAccessToken(configuration, false);
    try {
      await this.#transport({ ...smtp, password: null, accessToken: token.token }).send(message);
    } catch (error) {
      if (!token.cached || describeMailError(error).code !== "EAUTH") throw error;
      const fresh = await this.#smtpAccessToken(configuration, true);
      await this.#transport({ ...smtp, password: null, accessToken: fresh.token }).send(message);
    }
  }

  async #smtpAccessToken(
    configuration: SmtpConfiguration,
    refresh: boolean,
  ): Promise<{ token: string; cached: boolean }> {
    const oauth2 = configuration.oauth2;
    const secret = await this.#readSecret(SMTP_OAUTH_SECRET);
    if (!oauth2 || !configuration.username || !secret) throw new MailNotConfiguredError();
    const fingerprint = tokenFingerprint(oauth2, configuration.username, secret);
    if (!refresh) {
      const stored = await this.#readSecret(SMTP_OAUTH_TOKEN);
      const parsed = stored ? storedToken.safeParse(JSON.parse(stored)) : null;
      if (
        parsed?.success &&
        parsed.data.fingerprint === fingerprint &&
        parsed.data.expiresAt - TOKEN_MARGIN_MS > Date.now()
      ) {
        return { token: parsed.data.token, cached: true };
      }
    }
    const fresh = await requestMailToken({
      configuration: oauth2,
      mailbox: configuration.username,
      secret,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
    await this.#writeSecret(
      this.#database,
      SMTP_OAUTH_TOKEN,
      JSON.stringify({ fingerprint, token: fresh.token, expiresAt: fresh.expiresAt }),
    );
    return { token: fresh.token, cached: false };
  }

  async #readSecret(name: string, executor: Executor = this.#database): Promise<string | null> {
    const [row] = await executor
      .select({ value: instanceSecrets.value })
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, name));
    return row ? this.#encryption.decryptString(row.value, secretContext(name)) : null;
  }

  async #writeSecret(executor: Executor, name: string, plain: string): Promise<void> {
    const value = this.#encryption.encrypt(plain, secretContext(name));
    await executor
      .insert(instanceSecrets)
      .values({ name, value })
      .onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } });
  }

  async #deleteSecret(executor: Executor, name: string): Promise<void> {
    await executor.delete(instanceSecrets).where(eq(instanceSecrets.name, name));
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

  #parseSmtp(configuration: SmtpConfigurationInput): SmtpConfiguration {
    const parsed = smtpConfigurationSchema.parse(configuration);
    if (parsed.oauth2) {
      try {
        checkOAuth2Configuration(parsed.oauth2, { allowInsecure: this.#allowInsecure });
      } catch (error) {
        if (error instanceof MailOAuth2ConfigurationError) throw new SmtpConfigurationError(error.message);
        throw error;
      }
    }
    return parsed;
  }

  #oauth2SecretOf(oauth2: SmtpOAuth2Configuration, input: string): string {
    if (oauth2.provider !== "google") return input;
    try {
      const key = parseServiceAccountKey(input);
      if (key.clientEmail !== oauth2.serviceAccount.toLowerCase()) {
        throw new SmtpConfigurationError("The key file belongs to another service account");
      }
      return key.privateKey;
    } catch (error) {
      if (error instanceof MailOAuth2ConfigurationError) throw new SmtpConfigurationError(error.message);
      throw error;
    }
  }

  async configureSmtp(
    configuration: SmtpConfigurationInput,
    password: string | null | undefined,
    options: { tx?: Transaction; oauth2Secret?: string | undefined } = {},
  ): Promise<void> {
    const parsed = this.#parseSmtp(configuration);
    const oauth2 = parsed.oauth2;
    const oauth2Secret =
      oauth2 && options.oauth2Secret !== undefined
        ? this.#oauth2SecretOf(oauth2, options.oauth2Secret)
        : null;
    const run = async (tx: Transaction) => {
      const previous = await this.smtpConfiguration(tx);
      await this.#deleteSecret(tx, SMTP_OAUTH_TOKEN);
      if (oauth2) {
        await this.#deleteSecret(tx, SMTP_PASSWORD);
        if (oauth2Secret !== null) {
          await this.#writeSecret(tx, SMTP_OAUTH_SECRET, oauth2Secret);
        } else if (
          !sameOAuth2Client(previous?.oauth2 ?? null, oauth2) ||
          (await this.#readSecret(SMTP_OAUTH_SECRET, tx)) === null
        ) {
          throw new SmtpConfigurationError(
            oauth2.provider === "google"
              ? "Upload the key file of the service account"
              : "Enter the client secret",
          );
        }
      } else {
        await this.#deleteSecret(tx, SMTP_OAUTH_SECRET);
        if (password === null || (password !== undefined && parsed.username === null)) {
          await this.#deleteSecret(tx, SMTP_PASSWORD);
        }
        if (password !== undefined && password !== null && parsed.username !== null) {
          await this.#writeSecret(tx, SMTP_PASSWORD, password);
        }
      }
      const hasPassword = !oauth2 && (await this.#readSecret(SMTP_PASSWORD, tx)) !== null;
      checkSmtpCredentials(parsed, hasPassword);
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
          oauth2Provider: oauth2?.provider ?? null,
          oauth2ClientId: oauth2
            ? oauth2.provider === "google"
              ? oauth2.serviceAccount
              : oauth2.clientId
            : null,
          oauth2CredentialChanged: oauth2Secret !== null,
        },
      });
    };
    await (options.tx ? run(options.tx) : this.#database.transaction(run));
  }

  async #adHocToken(configuration: SmtpConfiguration, oauth2Secret: string | undefined): Promise<string> {
    const oauth2 = configuration.oauth2;
    if (!oauth2 || !configuration.username) throw new MailNotConfiguredError();
    let secret: string | null = null;
    if (oauth2Secret !== undefined) {
      secret = this.#oauth2SecretOf(oauth2, oauth2Secret);
    } else {
      const stored = await this.smtpConfiguration();
      const sameServer =
        stored !== null &&
        stored.host.toLowerCase() === configuration.host.toLowerCase() &&
        stored.port === configuration.port &&
        stored.username?.toLowerCase() === configuration.username.toLowerCase();
      if (sameServer && sameOAuth2Client(stored.oauth2, oauth2))
        secret = await this.#readSecret(SMTP_OAUTH_SECRET);
    }
    if (secret === null) {
      throw new SmtpConfigurationError(
        oauth2.provider === "google"
          ? "Upload the key file of the service account"
          : "Enter the client secret",
      );
    }
    const token = await requestMailToken({
      configuration: oauth2,
      mailbox: configuration.username,
      secret,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
    return token.token;
  }

  async sendTest(
    to: string,
    language: Language,
    smtp?: {
      configuration: SmtpConfigurationInput;
      password: string | null | undefined;
      oauth2Secret?: string | undefined;
    },
  ): Promise<MailTestResult> {
    const instanceName = await this.#settings.get(instanceNameSetting, {});
    const message: MailMessage = renderMail("smtpTest", language, { instanceName }, to);
    const adHoc = smtp ? this.#parseSmtp(smtp.configuration) : undefined;
    const stored = adHoc && smtp?.password === undefined ? await this.smtpConfiguration() : null;
    const sameServer =
      stored !== null &&
      adHoc !== undefined &&
      stored.host.toLowerCase() === adHoc.host.toLowerCase() &&
      stored.port === adHoc.port &&
      stored.username === adHoc.username;
    const password =
      adHoc?.username === null || adHoc?.oauth2
        ? null
        : smtp?.password === undefined
          ? !adHoc || sameServer
            ? await this.#smtpPassword()
            : null
          : smtp.password;
    if (adHoc) checkSmtpCredentials(adHoc, password !== null);
    let error: MailFailure | null = null;
    try {
      if (!adHoc) {
        await this.#send(message);
      } else {
        const { oauth2, ...options } = adHoc;
        const accessToken = oauth2 ? await this.#adHocToken(adHoc, smtp?.oauth2Secret) : null;
        await this.#transport({ ...options, password, accessToken }).send(message);
      }
    } catch (failure) {
      if (failure instanceof SmtpConfigurationError) throw failure;
      error = describeFailure(failure);
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
