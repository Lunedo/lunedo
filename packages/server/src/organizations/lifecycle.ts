import { sql } from "drizzle-orm";
import { z } from "zod";
import { SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import type { MailTemplates } from "../mail/templates.js";
import type { SettingsService } from "../settings/service.js";
import type { BreakGlassService } from "./break-glass.js";
import type { MembershipService } from "./memberships.js";
import {
  expiryReminderDaysSetting,
  guestExpiryReminderDaysSetting,
  guestInactivityDaysSetting,
  organizationSettingsChain,
} from "./settings.js";

export const organizationExpiryJob = defineJob({
  name: "organizations.process-expiry",
  payload: z.object({}),
  retryLimit: 2,
});

export const ORGANIZATION_EXPIRY_SCHEDULE = "* * * * *";

export const organizationRemindersJob = defineJob({
  name: "organizations.send-reminders",
  payload: z.object({}),
  retryLimit: 2,
});

export const ORGANIZATION_REMINDERS_SCHEDULE = "23 * * * *";

type MailParams<T extends keyof MailTemplates> = Omit<MailTemplates[T], "instanceName">;

function day(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

export class OrganizationLifecycle {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #memberships: MembershipService;
  readonly #breakGlass: BreakGlassService;
  readonly #mail: MailService;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    memberships: MembershipService;
    breakGlass: BreakGlassService;
    mail: MailService;
    settings: SettingsService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#memberships = options.memberships;
    this.#breakGlass = options.breakGlass;
    this.#mail = options.mail;
    this.#settings = options.settings;
  }

  async processExpiry(): Promise<number> {
    let processed = await this.#breakGlass.recordExpired();
    const expiredMemberships = await this.#database.execute<{ organization_id: string; account_id: string }>(
      sql`select organization_id, account_id from memberships where expires_at <= now() limit 500`,
    );
    for (const row of expiredMemberships.rows) {
      if (await this.#memberships.expire(row.organization_id, row.account_id)) processed += 1;
    }
    const assignments = await this.#database.execute<{
      id: string;
      organization_id: string | null;
      role: string;
      principal_kind: string;
      principal_id: string | null;
    }>(sql`
      select ra.id, ra.organization_id, coalesce(ra.built_in_role::text, cr.name) as role,
        ra.principal_kind, ra.principal_id
      from role_assignments ra left join custom_roles cr on cr.id = ra.custom_role_id
      where ra.expires_at <= now() limit 500`);
    for (const assignment of assignments.rows) {
      await this.#database.transaction(async (tx) => {
        const deleted = await tx.execute(
          sql`delete from role_assignments where id = ${assignment.id} and expires_at <= now() returning id`,
        );
        if (deleted.rows.length === 0) return;
        await this.#audit.record(tx, {
          name: "role.unassigned",
          actor: SYSTEM,
          targetId: assignment.id,
          fields: {
            role: assignment.role,
            principalKind: assignment.principal_kind,
            principalId: assignment.principal_id,
            reason: "expired",
          },
          ...(assignment.organization_id
            ? { scope: { type: "organization" as const, id: assignment.organization_id } }
            : {}),
        });
        processed += 1;
      });
    }
    const groupMemberships = await this.#database.execute<{
      group_id: string;
      account_id: string;
      organization_id: string;
    }>(sql`
      select gm.group_id, gm.account_id, g.organization_id
      from group_members gm join groups g on g.id = gm.group_id
      where gm.expires_at <= now() limit 500`);
    for (const membership of groupMemberships.rows) {
      await this.#database.transaction(async (tx) => {
        const deleted = await tx.execute(sql`
          delete from group_members where group_id = ${membership.group_id}
            and account_id = ${membership.account_id} and expires_at <= now() returning group_id`);
        if (deleted.rows.length === 0) return;
        await this.#audit.record(tx, {
          name: "group.memberRemoved",
          actor: SYSTEM,
          targetId: membership.group_id,
          fields: { accountId: membership.account_id, reason: "expired" },
          scope: { type: "organization", id: membership.organization_id },
        });
        processed += 1;
      });
    }
    return processed;
  }

  async #recipients(
    organizationId: string,
    preferred: string | null,
  ): Promise<{ id: string; email: string }[]> {
    if (preferred) {
      const result = await this.#database.execute<{ id: string; email: string }>(sql`
        select a.id, a.email from accounts a join memberships m on m.account_id = a.id
        where a.id = ${preferred} and m.organization_id = ${organizationId} and m.kind = 'member'
          and a.state = 'active' and a.email is not null`);
      if (result.rows.length > 0) return result.rows;
    }
    const administrators = await this.#database.execute<{ id: string; email: string }>(sql`
      select distinct a.id, a.email from role_assignments ra join accounts a on a.id = ra.principal_id
      where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
        and ra.built_in_role in ('owner', 'administrator')
        and (ra.expires_at is null or ra.expires_at > now())
        and a.state = 'active' and a.email is not null`);
    return administrators.rows;
  }

  async #notify<T extends keyof MailTemplates>(
    organizationId: string,
    preferred: string | null,
    template: T,
    params: (organizationName: string) => MailParams<T>,
  ): Promise<void> {
    const organization = await this.#database.execute<{ name: string }>(
      sql`select name from organizations where id = ${organizationId}`,
    );
    const name = organization.rows[0]?.name ?? "";
    const recipients = await this.#recipients(organizationId, preferred);
    const mailIds = await this.#database.transaction(async (tx) => {
      const ids: string[] = [];
      for (const recipient of recipients) {
        ids.push(
          await this.#mail.queue(tx, {
            to: recipient.email,
            template,
            language: await this.#mail.languageOf(recipient.id),
            params: params(name),
          }),
        );
      }
      return ids;
    });
    await this.#mail.dispatch(mailIds);
  }

  async sendReminders(): Promise<number> {
    let sent = 0;
    const organizations = await this.#database.execute<{ id: string }>(sql`select id from organizations`);
    for (const { id: organizationId } of organizations.rows) {
      const chain = organizationSettingsChain(organizationId);
      const guestDays = await this.#settings.get(guestExpiryReminderDaysSetting, chain);
      const inactivityDays = await this.#settings.get(guestInactivityDaysSetting, chain);
      const accessDays = await this.#settings.get(expiryReminderDaysSetting, chain);

      const guests = await this.#database.execute<{
        id: string;
        name: string;
        expires_at: Date;
        responsible_account_id: string | null;
      }>(sql`
        update memberships m set expiry_reminded_at = now()
        from accounts a
        where a.id = m.account_id and m.organization_id = ${organizationId} and m.kind = 'guest'
          and m.expiry_reminded_at is null and m.expires_at > now()
          and m.expires_at <= now() + make_interval(days => ${guestDays})
        returning m.id, a.name, m.expires_at, m.responsible_account_id`);
      for (const guest of guests.rows) {
        await this.#notify(
          organizationId,
          guest.responsible_account_id,
          "guestExpiring",
          (organizationName) => ({
            organizationName,
            guestName: guest.name,
            date: day(guest.expires_at),
          }),
        );
        sent += 1;
      }

      const inactive = await this.#database.execute<{
        id: string;
        name: string;
        responsible_account_id: string | null;
      }>(sql`
        with candidates as (
          select a.id, a.name, m.responsible_account_id
          from accounts a join memberships m on m.account_id = a.id
          where m.organization_id = ${organizationId} and m.kind = 'guest' and a.state = 'active'
            and coalesce(a.last_active_at, a.created_at) <= now() - make_interval(days => ${inactivityDays})
            and (a.inactivity_notified_at is null
              or a.inactivity_notified_at < coalesce(a.last_active_at, a.created_at))
        )
        update accounts a set inactivity_notified_at = now()
        from candidates c where a.id = c.id
        returning c.id, c.name, c.responsible_account_id`);
      for (const guest of inactive.rows) {
        await this.#notify(
          organizationId,
          guest.responsible_account_id,
          "guestInactive",
          (organizationName) => ({
            organizationName,
            guestName: guest.name,
            days: inactivityDays,
          }),
        );
        sent += 1;
      }

      const roles = await this.#database.execute<{
        name: string;
        expires_at: Date;
        created_by: string | null;
        holder: string;
      }>(sql`
        update role_assignments ra set expiry_reminded_at = now()
        from role_assignments original left join custom_roles cr on cr.id = original.custom_role_id
        where ra.id = original.id and ra.organization_id = ${organizationId}
          and ra.expiry_reminded_at is null and ra.expires_at > now()
          and ra.expires_at <= now() + make_interval(days => ${accessDays})
        returning coalesce(ra.built_in_role::text, cr.name) as name, ra.expires_at, ra.created_by`);
      for (const role of roles.rows) {
        await this.#notify(organizationId, role.created_by, "accessExpiring", (organizationName) => ({
          organizationName,
          kind: "role" as const,
          name: role.name,
          date: day(role.expires_at),
        }));
        sent += 1;
      }

      const groupMemberships = await this.#database.execute<{
        group_id: string;
        name: string;
        expires_at: Date;
      }>(sql`
        update group_members gm set expiry_reminded_at = now()
        from groups g
        where g.id = gm.group_id and g.organization_id = ${organizationId}
          and gm.expiry_reminded_at is null and gm.expires_at > now()
          and gm.expires_at <= now() + make_interval(days => ${accessDays})
        returning gm.group_id, g.name, gm.expires_at`);
      for (const membership of groupMemberships.rows) {
        const managers = await this.#database.execute<{ account_id: string }>(
          sql`select account_id from group_managers where group_id = ${membership.group_id} limit 1`,
        );
        await this.#notify(
          organizationId,
          managers.rows[0]?.account_id ?? null,
          "accessExpiring",
          (organizationName) => ({
            organizationName,
            kind: "group" as const,
            name: membership.name,
            date: day(membership.expires_at),
          }),
        );
        sent += 1;
      }

      const members = await this.#database.execute<{ expires_at: Date; created_by: string | null }>(sql`
        update memberships set expiry_reminded_at = now()
        where organization_id = ${organizationId} and kind <> 'guest'
          and expiry_reminded_at is null and expires_at > now()
          and expires_at <= now() + make_interval(days => ${accessDays})
        returning expires_at, created_by`);
      for (const membership of members.rows) {
        await this.#notify(organizationId, membership.created_by, "accessExpiring", (organizationName) => ({
          organizationName,
          kind: "membership" as const,
          name: "",
          date: day(membership.expires_at),
        }));
        sent += 1;
      }
    }
    return sent;
  }
}
