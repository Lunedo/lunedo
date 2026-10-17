import { sql } from "drizzle-orm";
import { z } from "zod";
import { SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AccessReductions } from "../authorization/access-reductions.js";
import type { Database, Transaction } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { NotificationService, NotifyResult } from "../notifications/service.js";
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

export class OrganizationLifecycle {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #memberships: MembershipService;
  readonly #breakGlass: BreakGlassService;
  readonly #notifications: NotificationService;
  readonly #settings: SettingsService;
  readonly #reductions: AccessReductions | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    memberships: MembershipService;
    breakGlass: BreakGlassService;
    notifications: NotificationService;
    settings: SettingsService;
    reductions?: AccessReductions;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#memberships = options.memberships;
    this.#breakGlass = options.breakGlass;
    this.#notifications = options.notifications;
    this.#settings = options.settings;
    this.#reductions = options.reductions;
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
        await this.#reductions?.reduced(tx, {
          organizationId: assignment.organization_id,
          accountId: assignment.principal_kind === "account" ? assignment.principal_id : null,
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
        await this.#reductions?.reduced(tx, {
          organizationId: membership.organization_id,
          accountId: membership.account_id,
        });
        processed += 1;
      });
    }
    return processed;
  }

  async #recipients(tx: Transaction, organizationId: string, preferred: string | null): Promise<string[]> {
    if (preferred) {
      const result = await tx.execute<{ id: string }>(sql`
        select a.id from accounts a join memberships m on m.account_id = a.id
        where a.id = ${preferred} and m.organization_id = ${organizationId} and m.kind = 'member'
          and a.state = 'active'`);
      if (result.rows.length > 0) return result.rows.map((row) => row.id);
    }
    const administrators = await tx.execute<{ id: string }>(sql`
      select distinct a.id from role_assignments ra join accounts a on a.id = ra.principal_id
      where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
        and ra.built_in_role in ('owner', 'administrator')
        and (ra.expires_at is null or ra.expires_at > now())
        and a.state = 'active'`);
    return administrators.rows.map((row) => row.id);
  }

  async #remind(
    candidates: { key: string }[],
    remind: (tx: Transaction, key: string) => Promise<NotifyResult | null>,
  ): Promise<number> {
    let reminded = 0;
    for (const { key } of candidates) {
      const result = await this.#database.transaction((tx) => remind(tx, key));
      if (!result) continue;
      await this.#notifications.dispatch(result.mailIds);
      reminded += 1;
    }
    return reminded;
  }

  async sendReminders(): Promise<number> {
    let sent = 0;
    const organizations = await this.#database.execute<{ id: string; name: string }>(
      sql`select id, name from organizations`,
    );
    for (const { id: organizationId, name: organizationName } of organizations.rows) {
      const chain = organizationSettingsChain(organizationId);
      const guestDays = await this.#settings.get(guestExpiryReminderDaysSetting, chain);
      const inactivityDays = await this.#settings.get(guestInactivityDaysSetting, chain);
      const accessDays = await this.#settings.get(expiryReminderDaysSetting, chain);

      const guests = await this.#database.execute<{ key: string }>(sql`
        select m.id as key from memberships m
        where m.organization_id = ${organizationId} and m.kind = 'guest'
          and m.expiry_reminded_at is null and m.expires_at > now()
          and m.expires_at <= now() + make_interval(days => ${guestDays})`);
      sent += await this.#remind(guests.rows, async (tx, key) => {
        const marked = await tx.execute<{
          account_id: string;
          name: string;
          expires_at: Date | string;
          responsible_account_id: string | null;
        }>(sql`
          update memberships m set expiry_reminded_at = now()
          from accounts a
          where m.id = ${key} and a.id = m.account_id and m.expiry_reminded_at is null and m.expires_at > now()
          returning m.account_id, a.name, m.expires_at, m.responsible_account_id`);
        const guest = marked.rows[0];
        if (!guest) return null;
        return this.#notifications.notify(tx, {
          type: "guest.expiring",
          recipients: await this.#recipients(tx, organizationId, guest.responsible_account_id),
          organizationId,
          targetId: guest.account_id,
          params: {
            organizationName,
            guestName: guest.name,
            expiresAt: new Date(guest.expires_at).toISOString(),
          },
        });
      });

      const inactive = await this.#database.execute<{ key: string }>(sql`
        select a.id as key
        from accounts a join memberships m on m.account_id = a.id
        where m.organization_id = ${organizationId} and m.kind = 'guest' and a.state = 'active'
          and coalesce(a.last_active_at, a.created_at) <= now() - make_interval(days => ${inactivityDays})
          and (a.inactivity_notified_at is null
            or a.inactivity_notified_at < coalesce(a.last_active_at, a.created_at))`);
      sent += await this.#remind(inactive.rows, async (tx, key) => {
        const marked = await tx.execute<{ name: string; responsible_account_id: string | null }>(sql`
          update accounts a set inactivity_notified_at = now()
          from memberships m
          where a.id = ${key} and m.account_id = a.id and m.organization_id = ${organizationId}
            and m.kind = 'guest' and a.state = 'active'
            and coalesce(a.last_active_at, a.created_at) <= now() - make_interval(days => ${inactivityDays})
            and (a.inactivity_notified_at is null
              or a.inactivity_notified_at < coalesce(a.last_active_at, a.created_at))
          returning a.name, m.responsible_account_id`);
        const guest = marked.rows[0];
        if (!guest) return null;
        return this.#notifications.notify(tx, {
          type: "guest.inactive",
          recipients: await this.#recipients(tx, organizationId, guest.responsible_account_id),
          organizationId,
          targetId: key,
          params: { organizationName, guestName: guest.name, days: inactivityDays },
        });
      });

      const roles = await this.#database.execute<{ key: string }>(sql`
        select id as key from role_assignments
        where organization_id = ${organizationId} and expiry_reminded_at is null and expires_at > now()
          and expires_at <= now() + make_interval(days => ${accessDays})`);
      sent += await this.#remind(roles.rows, async (tx, key) => {
        const marked = await tx.execute<{
          name: string;
          expires_at: Date | string;
          created_by: string | null;
        }>(sql`
          update role_assignments ra set expiry_reminded_at = now()
          from role_assignments original left join custom_roles cr on cr.id = original.custom_role_id
          where ra.id = ${key} and original.id = ra.id
            and ra.expiry_reminded_at is null and ra.expires_at > now()
          returning coalesce(ra.built_in_role::text, cr.name) as name, ra.expires_at, ra.created_by`);
        const role = marked.rows[0];
        if (!role) return null;
        return this.#notifications.notify(tx, {
          type: "access.expiring",
          recipients: await this.#recipients(tx, organizationId, role.created_by),
          organizationId,
          targetId: key,
          params: {
            organizationName,
            kind: "role",
            name: role.name,
            expiresAt: new Date(role.expires_at).toISOString(),
          },
        });
      });

      const groupMemberships = await this.#database.execute<{ key: string }>(sql`
        select gm.group_id || ':' || gm.account_id as key
        from group_members gm join groups g on g.id = gm.group_id
        where g.organization_id = ${organizationId}
          and gm.expiry_reminded_at is null and gm.expires_at > now()
          and gm.expires_at <= now() + make_interval(days => ${accessDays})`);
      sent += await this.#remind(groupMemberships.rows, async (tx, key) => {
        const [groupId = "", accountId = ""] = key.split(":");
        const marked = await tx.execute<{ name: string; expires_at: Date | string }>(sql`
          update group_members gm set expiry_reminded_at = now()
          from groups g
          where gm.group_id = ${groupId} and gm.account_id = ${accountId} and g.id = gm.group_id
            and gm.expiry_reminded_at is null and gm.expires_at > now()
          returning g.name, gm.expires_at`);
        const membership = marked.rows[0];
        if (!membership) return null;
        const managers = await tx.execute<{ account_id: string }>(
          sql`select account_id from group_managers where group_id = ${groupId} limit 1`,
        );
        return this.#notifications.notify(tx, {
          type: "access.expiring",
          recipients: await this.#recipients(tx, organizationId, managers.rows[0]?.account_id ?? null),
          organizationId,
          targetId: groupId,
          params: {
            organizationName,
            kind: "group",
            name: membership.name,
            expiresAt: new Date(membership.expires_at).toISOString(),
          },
        });
      });

      const members = await this.#database.execute<{ key: string }>(sql`
        select id as key from memberships
        where organization_id = ${organizationId} and kind <> 'guest'
          and expiry_reminded_at is null and expires_at > now()
          and expires_at <= now() + make_interval(days => ${accessDays})`);
      sent += await this.#remind(members.rows, async (tx, key) => {
        const marked = await tx.execute<{
          account_id: string;
          name: string;
          expires_at: Date | string;
          created_by: string | null;
        }>(sql`
          update memberships m set expiry_reminded_at = now()
          from accounts a
          where m.id = ${key} and a.id = m.account_id and m.expiry_reminded_at is null and m.expires_at > now()
          returning m.account_id, a.name, m.expires_at, m.created_by`);
        const membership = marked.rows[0];
        if (!membership) return null;
        return this.#notifications.notify(tx, {
          type: "access.expiring",
          recipients: await this.#recipients(tx, organizationId, membership.created_by),
          organizationId,
          targetId: membership.account_id,
          params: {
            organizationName,
            kind: "membership",
            name: membership.name,
            expiresAt: new Date(membership.expires_at).toISOString(),
          },
        });
      });
    }
    return sent;
  }
}
