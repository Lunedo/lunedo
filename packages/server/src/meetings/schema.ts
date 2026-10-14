import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { timestamps } from "../database/columns.js";
import { treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const scheduleSources = ["manual", "calendar"] as const;
export type ScheduleSource = (typeof scheduleSources)[number];
export const scheduleSource = pgEnum("meeting_schedule_source", scheduleSources);

export const meetingStates = ["upcoming", "closed", "reopened", "skipped"] as const;
export type MeetingState = (typeof meetingStates)[number];
export const meetingState = pgEnum("meeting_state", meetingStates);

export const attendanceValues = ["present", "excused", "absent"] as const;
export type Attendance = (typeof attendanceValues)[number];
export const attendance = pgEnum("meeting_attendance", attendanceValues);

export const meetingReminders = ["off", "oneDay", "twoDays", "oneWeek"] as const;
export type MeetingReminder = (typeof meetingReminders)[number];
export const meetingReminder = pgEnum("meeting_reminder", meetingReminders);

export const topicStatuses = ["open", "closed"] as const;
export type TopicStatus = (typeof topicStatuses)[number];
export const topicStatus = pgEnum("meeting_topic_status", topicStatuses);

export const topicOutcomes = ["resolved", "decided", "dropped"] as const;
export type TopicOutcome = (typeof topicOutcomes)[number];
export const topicOutcome = pgEnum("meeting_topic_outcome", topicOutcomes);

export const meetingSeries = pgTable(
  "meeting_series",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    recurrence: text(),
    startsOn: text().notNull(),
    startTime: text().notNull(),
    timeZone: text().notNull(),
    durationMinutes: integer().notNull(),
    templateId: text().notNull(),
    source: scheduleSource().notNull().default("manual"),
    calendarUid: text(),
    reminder: meetingReminder().notNull().default("oneDay"),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("meeting_series_calendar_uid_unique")
      .on(table.calendarUid)
      .where(sql`${table.calendarUid} is not null`),
    index().on(table.createdBy),
    check("meeting_series_starts_on", sql`${table.startsOn} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
    check("meeting_series_start_time", sql`${table.startTime} ~ '^([01]\\d|2[0-3]):[0-5]\\d$'`),
    check("meeting_series_duration", sql`${table.durationMinutes} between 5 and 1440`),
    check("meeting_series_recurrence_length", sql`length(${table.recurrence}) <= 500`),
  ],
);

export const meetingSeriesMembers = pgTable(
  "meeting_series_members",
  {
    seriesId: uuid()
      .notNull()
      .references(() => meetingSeries.itemId, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.seriesId, table.accountId] }), index().on(table.accountId)],
);

export const meetingOccurrenceOverrides = pgTable(
  "meeting_occurrence_overrides",
  {
    seriesId: uuid()
      .notNull()
      .references(() => meetingSeries.itemId, { onDelete: "cascade" }),
    recurrenceId: timestampColumn().notNull(),
    startsAt: timestampColumn(),
    calendarUid: text(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.seriesId, table.recurrenceId] })],
);

export const meetings = pgTable(
  "meetings",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    seriesId: uuid()
      .notNull()
      .references(() => meetingSeries.itemId, { onDelete: "cascade" }),
    recurrenceId: timestampColumn(),
    startsAt: timestampColumn(),
    durationMinutes: integer().notNull(),
    state: meetingState().notNull().default("upcoming"),
    closedAt: timestampColumn(),
    closedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    nextMeetingId: uuid().references((): AnyPgColumn => meetings.itemId, { onDelete: "set null" }),
    calendarUid: text(),
    remindedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("meetings_one_upcoming").on(table.seriesId).where(sql`${table.state} = 'upcoming'`),
    uniqueIndex("meetings_occurrence_unique")
      .on(table.seriesId, table.recurrenceId)
      .where(sql`${table.recurrenceId} is not null`),
    index().on(table.seriesId, table.startsAt),
    index("meetings_reminder_due_index")
      .on(table.startsAt)
      .where(sql`${table.state} = 'upcoming' and ${table.remindedAt} is null`),
    index().on(table.closedBy),
    index().on(table.nextMeetingId),
    check(
      "meetings_closed",
      sql`(${table.state} in ('closed', 'skipped')) = (${table.closedAt} is not null) or ${table.state} = 'reopened'`,
    ),
  ],
);

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    meetingId: uuid()
      .notNull()
      .references(() => meetings.itemId, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    attendance: attendance(),
    position: integer().notNull().default(0),
    addedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.accountId] }),
    index().on(table.accountId),
    index().on(table.addedBy),
  ],
);

export const meetingTopics = pgTable(
  "meeting_topics",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    seriesId: uuid()
      .notNull()
      .references(() => meetingSeries.itemId, { onDelete: "cascade" }),
    status: topicStatus().notNull().default("open"),
    outcome: topicOutcome(),
    raisedInId: uuid().references(() => meetings.itemId, { onDelete: "set null" }),
    closedInId: uuid().references(() => meetings.itemId, { onDelete: "set null" }),
    closedAt: timestampColumn(),
    closedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    decisionId: uuid(),
    lastUpdateAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.seriesId, table.status),
    index().on(table.raisedInId),
    index().on(table.closedInId),
    index().on(table.closedBy),
    check(
      "meeting_topics_outcome",
      sql`(${table.status} = 'closed') = (${table.outcome} is not null and ${table.closedAt} is not null)`,
    ),
  ],
);

export const meetingTopicUpdates = pgTable(
  "meeting_topic_updates",
  {
    topicId: uuid()
      .notNull()
      .references(() => meetingTopics.itemId, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    content: jsonb().notNull(),
    text: text().notNull().default(""),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.itemId] }), index().on(table.itemId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    topicId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    published: boolean().notNull().default(false),
    statement: jsonb().notNull().default(sql`'[]'::jsonb`),
    text: text().notNull().default(""),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index().on(table.itemId),
    index().on(table.topicId),
    index("decisions_published_index").on(table.createdAt).where(sql`${table.published}`),
  ],
);

export const meetingPrivateNotes = pgTable(
  "meeting_private_notes",
  {
    meetingId: uuid()
      .notNull()
      .references(() => meetings.itemId, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    document: jsonb().notNull(),
    schemaVersion: integer().notNull(),
    revision: bigint({ mode: "number" }).notNull().default(1),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.accountId] }), index().on(table.accountId)],
);
