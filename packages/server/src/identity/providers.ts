import { createHash } from "node:crypto";
import {
  clientSecretSchema,
  ENTRA_AUTHORITY,
  GOOGLE_ISSUER,
  googleServiceAccountKeySchema,
  identityProviderNameSchema,
  type OidcConfig,
  type OidcConfigInput,
  oidcConfigSchema,
  uuidv7,
} from "@pagehall/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { sessions } from "../auth/schema.js";
import { type Areas, builtInRoleAreas } from "../authorization/areas.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { NotificationService } from "../notifications/service.js";
import type { BuiltInRoleKey } from "../organizations/access-schema.js";
import { LOGO_MAX_BYTES, logoContentType, OrganizationError } from "../organizations/organizations.js";
import type { SettingsService } from "../settings/service.js";
import type { ProviderCapabilities, ProviderCredential, ProviderDefinition } from "./adapter.js";
import { generateCertificate } from "./certificates.js";
import { foreignDirectoryEndpoint } from "./directory.js";
import { emptyReport, type GroupMappingService } from "./groups.js";
import { oidcCapabilities, oidcIssuer } from "./oidc.js";
import {
  identities,
  identityProviderCredentials,
  identityProviderDomains,
  identityProviderLogos,
  identityProviderSecrets,
  identityProviders,
  managedGroups,
  mappingRules,
  providerSyncRuns,
} from "./schema.js";
import { accountsWithoutOtherSignIn } from "./sign-in-ways.js";

export type ProviderWarning = "noCredential" | "credentialExpiring" | "credentialExpired";

export interface CredentialSummary {
  id: string;
  kind: "clientSecret" | "certificate";
  keyId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ProviderSummary {
  id: string;
  type: "oidc";
  name: string;
  config: OidcConfig;
  issuer: string;
  callbackPath: string;
  logoRef: string | null;
  credentials: CredentialSummary[];
  directoryKey: boolean;
  capabilities: ProviderCapabilities;
  deactivatedAt: Date | null;
  warnings: ProviderWarning[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RemovalPreview {
  accounts: number;
  accountsWithoutSignIn: number;
  groups: number;
  rules: number;
  grants: number;
}

export interface SignInProvider {
  id: string;
  name: string;
  preset: OidcConfig["preset"];
  logoRef: string | null;
}

export type CredentialInput =
  | { kind: "clientSecret"; secret: string; expiresAt: Date | null }
  | { kind: "certificate"; validDays: number };

export interface AddedCredential extends CredentialSummary {
  certificate: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MICROSOFT_AUTHORITIES: readonly string[] = [
  ENTRA_AUTHORITY,
  "https://login.microsoftonline.us",
  "https://login.partner.microsoftonline.cn",
];
const WARNING_DAYS = 30;
const REMINDER_THRESHOLDS = [
  { days: 30, column: "notifiedThirtyDaysAt" },
  { days: 7, column: "notifiedSevenDaysAt" },
] as const;

export const providerCredentialReminderJob = defineJob({
  name: "identity-providers.send-credential-reminders",
  payload: z.object({}),
  retryLimit: 2,
});

export const PROVIDER_CREDENTIAL_REMINDER_SCHEDULE = "41 * * * *";

export function callbackPath(providerId: string): string {
  return `/api/v1/auth/providers/${providerId}/callback`;
}

function directoryKeyContext(id: string): string {
  return `identity_provider_secrets.directory_key:${id}`;
}

function credentialContext(id: string): string {
  return `identity_provider_credentials.secret:${id}`;
}

function domainInUse(domains: readonly string[]): OrganizationError {
  return new OrganizationError("domainInUse", "A domain already belongs to another identity provider", {
    domains: [...domains],
  });
}

function notFound(): OrganizationError {
  return new OrganizationError("notFound", "The identity provider does not exist");
}

function warningsOf(credentials: CredentialSummary[], now: Date): ProviderWarning[] {
  const usable = credentials.filter((credential) => !credential.expiresAt || credential.expiresAt > now);
  if (credentials.length === 0) return ["noCredential"];
  if (usable.length === 0) return ["credentialExpired"];
  const latest = Math.max(
    ...usable.map((credential) => credential.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  return latest < now.getTime() + WARNING_DAYS * DAY_MS ? ["credentialExpiring"] : [];
}

export class IdentityProviderService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #encryption: Encryption;
  readonly #notifications: NotificationService;
  readonly #allowInsecure: boolean;
  readonly #clock: () => Date;
  readonly #mapping: GroupMappingService | undefined;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    encryption: Encryption;
    notifications: NotificationService;
    settings: SettingsService;
    allowInsecure: boolean;
    clock?: () => Date;
    mapping?: GroupMappingService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#encryption = options.encryption;
    this.#notifications = options.notifications;
    this.#allowInsecure = options.allowInsecure;
    this.#clock = options.clock ?? (() => new Date());
    this.#mapping = options.mapping;
    this.#settings = options.settings;
  }

  #parseConfig(input: OidcConfigInput | unknown): OidcConfig {
    const parsed = oidcConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrganizationError("invalidProviderConfiguration", "The provider configuration is not valid", {
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const config = parsed.data;
    if (this.#allowInsecure) return config;
    const urls = [oidcIssuer(config), ...(config.preset === "entraId" ? [config.graphUrl] : [])];
    if (urls.some((url) => new URL(url).protocol !== "https:")) {
      throw new OrganizationError("invalidProviderConfiguration", "Identity providers must use HTTPS", {
        fields: ["issuer"],
      });
    }
    if (config.preset === "entraId" && !MICROSOFT_AUTHORITIES.includes(config.authority)) {
      throw new OrganizationError("invalidProviderConfiguration", "The authority is not a Microsoft cloud", {
        fields: ["authority"],
      });
    }
    const foreign = foreignDirectoryEndpoint(config);
    if (foreign) {
      throw new OrganizationError(
        "invalidProviderConfiguration",
        "The directory endpoint is not one of the provider's own endpoints",
        { fields: [foreign] },
      );
    }
    if (config.preset === "google" && config.issuer !== GOOGLE_ISSUER) {
      throw new OrganizationError(
        "invalidProviderConfiguration",
        "Google signs in only through its own issuer",
        {
          fields: ["issuer"],
        },
      );
    }
    return config;
  }

  async #find(executor: Executor, id: string, lock = false) {
    const query = executor.select().from(identityProviders).where(eq(identityProviders.id, id));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  async #syncDomains(tx: Transaction, providerId: string, domains: readonly string[]): Promise<void> {
    await tx.delete(identityProviderDomains).where(eq(identityProviderDomains.providerId, providerId));
    const unique = [...new Set(domains)].sort();
    if (unique.length === 0) return;
    const taken = await tx
      .select({ domain: identityProviderDomains.domain })
      .from(identityProviderDomains)
      .where(inArray(identityProviderDomains.domain, unique))
      .for("update");
    if (taken.length > 0) throw domainInUse(taken.map((row) => row.domain));
    try {
      await tx.insert(identityProviderDomains).values(unique.map((domain) => ({ domain, providerId })));
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "23505") throw domainInUse(unique);
      throw error;
    }
  }

  async #credentials(executor: Executor, providerIds: string[]): Promise<Map<string, CredentialSummary[]>> {
    const map = new Map<string, CredentialSummary[]>();
    if (providerIds.length === 0) return map;
    const rows = await executor
      .select({
        id: identityProviderCredentials.id,
        providerId: identityProviderCredentials.providerId,
        kind: identityProviderCredentials.kind,
        keyId: identityProviderCredentials.keyId,
        expiresAt: identityProviderCredentials.expiresAt,
        createdAt: identityProviderCredentials.createdAt,
      })
      .from(identityProviderCredentials)
      .where(inArray(identityProviderCredentials.providerId, providerIds))
      .orderBy(desc(identityProviderCredentials.createdAt), desc(identityProviderCredentials.id));
    for (const { providerId, ...credential } of rows) {
      map.set(providerId, [...(map.get(providerId) ?? []), credential]);
    }
    return map;
  }

  async #summaries(
    executor: Executor,
    rows: (typeof identityProviders.$inferSelect)[],
  ): Promise<ProviderSummary[]> {
    const ids = rows.map((row) => row.id);
    const credentials = await this.#credentials(executor, ids);
    const logos =
      ids.length === 0
        ? []
        : await executor
            .select({ providerId: identityProviderLogos.providerId, ref: identityProviderLogos.ref })
            .from(identityProviderLogos)
            .where(inArray(identityProviderLogos.providerId, ids));
    const keys =
      ids.length === 0
        ? []
        : await executor
            .select({ providerId: identityProviderSecrets.providerId })
            .from(identityProviderSecrets)
            .where(inArray(identityProviderSecrets.providerId, ids));
    const now = this.#clock();
    return rows.map((row) => {
      const config = oidcConfigSchema.parse(row.config);
      const own = credentials.get(row.id) ?? [];
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        config,
        issuer: oidcIssuer(config),
        callbackPath: callbackPath(row.id),
        logoRef: logos.find((logo) => logo.providerId === row.id)?.ref ?? null,
        credentials: own,
        directoryKey: keys.some((key) => key.providerId === row.id),
        capabilities: oidcCapabilities(
          config,
          keys.some((key) => key.providerId === row.id),
        ),
        deactivatedAt: row.deactivatedAt,
        warnings: warningsOf(own, now),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async list(): Promise<ProviderSummary[]> {
    const rows = await this.#database
      .select()
      .from(identityProviders)
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return this.#summaries(this.#database, rows);
  }

  async get(id: string): Promise<ProviderSummary> {
    const row = await this.#find(this.#database, id);
    const [summary] = await this.#summaries(this.#database, [row]);
    if (!summary) throw notFound();
    return summary;
  }

  async create(
    actor: Principal,
    input: { name: string; config: unknown; credential: CredentialInput },
  ): Promise<{ provider: ProviderSummary; credential: AddedCredential }> {
    const name = identityProviderNameSchema.parse(input.name);
    const config = this.#parseConfig(input.config);
    const created = await this.#database.transaction(async (tx) => {
      const [row] = await tx
        .insert(identityProviders)
        .values({
          type: "oidc",
          preset: config.preset,
          name,
          config,
        })
        .returning();
      if (!row) throw new Error("The identity provider was not created");
      await this.#audit.record(tx, {
        name: "identityProvider.created",
        actor,
        targetId: row.id,
        fields: { name, type: row.type, preset: config.preset },
      });
      await this.#syncDomains(tx, row.id, config.domains);
      const credential = await this.#addCredential(tx, actor, row, input.credential);
      return { id: row.id, credential };
    });
    return { provider: await this.get(created.id), credential: created.credential };
  }

  async update(
    actor: Principal,
    id: string,
    input: { name?: string; config?: unknown },
  ): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      const name = input.name === undefined ? current.name : identityProviderNameSchema.parse(input.name);
      const config =
        input.config === undefined ? oidcConfigSchema.parse(current.config) : this.#parseConfig(input.config);
      if (config.preset !== current.preset) {
        throw new OrganizationError(
          "invalidProviderConfiguration",
          "The preset of a provider cannot change",
          {
            fields: ["config.preset"],
          },
        );
      }
      await tx.update(identityProviders).set({ name, config }).where(eq(identityProviders.id, id));
      await this.#syncDomains(tx, id, config.domains);
      await this.#audit.record(tx, {
        name: "identityProvider.updated",
        actor,
        targetId: id,
        fields: {
          name,
          config: config as unknown as Record<string, never>,
          previous: { name: current.name, config: current.config as never },
        },
      });
    });
    return this.get(id);
  }

  async #linked(executor: Executor, id: string) {
    return executor
      .select({ id: identities.id, accountId: identities.accountId })
      .from(identities)
      .where(eq(identities.providerId, id));
  }

  async #endSessions(tx: Transaction, linked: { id: string }[]): Promise<number> {
    if (linked.length === 0) return 0;
    const ended = await tx
      .delete(sessions)
      .where(
        inArray(
          sessions.identityId,
          linked.map((identity) => identity.id),
        ),
      )
      .returning({ id: sessions.id });
    return ended.length;
  }

  async deactivate(actor: Principal, id: string): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      if (current.deactivatedAt) return;
      await tx
        .update(identityProviders)
        .set({ deactivatedAt: this.#clock() })
        .where(eq(identityProviders.id, id));
      await tx
        .update(providerSyncRuns)
        .set({ cancelRequestedAt: this.#clock() })
        .where(
          and(
            eq(providerSyncRuns.providerId, id),
            eq(providerSyncRuns.status, "running"),
            isNull(providerSyncRuns.cancelRequestedAt),
          ),
        );
      const endedSessions = await this.#endSessions(tx, await this.#linked(tx, id));
      await this.#audit.record(tx, {
        name: "identityProvider.deactivated",
        actor,
        targetId: id,
        fields: { name: current.name, endedSessions },
      });
    });
    return this.get(id);
  }

  async activate(actor: Principal, id: string): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      if (!current.deactivatedAt) return;
      await tx.update(identityProviders).set({ deactivatedAt: null }).where(eq(identityProviders.id, id));
      await this.#audit.record(tx, {
        name: "identityProvider.activated",
        actor,
        targetId: id,
        fields: { name: current.name },
      });
    });
    return this.get(id);
  }

  async removalPreview(id: string): Promise<RemovalPreview> {
    await this.#find(this.#database, id);
    const linked = await this.#linked(this.#database, id);
    const accountIds = [...new Set(linked.map((identity) => identity.accountId))];
    const [groups] = await this.#database
      .select({ value: count() })
      .from(managedGroups)
      .where(eq(managedGroups.providerId, id));
    const [rules] = await this.#database
      .select({ value: count() })
      .from(mappingRules)
      .where(eq(mappingRules.providerId, id));
    const withoutSignIn = await accountsWithoutOtherSignIn(this.#database, this.#settings, accountIds, {
      providerId: id,
    });
    return {
      accounts: accountIds.length,
      accountsWithoutSignIn: withoutSignIn.length,
      groups: Number(groups?.value ?? 0),
      rules: Number(rules?.value ?? 0),
      grants: (await this.#mapping?.withdrawnWithout(this.#database, id, accountIds)) ?? 0,
    };
  }

  async remove(actor: Principal, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      const linked = await this.#linked(tx, id);
      const endedSessions = await this.#endSessions(tx, linked);
      const releasedGroups = (await this.#mapping?.releaseGroups(tx, id, current.name)) ?? 0;
      await this.#audit.record(tx, {
        name: "identityProvider.removed",
        actor,
        targetId: id,
        fields: { name: current.name, endedSessions, releasedGroups },
      });
      await tx.delete(identityProviders).where(eq(identityProviders.id, id));
      for (const accountId of new Set(linked.map((identity) => identity.accountId))) {
        await this.#mapping?.reconcile(tx, accountId, emptyReport());
      }
    });
  }

  async #addCredential(
    tx: Transaction,
    actor: Principal,
    provider: typeof identityProviders.$inferSelect,
    input: CredentialInput,
  ): Promise<AddedCredential> {
    const now = this.#clock();
    let secret: string;
    let certificate: string | null = null;
    let keyId: string | null = null;
    let expiresAt: Date | null;
    if (input.kind === "clientSecret") {
      secret = clientSecretSchema.parse(input.secret);
      expiresAt = input.expiresAt;
      if (expiresAt && expiresAt <= now) {
        throw new OrganizationError("expiryInPast", "The client secret has already expired");
      }
    } else {
      if (!Number.isInteger(input.validDays) || input.validDays < 30 || input.validDays > 3 * 365) {
        throw new OrganizationError("invalidInput", "A certificate is valid for 30 days to 3 years");
      }
      const generated = await generateCertificate({
        commonName: `Pagehall ${provider.name}`,
        validDays: input.validDays,
        now,
      });
      secret = generated.privateKey;
      certificate = generated.certificate;
      keyId = generated.thumbprint;
      expiresAt = generated.expiresAt;
    }
    const credentialId = uuidv7();
    const [row] = await tx
      .insert(identityProviderCredentials)
      .values({
        id: credentialId,
        providerId: provider.id,
        kind: input.kind,
        secret: this.#encryption.encrypt(secret, credentialContext(credentialId)),
        certificate,
        keyId,
        expiresAt,
      })
      .returning({ id: identityProviderCredentials.id, createdAt: identityProviderCredentials.createdAt });
    if (!row) throw new Error("The credential was not stored");
    await this.#audit.record(tx, {
      name: "identityProvider.credentialAdded",
      actor,
      targetId: provider.id,
      fields: { credentialId: row.id, kind: input.kind, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return { id: row.id, kind: input.kind, keyId, expiresAt, createdAt: row.createdAt, certificate };
  }

  async addCredential(actor: Principal, id: string, input: CredentialInput): Promise<AddedCredential> {
    return this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, id, true);
      return this.#addCredential(tx, actor, provider, input);
    });
  }

  async removeCredential(actor: Principal, id: string, credentialId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      const credentials = await tx
        .select({ id: identityProviderCredentials.id, kind: identityProviderCredentials.kind })
        .from(identityProviderCredentials)
        .where(eq(identityProviderCredentials.providerId, id));
      const credential = credentials.find((candidate) => candidate.id === credentialId);
      if (!credential) throw new OrganizationError("notFound", "The credential does not exist");
      if (credentials.length === 1) {
        throw new OrganizationError("lastCredential", "Add a new credential before removing the last one");
      }
      await tx.delete(identityProviderCredentials).where(eq(identityProviderCredentials.id, credentialId));
      await this.#audit.record(tx, {
        name: "identityProvider.credentialRemoved",
        actor,
        targetId: id,
        fields: { credentialId, kind: credential.kind },
      });
    });
  }

  async setDirectoryKey(actor: Principal, id: string, key: string): Promise<void> {
    let parsed: { client_email: string };
    try {
      parsed = googleServiceAccountKeySchema.parse(JSON.parse(key));
    } catch {
      throw new OrganizationError(
        "invalidServiceAccountKey",
        "The service account key is not a valid JSON key",
      );
    }
    await this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, id, true);
      if (provider.preset !== "google") {
        throw new OrganizationError(
          "invalidProviderConfiguration",
          "Only Google providers use a service account key",
        );
      }
      const encrypted = this.#encryption.encrypt(key, directoryKeyContext(provider.id));
      await tx
        .insert(identityProviderSecrets)
        .values({ providerId: provider.id, directoryKey: encrypted })
        .onConflictDoUpdate({
          target: identityProviderSecrets.providerId,
          set: { directoryKey: encrypted, updatedAt: new Date() },
        });
      await this.#audit.record(tx, {
        name: "identityProvider.directoryKeyChanged",
        actor,
        targetId: provider.id,
        fields: { action: "set", serviceAccount: parsed.client_email },
      });
    });
  }

  async removeDirectoryKey(actor: Principal, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, id, true);
      const removed = await tx
        .delete(identityProviderSecrets)
        .where(eq(identityProviderSecrets.providerId, provider.id))
        .returning({ providerId: identityProviderSecrets.providerId });
      if (removed.length === 0) return;
      await this.#audit.record(tx, {
        name: "identityProvider.directoryKeyChanged",
        actor,
        targetId: provider.id,
        fields: { action: "removed", serviceAccount: null },
      });
    });
  }

  async certificate(id: string, credentialId: string): Promise<string> {
    await this.#find(this.#database, id);
    const [row] = await this.#database
      .select({ certificate: identityProviderCredentials.certificate })
      .from(identityProviderCredentials)
      .where(
        and(eq(identityProviderCredentials.id, credentialId), eq(identityProviderCredentials.providerId, id)),
      );
    if (!row?.certificate) throw new OrganizationError("notFound", "The credential has no certificate");
    return row.certificate;
  }

  async setLogo(actor: Principal, id: string, logo: { contentType: string; data: Buffer }): Promise<string> {
    const contentType = logoContentType(logo.data);
    if (contentType === null || contentType !== logo.contentType || logo.data.length > LOGO_MAX_BYTES) {
      throw new OrganizationError(
        "invalidLogo",
        "The logo must be a PNG, JPEG or WebP image of at most 256 KiB",
      );
    }
    const ref = createHash("sha256").update(logo.data).digest("hex").slice(0, 16);
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      await tx
        .insert(identityProviderLogos)
        .values({ providerId: id, contentType, data: logo.data, ref })
        .onConflictDoUpdate({
          target: identityProviderLogos.providerId,
          set: { contentType, data: logo.data, ref, updatedAt: new Date() },
        });
      await this.#audit.record(tx, {
        name: "identityProvider.logoChanged",
        actor,
        targetId: id,
        fields: { removed: false },
      });
    });
    return ref;
  }

  async removeLogo(actor: Principal, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      const deleted = await tx
        .delete(identityProviderLogos)
        .where(eq(identityProviderLogos.providerId, id))
        .returning({ id: identityProviderLogos.providerId });
      if (deleted.length === 0) return;
      await this.#audit.record(tx, {
        name: "identityProvider.logoChanged",
        actor,
        targetId: id,
        fields: { removed: true },
      });
    });
  }

  async logo(id: string): Promise<{ contentType: string; data: Buffer; ref: string } | null> {
    const [row] = await this.#database
      .select({
        contentType: identityProviderLogos.contentType,
        data: identityProviderLogos.data,
        ref: identityProviderLogos.ref,
      })
      .from(identityProviderLogos)
      .where(eq(identityProviderLogos.providerId, id));
    return row ?? null;
  }

  async definition(
    id: string,
  ): Promise<{ provider: ProviderDefinition; credentials: ProviderCredential[]; active: boolean } | null> {
    const [row] = await this.#database.select().from(identityProviders).where(eq(identityProviders.id, id));
    if (!row) return null;
    const now = this.#clock();
    const rows = await this.#database
      .select()
      .from(identityProviderCredentials)
      .where(
        and(
          eq(identityProviderCredentials.providerId, id),
          or(
            isNull(identityProviderCredentials.expiresAt),
            sql`${identityProviderCredentials.expiresAt} > ${now}`,
          ),
        ),
      )
      .orderBy(desc(identityProviderCredentials.createdAt), desc(identityProviderCredentials.id));
    const [secret] = await this.#database
      .select({ directoryKey: identityProviderSecrets.directoryKey })
      .from(identityProviderSecrets)
      .where(eq(identityProviderSecrets.providerId, id));
    return {
      provider: {
        id: row.id,
        type: row.type,
        name: row.name,
        config: oidcConfigSchema.parse(row.config),
        directoryKey: secret
          ? this.#encryption.decryptString(secret.directoryKey, directoryKeyContext(row.id))
          : null,
      },
      active: row.deactivatedAt === null,
      credentials: rows.map((credential) => ({
        id: credential.id,
        kind: credential.kind,
        keyId: credential.keyId,
        secret: this.#encryption.decryptString(credential.secret, credentialContext(credential.id)),
      })),
    };
  }

  async signInProviders(): Promise<SignInProvider[]> {
    const rows = await this.#database
      .select({
        id: identityProviders.id,
        name: identityProviders.name,
        preset: identityProviders.preset,
        logoRef: identityProviderLogos.ref,
      })
      .from(identityProviders)
      .leftJoin(identityProviderLogos, eq(identityProviderLogos.providerId, identityProviders.id))
      .where(isNull(identityProviders.deactivatedAt))
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return rows.map((row) => ({ ...row, logoRef: row.logoRef ?? null }));
  }

  async providerForDomain(domain: string): Promise<SignInProvider | null> {
    const [row] = await this.#database
      .select({
        id: identityProviders.id,
        name: identityProviders.name,
        preset: identityProviders.preset,
        logoRef: identityProviderLogos.ref,
      })
      .from(identityProviderDomains)
      .innerJoin(identityProviders, eq(identityProviders.id, identityProviderDomains.providerId))
      .leftJoin(identityProviderLogos, eq(identityProviderLogos.providerId, identityProviders.id))
      .where(
        and(
          eq(identityProviderDomains.domain, domain.trim().toLowerCase()),
          isNull(identityProviders.deactivatedAt),
        ),
      );
    return row ? { ...row, logoRef: row.logoRef ?? null } : null;
  }

  async sendCredentialReminders(): Promise<number> {
    const now = this.#clock();
    let sent = 0;
    for (const threshold of REMINDER_THRESHOLDS) {
      const column = identityProviderCredentials[threshold.column];
      const due = await this.#database
        .select({ id: identityProviderCredentials.id })
        .from(identityProviderCredentials)
        .where(
          and(
            isNotNull(identityProviderCredentials.expiresAt),
            sql`${identityProviderCredentials.expiresAt} > ${now}`,
            lte(identityProviderCredentials.expiresAt, new Date(now.getTime() + threshold.days * DAY_MS)),
            isNull(column),
          ),
        )
        .limit(200);
      for (const { id } of due) {
        const result = await this.#database.transaction(async (tx) => {
          const [marked] = await tx
            .update(identityProviderCredentials)
            .set({ [threshold.column]: now })
            .where(and(eq(identityProviderCredentials.id, id), isNull(column)))
            .returning({
              providerId: identityProviderCredentials.providerId,
              expiresAt: identityProviderCredentials.expiresAt,
            });
          if (!marked?.expiresAt) return null;
          const newer = await tx.execute(sql`
            select 1 from identity_provider_credentials
            where provider_id = ${marked.providerId} and id <> ${id}
              and (expires_at is null or expires_at > ${marked.expiresAt})`);
          if (newer.rows.length > 0) return null;
          const [provider] = await tx
            .select({ id: identityProviders.id, name: identityProviders.name })
            .from(identityProviders)
            .where(eq(identityProviders.id, marked.providerId));
          if (!provider) return null;
          const recipients = await signInAdministrators(tx);
          return this.#notifications.notify(tx, {
            type: "identityProvider.credentialExpiring",
            recipients,
            organizationId: null,
            targetId: provider.id,
            params: {
              providerName: provider.name,
              expiresAt: marked.expiresAt.toISOString(),
              providerId: provider.id,
            },
          });
        });
        if (!result) continue;
        await this.#notifications.dispatch(result.mailIds);
        sent += result.recipients;
      }
    }
    return sent;
  }
}

export async function signInAdministrators(executor: Executor): Promise<string[]> {
  const owner = await executor.execute<{ id: string }>(sql`
    select a.id from instance i join accounts a on a.id = i.owner_account_id where a.state = 'active'`);
  const roles = await executor.execute<{
    id: string;
    built_in_role: BuiltInRoleKey | null;
    areas: Areas | null;
  }>(sql`
    select a.id, ra.built_in_role, cr.areas from role_assignments ra
    join accounts a on a.id = ra.principal_id
    left join custom_roles cr on cr.id = ra.custom_role_id
    where ra.scope = 'instance' and ra.principal_kind = 'account' and a.state = 'active'
      and (ra.expires_at is null or ra.expires_at > now())`);
  const holders = roles.rows
    .filter((row) => {
      const areas = row.built_in_role ? builtInRoleAreas("instance", row.built_in_role) : (row.areas ?? {});
      return areas.signInAndSecurity !== undefined;
    })
    .map((row) => row.id);
  return [...new Set([...owner.rows.map((row) => row.id), ...holders])].sort();
}
