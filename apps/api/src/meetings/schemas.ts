import {
  AGENDA_TASK_TEXT_MAX_LENGTH,
  ATTENDANCE_WINDOW,
  attendanceValues,
  GUEST_NAME_MAX_LENGTH,
  GUEST_NOTE_MAX_LENGTH,
  MAX_INTERVAL,
  MAX_OVERVIEW_LINKS,
  MAX_SERIES_MEMBERS,
  MAX_STATEMENT_LENGTH,
  MAX_TOPIC_LABELS,
  meetingReminders,
  meetingStates,
  overviewModules,
  rhythmFrequencies,
  SERIES_NAME_MAX_LENGTH,
  scheduleSources,
  TOPIC_TITLE_MAX_LENGTH,
  topicOutcomes,
  topicStatuses,
  UPDATE_TEXT_MAX_LENGTH,
  weekdays,
} from "@lunedo/server";
import { z } from "zod";
import {
  extensibleEnum,
  inputTimestamp,
  itemNumber,
  pictureRefField,
  timestamp,
  uuid,
} from "../http/schemas.js";
import { documentSchema, exampleDocument } from "../spaces/schemas.js";

const weekday = z.enum(weekdays).describe("Weekday as in iCalendar: `MO` to `SU`.");

export const rhythmSchema = z
  .object({
    frequency: z
      .enum(rhythmFrequencies)
      .describe("`none` for no fixed rhythm, otherwise how often the meetings repeat."),
    interval: z
      .number()
      .int()
      .min(1)
      .max(MAX_INTERVAL)
      .default(1)
      .describe(
        "Every how many days, weeks, months or years. 2 weekly is every two weeks, 3 monthly is quarterly.",
      ),
    weekdays: z
      .array(weekday)
      .max(7)
      .optional()
      .describe("For `weekly`: the weekdays of the meetings, at least one."),
    monthDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("For `monthly` by date: the day of the month."),
    weekOfMonth: z
      .number()
      .int()
      .min(-1)
      .max(4)
      .refine((value) => value !== 0, "Use 1 to 4, or -1 for the last")
      .optional()
      .describe("For `monthly` by weekday: 1 to 4 for the first to fourth, -1 for the last."),
    weekday: weekday.optional().describe("For `monthly` by weekday: the weekday, for example `TU`."),
  })
  .strict()
  .describe("The rhythm of a series, as the interface offers it.");

const rhythmResponseSchema = z
  .object({
    frequency: extensibleEnum(rhythmFrequencies, "How often the meetings repeat."),
    interval: z.number().int().describe("Every how many units."),
    weekdays: z.array(z.string()).optional().describe("Weekdays for weekly rhythms."),
    monthDay: z.number().int().optional().describe("Day of the month for monthly rhythms by date."),
    weekOfMonth: z.number().int().optional().describe("1 to 4 or -1 for monthly rhythms by weekday."),
    weekday: z.string().optional().describe("Weekday for monthly rhythms by weekday."),
  })
  .describe("The rhythm of the series.");

const scheduleFields = {
  rhythm: rhythmSchema,
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date of the first meeting in the series' time zone, YYYY-MM-DD."),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .describe("Local start time of the meetings, HH:MM in 24 hours."),
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "IANA time zone of the series, such as `Europe/Vienna`. Meetings keep their local time across daylight saving changes.",
    ),
  durationMinutes: z.number().int().min(5).max(1440).describe("Duration of each meeting in minutes."),
};

export const scheduleInputSchema = z
  .object(scheduleFields)
  .strict()
  .describe("When the meetings take place.");

const REMINDER_DESCRIPTION =
  "When attendees are reminded to add their topics: `off`, or one day, two days or one week before each meeting.";
const reminderInputSchema = z.enum(meetingReminders).describe(REMINDER_DESCRIPTION);
export const reminderSchema = extensibleEnum(meetingReminders, REMINDER_DESCRIPTION);

export const createSeriesSchema = z
  .object({
    name: z
      .string()
      .max(SERIES_NAME_MAX_LENGTH * 2)
      .describe(`Name of the series, 1 to ${SERIES_NAME_MAX_LENGTH} characters.`),
    parentId: uuid("Page or folder to place the series below, or null for the top level.")
      .nullable()
      .default(null),
    members: z
      .array(uuid("Account ID."))
      .max(MAX_SERIES_MEMBERS)
      .default([])
      .describe(
        "Members of the series: the default attendees of every meeting. Access comes from the space roles.",
      ),
    templateId: z
      .string()
      .max(64)
      .default("builtin:team-meeting")
      .describe("Template for the meeting pages: a template ID or `builtin:<key>`."),
    reminder: reminderInputSchema.default("oneDay"),
    ...scheduleFields,
  })
  .strict()
  .describe("A new meeting series.");

export const updateSeriesSchema = z
  .object({
    name: z
      .string()
      .max(SERIES_NAME_MAX_LENGTH * 2)
      .optional()
      .describe("New name."),
    members: z
      .array(uuid("Account ID."))
      .max(MAX_SERIES_MEMBERS)
      .optional()
      .describe("All members, in order."),
    templateId: z.string().max(64).optional().describe("Template for new meetings."),
    reminder: reminderInputSchema.optional(),
    schedule: scheduleInputSchema
      .optional()
      .describe("New schedule. The upcoming meeting moves to the new rhythm."),
  })
  .strict()
  .describe("Changes to a meeting series. Fields that are left out stay unchanged.");

const memberSchema = z
  .object({
    id: uuid("Account ID."),
    name: z.string().nullable().describe("Name, or null when the caller may not see the person."),
    pictureRef: pictureRefField,
    active: z
      .boolean()
      .describe(
        "Whether the person can still take part: false when the account is deactivated, not set up yet or no longer a member of the organization. Always true for people the caller may not see.",
      ),
    canRead: z
      .boolean()
      .describe(
        "Whether the person can read the series. Active members without access are shown with a warning.",
      ),
  })
  .describe("A member of the series.");

export const meetingStateSchema = extensibleEnum(
  meetingStates,
  "`upcoming` is the next meeting, `closed` and `skipped` are done, `reopened` was closed and is open again.",
);

export const meetingSummarySchema = z
  .object({
    id: uuid("ID of the meeting page."),
    number: itemNumber("Number of the meeting page in the addresses of the app."),
    title: z.string().describe("Title of the meeting page."),
    state: meetingStateSchema,
    startsAt: timestamp("Start of the meeting, or null when it is not scheduled yet.").nullable(),
    recurrenceId: timestamp("Original start of the occurrence in the rhythm, or null.").nullable(),
    durationMinutes: z.number().int().describe("Duration in minutes."),
    attendees: z.number().int().describe("Number of attendees."),
    present: z.number().int().describe("Number of attendees marked present."),
    extra: z.boolean().describe("True for an additional meeting outside the rhythm."),
    next: z
      .boolean()
      .describe(
        "True for the next meeting of the series: the earliest one that is neither held nor skipped.",
      ),
  })
  .describe("A meeting of a series.");

export const exampleMeetingSummary = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a10",
  number: 1051,
  title: "Jour fixe IT · 12 Oct 2026",
  state: "upcoming",
  startsAt: "2026-10-12T07:30:00.000Z",
  recurrenceId: "2026-10-12T07:30:00.000Z",
  durationMinutes: 45,
  attendees: 5,
  present: 0,
  extra: false,
  next: true,
};

const overviewModuleSchema = extensibleEnum(overviewModules, "A module of the series overview.");

export const overviewSchema = z
  .object({
    columns: z
      .array(z.array(overviewModuleSchema))
      .length(2)
      .describe("Modules of the left and the right column, from top to bottom."),
    hidden: z.array(overviewModuleSchema).describe("Modules that are not shown."),
    links: z
      .array(
        z
          .object({
            id: uuid("ID of the item."),
            number: itemNumber("Number of the item in the addresses of the app."),
            title: z.string().describe("Title of the item."),
            kind: z.string().describe("Kind of the item, such as `page` or `folder`."),
            spaceKey: z.string().describe("Key of its space."),
          })
          .describe("A pinned item."),
      )
      .describe("Pinned items for the Links module that the caller can open, in their order."),
  })
  .describe("The overview of the series, the same for all members.");

export const saveOverviewSchema = z
  .object({
    columns: z
      .array(z.array(z.string().max(40)).max(overviewModules.length))
      .length(2)
      .describe(`Modules of the left and the right column. Known modules: ${overviewModules.join(", ")}.`),
    hidden: z
      .array(z.string().max(40))
      .max(overviewModules.length)
      .describe("Modules that are not shown. Modules left out anywhere are hidden too."),
    links: z
      .array(uuid("A page, folder, blog post or whiteboard of the same space."))
      .max(MAX_OVERVIEW_LINKS)
      .describe(`Pinned items, up to ${MAX_OVERVIEW_LINKS}.`),
  })
  .strict()
  .describe("The overview layout.");

export const attendanceRatesSchema = z
  .array(
    z
      .object({
        id: uuid("Account ID of the member."),
        name: z.string().nullable().describe("Name, or null when the caller may not see the person."),
        pictureRef: pictureRefField,
        present: z.number().int().describe("Meetings the member was marked present in."),
        meetings: z.number().int().describe("Meetings counted."),
      })
      .describe("Attendance of one member."),
  )
  .describe(
    `Attendance of the members over the last ${ATTENDANCE_WINDOW} held meetings the caller can read.`,
  );

export const extraMeetingSchema = z
  .object({ startsAt: inputTimestamp("Start of the additional meeting.") })
  .strict()
  .describe("An additional meeting outside the rhythm. It shows the open topics of the series.");

export const seriesSchema = z
  .object({
    id: uuid("ID of the series."),
    number: itemNumber("Number of the series in the addresses of the app."),
    spaceId: uuid("Space of the series."),
    title: z.string().describe("Name of the series."),
    parentId: uuid("Parent page or folder, or null.").nullable(),
    archived: z.boolean().describe("True when the series has ended: read-only, without a next meeting."),
    oneOnOne: z.boolean().describe("True for the series of a one-on-one."),
    members: z.array(memberSchema).describe("Members in their order."),
    schedule: z
      .object({
        rhythm: rhythmResponseSchema
          .nullable()
          .describe("The rhythm, or null when the rule cannot be shown as one."),
        recurrence: z
          .string()
          .nullable()
          .describe(
            "The iCalendar recurrence rule (RFC 5545) without `RRULE:`, or null without a fixed rhythm.",
          ),
        startsOn: z.string().describe("Date of the first meeting."),
        startTime: z.string().describe("Local start time."),
        timeZone: z.string().describe("Time zone of the series."),
        durationMinutes: z.number().int().describe("Duration in minutes."),
      })
      .describe("The schedule."),
    template: z
      .object({
        id: z.string().describe("Template ID."),
        name: z.string().nullable().describe("Name of the template, or null when it was deleted."),
      })
      .describe("Template of the meeting pages."),
    reminder: reminderSchema,
    source: extensibleEnum(scheduleSources, "Where the schedule comes from: set here or from a calendar."),
    calendarUid: z.string().nullable().describe("Calendar UID when the schedule comes from a calendar."),
    upcoming: meetingSummarySchema
      .nullable()
      .describe("The next meeting, or null when the series has ended."),
    openTopics: z.number().int().describe("Open running topics the caller can see."),
    overview: overviewSchema,
    createdAt: timestamp("When the series was created."),
  })
  .describe("A meeting series.");

export const exampleSeries = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a00",
  number: 1050,
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a00",
  title: "Jour fixe IT",
  parentId: null,
  archived: false,
  oneOnOne: false,
  members: [
    {
      id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      name: "Anna Berger",
      pictureRef: null,
      active: true,
      canRead: true,
    },
  ],
  schedule: {
    rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
    recurrence: "FREQ=WEEKLY;BYDAY=MO",
    startsOn: "2026-10-12",
    startTime: "09:30",
    timeZone: "Europe/Vienna",
    durationMinutes: 45,
  },
  template: { id: "builtin:team-meeting", name: "Team meeting" },
  reminder: "oneDay",
  source: "manual",
  calendarUid: null,
  upcoming: exampleMeetingSummary,
  openTopics: 3,
  overview: {
    columns: [
      ["topics", "tasks"],
      ["meetings", "decisions"],
    ],
    hidden: ["attendance", "links"],
    links: [],
  },
  createdAt: "2026-10-05T08:00:00.000Z",
};

export const seriesListSchema = z
  .array(
    z
      .object({
        id: uuid("ID of the series."),
        number: itemNumber("Number of the series in the addresses of the app."),
        title: z.string().describe("Name."),
        archived: z.boolean().describe("Whether the series has ended."),
        upcomingAt: timestamp("Start of the next meeting, or null.").nullable(),
      })
      .describe("A series of the space."),
  )
  .describe("The meeting series of the space the caller can see.");

const adjacentMeetingSchema = z
  .object({
    id: uuid("ID of the meeting."),
    number: itemNumber("Number of the meeting in the addresses of the app."),
    title: z.string().describe("Title."),
    startsAt: timestamp("Start.").nullable(),
  })
  .describe("A neighboring meeting.");

const historyEntrySchema = z
  .object({
    meetingId: uuid("Meeting of the update."),
    meetingNumber: itemNumber("Number of that meeting in the addresses of the app."),
    meetingTitle: z.string().describe("Title of that meeting."),
    startsAt: timestamp("Start of that meeting.").nullable(),
    text: z.string().describe("The update as plain text."),
  })
  .describe("An earlier update.");

export const meetingSchema = z
  .object({
    id: uuid("ID of the meeting page."),
    number: itemNumber("Number of the meeting page in the addresses of the app."),
    seriesId: uuid("The series, or null when the caller cannot read it.").nullable(),
    seriesNumber: itemNumber(
      "Number of the series in the addresses of the app, or null when the caller cannot read it.",
    ).nullable(),
    seriesTitle: z
      .string()
      .nullable()
      .describe("Name of the series, or null when the caller cannot read it."),
    title: z.string().describe("Title of the meeting page."),
    state: meetingStateSchema,
    next: z
      .boolean()
      .describe(
        "True for the next meeting of the series: the earliest one that is neither held nor skipped.",
      ),
    current: z.boolean().describe("Whether the meeting is open: upcoming or reopened."),
    startsAt: timestamp("Start, or null when not scheduled yet.").nullable(),
    recurrenceId: timestamp("Original start in the rhythm, or null.").nullable(),
    durationMinutes: z.number().int().describe("Duration in minutes."),
    timeZone: z
      .string()
      .nullable()
      .describe("Time zone of the series, or null when the caller cannot read the series."),
    closedAt: timestamp("When the meeting was closed or skipped.").nullable(),
    closedBy: z
      .object({ id: uuid("Account ID."), name: z.string().nullable().describe("Name, if visible.") })
      .nullable()
      .describe("Who closed it."),
    nextMeetingId: uuid(
      "The meeting created when this one was closed or skipped, or null when the caller cannot read the series.",
    ).nullable(),
    previousMeeting: adjacentMeetingSchema
      .nullable()
      .describe("The meeting of the series before this one that the caller can read, skipped ones left out."),
    followingMeeting: adjacentMeetingSchema
      .nullable()
      .describe("The meeting of the series after this one that the caller can read, skipped ones left out."),
    rhythm: z
      .boolean()
      .nullable()
      .describe(
        "Whether the series has a fixed rhythm; without one, closing asks for the next date. Null when the caller cannot read the series.",
      ),
    attendees: z
      .array(
        z
          .object({
            id: uuid("Account ID."),
            name: z.string().nullable().describe("Name, if visible."),
            pictureRef: pictureRefField,
            attendance: extensibleEnum(attendanceValues, "Attendance, or null when not recorded.").nullable(),
            member: z
              .boolean()
              .nullable()
              .describe(
                "Whether the person is a member of the series, or null when the caller cannot read it.",
              ),
            active: z
              .boolean()
              .describe(
                "Whether the person can still take part: false when the account is deactivated, not set up yet or no longer a member of the organization. Always true for people the caller may not see.",
              ),
            canRead: z.boolean().describe("Whether the person can read the meeting page."),
          })
          .describe("An attendee."),
      )
      .describe("Attendees in order."),
    extra: z.boolean().describe("True for an additional meeting outside the rhythm."),
    guests: z
      .array(
        z
          .object({
            id: uuid("ID of the guest entry."),
            name: z.string().describe("Name as entered."),
            note: z.string().nullable().describe("Optional note, such as the company."),
            attendance: extensibleEnum(attendanceValues, "Attendance, or null when not recorded.").nullable(),
          })
          .describe("A person without an account. Guests have no access to anything."),
      )
      .describe("Guests without an account, in order."),
    calendarUid: z.string().nullable().describe("Calendar UID of the meeting when it comes from a calendar."),
  })
  .describe("A meeting.");

export const exampleMeeting = {
  id: exampleMeetingSummary.id,
  number: exampleMeetingSummary.number,
  seriesId: exampleSeries.id,
  seriesNumber: exampleSeries.number,
  seriesTitle: exampleSeries.title,
  title: exampleMeetingSummary.title,
  state: "upcoming",
  next: true,
  current: true,
  startsAt: exampleMeetingSummary.startsAt,
  recurrenceId: exampleMeetingSummary.recurrenceId,
  durationMinutes: 45,
  timeZone: "Europe/Vienna",
  closedAt: null,
  closedBy: null,
  nextMeetingId: null,
  previousMeeting: null,
  followingMeeting: null,
  rhythm: true,
  attendees: [
    {
      id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      name: "Anna Berger",
      pictureRef: null,
      attendance: "present",
      member: true,
      active: true,
      canRead: true,
    },
  ],
  extra: false,
  guests: [
    {
      id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6c00",
      name: "Martin Huber",
      note: "Printer service",
      attendance: null,
    },
  ],
  calendarUid: null,
};

export const addGuestSchema = z
  .object({
    name: z
      .string()
      .max(GUEST_NAME_MAX_LENGTH * 2)
      .describe(`Name of the person, 1 to ${GUEST_NAME_MAX_LENGTH} characters.`),
    note: z
      .string()
      .max(GUEST_NOTE_MAX_LENGTH * 2)
      .nullable()
      .optional()
      .describe(`Optional note, up to ${GUEST_NOTE_MAX_LENGTH} characters.`),
  })
  .strict()
  .describe("A guest without an account, recorded for the attendance of this meeting only.");

export const guestCreatedSchema = z
  .object({ id: uuid("ID of the guest entry.") })
  .describe("The new guest entry.");

const agendaTaskSchema = z
  .object({
    id: uuid("ID of the task."),
    text: z.string().describe("Text of the task."),
    done: z.boolean().describe("Whether the task is done."),
    dueDate: z.string().nullable().describe("Due date as `YYYY-MM-DD`, or null."),
    assignee: z
      .object({ id: uuid("Account ID."), name: z.string().nullable().describe("Name, if visible.") })
      .nullable()
      .describe("The assignee, or null."),
    meetingId: uuid("Meeting the task was written in."),
  })
  .describe("A task.");

export const agendaSchema = z
  .object({
    meetingId: uuid("The meeting."),
    meetingNumber: itemNumber("Number of the meeting in the addresses of the app."),
    seriesId: uuid("Its series."),
    seriesNumber: itemNumber("Number of its series in the addresses of the app."),
    current: z
      .boolean()
      .describe(
        "True while the meeting is open: then the list holds all open topics. A closed meeting lists the topics it discussed.",
      ),
    topics: z
      .array(
        z
          .object({
            id: uuid("ID of the topic."),
            number: itemNumber("Number of the topic in the addresses of the app."),
            title: z.string().describe("Title."),
            status: extensibleEnum(topicStatuses, "Whether the topic is open."),
            outcome: extensibleEnum(topicOutcomes, "How a closed topic ended.").nullable(),
            oneOff: z
              .boolean()
              .describe("True for a topic of this meeting only; it closes with the meeting."),
            owner: z
              .object({ id: uuid("Account ID."), name: z.string().nullable().describe("Name, if visible.") })
              .nullable()
              .describe("Who owns the topic."),
            labels: z.array(z.string()).describe("Labels."),
            createdAt: timestamp("When the topic was raised."),
            update: z
              .object({
                text: z
                  .string()
                  .describe("The update of this meeting as plain text, paragraphs on own lines."),
                formatted: z
                  .boolean()
                  .describe("True when the update has formatting; change it in the notes then."),
              })
              .nullable()
              .describe("This meeting's update, or null when the notes have no block for the topic."),
            previous: z
              .array(historyEntrySchema)
              .describe("The last earlier updates the caller can read, newest first."),
            history: z
              .array(historyEntrySchema)
              .describe(
                "All updates of meetings before this one that the caller can read, oldest first. The first is the start of the topic.",
              ),
            meetings: z
              .number()
              .int()
              .min(1)
              .describe("How many meetings of the series the topic has been on, this one included."),
            tasks: z.array(agendaTaskSchema).describe("Tasks written in the updates of this topic."),
          })
          .describe("A topic on the agenda."),
      )
      .describe("Topics in the order of the series."),
    closedTopics: z.number().int().min(0).describe("How many topics were closed in this meeting."),
    decisions: z
      .array(
        z
          .object({
            id: uuid("Decision ID."),
            topicId: uuid("Topic it closed, or null.").nullable(),
            topicTitle: z.string().nullable().describe("Title of that topic, if visible."),
            text: z.string().describe("The statement as plain text."),
          })
          .describe("A decision."),
      )
      .describe("Decisions recorded in this meeting."),
    tasks: z.array(agendaTaskSchema).describe("Tasks written in this meeting."),
  })
  .describe("The agenda of a meeting.");

export const saveUpdateSchema = z
  .object({
    text: z
      .string()
      .max(UPDATE_TEXT_MAX_LENGTH)
      .describe(`The update as plain text, up to ${UPDATE_TEXT_MAX_LENGTH} characters. Empty clears it.`),
  })
  .strict()
  .describe("This meeting's update of a topic.");

export const addAgendaTaskSchema = z
  .object({
    text: z
      .string()
      .max(AGENDA_TASK_TEXT_MAX_LENGTH * 2)
      .describe(`What is to be done, 1 to ${AGENDA_TASK_TEXT_MAX_LENGTH} characters.`),
    assigneeId: uuid("Who does it.").nullable().optional(),
    dueDate: z.iso.date().nullable().optional().describe("Due date as `YYYY-MM-DD`."),
  })
  .strict()
  .describe("A task for a topic, written into this meeting's update.");

export const agendaTaskCreatedSchema = z.object({ id: uuid("ID of the task.") }).describe("The new task.");

export const moveTopicSchema = z
  .object({
    topicId: uuid("The topic to move."),
    afterId: uuid("The topic it goes after, or null for the top.").nullable(),
  })
  .strict()
  .describe("A new place of an open topic in the order of the series.");

export const nextDateSchema = z
  .object({
    nextStartsAt: inputTimestamp("Start of the next meeting for a series without a fixed rhythm.")
      .nullable()
      .optional()
      .describe(
        "For a series without a fixed rhythm: the start of the next meeting, or null for `not scheduled yet`. Ignored with a rhythm.",
      ),
  })
  .strict()
  .describe("How to continue the series.");

export const moveMeetingSchema = z
  .object({
    startsAt: inputTimestamp("New start of the meeting.")
      .nullable()
      .describe("New start, or null for `not scheduled yet` without a fixed rhythm."),
  })
  .strict()
  .describe("The new start.");

export const attendanceSchema = z
  .object({
    attendance: z
      .enum(attendanceValues)
      .nullable()
      .describe("`present`, `excused`, `absent`, or null to clear."),
  })
  .strict()
  .describe("The attendance of one attendee.");

export const addAttendeeSchema = z
  .object({ accountId: uuid("The person to add.") })
  .strict()
  .describe("An attendee beyond the members.");

export const topicSchema = z
  .object({
    id: uuid("ID of the topic."),
    number: itemNumber("Number of the topic in the addresses of the app."),
    seriesId: uuid("The series."),
    seriesNumber: itemNumber("Number of the series in the addresses of the app."),
    title: z.string().describe("Title."),
    status: extensibleEnum(topicStatuses, "Whether the topic is open."),
    outcome: extensibleEnum(topicOutcomes, "How a closed topic ended.").nullable(),
    owner: z
      .object({ id: uuid("Account ID."), name: z.string().nullable().describe("Name, if visible.") })
      .nullable()
      .describe("Who owns the topic."),
    labels: z.array(z.string()).describe("Labels."),
    oneOff: z.boolean().describe("True for a topic of one meeting only; it closes with that meeting."),
    raisedIn: z
      .object({
        id: uuid("Meeting ID."),
        number: itemNumber("Number of the meeting in the addresses of the app."),
        title: z.string().describe("Title of the meeting."),
        startsAt: timestamp("Start of the meeting.").nullable(),
      })
      .nullable()
      .describe("The meeting the topic was raised in, if the caller can read it."),
    updates: z.number().int().describe("Number of updates the caller can read."),
    openTasks: z.number().int().describe("Open tasks written in those updates."),
    lastUpdateAt: timestamp("When the last update was written.").nullable(),
    lastUpdateText: z
      .string()
      .nullable()
      .describe("Text of the last update that is not empty, in one line, or null when there is none."),
    createdAt: timestamp("When the topic was raised."),
    closedAt: timestamp("When the topic was closed.").nullable(),
    decisionId: uuid("The decision that closed the topic.").nullable(),
  })
  .describe("A running topic.");

export const exampleTopic = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6b00",
  number: 1052,
  seriesId: exampleSeries.id,
  seriesNumber: exampleSeries.number,
  title: "Positions in AD",
  status: "open",
  outcome: null,
  owner: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  labels: ["directory"],
  oneOff: false,
  raisedIn: {
    id: exampleMeetingSummary.id,
    number: exampleMeetingSummary.number,
    title: exampleMeetingSummary.title,
    startsAt: exampleMeetingSummary.startsAt,
  },
  updates: 3,
  openTasks: 1,
  lastUpdateAt: "2026-10-05T08:30:00.000Z",
  lastUpdateText: "Positions stay in AD; the sync runs nightly.",
  createdAt: "2026-09-21T08:00:00.000Z",
  closedAt: null,
  decisionId: null,
};

export const topicDetailsSchema = topicSchema
  .extend({
    spaceId: uuid("Space of the topic."),
    seriesTitle: z.string().describe("Name of the series."),
    timeline: z
      .array(
        z
          .object({
            meetingId: uuid("Meeting the update was written in."),
            meetingNumber: itemNumber("Number of that meeting in the addresses of the app."),
            meetingTitle: z.string().describe("Title of that meeting."),
            startsAt: timestamp("Start of that meeting.").nullable(),
            content: z.array(z.json()).describe("The update as blocks of the editor schema."),
            updatedAt: timestamp("When the update was last changed."),
          })
          .describe("An update."),
      )
      .describe("All updates the caller can read, oldest first. Skipped meetings are left out."),
    decision: z
      .object({
        id: uuid("Decision ID."),
        itemId: uuid("Page that holds the decision."),
        itemNumber: itemNumber("Number of that page in the addresses of the app."),
        itemTitle: z.string().describe("Title of that page."),
        statement: z.array(z.json()).describe("The statement as blocks of the editor schema."),
        text: z.string().describe("The statement as plain text."),
      })
      .nullable()
      .describe("The decision that closed the topic, if the caller can read it."),
  })
  .describe("A running topic with its history.");

export const topicQuerySchema = z
  .object({
    status: z
      .enum([...topicStatuses, "all"])
      .default("open")
      .describe("`open` (default), `closed` or `all`."),
    ownerId: uuid("Only topics of this owner.").optional(),
    label: z.string().max(100).optional().describe("Only topics with this label."),
    from: inputTimestamp("Only topics updated at or after this moment.").optional(),
    to: inputTimestamp("Only topics updated before this moment.").optional(),
    text: z.string().max(200).optional().describe("Only topics whose title contains this text."),
    limit: z.coerce.number().int().min(1).max(500).default(200).describe("Maximum number of topics."),
  })
  .strict();

export const createTopicSchema = z
  .object({
    title: z
      .string()
      .max(TOPIC_TITLE_MAX_LENGTH * 2)
      .describe(`Title, 1 to ${TOPIC_TITLE_MAX_LENGTH} characters.`),
    ownerId: uuid("Owner; the caller when left out.").nullable().optional(),
    labels: z.array(z.string().max(200)).max(MAX_TOPIC_LABELS).optional().describe("Labels."),
    meetingId: uuid("Meeting the topic is raised in; the current meeting when left out.").optional(),
    oneOff: z
      .boolean()
      .optional()
      .describe(
        "True for a topic of the given meeting only. It closes when that meeting is closed. Needs `meetingId`.",
      ),
    description: z
      .string()
      .max(UPDATE_TEXT_MAX_LENGTH)
      .optional()
      .describe(
        `What the topic is about, up to ${UPDATE_TEXT_MAX_LENGTH} characters. It becomes the topic's update in the meeting it is raised in, the first entry of its history. Needs a meeting that has not been closed.`,
      ),
  })
  .strict()
  .describe("A new running topic. It is added to the upcoming meeting.");

export const updateTopicSchema = z
  .object({
    title: z
      .string()
      .max(TOPIC_TITLE_MAX_LENGTH * 2)
      .optional()
      .describe("New title."),
    ownerId: uuid("New owner, or null for none.").nullable().optional(),
    labels: z.array(z.string().max(200)).max(MAX_TOPIC_LABELS).optional().describe("All labels."),
  })
  .strict()
  .describe("Changes to a topic.");

export const closeTopicSchema = z
  .object({
    outcome: z
      .enum(["resolved", "dropped"])
      .describe("How the topic ended. Use the decision endpoint for `decided`."),
    meetingId: uuid("Meeting in which it was closed; the current meeting when left out.").optional(),
  })
  .strict()
  .describe("Closing a topic. It no longer appears in later meetings; its history stays.");

export const decideTopicSchema = z
  .object({
    statement: z
      .string()
      .max(MAX_STATEMENT_LENGTH * 2)
      .default("")
      .describe(`The decision, up to ${MAX_STATEMENT_LENGTH} characters; it can be completed in the page.`),
    meetingId: uuid("Meeting to record the decision in; the current meeting when left out.").optional(),
  })
  .strict()
  .describe("Closing a topic as a decision.");

export const decisionEntrySchema = z
  .object({
    id: uuid("Decision ID."),
    statement: z.array(z.json()).describe("The statement as blocks of the editor schema."),
    text: z.string().describe("The statement as plain text."),
    meeting: z
      .object({
        id: uuid("Meeting ID."),
        number: itemNumber("Number of the meeting in the addresses of the app."),
        title: z.string().describe("Title."),
        startsAt: timestamp("Start of the meeting.").nullable(),
      })
      .describe("The meeting it was recorded in."),
    topic: z
      .object({
        id: uuid("Topic ID."),
        number: itemNumber("Number of the topic in the addresses of the app."),
        title: z.string().describe("Title."),
      })
      .nullable()
      .describe("The topic it closed, if visible."),
    recordedAt: timestamp("When the decision was first recorded."),
  })
  .describe("A decision.");

export const decisionQuerySchema = z
  .object({
    from: inputTimestamp("Only decisions of meetings at or after this moment.").optional(),
    to: inputTimestamp("Only decisions of meetings before this moment.").optional(),
    topicId: uuid("Only decisions of this topic.").optional(),
    text: z.string().max(200).optional().describe("Only decisions containing this text."),
    limit: z.coerce.number().int().min(1).max(500).default(100).describe("Maximum number of decisions."),
  })
  .strict();

export const meetingsQuerySchema = z
  .object({
    cursor: z.string().max(200).optional().describe("Cursor from `nextCursor` of the previous page."),
    limit: z.coerce.number().int().min(1).max(200).default(50).describe("Maximum number of meetings."),
  })
  .strict();

export const privateNotesSchema = z
  .object({
    meetingId: uuid("The meeting."),
    document: documentSchema,
    schemaVersion: z.number().int().describe("Version of the editor schema."),
    revision: z.number().int().describe("Revision of the stored notes; 0 when there are none yet."),
    updatedAt: timestamp("When the notes were last saved.").nullable(),
  })
  .describe("The caller's private notes on a meeting. Nobody else can read them.");

export const examplePrivateNotes = {
  meetingId: exampleMeetingSummary.id,
  document: exampleDocument,
  schemaVersion: 4,
  revision: 3,
  updatedAt: "2026-10-12T07:40:00.000Z",
};

export const savePrivateNotesSchema = z
  .object({
    document: documentSchema,
    revision: z
      .number()
      .int()
      .min(0)
      .describe(
        "The revision the notes are based on; 0 for the first save. A mismatch is refused with `notesChanged`.",
      ),
  })
  .strict()
  .describe("Private notes to store.");

export const upcomingSchema = z
  .array(
    z
      .object({
        id: uuid("Meeting ID."),
        number: itemNumber("Number of the meeting in the addresses of the app."),
        title: z.string().describe("Title."),
        startsAt: timestamp("Start, or null when not scheduled yet.").nullable(),
        durationMinutes: z.number().int().describe("Duration in minutes."),
        seriesId: uuid("The series, or null when the caller cannot read it.").nullable(),
        seriesNumber: itemNumber(
          "Number of the series in the addresses of the app, or null when the caller cannot read it.",
        ).nullable(),
        seriesTitle: z
          .string()
          .nullable()
          .describe("Name of the series, or null when the caller cannot read it."),
        spaceId: uuid("The space."),
        spaceKey: z.string().describe("Key of the space."),
        oneOnOne: z.boolean().describe("Whether it is a one-on-one."),
      })
      .describe("An upcoming meeting."),
  )
  .describe("Upcoming meetings the caller can read, the soonest first.");

export const upcomingQuerySchema = z
  .object({
    oneOnOne: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional()
      .describe("`true` for one-on-ones only, `false` for other series only; both when left out."),
    limit: z.coerce.number().int().min(1).max(50).default(10).describe("Maximum number of meetings."),
  })
  .strict();

export const createOneOnOneSchema = z
  .object({
    otherId: uuid("The other person."),
    organizationId: uuid("Organization in which both are members; it owns the confidential space."),
    ...scheduleFields,
  })
  .strict()
  .describe("A new one-on-one: a confidential space for two people with a series.");

export const successorSchema = z
  .object({
    previousId: uuid("The person who leaves the one-on-one."),
    successorId: uuid("The person who follows."),
    mode: z
      .enum(["add", "new"])
      .describe(
        "`add` adds the successor to this one-on-one, who then sees all earlier meetings; `new` starts a new one-on-one.",
      ),
  })
  .strict()
  .describe("A change of person in a one-on-one.");

export const oneOnOneSchema = z
  .object({
    spaceId: uuid("The confidential space."),
    spaceKey: z.string().describe("Its key."),
    seriesId: uuid("The series.").nullable(),
    seriesNumber: itemNumber("Number of the series in the addresses of the app.").nullable(),
    partners: z
      .array(
        z
          .object({
            id: uuid("Account ID."),
            name: z.string().nullable().describe("Name."),
            pictureRef: pictureRefField,
          })
          .describe("A person."),
      )
      .describe("The other people of the one-on-one."),
    nextMeeting: z
      .object({
        id: uuid("Meeting ID."),
        number: itemNumber("Number of the meeting in the addresses of the app."),
        startsAt: timestamp("Start.").nullable(),
      })
      .nullable()
      .describe("The next meeting."),
  })
  .describe("A one-on-one of the caller.");

export const organizationsSchema = z
  .array(
    z
      .object({ id: uuid("Organization ID."), name: z.string().describe("Name.") })
      .describe("An organization."),
  )
  .describe("Organizations in which both people are members.");

export const privateNotesListSchema = z
  .array(
    z
      .object({
        meetingId: uuid("The meeting."),
        meetingNumber: itemNumber("Number of the meeting in the addresses of the app."),
        meetingTitle: z.string().describe("Title of the meeting."),
        startsAt: timestamp("Start of the meeting.").nullable(),
        document: documentSchema,
        updatedAt: timestamp("When the notes were last saved."),
      })
      .describe("Private notes on one meeting."),
  )
  .describe("The caller's private notes in this series, newest meeting first.");
