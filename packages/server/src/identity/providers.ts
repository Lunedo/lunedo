import { createHash } from "node:crypto";
import {
  clientSecretSchema,
  ENTRA_AUTHORITY,
  GOOGLE_ISSUER,
  identityProviderNameSchema,
  type OidcConfig,
  type OidcConfigInput,
  oidcConfigSchema,
  uuidv7,
} from "@pagehall/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { NotificationService } from "../notifications/service.js";
import { LOGO_MAX_BYTES, logoContentType, OrganizationError } from "../organizations/organizations.js";
import { organizations } from "../organizations/schema.js";
import type { ProviderCredential, ProviderDefinition } from "./adapter.js";
import { generateCertificate } from "./certificates.js";
import { oidcIssuer } from "./oidc.js";
import {
  identityProviderCredentials,
  identityProviderLogos,
  identityProviderOrganizations,
  identityProviders,
} from "./schema.js";

export type ProviderScope = { level: "instance" } | { level: "organization"; organizationId: string };

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
  level: "instance" | "organization";
  organizationId: string | null;
  name: string;
  config: OidcConfig;
  issuer: string;
  callbackPath: string;
  logoRef: string | null;
  credentials: CredentialSummary[];
  warnings: ProviderWarning[];
  organizationIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationProvider {
  id: string;
  name: string;
  preset: OidcConfig["preset"];
  level: "instance" | "organization";
  logoRef: string | null;
  enabled: boolean;
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

function credentialContext(id: string): string {
  return `identity_provider_credentials.secret:${id}`;
}

function scopeOf(provider: { level: string; organizationId: string | null }) {
  return provider.level === "organization" && provider.organizationId
    ? { scope: { type: "organization" as const, id: provider.organizationId } }
    : {};
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

  constructor(options: {
    database: Database;
    audit: AuditLog;
    encryption: Encryption;
    notifications: NotificationService;
    allowInsecure: boolean;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#encryption = options.encryption;
    this.#notifications = options.notifications;
    this.#allowInsecure = options.allowInsecure;
    this.#clock = options.clock ?? (() => new Date());
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

  async #find(executor: Executor, scope: ProviderScope, id: string, lock = false) {
    const query = executor
      .select()
      .from(identityProviders)
      .where(
        and(
          eq(identityProviders.id, id),
          scope.level === "instance"
            ? eq(identityProviders.level, "instance")
            : and(
                eq(identityProviders.level, "organization"),
                eq(identityProviders.organizationId, scope.organizationId),
              ),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
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
    const availability =
      ids.length === 0
        ? []
        : await executor
            .select({
              providerId: identityProviderOrganizations.providerId,
              organizationId: identityProviderOrganizations.organizationId,
            })
            .from(identityProviderOrganizations)
            .where(inArray(identityProviderOrganizations.providerId, ids))
            .orderBy(asc(identityProviderOrganizations.organizationId));
    const now = this.#clock();
    return rows.map((row) => {
      const config = oidcConfigSchema.parse(row.config);
      const own = credentials.get(row.id) ?? [];
      return {
        id: row.id,
        type: row.type,
        level: row.level,
        organizationId: row.organizationId,
        name: row.name,
        config,
        issuer: oidcIssuer(config),
        callbackPath: callbackPath(row.id),
        logoRef: logos.find((logo) => logo.providerId === row.id)?.ref ?? null,
        credentials: own,
        warnings: warningsOf(own, now),
        organizationIds: availability
          .filter((entry) => entry.providerId === row.id)
          .map((entry) => entry.organizationId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async list(scope: ProviderScope): Promise<ProviderSummary[]> {
    const rows = await this.#database
      .select()
      .from(identityProviders)
      .where(
        scope.level === "instance"
          ? eq(identityProviders.level, "instance")
          : eq(identityProviders.organizationId, scope.organizationId),
      )
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return this.#summaries(this.#database, rows);
  }

  async get(scope: ProviderScope, id: string): Promise<ProviderSummary> {
    const row = await this.#find(this.#database, scope, id);
    const [summary] = await this.#summaries(this.#database, [row]);
    if (!summary) throw notFound();
    return summary;
  }

  async create(
    actor: Principal,
    scope: ProviderScope,
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
          level: scope.level,
          organizationId: scope.level === "organization" ? scope.organizationId : null,
          name,
          config,
        })
        .returning();
      if (!row) throw new Error("The identity provider was not created");
      await this.#audit.record(tx, {
        name: "identityProvider.created",
        actor,
        targetId: row.id,
        fields: { name, type: row.type, preset: config.preset, level: row.level },
        ...scopeOf(row),
      });
      if (scope.level === "organization") {
        await tx
          .insert(identityProviderOrganizations)
          .values({ providerId: row.id, organizationId: scope.organizationId, enabled: true });
      }
      const credential = await this.#addCredential(tx, actor, row, input.credential);
      return { id: row.id, credential };
    });
    return { provider: await this.get(scope, created.id), credential: created.credential };
  }

  async update(
    actor: Principal,
    scope: ProviderScope,
    id: string,
    input: { name?: string; config?: unknown },
  ): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, scope, id, true);
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
      await this.#audit.record(tx, {
        name: "identityProvider.updated",
        actor,
        targetId: id,
        fields: {
          name,
          config: config as unknown as Record<string, never>,
          previous: { name: current.name, config: current.config as never },
        },
        ...scopeOf(current),
      });
    });
    return this.get(scope, id);
  }

  async remove(actor: Principal, scope: ProviderScope, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, scope, id, true);
      await this.#audit.record(tx, {
        name: "identityProvider.removed",
        actor,
        targetId: id,
        fields: { name: current.name },
        ...scopeOf(current),
      });
      await tx.delete(identityProviders).where(eq(identityProviders.id, id));
    });
  }

  async setAvailability(actor: Principal, id: string, organizationIds: string[]): Promise<ProviderSummary> {
    const wanted = [...new Set(organizationIds)].sort();
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, { level: "instance" }, id, true);
      if (wanted.length > 0) {
        const existing = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(inArray(organizations.id, wanted));
        if (existing.length !== wanted.length) {
          throw new OrganizationError("notFound", "An organization does not exist");
        }
      }
      const previous = (
        await tx
          .select({ organizationId: identityProviderOrganizations.organizationId })
          .from(identityProviderOrganizations)
          .where(eq(identityProviderOrganizations.providerId, id))
          .orderBy(asc(identityProviderOrganizations.organizationId))
      ).map((row) => row.organizationId);
      const removed = previous.filter((organizationId) => !wanted.includes(organizationId));
      if (removed.length > 0) {
        await tx
          .delete(identityProviderOrganizations)
          .where(
            and(
              eq(identityProviderOrganizations.providerId, id),
              inArray(identityProviderOrganizations.organizationId, removed),
            ),
          );
      }
      const added = wanted.filter((organizationId) => !previous.includes(organizationId));
      if (added.length > 0) {
        await tx
          .insert(identityProviderOrganizations)
          .values(added.map((organizationId) => ({ providerId: id, organizationId, enabled: false })));
      }
      if (added.length > 0 || removed.length > 0) {
        await this.#audit.record(tx, {
          name: "identityProvider.availabilityChanged",
          actor,
          targetId: id,
          fields: { organizationIds: wanted, previousOrganizationIds: previous },
        });
      }
    });
    return this.get({ level: "instance" }, id);
  }

  async organizationProviders(organizationId: string): Promise<OrganizationProvider[]> {
    const rows = await this.#database
      .select({
        id: identityProviders.id,
        name: identityProviders.name,
        preset: identityProviders.preset,
        level: identityProviders.level,
        enabled: identityProviderOrganizations.enabled,
        logoRef: identityProviderLogos.ref,
      })
      .from(identityProviderOrganizations)
      .innerJoin(identityProviders, eq(identityProviders.id, identityProviderOrganizations.providerId))
      .leftJoin(identityProviderLogos, eq(identityProviderLogos.providerId, identityProviders.id))
      .where(eq(identityProviderOrganizations.organizationId, organizationId))
      .orderBy(asc(identityProviders.level), asc(identityProviders.name), asc(identityProviders.id));
    return rows.map((row) => ({ ...row, logoRef: row.logoRef ?? null }));
  }

  async setEnabled(
    actor: Principal,
    organizationId: string,
    providerId: string,
    enabled: boolean,
  ): Promise<OrganizationProvider[]> {
    await this.#database.transaction(async (tx) => {
      const [row] = await tx
        .select({ enabled: identityProviderOrganizations.enabled })
        .from(identityProviderOrganizations)
        .where(
          and(
            eq(identityProviderOrganizations.providerId, providerId),
            eq(identityProviderOrganizations.organizationId, organizationId),
          ),
        )
        .for("update");
      if (!row) throw notFound();
      if (row.enabled === enabled) return;
      await tx
        .update(identityProviderOrganizations)
        .set({ enabled })
        .where(
          and(
            eq(identityProviderOrganizations.providerId, providerId),
            eq(identityProviderOrganizations.organizationId, organizationId),
          ),
        );
      await this.#audit.record(tx, {
        name: "identityProvider.enabledChanged",
        actor,
        targetId: providerId,
        fields: { enabled, previousEnabled: row.enabled },
        scope: { type: "organization", id: organizationId },
      });
    });
    return this.organizationProviders(organizationId);
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
      ...scopeOf(provider),
    });
    return { id: row.id, kind: input.kind, keyId, expiresAt, createdAt: row.createdAt, certificate };
  }

  async addCredential(
    actor: Principal,
    scope: ProviderScope,
    id: string,
    input: CredentialInput,
  ): Promise<AddedCredential> {
    return this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, scope, id, true);
      return this.#addCredential(tx, actor, provider, input);
    });
  }

  async removeCredential(
    actor: Principal,
    scope: ProviderScope,
    id: string,
    credentialId: string,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, scope, id, true);
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
        ...scopeOf(provider),
      });
    });
  }

  async certificate(scope: ProviderScope, id: string, credentialId: string): Promise<string> {
    await this.#find(this.#database, scope, id);
    const [row] = await this.#database
      .select({ certificate: identityProviderCredentials.certificate })
      .from(identityProviderCredentials)
      .where(
        and(eq(identityProviderCredentials.id, credentialId), eq(identityProviderCredentials.providerId, id)),
      );
    if (!row?.certificate) throw new OrganizationError("notFound", "The credential has no certificate");
    return row.certificate;
  }

  async setLogo(
    actor: Principal,
    scope: ProviderScope,
    id: string,
    logo: { contentType: string; data: Buffer },
  ): Promise<string> {
    const contentType = logoContentType(logo.data);
    if (contentType === null || contentType !== logo.contentType || logo.data.length > LOGO_MAX_BYTES) {
      throw new OrganizationError(
        "invalidLogo",
        "The logo must be a PNG, JPEG or WebP image of at most 256 KiB",
      );
    }
    const ref = createHash("sha256").update(logo.data).digest("hex").slice(0, 16);
    await this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, scope, id, true);
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
        ...scopeOf(provider),
      });
    });
    return ref;
  }

  async removeLogo(actor: Principal, scope: ProviderScope, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, scope, id, true);
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
        ...scopeOf(provider),
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
  ): Promise<{ provider: ProviderDefinition; credentials: ProviderCredential[] } | null> {
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
    return {
      provider: {
        id: row.id,
        type: row.type,
        level: row.level,
        organizationId: row.organizationId,
        name: row.name,
        config: oidcConfigSchema.parse(row.config),
      },
      credentials: rows.map((credential) => ({
        id: credential.id,
        kind: credential.kind,
        keyId: credential.keyId,
        secret: this.#encryption.decryptString(credential.secret, credentialContext(credential.id)),
      })),
    };
  }

  async enabledFor(providerId: string, organizationId: string): Promise<boolean> {
    const [row] = await this.#database
      .select({ enabled: identityProviderOrganizations.enabled })
      .from(identityProviderOrganizations)
      .where(
        and(
          eq(identityProviderOrganizations.providerId, providerId),
          eq(identityProviderOrganizations.organizationId, organizationId),
        ),
      );
    return row?.enabled === true;
  }

  async enabledAnywhere(providerId: string): Promise<boolean> {
    const [row] = await this.#database
      .select({ providerId: identityProviderOrganizations.providerId })
      .from(identityProviderOrganizations)
      .where(
        and(
          eq(identityProviderOrganizations.providerId, providerId),
          eq(identityProviderOrganizations.enabled, true),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async enabledProviders(organizationId: string | null): Promise<OrganizationProvider[]> {
    if (organizationId) {
      return (await this.organizationProviders(organizationId)).filter((provider) => provider.enabled);
    }
    const rows = await this.#database
      .selectDistinct({
        id: identityProviders.id,
        name: identityProviders.name,
        preset: identityProviders.preset,
        level: identityProviders.level,
        logoRef: identityProviderLogos.ref,
      })
      .from(identityProviders)
      .innerJoin(
        identityProviderOrganizations,
        eq(identityProviderOrganizations.providerId, identityProviders.id),
      )
      .leftJoin(identityProviderLogos, eq(identityProviderLogos.providerId, identityProviders.id))
      .where(and(eq(identityProviders.level, "instance"), eq(identityProviderOrganizations.enabled, true)))
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return rows.map((row) => ({ ...row, logoRef: row.logoRef ?? null, enabled: true }));
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
            .select({
              id: identityProviders.id,
              name: identityProviders.name,
              organizationId: identityProviders.organizationId,
            })
            .from(identityProviders)
            .where(eq(identityProviders.id, marked.providerId));
          if (!provider) return null;
          const recipients = await ownersOf(tx, provider.organizationId);
          return this.#notifications.notify(tx, {
            type: "identityProvider.credentialExpiring",
            recipients,
            organizationId: provider.organizationId,
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

export async function ownersOf(executor: Executor, organizationId: string | null): Promise<string[]> {
  if (organizationId === null) {
    const result = await executor.execute<{ id: string }>(sql`
      select a.id from instance i join accounts a on a.id = i.owner_account_id where a.state = 'active'`);
    return result.rows.map((row) => row.id);
  }
  const result = await executor.execute<{ id: string }>(sql`
    select distinct a.id from role_assignments ra
    join accounts a on a.id = ra.principal_id
    join memberships m on m.account_id = a.id and m.organization_id = ra.organization_id
    where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
      and ra.built_in_role = 'owner' and a.state = 'active' and m.kind = 'member'`);
  return result.rows.map((row) => row.id);
}
