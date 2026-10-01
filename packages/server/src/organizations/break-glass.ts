import { breakGlassReasonSchema } from "@pagehall/shared";
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { SettingsService } from "../settings/service.js";
import { breakGlassAccesses } from "./access-schema.js";
import { lockOrganization } from "./memberships.js";
import { OrganizationError } from "./organizations.js";
import { organizations } from "./schema.js";
import { breakGlassMinutesSetting } from "./settings.js";

export { breakGlassReasonSchema };

export interface BreakGlassAccess {
  id: string;
  organizationId: string;
  accountId: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

export class BreakGlassService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #mail: MailService;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    mail: MailService;
    settings: SettingsService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#mail = options.mail;
    this.#settings = options.settings;
  }

  async recent(
    days: number,
  ): Promise<(BreakGlassAccess & { organizationName: string; accountName: string })[]> {
    return this.#database
      .select({
        id: breakGlassAccesses.id,
        organizationId: breakGlassAccesses.organizationId,
        accountId: breakGlassAccesses.accountId,
        reason: breakGlassAccesses.reason,
        startedAt: breakGlassAccesses.startedAt,
        expiresAt: breakGlassAccesses.expiresAt,
        endedAt: breakGlassAccesses.endedAt,
        organizationName: organizations.name,
        accountName: accounts.name,
      })
      .from(breakGlassAccesses)
      .innerJoin(organizations, eq(organizations.id, breakGlassAccesses.organizationId))
      .innerJoin(accounts, eq(accounts.id, breakGlassAccesses.accountId))
      .where(gt(breakGlassAccesses.startedAt, sql`now() - make_interval(days => ${days})`))
      .orderBy(desc(breakGlassAccesses.startedAt));
  }

  async active(organizationId: string): Promise<BreakGlassAccess[]> {
    return this.#database
      .select()
      .from(breakGlassAccesses)
      .where(
        and(
          eq(breakGlassAccesses.organizationId, organizationId),
          isNull(breakGlassAccesses.endedAt),
          gt(breakGlassAccesses.expiresAt, sql`now()`),
        ),
      );
  }

  async request(actor: Principal, organizationId: string, reason: string): Promise<BreakGlassAccess> {
    if (actor.type !== "account")
      throw new OrganizationError("accountRequired", "Break-glass access is for accounts");
    const justification = breakGlassReasonSchema.parse(reason);
    const minutes = await this.#settings.get(breakGlassMinutesSetting, {});
    const { access, mailIds } = await this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const [access] = await tx
        .insert(breakGlassAccesses)
        .values({
          organizationId,
          accountId: actor.id,
          reason: justification,
          expiresAt: sql`now() + make_interval(mins => ${minutes})`,
        })
        .returning();
      if (!access) throw new Error("The break-glass access was not created");
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      const [requester] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, actor.id));
      const owners = await tx.execute<{ id: string; email: string }>(sql`
        select a.id, a.email from role_assignments ra join accounts a on a.id = ra.principal_id
        where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
          and ra.built_in_role = 'owner' and a.state = 'active' and a.email is not null`);
      const ids: string[] = [];
      for (const owner of owners.rows) {
        ids.push(
          await this.#mail.queue(tx, {
            to: owner.email,
            template: "breakGlassStarted",
            language: await this.#mail.languageOf(owner.id),
            params: {
              organizationName: organization?.name ?? "",
              requesterName: requester?.name ?? "",
              reason: justification,
              minutes,
            },
          }),
        );
      }
      await this.#audit.record(tx, {
        name: "breakGlass.started",
        actor,
        targetId: access.id,
        fields: { accountId: actor.id, reason: justification, expiresAt: access.expiresAt.toISOString() },
        scope: scopeOf(organizationId),
      });
      return { access, mailIds: ids };
    });
    await this.#mail.dispatch(mailIds);
    return access;
  }

  async end(actor: Principal, organizationId: string, id: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const ended = await tx
        .update(breakGlassAccesses)
        .set({ endedAt: sql`now()`, endRecordedAt: sql`now()` })
        .where(
          and(
            eq(breakGlassAccesses.id, id),
            eq(breakGlassAccesses.organizationId, organizationId),
            isNull(breakGlassAccesses.endedAt),
            gt(breakGlassAccesses.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: breakGlassAccesses.id });
      if (ended.length === 0) return false;
      await this.#audit.record(tx, {
        name: "breakGlass.ended",
        actor,
        targetId: id,
        fields: { reason: "endedByAccount" },
        scope: scopeOf(organizationId),
      });
      return true;
    });
  }

  async recordExpired(): Promise<number> {
    const expired = await this.#database
      .select({ id: breakGlassAccesses.id, organizationId: breakGlassAccesses.organizationId })
      .from(breakGlassAccesses)
      .where(and(isNull(breakGlassAccesses.endRecordedAt), lte(breakGlassAccesses.expiresAt, sql`now()`)));
    let recorded = 0;
    for (const access of expired) {
      await this.#database.transaction(async (tx) => {
        const updated = await tx
          .update(breakGlassAccesses)
          .set({ endRecordedAt: sql`now()` })
          .where(and(eq(breakGlassAccesses.id, access.id), isNull(breakGlassAccesses.endRecordedAt)))
          .returning({ id: breakGlassAccesses.id });
        if (updated.length === 0) return;
        await this.#audit.record(tx, {
          name: "breakGlass.ended",
          actor: SYSTEM,
          targetId: access.id,
          fields: { reason: "expired" },
          scope: scopeOf(access.organizationId),
        });
        recorded += 1;
      });
    }
    return recorded;
  }
}
