import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { memberships } from "./access-schema.js";
import { OrganizationError } from "./organizations.js";
import { organizations } from "./schema.js";

export type HomeChangeReason = "providerRule" | "manual";

export const CHANGE_HOME_ACTION = "account.homeOrganization.change";

async function organizationAdministrators(executor: Executor, organizationId: string): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    select distinct a.id from role_assignments ra
    join accounts a on a.id = ra.principal_id
    left join custom_roles cr on cr.id = ra.custom_role_id
    where ra.organization_id = ${organizationId} and ra.principal_kind = 'account' and a.state = 'active'
      and (ra.expires_at is null or ra.expires_at > now())
      and (ra.built_in_role in ('owner', 'administrator') or cr.areas->>'membersAndGroups' = 'manage')`);
  return result.rows.map((row) => row.id);
}

export class HomeOrganizationService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #notifications: NotificationService | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    notifications?: NotificationService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#notifications = options.notifications;
  }

  async #nextHome(tx: Transaction, accountId: string): Promise<string | null> {
    const [next] = await tx
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(
        and(
          eq(memberships.accountId, accountId),
          eq(memberships.kind, "member"),
          or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
        ),
      )
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(1);
    return next?.organizationId ?? null;
  }

  async moveAfterLoss(
    tx: Transaction,
    actor: Principal,
    accountId: string,
    previousOrganizationId: string,
    reason: HomeChangeReason,
  ): Promise<string[]> {
    const next = await this.#nextHome(tx, accountId);
    const moved = await tx
      .update(accounts)
      .set({ homeOrganizationId: next, updatedAt: new Date() })
      .where(and(eq(accounts.id, accountId), eq(accounts.homeOrganizationId, previousOrganizationId)))
      .returning({ id: accounts.id });
    if (moved.length === 0) return [];
    return this.#announce(tx, actor, accountId, previousOrganizationId, next, reason);
  }

  async change(actor: Principal, accountId: string, organizationId: string): Promise<void> {
    const mailIds = await this.#database.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: accounts.id,
          type: accounts.type,
          state: accounts.state,
          home: accounts.homeOrganizationId,
        })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (target?.state !== "active" || target.type !== "standard") {
        throw new OrganizationError("notFound", "The account does not exist or is not active");
      }
      await this.#authorization.require(
        actor,
        CHANGE_HOME_ACTION,
        { type: "account", id: accountId },
        { executor: tx },
      );
      if (target.home === organizationId) return [];
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.accountId, accountId),
            eq(memberships.organizationId, organizationId),
            eq(memberships.kind, "member"),
            or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
          ),
        );
      if (!membership) {
        throw new OrganizationError(
          "notMember",
          "The home organization must be an organization the account is a member of",
        );
      }
      await tx
        .update(accounts)
        .set({ homeOrganizationId: organizationId, updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      return this.#announce(tx, actor, accountId, target.home, organizationId, "manual");
    });
    await this.#notifications?.dispatch(mailIds);
  }

  async #announce(
    tx: Transaction,
    actor: Principal,
    accountId: string,
    previousOrganizationId: string | null,
    organizationId: string | null,
    reason: HomeChangeReason,
  ): Promise<string[]> {
    const event = {
      name: "account.homeOrganizationChanged" as const,
      actor,
      targetId: accountId,
      fields: { previousOrganizationId, organizationId, reason },
    };
    const scopes = [previousOrganizationId, organizationId].filter((id): id is string => id !== null);
    if (scopes.length === 0) await this.#audit.record(tx, event);
    for (const scope of scopes) {
      await this.#audit.record(tx, { ...event, scope: { type: "organization", id: scope } });
    }
    if (!this.#notifications) return [];
    const names = new Map(
      scopes.length === 0
        ? []
        : (
            await tx
              .select({ id: organizations.id, name: organizations.name })
              .from(organizations)
              .where(inArray(organizations.id, scopes))
          ).map((row) => [row.id, row.name] as const),
    );
    const [account] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    const params = {
      accountName: account?.name ?? "",
      previousOrganizationName: previousOrganizationId ? (names.get(previousOrganizationId) ?? null) : null,
      organizationName: organizationId ? (names.get(organizationId) ?? null) : null,
      reason,
    };
    const mailIds: string[] = [];
    const announce = async (recipients: string[], scope: string | null) => {
      if (recipients.length === 0) return;
      const result = await this.#notifications?.notify(tx, {
        type: "account.homeOrganizationChanged",
        recipients,
        organizationId: scope,
        targetId: accountId,
        params,
      });
      if (result) mailIds.push(...result.mailIds);
    };
    await announce([accountId], null);
    const told = new Set([accountId]);
    for (const scope of scopes) {
      const administrators = (await organizationAdministrators(tx, scope)).filter((id) => !told.has(id));
      for (const id of administrators) told.add(id);
      await announce(administrators, scope);
    }
    return mailIds;
  }
}
