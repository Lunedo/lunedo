import {
  responsibleAccountIdsSchema,
  serviceAccountDescriptionSchema,
  serviceAccountNameSchema,
} from "@pagehall/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { MailService } from "../mail/mail-service.js";
import { memberships } from "../organizations/access-schema.js";
import { LastOwnerError, lockOrganization, ownerCount } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import { apiTokens, serviceAccountResponsibles, serviceAccounts } from "./schema.js";

export { responsibleAccountIdsSchema, serviceAccountDescriptionSchema, serviceAccountNameSchema };

export interface ServiceAccount {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  state: string;
  responsibleAccountIds: string[];
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
  createdAt: serviceAccounts.createdAt,
};

type Row = Omit<ServiceAccount, "responsibleAccountIds">;

export async function responsiblesOf(
  executor: Executor,
  serviceAccountIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(serviceAccountIds.map((id) => [id, []]));
  if (serviceAccountIds.length === 0) return result;
  const rows = await executor
    .select({
      serviceAccountId: serviceAccountResponsibles.serviceAccountId,
      accountId: serviceAccountResponsibles.accountId,
    })
    .from(serviceAccountResponsibles)
    .where(inArray(serviceAccountResponsibles.serviceAccountId, serviceAccountIds))
    .orderBy(asc(serviceAccountResponsibles.createdAt), asc(serviceAccountResponsibles.accountId));
  for (const row of rows) result.get(row.serviceAccountId)?.push(row.accountId);
  return result;
}

export class ServiceAccountService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #mail: MailService | undefined;

  readonly #authorization: AuthorizationService | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    mail?: MailService;
    authorization?: AuthorizationService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#mail = options.mail;
    this.#authorization = options.authorization;
  }

  async #withResponsibles(executor: Executor, rows: Row[]): Promise<ServiceAccount[]> {
    const responsibles = await responsiblesOf(
      executor,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, responsibleAccountIds: responsibles.get(row.id) ?? [] }));
  }

  async list(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<ServiceAccount>> {
    const sortName = sql<string>`lower(${accounts.name})`;
    const rows = await this.#database
      .select({ ...columns, sortName })
      .from(serviceAccounts)
      .innerJoin(accounts, eq(accounts.id, serviceAccounts.accountId))
      .where(
        and(
          eq(serviceAccounts.organizationId, organizationId),
          afterKey([sortName, serviceAccounts.accountId], page.after),
        ),
      )
      .orderBy(sortName, serviceAccounts.accountId)
      .limit(pageLimit(page));
    const result = toPage(
      rows,
      page,
      (row) => [row.sortName, row.id],
      ({ sortName: _sortName, ...row }) => row,
    );
    return { next: result.next, items: await this.#withResponsibles(this.#database, result.items) };
  }

  async get(id: string, executor: Executor = this.#database): Promise<ServiceAccount | null> {
    const [row] = await executor
      .select(columns)
      .from(serviceAccounts)
      .innerJoin(accounts, eq(accounts.id, serviceAccounts.accountId))
      .where(eq(serviceAccounts.accountId, id));
    if (!row) return null;
    const [withResponsibles] = await this.#withResponsibles(executor, [row]);
    return withResponsibles ?? null;
  }

  async #checkResponsibles(tx: Transaction, organizationId: string, accountIds: string[]): Promise<void> {
    if (accountIds.length === 0) return;
    const valid = await tx
      .select({ id: accounts.id })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.accountId, accountIds),
          eq(memberships.kind, "member"),
          eq(accounts.state, "active"),
          eq(accounts.type, "standard"),
        ),
      );
    if (valid.length !== accountIds.length) {
      throw new OrganizationError(
        "invalidResponsible",
        "Responsible people must be active members of the organization",
      );
    }
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: { name: string; description?: string; responsibleAccountIds?: string[] },
  ): Promise<ServiceAccount> {
    const name = serviceAccountNameSchema.parse(input.name);
    const description = serviceAccountDescriptionSchema.parse(input.description ?? "");
    const creator = actor.type === "account" ? actor.id : null;
    const responsibleAccountIds = [
      ...new Set(
        responsibleAccountIdsSchema.parse(input.responsibleAccountIds ?? (creator ? [creator] : [])),
      ),
    ];
    return this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await this.#checkResponsibles(tx, organizationId, responsibleAccountIds);
      const [account] = await tx
        .insert(accounts)
        .values({ type: "service", state: "active", name, homeOrganizationId: organizationId })
        .returning({ id: accounts.id });
      if (!account) throw new Error("The service account was not created");
      await tx
        .insert(memberships)
        .values({ organizationId, accountId: account.id, kind: "member", createdBy: creator });
      await tx
        .insert(serviceAccounts)
        .values({ accountId: account.id, organizationId, description, createdBy: creator });
      if (responsibleAccountIds.length > 0) {
        await tx
          .insert(serviceAccountResponsibles)
          .values(responsibleAccountIds.map((accountId) => ({ serviceAccountId: account.id, accountId })));
      }
      await this.#audit.record(tx, {
        name: "serviceAccount.created",
        actor,
        targetId: account.id,
        fields: { name, responsibleAccountIds },
        scope: scopeOf(organizationId),
      });
      const created = await this.get(account.id, tx);
      if (!created) throw new Error("The service account was not created");
      return created;
    });
  }

  async update(
    actor: Principal,
    id: string,
    input: { name?: string; description?: string; responsibleAccountIds?: string[] },
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
      if (name !== current.name || description !== current.description) {
        await tx.update(accounts).set({ name, updatedAt: new Date() }).where(eq(accounts.id, id));
        await tx
          .update(serviceAccounts)
          .set({ description, updatedAt: new Date() })
          .where(eq(serviceAccounts.accountId, id));
        await this.#audit.record(tx, {
          name: "serviceAccount.updated",
          actor,
          targetId: id,
          fields: { name, description },
          scope: scopeOf(current.organizationId),
        });
      }
      if (input.responsibleAccountIds !== undefined) {
        const wanted = [...new Set(responsibleAccountIdsSchema.parse(input.responsibleAccountIds))];
        const before = (await responsiblesOf(tx, [id])).get(id) ?? [];
        if (wanted.length !== before.length || wanted.some((accountId) => !before.includes(accountId))) {
          await this.#checkResponsibles(tx, current.organizationId, wanted);
          await tx
            .delete(serviceAccountResponsibles)
            .where(eq(serviceAccountResponsibles.serviceAccountId, id));
          if (wanted.length > 0) {
            await tx
              .insert(serviceAccountResponsibles)
              .values(wanted.map((accountId) => ({ serviceAccountId: id, accountId })));
          }
          await tx
            .update(serviceAccounts)
            .set({ unattendedNotifiedAt: null, updatedAt: new Date() })
            .where(eq(serviceAccounts.accountId, id));
          await this.#audit.record(tx, {
            name: "serviceAccount.responsiblesChanged",
            actor,
            targetId: id,
            fields: { responsibleAccountIds: wanted },
            scope: scopeOf(current.organizationId),
          });
        }
      }
      const updated = await this.get(id, tx);
      if (!updated) throw new OrganizationError("notFound", "The service account does not exist");
      return updated;
    });
  }

  async deactivate(actor: Principal, id: string): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select({ organizationId: serviceAccounts.organizationId })
        .from(serviceAccounts)
        .where(eq(serviceAccounts.accountId, id));
      if (!current) throw new OrganizationError("notFound", "The service account does not exist");
      await lockOrganization(tx, current.organizationId);
      await this.#authorization?.checkRankOverAccount(actor, current.organizationId, id, {
        executor: tx,
        action: "serviceAccount.manage",
      });
      if (
        (await ownerCount(tx, current.organizationId)) > 0 &&
        (await ownerCount(tx, current.organizationId, { accountId: id })) === 0
      ) {
        throw new LastOwnerError();
      }
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
      await this.#audit.recordMany(tx, [
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
      ]);
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

  async notifyUnattended(): Promise<number> {
    const mail = this.#mail;
    if (!mail) return 0;
    const candidates = await this.#database.execute<{ account_id: string }>(sql`
      select s.account_id from service_accounts s join accounts a on a.id = s.account_id
      where a.state = 'active' and s.unattended_notified_at is null
        and not exists (select 1 from service_account_responsibles r where r.service_account_id = s.account_id)
      limit 100`);
    const mailIds: string[] = [];
    for (const { account_id: id } of candidates.rows) {
      const queued = await this.#database.transaction(async (tx) => {
        const marked = await tx.execute<{
          organization_id: string;
          name: string;
          organization_name: string;
        }>(sql`
          update service_accounts s set unattended_notified_at = now()
          from accounts a, organizations o
          where s.account_id = ${id} and a.id = s.account_id and o.id = s.organization_id
            and s.unattended_notified_at is null and a.state = 'active'
            and not exists (select 1 from service_account_responsibles r where r.service_account_id = s.account_id)
          returning s.organization_id, a.name, o.name as organization_name`);
        const row = marked.rows[0];
        if (!row) return [];
        const owners = await tx.execute<{ id: string; email: string }>(sql`
          select distinct a.id, a.email from role_assignments ra
          join accounts a on a.id = ra.principal_id
          join memberships m on m.account_id = a.id and m.organization_id = ra.organization_id
          where ra.organization_id = ${row.organization_id} and ra.principal_kind = 'account'
            and ra.built_in_role = 'owner' and a.state = 'active' and a.email is not null and m.kind = 'member'`);
        const ids: string[] = [];
        for (const owner of owners.rows) {
          ids.push(
            await mail.queue(tx, {
              to: owner.email,
              template: "serviceAccountUnattended",
              language: await mail.languageOf(owner.id),
              params: { serviceAccountName: row.name, organizationName: row.organization_name },
            }),
          );
        }
        await this.#audit.record(tx, {
          name: "serviceAccount.unattended",
          actor: SYSTEM,
          targetId: id,
          fields: { notifiedCount: ids.length },
          scope: scopeOf(row.organization_id),
        });
        return ids;
      });
      mailIds.push(...queued);
    }
    await mail.dispatch(mailIds);
    return mailIds.length;
  }
}
