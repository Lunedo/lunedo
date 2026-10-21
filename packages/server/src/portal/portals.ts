import { createHash } from "node:crypto";
import {
  type AccentColor,
  accentColors,
  type BrandCheck,
  type BrandMode,
  checkBrandColor,
  normalizeHex,
  proposeBrandColor,
} from "@pagehall/shared";
import { tokens } from "@pagehall/tokens";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor } from "../database/database.js";
import type { NotificationListener } from "../database/notifications.js";
import type { ArticleLanguage } from "../knowledge-bases/translations.js";
import { logoContentType } from "../organizations/organizations.js";
import { supportedLanguages, timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { auditScopeOf, isUniqueViolation, SpaceError } from "../spaces/common.js";
import type { KnowledgeBaseAudience } from "../spaces/schema.js";
import { helpKnowledgeBaseSetting } from "./settings.js";

export const brandColors = [...accentColors, "custom"] as const;
export type BrandColor = (typeof brandColors)[number];

export const LOGO_MAX_BYTES = 256 * 1024;
export const PORTAL_PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PORTAL_PATH_MAX = 60;
export const TOP_BAR_THRESHOLD_MAX = 100;
export const FEEDBACK_RETENTION_MAX = 60;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PATH_LOCK = "pagehall.knowledge-base.paths";

export type PortalLanguage = (typeof supportedLanguages)[number];

export interface PortalBrand {
  color: BrandColor;
  light: string | null;
  dark: string | null;
}

export interface PortalConfig {
  spaceId: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  audience: KnowledgeBaseAudience;
  path: string;
  domain: string | null;
  contactEmail: string | null;
  brand: PortalBrand;
  welcomeHeading: string;
  welcomeText: string;
  topBarThreshold: number;
  poweredBy: boolean;
  feedbackRetentionMonths: number;
  logoRef: string | null;
  organizationLogoRef: string | null;
  defaultLanguage: ArticleLanguage;
  languages: ArticleLanguage[];
  timeZone: string;
}

export function interfaceLanguage(language: string): PortalLanguage {
  return (supportedLanguages as readonly string[]).includes(language) ? (language as PortalLanguage) : "en";
}

export type PathLookup = { type: "found"; config: PortalConfig } | { type: "moved"; path: string };

export interface PortalDomain {
  domain: string;
  organizationId: string;
  organizationName: string;
  spaceId: string | null;
  spaceName: string | null;
  createdAt: Date;
}

export interface HelpCandidate {
  spaceId: string;
  name: string;
  audience: KnowledgeBaseAudience;
  path: string;
  domain: string | null;
}

export interface AppearanceInput {
  brand?: PortalBrand;
  confirmProposal?: boolean;
  welcomeHeading?: string;
  welcomeText?: string;
  topBarThreshold?: number;
  poweredBy?: boolean;
  feedbackRetentionMonths?: number;
}

export interface BrandModeCheck extends BrandCheck {
  color: string;
  proposal: string | null;
}

export function brandPair(mode: BrandMode): { background: string; onBrand: string } {
  return { background: tokens.color[mode].bg, onBrand: tokens.color[mode].onAccent };
}

export function brandValues(brand: PortalBrand): Record<BrandMode, string> {
  if (brand.color === "custom" && brand.light && brand.dark) return { light: brand.light, dark: brand.dark };
  const key: AccentColor = brand.color === "custom" ? "petrol" : brand.color;
  return { light: tokens.color.palette.light[key], dark: tokens.color.palette.dark[key] };
}

export function checkBrand(brand: PortalBrand): Record<BrandMode, BrandModeCheck> {
  const values = brandValues(brand);
  const check = (mode: BrandMode): BrandModeCheck => {
    const color = values[mode];
    const result = checkBrandColor(color, brandPair(mode));
    return {
      color,
      ...result,
      proposal: result.passes ? color : proposeBrandColor(color, mode, brandPair(mode)),
    };
  };
  return { light: check("light"), dark: check("dark") };
}

export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length <= 253 && DOMAIN.test(domain) ? domain : null;
}

export function hostOf(header: string | undefined): string | null {
  if (!header) return null;
  const host = header.trim().toLowerCase();
  const withoutPort = host.startsWith("[") ? host : host.replace(/:\d+$/, "");
  return withoutPort.replace(/\.$/, "") || null;
}

interface ConfigRow extends Record<string, unknown> {
  space_id: string;
  organization_id: string;
  key: string;
  name: string;
  description: string;
  audience: KnowledgeBaseAudience;
  portal_path: string;
  portal_domain: string | null;
  contact_email: string | null;
  brand_color: BrandColor;
  brand_light: string | null;
  brand_dark: string | null;
  welcome_heading: string;
  welcome_text: string;
  top_bar_threshold: number;
  powered_by: boolean;
  feedback_retention_months: number;
  logo_ref: string | null;
  organization_logo_ref: string | null;
  default_language: ArticleLanguage;
  languages: ArticleLanguage[];
}

export const PORTAL_DOMAINS_CHANNEL = "pagehall_portal_domains";

export class PortalService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  #domains: Promise<ReadonlySet<string>> | null = null;
  #caching = false;

  constructor(options: { database: Database; audit: AuditLog; settings: SettingsService }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
  }

  async #select(executor: Executor, condition: ReturnType<typeof sql>): Promise<PortalConfig | null> {
    const result = await executor.execute<ConfigRow>(sql`
      select kb.space_id, s.organization_id, s.key, s.name, s.description, s.audience, kb.portal_path,
        kb.portal_domain, kb.contact_email, kb.brand_color, kb.brand_light, kb.brand_dark, kb.welcome_heading,
        kb.welcome_text, kb.top_bar_threshold, kb.powered_by, kb.feedback_retention_months, kb.logo_ref,
        o.logo_ref as organization_logo_ref, kb.default_language, kb.languages
      from knowledge_bases kb join spaces s on s.id = kb.space_id join organizations o on o.id = s.organization_id
      where s.deleted_at is null and s.archived_at is null and not s.quarantined and s.type = 'knowledgeBase' and ${condition}`);
    const row = result.rows[0];
    if (!row) return null;
    const chain = { organization: row.organization_id };
    const timeZone = await this.#settings.get(timeZoneSetting, chain);
    return {
      spaceId: row.space_id,
      organizationId: row.organization_id,
      key: row.key,
      name: row.name,
      description: row.description,
      audience: row.audience,
      path: row.portal_path,
      domain: row.portal_domain,
      contactEmail: row.contact_email,
      brand: { color: row.brand_color, light: row.brand_light, dark: row.brand_dark },
      welcomeHeading: row.welcome_heading,
      welcomeText: row.welcome_text,
      topBarThreshold: row.top_bar_threshold,
      poweredBy: row.powered_by,
      feedbackRetentionMonths: row.feedback_retention_months,
      logoRef: row.logo_ref,
      organizationLogoRef: row.organization_logo_ref,
      defaultLanguage: row.default_language,
      languages: row.languages,
      timeZone,
    };
  }

  config(spaceId: string, executor: Executor = this.#database): Promise<PortalConfig | null> {
    return this.#select(executor, sql`kb.space_id = ${spaceId}`);
  }

  configOfItem(itemId: string): Promise<PortalConfig | null> {
    return this.#select(
      this.#database,
      sql`kb.space_id = (select space_id from tree_items where id = ${itemId})`,
    );
  }

  async byPath(path: string): Promise<PathLookup | null> {
    const normalized = path.toLowerCase();
    if (!PORTAL_PATH.test(normalized)) return null;
    const config = await this.#select(this.#database, sql`kb.portal_path = ${normalized}`);
    if (config) return { type: "found", config };
    const moved = await this.#database.execute<{ portal_path: string }>(sql`
      select kb.portal_path from knowledge_base_paths p join knowledge_bases kb on kb.space_id = p.space_id
      join spaces s on s.id = kb.space_id
      where p.path = ${normalized} and s.deleted_at is null and s.archived_at is null`);
    const target = moved.rows[0]?.portal_path;
    return target ? { type: "moved", path: target } : null;
  }

  byDomain(domain: string): Promise<PortalConfig | null> {
    return this.#select(this.#database, sql`kb.portal_domain = ${domain}`);
  }

  async enableDomainCache(listener: NotificationListener): Promise<void> {
    await listener.listen(PORTAL_DOMAINS_CHANNEL, () => {
      this.#domains = null;
    });
    listener.onReconnect(() => {
      this.#domains = null;
    });
    this.#caching = true;
  }

  async isPortalDomain(host: string): Promise<boolean> {
    if (!this.#caching) {
      const result = await this.#database.execute<{ found: boolean }>(
        sql`select exists (select 1 from portal_domains where domain = ${host}) as found`,
      );
      return result.rows[0]?.found ?? false;
    }
    if (!this.#domains) {
      const loading = this.#database
        .execute<{ domain: string }>(sql`select domain from portal_domains`)
        .then((result) => new Set(result.rows.map((row) => row.domain)));
      this.#domains = loading;
      loading.catch(() => {
        if (this.#domains === loading) this.#domains = null;
      });
    }
    return (await this.#domains).has(host);
  }

  async setAddress(
    actor: Principal,
    spaceId: string,
    input: { path: string; domain: string | null },
  ): Promise<PortalConfig> {
    const path = input.path.trim().toLowerCase();
    if (!PORTAL_PATH.test(path) || path.length > PORTAL_PATH_MAX) {
      throw new SpaceError(
        "invalidPortalPath",
        "Use lowercase letters, digits and single hyphens, at most 60 characters",
      );
    }
    const domain = input.domain === null || input.domain.trim() === "" ? null : normalizeDomain(input.domain);
    if (input.domain !== null && input.domain.trim() !== "" && domain === null) {
      throw new SpaceError("invalidPortalDomain", "Enter a domain name without https:// and without a path");
    }
    try {
      return await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${PATH_LOCK}, 0))`);
        const current = await this.config(spaceId, tx);
        if (!current) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
        const taken = await tx.execute<{ taken: boolean }>(sql`
          select exists (select 1 from knowledge_bases where portal_path = ${path} and space_id <> ${spaceId}) as taken`);
        const retired = await tx.execute<{ reserved: boolean }>(sql`
          select exists (select 1 from knowledge_base_paths p join spaces s on s.id = p.space_id
              where p.path = ${path} and s.organization_id <> ${current.organizationId})
            or exists (select 1 from portal_path_reservations r
              where r.path = ${path} and r.organization_id <> ${current.organizationId}) as reserved`);
        if (taken.rows[0]?.taken || retired.rows[0]?.reserved) {
          throw new SpaceError("portalPathTaken", "Another knowledge base already uses this path");
        }
        if (domain !== null && domain !== current.domain) {
          const allowed = await tx.execute<{ organization_id: string; space_id: string | null }>(sql`
            select d.organization_id, kb.space_id from portal_domains d
            left join knowledge_bases kb on kb.portal_domain = d.domain
            where d.domain = ${domain} for update of d`);
          const row = allowed.rows[0];
          if (!row || row.organization_id !== current.organizationId) {
            throw new SpaceError(
              "portalDomainNotAllowed",
              "Your instance administrator has not allowed this domain for the organization",
            );
          }
          if (row.space_id !== null && row.space_id !== spaceId) {
            throw new SpaceError("portalDomainTaken", "Another knowledge base already uses this domain");
          }
        }
        if (path === current.path && domain === current.domain) return current;
        if (path !== current.path) {
          await tx.execute(sql`delete from knowledge_base_paths where path = ${path}`);
          await tx.execute(sql`delete from portal_path_reservations where path = ${path}`);
          await tx.execute(sql`
            insert into knowledge_base_paths (path, space_id) values (${current.path}, ${spaceId})
            on conflict (path) do update set space_id = excluded.space_id, created_at = now()`);
        }
        await tx.execute(sql`
          update knowledge_bases set portal_path = ${path}, portal_domain = ${domain}, updated_at = now()
          where space_id = ${spaceId}`);
        await this.#audit.record(tx, {
          name: "knowledgeBase.portalAddressChanged",
          actor,
          targetId: spaceId,
          scope: auditScopeOf(current),
          fields: {
            name: current.name,
            path,
            previousPath: current.path,
            domain,
            previousDomain: current.domain,
          },
        });
        const updated = await this.config(spaceId, tx);
        if (!updated) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error, "knowledge_bases_portal_domain_unique")) {
        throw new SpaceError("portalDomainTaken", "Another knowledge base already uses this domain");
      }
      if (isUniqueViolation(error, "knowledge_bases_portal_path_unique")) {
        throw new SpaceError("portalPathTaken", "Another knowledge base already uses this path");
      }
      throw error;
    }
  }

  async updateAppearance(spaceId: string, input: AppearanceInput): Promise<PortalConfig> {
    const current = await this.config(spaceId);
    if (!current) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    const changes: ReturnType<typeof sql>[] = [];
    if (input.brand) changes.push(...this.#brandChanges(input.brand, input.confirmProposal ?? false));
    if (input.welcomeHeading !== undefined) {
      const value = input.welcomeHeading.trim();
      if (value.length > 120)
        throw new SpaceError("invalidWelcome", "The heading has at most 120 characters");
      changes.push(sql`welcome_heading = ${value}`);
    }
    if (input.welcomeText !== undefined) {
      const value = input.welcomeText.trim();
      if (value.length > 400) throw new SpaceError("invalidWelcome", "The text has at most 400 characters");
      changes.push(sql`welcome_text = ${value}`);
    }
    if (input.topBarThreshold !== undefined) {
      if (!Number.isInteger(input.topBarThreshold) || input.topBarThreshold < 1) {
        throw new SpaceError("invalidTopBarThreshold", "Enter a whole number from 1 to 100");
      }
      changes.push(sql`top_bar_threshold = ${Math.min(input.topBarThreshold, TOP_BAR_THRESHOLD_MAX)}`);
    }
    if (input.poweredBy !== undefined) changes.push(sql`powered_by = ${input.poweredBy}`);
    if (input.feedbackRetentionMonths !== undefined) {
      const months = input.feedbackRetentionMonths;
      if (!Number.isInteger(months) || months < 1 || months > FEEDBACK_RETENTION_MAX) {
        throw new SpaceError("invalidRetention", "Enter a whole number of months from 1 to 60");
      }
      changes.push(sql`feedback_retention_months = ${months}`);
    }
    if (changes.length > 0) {
      await this.#database.execute(sql`
        update knowledge_bases set ${sql.join(changes, sql`, `)}, updated_at = now() where space_id = ${spaceId}`);
    }
    const updated = await this.config(spaceId);
    if (!updated) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    return updated;
  }

  #brandChanges(brand: PortalBrand, confirmProposal: boolean): ReturnType<typeof sql>[] {
    if (brand.color !== "custom") {
      if (!(accentColors as readonly string[]).includes(brand.color)) {
        throw new SpaceError(
          "invalidBrandColor",
          "Choose a color from the palette or enter an own color value",
        );
      }
      return [sql`brand_color = ${brand.color}`, sql`brand_light = null`, sql`brand_dark = null`];
    }
    const light = brand.light ? normalizeHex(brand.light) : null;
    const dark = brand.dark ? normalizeHex(brand.dark) : null;
    if (!light || !dark) {
      throw new SpaceError("invalidBrandColor", "Enter the color as a hex value such as #0B6F78");
    }
    const checks = checkBrand({ color: "custom", light, dark });
    if (!checks.light.passes || !checks.dark.passes) {
      if (!confirmProposal || !checks.light.proposal || !checks.dark.proposal) {
        throw new SpaceError("brandContrast", "The color does not reach the contrast WCAG AA asks for", {
          light: checks.light,
          dark: checks.dark,
        });
      }
      return [
        sql`brand_color = 'custom'`,
        sql`brand_light = ${checks.light.proposal}`,
        sql`brand_dark = ${checks.dark.proposal}`,
      ];
    }
    return [sql`brand_color = 'custom'`, sql`brand_light = ${light}`, sql`brand_dark = ${dark}`];
  }

  async setLogo(spaceId: string, logo: { contentType: string; data: Buffer }): Promise<PortalConfig> {
    const contentType = logoContentType(logo.data);
    if (contentType === null || contentType !== logo.contentType || logo.data.length > LOGO_MAX_BYTES) {
      throw new SpaceError("invalidLogo", "The logo must be a PNG, JPEG or WebP image of at most 256 KiB");
    }
    const ref = createHash("sha256").update(logo.data).digest("hex").slice(0, 16);
    await this.#database.transaction(async (tx) => {
      const current = await this.config(spaceId, tx);
      if (!current) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
      await tx.execute(sql`
        insert into knowledge_base_logos (space_id, content_type, data, ref)
        values (${spaceId}, ${contentType}, ${logo.data}, ${ref})
        on conflict (space_id) do update set content_type = excluded.content_type, data = excluded.data,
          ref = excluded.ref, updated_at = now()`);
      await tx.execute(
        sql`update knowledge_bases set logo_ref = ${ref}, updated_at = now() where space_id = ${spaceId}`,
      );
    });
    const updated = await this.config(spaceId);
    if (!updated) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    return updated;
  }

  async removeLogo(spaceId: string): Promise<PortalConfig> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`delete from knowledge_base_logos where space_id = ${spaceId}`);
      await tx.execute(
        sql`update knowledge_bases set logo_ref = null, updated_at = now() where space_id = ${spaceId}`,
      );
    });
    const updated = await this.config(spaceId);
    if (!updated) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    return updated;
  }

  async logo(spaceId: string): Promise<{ contentType: string; data: Buffer; ref: string } | null> {
    const result = await this.#database.execute<{ content_type: string; data: Buffer; ref: string }>(
      sql`select content_type, data, ref from knowledge_base_logos where space_id = ${spaceId}`,
    );
    const row = result.rows[0];
    return row ? { contentType: row.content_type, data: row.data, ref: row.ref } : null;
  }

  async helpCandidates(organizationId: string): Promise<HelpCandidate[]> {
    const result = await this.#database.execute<{
      space_id: string;
      name: string;
      audience: KnowledgeBaseAudience;
      portal_path: string;
      portal_domain: string | null;
    }>(sql`
      select kb.space_id, s.name, s.audience, kb.portal_path, kb.portal_domain
      from knowledge_bases kb join spaces s on s.id = kb.space_id
      where s.organization_id = ${organizationId} and s.deleted_at is null and s.archived_at is null
        and s.audience in ('public', 'signedIn')
      order by lower(s.name), s.id`);
    return result.rows.map((row) => ({
      spaceId: row.space_id,
      name: row.name,
      audience: row.audience,
      path: row.portal_path,
      domain: row.portal_domain,
    }));
  }

  async helpTarget(organizationId: string): Promise<HelpCandidate | null> {
    const spaceId = await this.#settings.get(helpKnowledgeBaseSetting, { organization: organizationId });
    if (!spaceId) return null;
    return (
      (await this.helpCandidates(organizationId)).find((candidate) => candidate.spaceId === spaceId) ?? null
    );
  }

  async setHelpTarget(organizationId: string, spaceId: string | null): Promise<HelpCandidate | null> {
    if (spaceId !== null) {
      const candidate = (await this.helpCandidates(organizationId)).find(
        (entry) => entry.spaceId === spaceId,
      );
      if (!candidate) {
        throw new SpaceError(
          "invalidHelpKnowledgeBase",
          "Choose a knowledge base of this organization that everyone signed in may read",
        );
      }
    }
    await this.#settings.set(
      helpKnowledgeBaseSetting,
      { organization: organizationId },
      "organization",
      spaceId ?? "",
    );
    return this.helpTarget(organizationId);
  }

  async domains(organizationId?: string): Promise<PortalDomain[]> {
    const result = await this.#database.execute<{
      domain: string;
      organization_id: string;
      organization_name: string;
      space_id: string | null;
      space_name: string | null;
      created_at: Date;
    }>(sql`
      select d.domain, d.organization_id, o.name as organization_name, kb.space_id, s.name as space_name, d.created_at
      from portal_domains d join organizations o on o.id = d.organization_id
      left join knowledge_bases kb on kb.portal_domain = d.domain
      left join spaces s on s.id = kb.space_id
      where ${organizationId ? sql`d.organization_id = ${organizationId}` : sql`true`}
      order by d.domain`);
    return result.rows.map((row) => ({
      domain: row.domain,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      spaceId: row.space_id,
      spaceName: row.space_name,
      createdAt: new Date(row.created_at),
    }));
  }

  async allowDomain(
    actor: Principal,
    input: { domain: string; organizationId: string },
  ): Promise<PortalDomain> {
    const domain = normalizeDomain(input.domain);
    if (!domain)
      throw new SpaceError("invalidPortalDomain", "Enter a domain name without https:// and without a path");
    try {
      await this.#database.transaction(async (tx) => {
        const organization = await tx.execute<{ id: string }>(
          sql`select id from organizations where id = ${input.organizationId}`,
        );
        if (!organization.rows[0])
          throw new SpaceError("organizationNotFound", "The organization does not exist");
        await tx.execute(sql`
          insert into portal_domains (domain, organization_id, created_by)
          values (${domain}, ${input.organizationId}, ${actor.type === "account" ? actor.id : null})`);
        await this.#audit.record(tx, {
          name: "organization.portalDomainAllowed",
          actor,
          targetId: input.organizationId,
          scope: { type: "organization", id: input.organizationId },
          fields: { domain },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, "portal_domains_pkey")) {
        throw new SpaceError("portalDomainExists", "This domain is already allowed");
      }
      throw error;
    }
    const found = (await this.domains()).find((entry) => entry.domain === domain);
    if (!found) throw new SpaceError("portalDomainNotFound", "The domain is not allowed");
    return found;
  }

  async removeDomain(actor: Principal, domain: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const result = await tx.execute<{ organization_id: string; space_id: string | null }>(sql`
        select d.organization_id, kb.space_id from portal_domains d
        left join knowledge_bases kb on kb.portal_domain = d.domain
        where d.domain = ${domain.toLowerCase()} for update of d`);
      await tx.execute(sql`delete from portal_domains where domain = ${domain.toLowerCase()}`);
      const row = result.rows[0];
      if (!row) throw new SpaceError("portalDomainNotFound", "The domain is not allowed");
      await this.#audit.record(tx, {
        name: "organization.portalDomainRemoved",
        actor,
        targetId: row.organization_id,
        scope: { type: "organization", id: row.organization_id },
        fields: { domain: domain.toLowerCase(), spaceId: row.space_id },
      });
    });
  }
}
