import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { languageSetting, supportedLanguages, timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { memberships, roleAssignments } from "./access-schema.js";
import { organizationDomains, organizations } from "./schema.js";
import { organizationSettingsChain } from "./settings.js";

export const organizationNameSchema = z.string().trim().min(1).max(100);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "must be lowercase letters, digits and hyphens");
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "must be a domain name");
export const timeZoneSchema = z.string().refine((value) => timeZoneSetting.schema.safeParse(value).success);

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoRef: string | null;
  language: (typeof supportedLanguages)[number];
  timeZone: string;
  createdAt: Date;
}

export class OrganizationError extends Error {
  override name = "OrganizationError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  return details.code === "23505" && details.constraint === constraint;
}

export function slugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "organization";
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@").at(-1) ?? "";
}

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

export class OrganizationService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;

  constructor(options: { database: Database; settings: SettingsService; audit: AuditLog }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#audit = options.audit;
  }

  async #withSettings(row: typeof organizations.$inferSelect): Promise<Organization> {
    const chain = organizationSettingsChain(row.id);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoRef: row.logoRef,
      language: await this.#settings.get(languageSetting, chain),
      timeZone: await this.#settings.get(timeZoneSetting, chain),
      createdAt: row.createdAt,
    };
  }

  async get(id: string, executor: Executor = this.#database): Promise<Organization | null> {
    const [row] = await executor.select().from(organizations).where(eq(organizations.id, id));
    return row ? this.#withSettings(row) : null;
  }

  async list(): Promise<Organization[]> {
    const rows = await this.#database.select().from(organizations).orderBy(organizations.name);
    return Promise.all(rows.map((row) => this.#withSettings(row)));
  }

  async listForAccount(accountId: string): Promise<(Organization & { membershipKind: string })[]> {
    const rows = await this.#database
      .select({ organization: organizations, kind: memberships.kind })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.accountId, accountId),
          or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
        ),
      )
      .orderBy(organizations.name);
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.#withSettings(row.organization)),
        membershipKind: row.kind,
      })),
    );
  }

  async #uniqueSlug(executor: Executor, base: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 60)}-${attempt + 1}`;
      const [taken] = await executor
        .select({ id: organizations.id })
        .from(organizations)
        .where(sql`lower(${organizations.slug}) = ${candidate}`);
      if (!taken) return candidate;
    }
    throw new OrganizationError("slugTaken", "No free slug was found");
  }

  async create(
    tx: Transaction,
    actor: Principal,
    input: { name: string; slug?: string; language?: string; timeZone?: string; ownerAccountId: string },
  ): Promise<Organization> {
    const name = organizationNameSchema.parse(input.name);
    const slug = input.slug ? slugSchema.parse(input.slug) : await this.#uniqueSlug(tx, slugFromName(name));
    const [owner] = await tx
      .select({
        id: accounts.id,
        type: accounts.type,
        state: accounts.state,
        home: accounts.homeOrganizationId,
      })
      .from(accounts)
      .where(eq(accounts.id, input.ownerAccountId))
      .for("update");
    if (owner?.type !== "standard" || owner.state !== "active") {
      throw new OrganizationError("invalidOwner", "The owner must be an active standard account");
    }
    let row: typeof organizations.$inferSelect | undefined;
    try {
      [row] = await tx.insert(organizations).values({ name, slug }).returning();
    } catch (error) {
      if (isUniqueViolation(error, "organizations_slug_unique")) {
        throw new OrganizationError("slugTaken", "The slug is already used by another organization");
      }
      throw error;
    }
    if (!row) throw new Error("The organization was not created");
    const scope = scopeOf(row.id);
    const chain = organizationSettingsChain(row.id);
    if (input.language) {
      await this.#settings.set(
        languageSetting,
        chain,
        "organization",
        z.enum(supportedLanguages).parse(input.language),
        {
          tx,
          audit: false,
        },
      );
    }
    if (input.timeZone) {
      await this.#settings.set(timeZoneSetting, chain, "organization", timeZoneSchema.parse(input.timeZone), {
        tx,
        audit: false,
      });
    }
    if (!owner.home) {
      await tx.update(accounts).set({ homeOrganizationId: row.id }).where(eq(accounts.id, owner.id));
    }
    await tx.insert(memberships).values({
      organizationId: row.id,
      accountId: owner.id,
      kind: "member",
      createdBy: actor.type === "account" ? actor.id : null,
    });
    const [assignment] = await tx
      .insert(roleAssignments)
      .values({
        scope: "organization",
        organizationId: row.id,
        principalKind: "account",
        principalId: owner.id,
        builtInRole: "owner",
        createdBy: actor.type === "account" ? actor.id : null,
      })
      .returning({ id: roleAssignments.id });
    await this.#audit.recordMany(tx, [
      {
        name: "organization.created",
        actor,
        targetId: row.id,
        fields: {
          name,
          slug,
          language: input.language ?? (await this.#settings.get(languageSetting, {})),
          timeZone: input.timeZone ?? (await this.#settings.get(timeZoneSetting, {})),
        },
        scope,
      },
      {
        name: "membership.added",
        actor,
        targetId: owner.id,
        fields: { kind: "member", expiresAt: null },
        scope,
      },
      {
        name: "role.assigned",
        actor,
        targetId: assignment?.id ?? null,
        fields: {
          role: "owner",
          customRoleId: null,
          principalKind: "account",
          principalId: owner.id,
          expiresAt: null,
        },
        scope,
      },
    ]);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoRef: row.logoRef,
      language: z
        .enum(supportedLanguages)
        .parse(input.language ?? (await this.#settings.get(languageSetting, {}))),
      timeZone: input.timeZone ?? (await this.#settings.get(timeZoneSetting, {})),
      createdAt: row.createdAt,
    };
  }

  async createAsActor(
    actor: Principal,
    input: { name: string; slug?: string; language?: string; timeZone?: string; ownerAccountId: string },
  ): Promise<Organization> {
    return this.#database.transaction((tx) => this.create(tx, actor, input));
  }

  async update(
    actor: Principal,
    id: string,
    input: { name?: string; slug?: string; logoRef?: string | null; language?: string; timeZone?: string },
  ): Promise<Organization> {
    const updated = await this.#database.transaction(async (tx) => {
      const [current] = await tx.select().from(organizations).where(eq(organizations.id, id)).for("update");
      if (!current) throw new OrganizationError("notFound", "The organization does not exist");
      const changes = {
        name: input.name === undefined ? current.name : organizationNameSchema.parse(input.name),
        slug: input.slug === undefined ? current.slug : slugSchema.parse(input.slug),
        logoRef: input.logoRef === undefined ? current.logoRef : input.logoRef,
      };
      let row: typeof organizations.$inferSelect | undefined;
      try {
        [row] = await tx
          .update(organizations)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(organizations.id, id))
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, "organizations_slug_unique")) {
          throw new OrganizationError("slugTaken", "The slug is already used by another organization");
        }
        throw error;
      }
      if (!row) throw new Error("The organization was not updated");
      const chain = organizationSettingsChain(id);
      if (input.language !== undefined) {
        await this.#settings.set(
          languageSetting,
          chain,
          "organization",
          z.enum(supportedLanguages).parse(input.language),
          {
            tx,
          },
        );
      }
      if (input.timeZone !== undefined) {
        await this.#settings.set(
          timeZoneSetting,
          chain,
          "organization",
          timeZoneSchema.parse(input.timeZone),
          { tx },
        );
      }
      await this.#audit.record(tx, {
        name: "organization.updated",
        actor,
        targetId: id,
        fields: changes,
        scope: scopeOf(id),
      });
      return row;
    });
    return this.#withSettings(updated);
  }

  async domains(organizationId: string): Promise<string[]> {
    const rows = await this.#database
      .select({ domain: organizationDomains.domain })
      .from(organizationDomains)
      .where(eq(organizationDomains.organizationId, organizationId))
      .orderBy(organizationDomains.domain);
    return rows.map((row) => row.domain);
  }

  async addDomain(actor: Principal, organizationId: string, input: string): Promise<string> {
    const domain = domainSchema.parse(input);
    return this.#database.transaction(async (tx) => {
      const inserted = await tx
        .insert(organizationDomains)
        .values({ domain, organizationId })
        .onConflictDoNothing()
        .returning({ domain: organizationDomains.domain });
      if (inserted.length === 0) {
        throw new OrganizationError("domainTaken", "The domain is already assigned to an organization");
      }
      await this.#audit.record(tx, {
        name: "organization.domainAdded",
        actor,
        targetId: organizationId,
        fields: { domain },
        scope: scopeOf(organizationId),
      });
      return domain;
    });
  }

  async removeDomain(actor: Principal, organizationId: string, input: string): Promise<boolean> {
    const domain = input.trim().toLowerCase();
    return this.#database.transaction(async (tx) => {
      const deleted = await tx
        .delete(organizationDomains)
        .where(
          and(eq(organizationDomains.domain, domain), eq(organizationDomains.organizationId, organizationId)),
        )
        .returning({ domain: organizationDomains.domain });
      if (deleted.length === 0) return false;
      await this.#audit.record(tx, {
        name: "organization.domainRemoved",
        actor,
        targetId: organizationId,
        fields: { domain },
        scope: scopeOf(organizationId),
      });
      return true;
    });
  }

  async organizationForEmail(email: string, executor: Executor = this.#database): Promise<string | null> {
    const [row] = await executor
      .select({ organizationId: organizationDomains.organizationId })
      .from(organizationDomains)
      .where(eq(organizationDomains.domain, emailDomain(email)));
    return row?.organizationId ?? null;
  }
}
