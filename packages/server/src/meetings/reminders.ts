import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { accountPrincipal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { NotificationService } from "../notifications/service.js";
import type { MeetingReminder } from "./schema.js";

export const REMINDER_MINUTES: Record<Exclude<MeetingReminder, "off">, number> = {
  oneDay: 24 * 60,
  twoDays: 2 * 24 * 60,
  oneWeek: 7 * 24 * 60,
};

const REMINDER_BATCH = 50;

export const meetingRemindersJob = defineJob({
  name: "meetings.send-reminders",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const MEETING_REMINDERS_SCHEDULE = "* * * * *";

export function reminderOffset(series: SQL): SQL {
  return sql`make_interval(mins => case ${series}.reminder
    when 'oneDay' then ${REMINDER_MINUTES.oneDay}::int
    when 'twoDays' then ${REMINDER_MINUTES.twoDays}::int
    when 'oneWeek' then ${REMINDER_MINUTES.oneWeek}::int end)`;
}

export class MeetingReminders {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #notifications: NotificationService;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    notifications: NotificationService;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#notifications = options.notifications;
    this.#clock = options.clock ?? (() => new Date());
  }

  async sendDue(): Promise<number> {
    let sent = 0;
    for (;;) {
      const batch = await this.#sendBatch(this.#clock());
      sent += batch.sent;
      if (batch.meetings < REMINDER_BATCH) return sent;
    }
  }

  async #sendBatch(now: Date): Promise<{ meetings: number; sent: number }> {
    return this.#database.transaction(async (tx) => {
      const offset = reminderOffset(sql`ms`);
      const due = await tx.execute<{
        item_id: string;
        starts_at: Date | string;
        title: string;
        series_title: string;
        key: string;
        organization_id: string | null;
      }>(sql`
        select m.item_id, m.starts_at, t.title, st.title as series_title, s.key, s.organization_id
        from meetings m join meeting_series ms on ms.item_id = m.series_id
        join tree_items t on t.id = m.item_id join tree_items st on st.id = ms.item_id
        join spaces s on s.id = t.space_id
        where m.state = 'upcoming' and m.reminded_at is null and m.starts_at is not null and ms.reminder <> 'off'
          and m.starts_at > ${now}::timestamptz and m.starts_at - ${offset} <= ${now}::timestamptz
          and m.created_at <= m.starts_at - ${offset}
          and t.trash_entry_id is null and t.archived_root_id is null
          and s.deleted_at is null and s.archived_at is null
        order by m.starts_at, m.item_id
        limit ${REMINDER_BATCH}
        for update of m skip locked`);
      let sent = 0;
      for (const meeting of due.rows) {
        await tx.execute(
          sql`update meetings set reminded_at = ${now}::timestamptz where item_id = ${meeting.item_id}`,
        );
        const attendees = await tx.execute<{ account_id: string }>(sql`
          select ma.account_id from meeting_attendees ma join accounts a on a.id = ma.account_id
          where ma.meeting_id = ${meeting.item_id} and a.state = 'active'
            and ma.attendance is distinct from 'excused'
          order by ma.position, ma.account_id`);
        const recipients: string[] = [];
        for (const attendee of attendees.rows) {
          const decision = await this.#authorization.explain(
            accountPrincipal(attendee.account_id),
            "item.view",
            { type: "item", id: meeting.item_id },
            { executor: tx, fresh: true },
          );
          if (decision.allowed) recipients.push(attendee.account_id);
        }
        if (recipients.length === 0) continue;
        await this.#notifications.notify(tx, {
          type: "meeting.reminder",
          recipients,
          organizationId: meeting.organization_id,
          targetId: meeting.item_id,
          params: {
            itemTitle: meeting.title,
            seriesTitle: meeting.series_title,
            spaceKey: meeting.key,
            startsAt: new Date(meeting.starts_at).toISOString(),
          },
        });
        sent += recipients.length;
      }
      return { meetings: due.rows.length, sent };
    });
  }
}
