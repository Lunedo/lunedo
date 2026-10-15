import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { MeetingReminders } from "./reminders.js";
import type { MeetingReminder } from "./schema.js";

const baseUrl = testDatabaseBaseUrl();
const HOUR = 3_600_000;

describe.skipIf(!baseUrl)("meeting reminders", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  function remindersAt(now: Date) {
    return new MeetingReminders({
      database: test.database,
      authorization: test.services.authorization,
      notifications: test.services.notifications,
      clock: () => now,
    });
  }

  async function setup(reminder?: MeetingReminder) {
    const org = await organization();
    const leadId = await member(org.id, "member", "Lead");
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const created = await space(org.id, leadId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    const lead = accountPrincipal(leadId);
    const seriesId = await test.services.meetings.createSeries(lead, created.id, {
      name: "Platform weekly",
      parentId: null,
      members: [leadId, editorId, readerId],
      templateId: "builtin:team-meeting",
      rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
      startsOn: "2030-03-18",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
      ...(reminder ? { reminder } : {}),
    });
    const upcoming = (await test.services.meetings.details(lead, seriesId)).upcoming;
    if (!upcoming?.startsAt) throw new Error("The series has no scheduled meeting");
    return {
      space: created,
      seriesId,
      meetingId: upcoming.id,
      startsAt: upcoming.startsAt,
      lead,
      leadId,
      editorId,
      readerId,
    };
  }

  async function reminded(meetingId: string): Promise<string[]> {
    const result = await test.database.execute<{ recipient_id: string }>(sql`
      select recipient_id from notifications where type = 'meeting.reminder' and target_id = ${meetingId}
      order by recipient_id`);
    return result.rows.map((row) => row.recipient_id);
  }

  function before(startsAt: Date, hours: number): Date {
    return new Date(startsAt.getTime() - hours * HOUR);
  }

  it("reminds every attendee who can read the meeting once, one day before by default", async () => {
    const context = await setup();
    expect((await test.services.meetings.details(context.lead, context.seriesId)).reminder).toBe("oneDay");
    expect(await remindersAt(before(context.startsAt, 25)).sendDue()).toBe(0);
    expect(await reminded(context.meetingId)).toEqual([]);

    expect(await remindersAt(before(context.startsAt, 23)).sendDue()).toBe(3);
    expect(await reminded(context.meetingId)).toEqual(
      [context.leadId, context.editorId, context.readerId].sort(),
    );
    const notification = await test.database.execute<{ params: Record<string, unknown> }>(sql`
      select params from notifications where type = 'meeting.reminder' and recipient_id = ${context.leadId}`);
    expect(notification.rows[0]?.params).toMatchObject({
      seriesTitle: "Platform weekly",
      spaceKey: context.space.key,
      startsAt: context.startsAt.toISOString(),
    });

    expect(await remindersAt(before(context.startsAt, 22)).sendDue()).toBe(0);
    expect(await reminded(context.meetingId)).toHaveLength(3);
  });

  it("leaves out attendees who cannot read the meeting, were excused or are deactivated", async () => {
    const context = await setup();
    const permission = await test.database.execute<{ id: string }>(sql`
      select id from space_permissions where space_id = ${context.space.id} and principal_id = ${context.readerId}`);
    await test.services.spacePermissions.apply(context.lead, context.space.id, {
      action: "remove",
      permissionId: permission.rows[0]?.id ?? "",
    });
    await test.services.meetings.setAttendance(context.lead, context.meetingId, context.editorId, "excused");
    const deactivatedId = await member(
      (await test.services.spaces.get(context.space.id))?.organizationId ?? "",
    );
    await test.services.spacePermissions.apply(context.lead, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: deactivatedId,
      role: "reader",
    });
    await test.services.meetings.addAttendee(context.lead, context.meetingId, deactivatedId);
    await test.database.execute(sql`update accounts set state = 'deactivated' where id = ${deactivatedId}`);

    await remindersAt(before(context.startsAt, 2)).sendDue();
    expect(await reminded(context.meetingId)).toEqual([context.leadId]);
  });

  it("moves the reminder with the meeting", async () => {
    const context = await setup();
    const moved = new Date(context.startsAt.getTime() + 3 * 24 * HOUR);
    await test.services.meetings.move(context.lead, context.meetingId, moved);
    expect(await remindersAt(before(context.startsAt, 23)).sendDue()).toBe(0);
    expect(await reminded(context.meetingId)).toEqual([]);
    await remindersAt(before(moved, 23)).sendDue();
    expect(await reminded(context.meetingId)).toHaveLength(3);
  });

  it("reminds again after a move to another day whose reminder time is still ahead", async () => {
    const context = await setup();
    expect(await remindersAt(before(context.startsAt, 23)).sendDue()).toBe(3);

    const sameDay = new Date(context.startsAt.getTime() + 2 * HOUR);
    await test.services.meetings.move(context.lead, context.meetingId, sameDay);
    expect(await remindersAt(before(sameDay, 1)).sendDue()).toBe(0);

    const otherDay = new Date(context.startsAt.getTime() + 3 * 24 * HOUR);
    await test.services.meetings.move(context.lead, context.meetingId, otherDay);
    expect(await remindersAt(before(otherDay, 25)).sendDue()).toBe(0);
    expect(await remindersAt(before(otherDay, 23)).sendDue()).toBe(3);
    expect(await remindersAt(before(otherDay, 22)).sendDue()).toBe(0);
  });

  it("sends a reminder that became due by a move at once, and never after the start", async () => {
    const context = await setup();
    const sooner = new Date(context.startsAt.getTime() - 24 * HOUR);
    await test.services.meetings.move(context.lead, context.meetingId, sooner);
    expect(await remindersAt(new Date(sooner.getTime() + 1)).sendDue()).toBe(0);
    await remindersAt(before(sooner, 1)).sendDue();
    expect(await reminded(context.meetingId)).toHaveLength(3);
  });

  it("sends no reminder for a cancelled meeting", async () => {
    const context = await setup();
    await test.services.meetings.skip(context.lead, context.meetingId);
    await remindersAt(before(context.startsAt, 23)).sendDue();
    expect(await reminded(context.meetingId)).toEqual([]);
  });

  it("sends no reminder for a meeting in the trash", async () => {
    const context = await setup();
    await test.services.trash.deleteItem(context.lead, context.seriesId);
    await remindersAt(before(context.startsAt, 23)).sendDue();
    expect(await reminded(context.meetingId)).toEqual([]);
  });

  it("sends no reminder for a meeting created after its reminder time", async () => {
    const context = await setup();
    await test.database.execute(sql`
      update meetings set created_at = starts_at - interval '12 hours' where item_id = ${context.meetingId}`);
    await remindersAt(before(context.startsAt, 6)).sendDue();
    expect(await reminded(context.meetingId)).toEqual([]);
  });

  it("follows the reminder setting of the series", async () => {
    const off = await setup("off");
    await remindersAt(before(off.startsAt, 2)).sendDue();
    expect(await reminded(off.meetingId)).toEqual([]);

    const week = await setup("oneWeek");
    await remindersAt(before(week.startsAt, 8 * 24)).sendDue();
    expect(await reminded(week.meetingId)).toEqual([]);
    await remindersAt(before(week.startsAt, 6 * 24)).sendDue();
    expect(await reminded(week.meetingId)).toHaveLength(3);

    const changed = await setup();
    await test.services.meetings.updateSeries(changed.lead, changed.seriesId, { reminder: "twoDays" });
    expect((await test.services.meetings.details(changed.lead, changed.seriesId)).reminder).toBe("twoDays");
    await remindersAt(before(changed.startsAt, 47)).sendDue();
    expect(await reminded(changed.meetingId)).toHaveLength(3);
  });

  it("reminds exactly once with two nodes at the same moment and after a restart", async () => {
    const context = await setup();
    const now = before(context.startsAt, 12);
    await Promise.all([remindersAt(now).sendDue(), remindersAt(now).sendDue()]);
    expect(await reminded(context.meetingId)).toHaveLength(3);
    await remindersAt(before(context.startsAt, 11)).sendDue();
    expect(await reminded(context.meetingId)).toHaveLength(3);
  });
});
