import "reflect-metadata";
import { createHash } from "node:crypto";
import {
  caCertificateSchema,
  clientSecretSchema,
  directoryPasswordSchema,
  ENTRA_AUTHORITY,
  GOOGLE_ISSUER,
  googleServiceAccountKeySchema,
  type IdentityProviderType,
  identityProviderNameSchema,
  type LdapConfig,
  ldapConfigSchema,
  type OidcConfig,
  oidcConfigSchema,
  providerConfigSchema,
  providerDraftFieldsSchema,
  providerPresets,
  SAML_METADATA_REFRESH_HOURS,
  type SamlConfig,
  samlConfigSchema,
  samlMetadataXmlSchema,
  uuidv7,
} from "@pagehall/shared";
import * as x509 from "@peculiar/x509";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Principal, SYSTEM } from "../accounts/principal.js";
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
import {
  type ProviderCapabilities,
  type ProviderCredential,
  type ProviderDefinition,
  plainText,
} from "./adapter.js";
import { generateCertificate } from "./certificates.js";
import { foreignDirectoryEndpoint, foreignGraphEndpoint } from "./directory.js";
import { emptyReport, type GroupMappingService } from "./groups.js";
import { ldapCapabilities } from "./ldap.js";
import { oidcCapabilities, oidcIssuer } from "./oidc.js";
import { samlCapabilities, samlPaths } from "./saml.js";
import {
  type CertificateInfo,
  certificateInfo,
  fetchSamlMetadata,
  parseSamlMetadata,
  SamlMetadataError,
} from "./saml-metadata.js";
import {
  identities,
  identityProviderCaCertificates,
  identityProviderCredentials,
  identityProviderDomains,
  identityProviderLogos,
  identityProviderSecrets,
  identityProviders,
  managedGroups,
  mappingRules,
  providerSyncRuns,
  samlMetadata,
  scimTokens,
} from "./schema.js";
import { accountsWithoutOtherSignIn } from "./sign-in-ways.js";

export type ProviderWarning =
  | "noCredential"
  | "credentialExpiring"
  | "credentialExpired"
  | "metadataRefreshFailed"
  | "caCertificateExpiring"
  | "noGraphCredential";

export type CredentialKind = "clientSecret" | "certificate" | "samlSigning" | "bindPassword";

export interface CredentialSummary {
  id: string;
  kind: CredentialKind;
  keyId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  inUse: boolean;
  chosen: boolean;
}

export interface SamlSummary {
  acsPath: string;
  metadataPath: string;
  identityProvider: {
    entityId: string;
    ssoUrl: string;
    certificates: CertificateInfo[];
    fetchedAt: Date;
    refreshFailedAt: Date | null;
    refreshError: string | null;
  } | null;
}

export interface LdapSummary {
  caCertificate: CertificateInfo | null;
}

interface ProviderSummaryBase {
  id: string;
  name: string;
  issuer: string;
  callbackPath: string;
  logoRef: string | null;
  credentials: CredentialSummary[];
  directoryKey: boolean;
  capabilities: ProviderCapabilities;
  scim: boolean;
  deactivatedAt: Date | null;
  setupComplete: boolean;
  warnings: ProviderWarning[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProviderSummary =
  | (ProviderSummaryBase & { type: "oidc"; config: OidcConfig })
  | (ProviderSummaryBase & { type: "saml"; config: SamlConfig; saml: SamlSummary })
  | (ProviderSummaryBase & { type: "ldap"; config: LdapConfig; ldap: LdapSummary });

export interface RemovalPreview {
  accounts: number;
  accountsWithoutSignIn: number;
  groups: number;
  rules: number;
  grants: number;
}

export interface SignInProvider {
  id: string;
  type: IdentityProviderType;
  name: string;
  preset: OidcConfig["preset"] | SamlConfig["preset"] | LdapConfig["preset"];
  logoRef: string | null;
}

export type CredentialInput =
  | { kind: "clientSecret"; secret: string; expiresAt: Date | null }
  | { kind: "certificate"; validDays: number }
  | { kind: "samlSigning"; validDays: number }
  | { kind: "bindPassword"; secret: string };

export interface CreateProviderInput {
  type: IdentityProviderType;
  name: string;
  config: unknown;
  credential?: CredentialInput | null;
  metadataXml?: string | null;
  draftId?: string | null;
}

export interface ProviderDraft {
  id: string;
  type: IdentityProviderType;
  preset: (typeof providerPresets)[IdentityProviderType][number];
  name: string;
  fields: Record<string, unknown>;
  callbackPath: string;
  saml: { acsPath: string; metadataPath: string; signingCredentialId: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

type CredentialGroup = "client" | "signing" | "bind";

function groupOf(kind: CredentialKind): CredentialGroup {
  if (kind === "samlSigning") return "signing";
  if (kind === "bindPassword") return "bind";
  return "client";
}

function primaryGroup(type: IdentityProviderType): CredentialGroup {
  if (type === "saml") return "signing";
  if (type === "ldap") return "bind";
  return "client";
}

function allowedGroups(
  type: IdentityProviderType,
  config: OidcConfig | SamlConfig | LdapConfig,
): CredentialGroup[] {
  if (type === "saml") return config.preset === "entraId" ? ["signing", "client"] : ["signing"];
  return [primaryGroup(type)];
}

const SIGNING_VALID_DAYS = 2 * 365;

export interface AddedCredential extends Omit<CredentialSummary, "inUse" | "chosen"> {
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

export const samlMetadataRefreshJob = defineJob({
  name: "identity-providers.refresh-saml-metadata",
  payload: z.object({}),
  retryLimit: 1,
});

export const SAML_METADATA_REFRESH_SCHEDULE = "17 * * * *";

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

function invalidConfiguration(message: string, fields: string[]): OrganizationError {
  return new OrganizationError("invalidProviderConfiguration", message, { fields });
}

export function parseCaCertificates(pem: string): { pem: string; info: CertificateInfo } {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0 || blocks.length > 20) {
    throw new OrganizationError(
      "invalidCertificate",
      "The file must contain one to twenty certificates in PEM format",
    );
  }
  const infos: CertificateInfo[] = [];
  for (const block of blocks) {
    let certificate: x509.X509Certificate;
    try {
      certificate = new x509.X509Certificate(block);
    } catch {
      throw new OrganizationError("invalidCertificate", "A certificate in the file cannot be read");
    }
    const constraints = certificate.getExtension(x509.BasicConstraintsExtension);
    if (!constraints?.ca) {
      throw new OrganizationError(
        "invalidCertificate",
        "Upload the certificate of the certificate authority, not the certificate of the server",
      );
    }
    infos.push(certificateInfo(block));
  }
  const first = infos[0];
  if (!first) throw new OrganizationError("invalidCertificate", "The file contains no certificate");
  const expiresAt = new Date(Math.min(...infos.map((info) => info.expiresAt.getTime())));
  return { pem: `${blocks.join("\n")}\n`, info: { ...first, expiresAt } };
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
  readonly #fetch: typeof fetch | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    encryption: Encryption;
    notifications: NotificationService;
    settings: SettingsService;
    allowInsecure: boolean;
    clock?: () => Date;
    mapping?: GroupMappingService;
    fetch?: typeof fetch;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#encryption = options.encryption;
    this.#notifications = options.notifications;
    this.#allowInsecure = options.allowInsecure;
    this.#clock = options.clock ?? (() => new Date());
    this.#mapping = options.mapping;
    this.#settings = options.settings;
    this.#fetch = options.fetch;
  }

  #parseConfig(type: IdentityProviderType, input: unknown): OidcConfig | SamlConfig | LdapConfig {
    const parsed = providerConfigSchema(type).safeParse(input);
    if (!parsed.success) {
      throw invalidConfiguration(
        "The provider configuration is not valid",
        parsed.error.issues.map((issue) => issue.path.join(".")),
      );
    }
    const config = parsed.data;
    if (type === "oidc") return this.#checkOidc(config as OidcConfig);
    if (type === "saml") return this.#checkSaml(config as SamlConfig);
    return this.#checkLdap(config as LdapConfig);
  }

  #checkSaml(config: SamlConfig): SamlConfig {
    if (this.#allowInsecure) return config;
    if (config.metadata.source === "url" && new URL(config.metadata.url).protocol !== "https:") {
      throw invalidConfiguration("Metadata must be loaded through HTTPS", ["metadata.url"]);
    }
    if (config.preset === "entraId") {
      if (!MICROSOFT_AUTHORITIES.includes(config.authority)) {
        throw invalidConfiguration("The authority is not a Microsoft cloud", ["authority"]);
      }
      if (foreignGraphEndpoint(config.authority, config.graphUrl)) {
        throw invalidConfiguration("The directory endpoint is not one of the provider's own endpoints", [
          "graphUrl",
        ]);
      }
    }
    return config;
  }

  #checkLdap(config: LdapConfig): LdapConfig {
    if (this.#allowInsecure) return config;
    if (new URL(config.url).protocol === "ldap:" && !config.startTls) {
      throw invalidConfiguration("Directories must be reached through LDAPS or StartTLS", [
        "url",
        "startTls",
      ]);
    }
    return config;
  }

  #checkOidc(config: OidcConfig): OidcConfig {
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

  async #find(
    executor: Executor,
    id: string,
    lock = false,
    drafts: "exclude" | "include" | "only" = "exclude",
  ) {
    const query = executor
      .select()
      .from(identityProviders)
      .where(
        and(
          eq(identityProviders.id, id),
          drafts === "exclude" ? isNotNull(identityProviders.config) : undefined,
          drafts === "only" ? isNull(identityProviders.config) : undefined,
        ),
      );
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
        chosenAt: identityProviderCredentials.chosenAt,
      })
      .from(identityProviderCredentials)
      .where(inArray(identityProviderCredentials.providerId, providerIds))
      .orderBy(desc(identityProviderCredentials.createdAt), desc(identityProviderCredentials.id));
    const now = this.#clock();
    const usable = (row: (typeof rows)[number]) => !row.expiresAt || row.expiresAt > now;
    for (const providerId of new Set(rows.map((row) => row.providerId))) {
      const own = rows.filter((row) => row.providerId === providerId);
      const inUse = new Set<string>();
      for (const group of new Set(own.map((row) => groupOf(row.kind)))) {
        const candidates = own.filter((row) => groupOf(row.kind) === group && usable(row));
        const chosen = candidates
          .filter((row) => row.chosenAt !== null)
          .sort((a, b) => (b.chosenAt?.getTime() ?? 0) - (a.chosenAt?.getTime() ?? 0))[0];
        const used = chosen ?? candidates[0];
        if (used) inUse.add(used.id);
      }
      map.set(
        providerId,
        own.map(({ providerId: _providerId, chosenAt, ...credential }) => ({
          ...credential,
          inUse: inUse.has(credential.id),
          chosen: chosenAt !== null && (!credential.expiresAt || credential.expiresAt > now),
        })),
      );
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
    const metadata =
      ids.length === 0
        ? []
        : await executor.select().from(samlMetadata).where(inArray(samlMetadata.providerId, ids));
    const authorities =
      ids.length === 0
        ? []
        : await executor
            .select()
            .from(identityProviderCaCertificates)
            .where(inArray(identityProviderCaCertificates.providerId, ids));
    const scim = new Set(
      ids.length === 0
        ? []
        : (
            await executor
              .selectDistinct({ providerId: scimTokens.providerId })
              .from(scimTokens)
              .where(
                and(
                  inArray(scimTokens.providerId, ids),
                  or(isNull(scimTokens.expiresAt), sql`${scimTokens.expiresAt} > now()`),
                ),
              )
          ).map((row) => row.providerId),
    );
    const now = this.#clock();
    return rows.map((row): ProviderSummary => {
      const own = credentials.get(row.id) ?? [];
      const directoryKey = keys.some((key) => key.providerId === row.id);
      const base = {
        id: row.id,
        name: row.name,
        callbackPath: callbackPath(row.id),
        logoRef: logos.find((logo) => logo.providerId === row.id)?.ref ?? null,
        credentials: own,
        directoryKey,
        scim: scim.has(row.id),
        deactivatedAt: row.deactivatedAt,
        setupComplete: row.setupCompletedAt !== null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (row.type === "saml") {
        const config = samlConfigSchema.parse(row.config);
        const stored = metadata.find((entry) => entry.providerId === row.id);
        const warnings = this.#credentialWarnings("saml", config, own, now);
        if (stored?.refreshFailedAt) warnings.push("metadataRefreshFailed");
        const paths = samlPaths(row.id);
        return {
          ...base,
          type: "saml",
          config,
          issuer: stored?.entityId ?? (config.metadata.source === "url" ? config.metadata.url : ""),
          callbackPath: paths.acs,
          capabilities: samlCapabilities(
            config,
            own.some((credential) => groupOf(credential.kind) === "client"),
          ),
          warnings,
          saml: {
            acsPath: paths.acs,
            metadataPath: paths.metadata,
            identityProvider: stored
              ? {
                  entityId: stored.entityId,
                  ssoUrl: stored.ssoUrl,
                  certificates: stored.certificates.map((pem) => certificateInfo(pem)),
                  fetchedAt: stored.fetchedAt,
                  refreshFailedAt: stored.refreshFailedAt,
                  refreshError: stored.refreshError,
                }
              : null,
          },
        };
      }
      if (row.type === "ldap") {
        const config = ldapConfigSchema.parse(row.config);
        const authority = authorities.find((entry) => entry.providerId === row.id);
        const warnings = this.#credentialWarnings("ldap", config, own, now);
        if (authority && authority.expiresAt.getTime() < now.getTime() + WARNING_DAYS * DAY_MS) {
          warnings.push("caCertificateExpiring");
        }
        return {
          ...base,
          type: "ldap",
          config,
          issuer: config.url,
          capabilities: ldapCapabilities(config),
          warnings,
          ldap: {
            caCertificate: authority
              ? {
                  fingerprint: authority.fingerprint,
                  subject: authority.subject,
                  expiresAt: authority.expiresAt,
                }
              : null,
          },
        };
      }
      const config = oidcConfigSchema.parse(row.config);
      return {
        ...base,
        type: "oidc",
        config,
        issuer: oidcIssuer(config),
        capabilities: oidcCapabilities(config, directoryKey),
        warnings: warningsOf(own, now),
      };
    });
  }

  #credentialWarnings(
    type: IdentityProviderType,
    config: OidcConfig | SamlConfig | LdapConfig,
    credentials: CredentialSummary[],
    now: Date,
  ): ProviderWarning[] {
    const warnings = new Set<ProviderWarning>(
      warningsOf(
        credentials.filter((credential) => groupOf(credential.kind) === primaryGroup(type)),
        now,
      ),
    );
    if (type === "saml" && config.preset === "entraId" && "graphClientId" in config) {
      const graph = credentials.filter((credential) => groupOf(credential.kind) === "client");
      if (!config.graphClientId || graph.length === 0) warnings.add("noGraphCredential");
      else for (const warning of warningsOf(graph, now)) warnings.add(warning);
    }
    return [...warnings];
  }

  get allowsInsecure(): boolean {
    return this.#allowInsecure;
  }

  async list(): Promise<ProviderSummary[]> {
    const rows = await this.#database
      .select()
      .from(identityProviders)
      .where(isNotNull(identityProviders.config))
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return this.#summaries(this.#database, rows);
  }

  async get(id: string): Promise<ProviderSummary> {
    const row = await this.#find(this.#database, id);
    const [summary] = await this.#summaries(this.#database, [row]);
    if (!summary) throw notFound();
    return summary;
  }

  async #loadMetadata(config: SamlConfig, uploaded: string | null | undefined): Promise<string> {
    try {
      if (config.metadata.source === "url") {
        return await fetchSamlMetadata(config.metadata.url, {
          allowInsecure: this.#allowInsecure,
          ...(this.#fetch ? { fetch: this.#fetch } : {}),
        });
      }
      if (!uploaded) {
        throw new OrganizationError(
          "invalidSamlMetadata",
          "Upload the metadata file of the identity provider",
        );
      }
      const parsed = samlMetadataXmlSchema.safeParse(uploaded);
      if (!parsed.success) throw new OrganizationError("invalidSamlMetadata", "The metadata is too large");
      return parsed.data;
    } catch (error) {
      if (error instanceof SamlMetadataError)
        throw new OrganizationError("invalidSamlMetadata", error.message);
      throw error;
    }
  }

  #parseMetadata(xml: string) {
    try {
      const parsed = parseSamlMetadata(xml);
      if (!this.#allowInsecure && new URL(parsed.ssoUrl).protocol !== "https:") {
        throw new SamlMetadataError("The sign-in address of the identity provider does not use HTTPS");
      }
      return parsed;
    } catch (error) {
      if (error instanceof SamlMetadataError)
        throw new OrganizationError("invalidSamlMetadata", error.message);
      throw error;
    }
  }

  async #storeMetadata(
    tx: Transaction,
    actor: Principal,
    providerId: string,
    source: "url" | "file",
    xml: string,
  ): Promise<void> {
    const parsed = this.#parseMetadata(xml);
    const [previous] = await tx
      .select({ certificates: samlMetadata.certificates, xml: samlMetadata.xml })
      .from(samlMetadata)
      .where(eq(samlMetadata.providerId, providerId))
      .for("update");
    const now = this.#clock();
    const values = {
      xml,
      entityId: parsed.entityId,
      ssoUrl: parsed.ssoUrl,
      certificates: parsed.certificates,
      fetchedAt: now,
    };
    await tx
      .insert(samlMetadata)
      .values({ providerId, ...values })
      .onConflictDoUpdate({
        target: samlMetadata.providerId,
        set: { ...values, refreshFailedAt: null, refreshError: null, updatedAt: now },
      });
    if (previous?.xml === xml) return;
    await this.#audit.record(tx, {
      name: "identityProvider.metadataChanged",
      actor,
      targetId: providerId,
      fields: {
        source,
        entityId: parsed.entityId,
        certificates: parsed.certificates.map((pem) => certificateInfo(pem).fingerprint),
        previousCertificates: (previous?.certificates ?? []).map((pem) => certificateInfo(pem).fingerprint),
      },
    });
  }

  #checkCredential(
    type: IdentityProviderType,
    config: OidcConfig | SamlConfig | LdapConfig,
    input: CredentialInput,
  ): void {
    if (!allowedGroups(type, config).includes(groupOf(input.kind))) {
      throw new OrganizationError("invalidInput", "This kind of credential does not belong to this provider");
    }
  }

  async create(
    actor: Principal,
    input: CreateProviderInput,
  ): Promise<{ provider: ProviderSummary; credential: AddedCredential | null }> {
    const name = identityProviderNameSchema.parse(input.name);
    const type = input.type;
    const config = this.#parseConfig(type, input.config);
    const credential = input.credential ?? null;
    if (credential) this.#checkCredential(type, config, credential);
    if (!credential && type !== "saml") {
      throw new OrganizationError("invalidInput", "The provider needs a credential");
    }
    const metadataXml =
      type === "saml" ? await this.#loadMetadata(config as SamlConfig, input.metadataXml) : null;
    if (metadataXml) this.#parseMetadata(metadataXml);
    const draftId = input.draftId ?? null;
    const created = await this.#database.transaction(async (tx) => {
      let row: typeof identityProviders.$inferSelect | undefined;
      let signing = false;
      if (draftId) {
        const draft = await this.#find(tx, draftId, true, "only");
        if (draft.type !== type) {
          throw invalidConfiguration("The draft belongs to another type of provider", ["type"]);
        }
        [row] = await tx
          .update(identityProviders)
          .set({ name, preset: config.preset, config, draft: null, updatedAt: this.#clock() })
          .where(eq(identityProviders.id, draftId))
          .returning();
        if (!row) throw notFound();
        await this.#audit.record(tx, {
          name: "identityProvider.updated",
          actor,
          targetId: row.id,
          fields: {
            name,
            config: config as unknown as Record<string, never>,
            previous: { name: draft.name },
          },
        });
        signing = (await this.#signingCredentialId(tx, row.id)) !== null;
      } else {
        [row] = await tx
          .insert(identityProviders)
          .values({ type, preset: config.preset, name, config, setupCompletedAt: this.#clock() })
          .returning();
        if (!row) throw new Error("The identity provider was not created");
        await this.#audit.record(tx, {
          name: "identityProvider.created",
          actor,
          targetId: row.id,
          fields: { name, type: row.type, preset: config.preset },
        });
      }
      await this.#syncDomains(tx, row.id, config.domains);
      let added: AddedCredential | null = null;
      if (type === "saml" && metadataXml && !signing) {
        added = await this.#addCredential(tx, actor, row, {
          kind: "samlSigning",
          validDays: SIGNING_VALID_DAYS,
        });
      }
      if (type === "saml" && metadataXml) {
        await this.#storeMetadata(tx, actor, row.id, (config as SamlConfig).metadata.source, metadataXml);
      }
      if (credential) {
        const stored = await this.#addCredential(tx, actor, row, credential);
        added = added ?? stored;
      }
      return { id: row.id, credential: added };
    });
    return { provider: await this.get(created.id), credential: created.credential };
  }

  #draftOf(row: typeof identityProviders.$inferSelect, signingCredentialId: string | null): ProviderDraft {
    const paths = row.type === "saml" ? samlPaths(row.id) : null;
    return {
      id: row.id,
      type: row.type,
      preset: row.preset as ProviderDraft["preset"],
      name: row.name,
      fields: (row.draft ?? {}) as Record<string, unknown>,
      callbackPath: paths ? paths.acs : callbackPath(row.id),
      saml: paths ? { acsPath: paths.acs, metadataPath: paths.metadata, signingCredentialId } : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  #checkPreset(type: IdentityProviderType, preset: string): ProviderDraft["preset"] {
    if (!(providerPresets[type] as readonly string[]).includes(preset)) {
      throw invalidConfiguration("This kind of provider does not exist", ["preset"]);
    }
    return preset as ProviderDraft["preset"];
  }

  async #signingCredentialId(executor: Executor, id: string): Promise<string | null> {
    const [row] = await executor
      .select({ id: identityProviderCredentials.id })
      .from(identityProviderCredentials)
      .where(
        and(
          eq(identityProviderCredentials.providerId, id),
          eq(identityProviderCredentials.kind, "samlSigning"),
        ),
      )
      .orderBy(desc(identityProviderCredentials.createdAt));
    return row?.id ?? null;
  }

  async createDraft(
    actor: Principal,
    input: { type: IdentityProviderType; preset: string; name: string },
  ): Promise<ProviderDraft> {
    const name = identityProviderNameSchema.parse(input.name);
    const preset = this.#checkPreset(input.type, input.preset);
    return this.#database.transaction(async (tx) => {
      const [row] = await tx
        .insert(identityProviders)
        .values({ type: input.type, preset, name, config: null, draft: {} })
        .returning();
      if (!row) throw new Error("The draft was not created");
      await this.#audit.record(tx, {
        name: "identityProvider.created",
        actor,
        targetId: row.id,
        fields: { name, type: row.type, preset },
      });
      const signing =
        row.type === "saml"
          ? await this.#addCredential(tx, actor, row, { kind: "samlSigning", validDays: SIGNING_VALID_DAYS })
          : null;
      return this.#draftOf(row, signing?.id ?? null);
    });
  }

  async drafts(): Promise<ProviderDraft[]> {
    const rows = await this.#database
      .select()
      .from(identityProviders)
      .where(isNull(identityProviders.config))
      .orderBy(desc(identityProviders.createdAt));
    return Promise.all(
      rows.map(async (row) => this.#draftOf(row, await this.#signingCredentialId(this.#database, row.id))),
    );
  }

  async draft(id: string): Promise<ProviderDraft> {
    const row = await this.#find(this.#database, id, false, "only");
    return this.#draftOf(row, await this.#signingCredentialId(this.#database, id));
  }

  async updateDraft(
    id: string,
    input: { name?: string | undefined; preset?: string | undefined; fields?: unknown },
  ): Promise<ProviderDraft> {
    const parsed = input.fields === undefined ? null : providerDraftFieldsSchema.safeParse(input.fields);
    if (parsed && !parsed.success) {
      throw new OrganizationError("invalidInput", "The draft fields are not valid");
    }
    return this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true, "only");
      const [row] = await tx
        .update(identityProviders)
        .set({
          ...(input.name === undefined ? {} : { name: identityProviderNameSchema.parse(input.name) }),
          ...(input.preset === undefined ? {} : { preset: this.#checkPreset(current.type, input.preset) }),
          ...(parsed ? { draft: parsed.data } : {}),
          updatedAt: this.#clock(),
        })
        .where(eq(identityProviders.id, id))
        .returning();
      if (!row) throw notFound();
      return this.#draftOf(row, await this.#signingCredentialId(tx, id));
    });
  }

  async completeSetup(actor: Principal, id: string): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      if (current.setupCompletedAt) return;
      await tx
        .update(identityProviders)
        .set({ setupCompletedAt: this.#clock() })
        .where(eq(identityProviders.id, id));
      await this.#audit.record(tx, {
        name: "identityProvider.setupCompleted",
        actor,
        targetId: id,
        fields: { name: current.name },
      });
    });
    return this.get(id);
  }

  async draftServiceProvider(
    id: string,
  ): Promise<{ provider: ProviderDefinition; credentials: ProviderCredential[] } | null> {
    const [row] = await this.#database
      .select()
      .from(identityProviders)
      .where(and(eq(identityProviders.id, id), isNull(identityProviders.config)));
    if (row?.type !== "saml") return null;
    const signing = await this.#database
      .select()
      .from(identityProviderCredentials)
      .where(
        and(
          eq(identityProviderCredentials.providerId, id),
          eq(identityProviderCredentials.kind, "samlSigning"),
        ),
      )
      .orderBy(desc(identityProviderCredentials.createdAt));
    return {
      provider: {
        id: row.id,
        name: row.name,
        directoryKey: null,
        type: "saml",
        config: samlConfigSchema.parse({
          preset: "generic",
          metadata: { source: "file" },
          identifierAttribute: row.preset === "generic" ? null : "objectGUID",
        }),
        metadata: null,
      },
      credentials: signing.map((credential) => ({
        id: credential.id,
        kind: credential.kind,
        keyId: credential.keyId,
        certificate: credential.certificate,
        secret: this.#encryption.decryptString(credential.secret, credentialContext(credential.id)),
      })),
    };
  }

  async update(
    actor: Principal,
    id: string,
    input: { name?: string; config?: unknown },
  ): Promise<ProviderSummary> {
    const before = await this.#find(this.#database, id);
    const type = before.type;
    const previousConfig = providerConfigSchema(type).parse(before.config);
    const config = input.config === undefined ? previousConfig : this.#parseConfig(type, input.config);
    const metadataXml =
      config.preset !== previousConfig.preset
        ? null
        : type === "saml" &&
            (config as SamlConfig).metadata.source === "url" &&
            JSON.stringify((config as SamlConfig).metadata) !==
              JSON.stringify((previousConfig as SamlConfig).metadata)
          ? await this.#loadMetadata(config as SamlConfig, null)
          : null;
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      const name = input.name === undefined ? current.name : identityProviderNameSchema.parse(input.name);
      if (config.preset !== current.preset) {
        throw invalidConfiguration("The preset of a provider cannot change", ["config.preset"]);
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
      if (metadataXml) await this.#storeMetadata(tx, actor, id, "url", metadataXml);
    });
    return this.get(id);
  }

  async uploadSamlMetadata(actor: Principal, id: string, xml: string): Promise<ProviderSummary> {
    const parsedXml = samlMetadataXmlSchema.safeParse(xml);
    if (!parsedXml.success) {
      throw new OrganizationError("invalidSamlMetadata", "The metadata is empty or too large");
    }
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      if (current.type !== "saml") {
        throw new OrganizationError("invalidProviderConfiguration", "Only SAML providers have metadata");
      }
      if (samlConfigSchema.parse(current.config).metadata.source !== "file") {
        throw new OrganizationError(
          "invalidProviderConfiguration",
          "The provider loads its metadata from an address; switch it to an uploaded file first",
        );
      }
      await this.#storeMetadata(tx, actor, id, "file", parsedXml.data);
    });
    return this.get(id);
  }

  async refreshSamlMetadata(actor: Principal, id: string): Promise<ProviderSummary> {
    const current = await this.#find(this.#database, id);
    if (current.type !== "saml") {
      throw new OrganizationError("invalidProviderConfiguration", "Only SAML providers have metadata");
    }
    const config = samlConfigSchema.parse(current.config);
    if (config.metadata.source !== "url") {
      throw new OrganizationError(
        "invalidProviderConfiguration",
        "Uploaded metadata is replaced by uploading a new file",
      );
    }
    const failure = await this.#refresh(id, config.metadata.url, actor);
    if (failure) throw new OrganizationError("invalidSamlMetadata", failure);
    return this.get(id);
  }

  async #refresh(id: string, url: string, actor: Principal): Promise<string | null> {
    let xml: string;
    try {
      xml = await fetchSamlMetadata(url, {
        allowInsecure: this.#allowInsecure,
        ...(this.#fetch ? { fetch: this.#fetch } : {}),
      });
      this.#parseMetadata(xml);
    } catch (error) {
      const message = plainText(error instanceof Error ? error.message : String(error)).slice(0, 500);
      await this.#database.transaction(async (tx) => {
        await tx
          .update(samlMetadata)
          .set({ refreshFailedAt: this.#clock(), refreshError: message, updatedAt: this.#clock() })
          .where(eq(samlMetadata.providerId, id));
        await this.#audit.record(tx, {
          name: "identityProvider.metadataRefreshFailed",
          actor: SYSTEM,
          targetId: id,
          fields: { url, error: message },
        });
      });
      return message;
    }
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      await this.#storeMetadata(tx, actor, id, "url", xml);
    });
    return null;
  }

  async refreshDueMetadata(): Promise<number> {
    const threshold = new Date(this.#clock().getTime() - SAML_METADATA_REFRESH_HOURS * 60 * 60 * 1000);
    const due = await this.#database
      .select({ id: identityProviders.id, config: identityProviders.config })
      .from(identityProviders)
      .innerJoin(samlMetadata, eq(samlMetadata.providerId, identityProviders.id))
      .where(
        and(
          eq(identityProviders.type, "saml"),
          isNull(identityProviders.deactivatedAt),
          lte(samlMetadata.fetchedAt, threshold),
          or(isNull(samlMetadata.refreshFailedAt), lte(samlMetadata.refreshFailedAt, threshold)),
        ),
      );
    let refreshed = 0;
    for (const row of due) {
      const config = samlConfigSchema.parse(row.config);
      if (config.metadata.source !== "url") continue;
      if ((await this.#refresh(row.id, config.metadata.url, SYSTEM)) === null) refreshed++;
    }
    return refreshed;
  }

  async setCaCertificate(actor: Principal, id: string, pem: string): Promise<ProviderSummary> {
    const input = caCertificateSchema.safeParse(pem);
    if (!input.success) throw new OrganizationError("invalidCertificate", "The file is empty or too large");
    const parsed = parseCaCertificates(input.data);
    await this.#database.transaction(async (tx) => {
      const current = await this.#find(tx, id, true);
      if (current.type !== "ldap") {
        throw new OrganizationError(
          "invalidProviderConfiguration",
          "Only directory providers use a CA certificate",
        );
      }
      const [previous] = await tx
        .select({ fingerprint: identityProviderCaCertificates.fingerprint })
        .from(identityProviderCaCertificates)
        .where(eq(identityProviderCaCertificates.providerId, id));
      const values = {
        certificates: parsed.pem,
        fingerprint: parsed.info.fingerprint,
        subject: parsed.info.subject,
        expiresAt: parsed.info.expiresAt,
      };
      await tx
        .insert(identityProviderCaCertificates)
        .values({ providerId: id, ...values })
        .onConflictDoUpdate({
          target: identityProviderCaCertificates.providerId,
          set: { ...values, updatedAt: this.#clock() },
        });
      await this.#audit.record(tx, {
        name: "identityProvider.caCertificateChanged",
        actor,
        targetId: id,
        fields: {
          action: "set",
          fingerprint: parsed.info.fingerprint,
          subject: parsed.info.subject,
          expiresAt: parsed.info.expiresAt.toISOString(),
          previousFingerprint: previous?.fingerprint ?? null,
        },
      });
    });
    return this.get(id);
  }

  async removeCaCertificate(actor: Principal, id: string): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      const [removed] = await tx
        .delete(identityProviderCaCertificates)
        .where(eq(identityProviderCaCertificates.providerId, id))
        .returning({ fingerprint: identityProviderCaCertificates.fingerprint });
      if (!removed) return;
      await this.#audit.record(tx, {
        name: "identityProvider.caCertificateChanged",
        actor,
        targetId: id,
        fields: {
          action: "removed",
          fingerprint: null,
          subject: null,
          expiresAt: null,
          previousFingerprint: removed.fingerprint,
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
      const current = await this.#find(tx, id, true, "include");
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
    if (provider.config === null) {
      if (input.kind !== "samlSigning") {
        throw new OrganizationError("invalidInput", "Connect the provider before adding credentials");
      }
    } else {
      this.#checkCredential(provider.type, providerConfigSchema(provider.type).parse(provider.config), input);
    }
    if (input.kind === "clientSecret") {
      secret = clientSecretSchema.parse(input.secret);
      expiresAt = input.expiresAt;
      if (expiresAt && expiresAt <= now) {
        throw new OrganizationError("expiryInPast", "The client secret has already expired");
      }
    } else if (input.kind === "bindPassword") {
      const parsed = directoryPasswordSchema.safeParse(input.secret);
      if (!parsed.success)
        throw new OrganizationError("invalidInput", "Enter the password of the service account");
      secret = parsed.data;
      expiresAt = null;
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
    return {
      id: row.id,
      kind: input.kind,
      keyId,
      expiresAt,
      createdAt: row.createdAt,
      certificate,
    };
  }

  async addCredential(actor: Principal, id: string, input: CredentialInput): Promise<AddedCredential> {
    return this.#database.transaction(async (tx) => {
      const provider = await this.#find(tx, id, true);
      return this.#addCredential(tx, actor, provider, input);
    });
  }

  async chooseCredential(
    actor: Principal,
    id: string,
    credentialId: string,
    choice: "this" | "newest",
  ): Promise<ProviderSummary> {
    await this.#database.transaction(async (tx) => {
      await this.#find(tx, id, true);
      const credentials = await tx
        .select({
          id: identityProviderCredentials.id,
          kind: identityProviderCredentials.kind,
          expiresAt: identityProviderCredentials.expiresAt,
        })
        .from(identityProviderCredentials)
        .where(eq(identityProviderCredentials.providerId, id));
      const credential = credentials.find((candidate) => candidate.id === credentialId);
      if (!credential) throw new OrganizationError("notFound", "The credential does not exist");
      if (choice === "this" && credential.expiresAt && credential.expiresAt <= this.#clock()) {
        throw new OrganizationError("credentialExpired", "An expired credential cannot be used");
      }
      const group = credentials
        .filter((candidate) => groupOf(candidate.kind) === groupOf(credential.kind))
        .map((candidate) => candidate.id);
      await tx
        .update(identityProviderCredentials)
        .set({ chosenAt: null })
        .where(inArray(identityProviderCredentials.id, group));
      if (choice === "this") {
        await tx
          .update(identityProviderCredentials)
          .set({ chosenAt: this.#clock() })
          .where(eq(identityProviderCredentials.id, credentialId));
      }
      await this.#audit.record(tx, {
        name: "identityProvider.credentialChosen",
        actor,
        targetId: id,
        fields: { credentialId, kind: credential.kind, automatic: choice === "newest" },
      });
    });
    return this.get(id);
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
      const sameGroup = credentials.filter(
        (candidate) => groupOf(candidate.kind) === groupOf(credential.kind),
      );
      if (sameGroup.length === 1) {
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
    await this.#find(this.#database, id, false, "include");
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
    if (!row || row.config === null) return null;
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
      .orderBy(
        sql`${identityProviderCredentials.chosenAt} desc nulls last`,
        desc(identityProviderCredentials.createdAt),
        desc(identityProviderCredentials.id),
      );
    const [secret] = await this.#database
      .select({ directoryKey: identityProviderSecrets.directoryKey })
      .from(identityProviderSecrets)
      .where(eq(identityProviderSecrets.providerId, id));
    const base = {
      id: row.id,
      name: row.name,
      directoryKey: secret
        ? this.#encryption.decryptString(secret.directoryKey, directoryKeyContext(row.id))
        : null,
    };
    let provider: ProviderDefinition;
    if (row.type === "saml") {
      const [metadata] = await this.#database
        .select({
          entityId: samlMetadata.entityId,
          ssoUrl: samlMetadata.ssoUrl,
          certificates: samlMetadata.certificates,
        })
        .from(samlMetadata)
        .where(eq(samlMetadata.providerId, id));
      provider = {
        ...base,
        type: "saml",
        config: samlConfigSchema.parse(row.config),
        metadata: metadata ?? null,
      };
    } else if (row.type === "ldap") {
      const [authority] = await this.#database
        .select({ certificates: identityProviderCaCertificates.certificates })
        .from(identityProviderCaCertificates)
        .where(eq(identityProviderCaCertificates.providerId, id));
      provider = {
        ...base,
        type: "ldap",
        config: ldapConfigSchema.parse(row.config),
        caCertificates: authority?.certificates ?? null,
      };
    } else {
      provider = { ...base, type: "oidc", config: oidcConfigSchema.parse(row.config) };
    }
    return {
      provider,
      active: row.deactivatedAt === null && row.setupCompletedAt !== null,
      credentials: rows.map((credential) => ({
        id: credential.id,
        kind: credential.kind,
        keyId: credential.keyId,
        certificate: credential.certificate,
        secret: this.#encryption.decryptString(credential.secret, credentialContext(credential.id)),
      })),
    };
  }

  async signInProviders(): Promise<SignInProvider[]> {
    const rows = await this.#database
      .select({
        id: identityProviders.id,
        type: identityProviders.type,
        name: identityProviders.name,
        preset: identityProviders.preset,
        logoRef: identityProviderLogos.ref,
      })
      .from(identityProviders)
      .leftJoin(identityProviderLogos, eq(identityProviderLogos.providerId, identityProviders.id))
      .where(and(isNull(identityProviders.deactivatedAt), isNotNull(identityProviders.setupCompletedAt)))
      .orderBy(asc(identityProviders.name), asc(identityProviders.id));
    return rows.map((row) => ({ ...row, logoRef: row.logoRef ?? null }));
  }

  async providerForDomain(domain: string): Promise<SignInProvider | null> {
    const [row] = await this.#database
      .select({
        id: identityProviders.id,
        type: identityProviders.type,
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
          isNotNull(identityProviders.setupCompletedAt),
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
