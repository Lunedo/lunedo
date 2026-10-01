import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import { memberships } from "../organizations/access-schema.js";
import { lockOrganization } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import { apiTokens, serviceAccounts } from "./schema.js";

export const serviceAccountNameSchema = z.string().trim().min(1).max(200);
export const serviceAccountDescriptionSchema = z.string().trim().max(1000);

export interface ServiceAccount {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  state: string;
  responsibleAccountId: string | null;
  createdAt: Date;
}

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

const columns = {
  id: serviceAccounts.accountId,
  organizationId: serviceAccounts.organizationId,
  name: accounts.name,
  description: serviceAccounts.description,
  state: accounts.state,
  responsibleAccountId: serviceAccounts.responsibleAccountId,
  createdAt: serviceAccounts.createdAt,
};

export class ServiceAccountService {
  readonly #database: Database;
  readonly #audit: AuditLog;

  constructor(options: { database: Database; audit: AuditLog }) {
    this.#database = options.database;
    this.#audit = options.audit;
  }

  async list(organizationId: string): Promise<ServiceAccount[]> {
    return this.#database
      .select(columns)
      .from(serviceAccounts)
      .innerJoin(accounts, eq(accounts.id, serviceAccounts.accountId))
      .where(eq(serviceAccounts.organizationId, organizationId))
      .orderBy(asc(accounts.name), asc(serviceAccounts.accountId));
  }

  async get(id: string): Promise<ServiceAccount | null> {
    const [row] = await this.#database
      .select(columns)
      .from(serviceAccounts)
      .innerJoin(accounts, eq(accounts.id, serviceAccounts.accountId))
      .where(eq(serviceAccounts.accountId, id));
    return row ?? null;
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: { name: string; description?: string },
  ): Promise<ServiceAccount> {
    const name = serviceAccountNameSchema.parse(input.name);
    const description = serviceAccountDescriptionSchema.parse(input.description ?? "");
    const responsible = actor.type === "account" ? actor.id : null;
    return this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const [account] = await tx
        .insert(accounts)
        .values({ type: "service", state: "active", name, homeOrganizationId: organizationId })
        .returning({ id: accounts.id, createdAt: accounts.createdAt });
      if (!account) throw new Error("The service account was not created");
      await tx.insert(memberships).values({
        organizationId,
        accountId: account.id,
        kind: "member",
        createdBy: responsible,
      });
      const [row] = await tx
        .insert(serviceAccounts)
        .values({
          accountId: account.id,
          organizationId,
          description,
          responsibleAccountId: responsible,
          createdBy: responsible,
        })
        .returning({ createdAt: serviceAccounts.createdAt });
      await this.#audit.record(tx, {
        name: "serviceAccount.created",
        actor,
        targetId: account.id,
        fields: { name, responsibleAccountId: responsible },
        scope: scopeOf(organizationId),
      });
      return {
        id: account.id,
        organizationId,
        name,
        description,
        state: "active",
        responsibleAccountId: responsible,
        createdAt: row?.createdAt ?? account.createdAt,
      };
    });
  }

  async update(
    actor: Principal,
    id: string,
    input: { name?: string; description?: string; responsibleAccountId?: string | null },
  ): Promise<ServiceAccount> {
    return this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select(columns)
        .from(serviceAccounts)
        .innerJoin(accounts, eq(accounts.id, serviceAccounts.accountId))
        .where(eq(serviceAccounts.accountId, id))
        .for("update", { of: serviceAccounts });
      if (!current) throw new OrganizationError("notFound", "The service account does not exist");
      const name = input.name === undefined ? current.name : serviceAccountNameSchema.parse(input.name);
      const description =
        input.description === undefined
          ? current.description
          : serviceAccountDescriptionSchema.parse(input.description);
      const responsibleAccountId =
        input.responsibleAccountId === undefined ? current.responsibleAccountId : input.responsibleAccountId;
      if (responsibleAccountId && responsibleAccountId !== current.responsibleAccountId) {
        const [member] = await tx
          .select({ kind: memberships.kind })
          .from(memberships)
          .innerJoin(accounts, eq(accounts.id, memberships.accountId))
          .where(
            and(
              eq(memberships.organizationId, current.organizationId),
              eq(memberships.accountId, responsibleAccountId),
              eq(accounts.state, "active"),
              eq(accounts.type, "standard"),
            ),
          );
        if (member?.kind !== "member") {
          throw new OrganizationError(
            "invalidResponsible",
            "The responsible person must be a member of the organization",
          );
        }
      }
      await tx.update(accounts).set({ name, updatedAt: new Date() }).where(eq(accounts.id, id));
      await tx
        .update(serviceAccounts)
        .set({ description, responsibleAccountId, updatedAt: new Date() })
        .where(eq(serviceAccounts.accountId, id));
      await this.#audit.record(tx, {
        name: "serviceAccount.updated",
        actor,
        targetId: id,
        fields: { name, description, responsibleAccountId },
        scope: scopeOf(current.organizationId),
      });
      return { ...current, name, description, responsibleAccountId };
    });
  }

  async deactivate(actor: Principal, id: string): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select({ organizationId: serviceAccounts.organizationId })
        .from(serviceAccounts)
        .where(eq(serviceAccounts.accountId, id));
      if (!current) throw new OrganizationError("notFound", "The service account does not exist");
      const updated = await tx
        .update(accounts)
        .set({ state: "deactivated", updatedAt: new Date() })
        .where(and(eq(accounts.id, id), eq(accounts.state, "active")))
        .returning({ id: accounts.id });
      if (updated.length === 0) throw new OrganizationError("notFound", "The service account is not active");
      const revoked = await tx
        .update(apiTokens)
        .set({ revokedAt: sql`now()`, updatedAt: new Date() })
        .where(and(eq(apiTokens.accountId, id), isNull(apiTokens.revokedAt)))
        .returning({ id: apiTokens.id });
      const events: Parameters<AuditLog["recordMany"]>[1] = [
        {
          name: "serviceAccount.deactivated",
          actor,
          targetId: id,
          fields: { revokedCount: revoked.length },
          scope: scopeOf(current.organizationId),
        },
        ...revoked.map((token) => ({
          name: "apiToken.revoked" as const,
          actor,
          targetId: token.id,
          fields: { accountId: id, reason: "accountDeactivated" as const },
          scope: scopeOf(current.organizationId),
        })),
      ];
      await this.#audit.recordMany(tx, events);
      return revoked.length;
    });
  }

  async organizationOf(id: string): Promise<string | null> {
    const [row] = await this.#database
      .select({ organizationId: serviceAccounts.organizationId })
      .from(serviceAccounts)
      .where(eq(serviceAccounts.accountId, id));
    return row?.organizationId ?? null;
  }
}
