import type { DocumentJson } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { organizationMembership } from "../authorization/space-access.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import { insertInitialDocument, type PageDocumentService } from "../spaces/documents.js";
import { positionBetween } from "../spaces/fractional-index.js";
import { lockSpaces } from "../spaces/items.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { refreshReaderVisibility, visibleItem } from "../spaces/visibility.js";
import type { TemplateLanguage } from "../templates/builtin/types.js";
import type { PageTemplate, TemplateService } from "../templates/templates.js";
import {
  addTopicUpdates,
  removeEmptyTopicUpdate,
  type SectionTitles,
  withoutStableIds,
  withSeriesTaskReport,
} from "./meeting-document.js";
import {
  firstStart,
  nextOccurrence,
  type Override,
  type Rhythm,
  recurrenceOf,
  rhythmOf,
  type Schedule,
  ScheduleError,
  validateSchedule,
} from "./schedule.js";
import type { Attendance, MeetingReminder, MeetingState, ScheduleSource } from "./schema.js";

export const SERIES_NAME_MAX_LENGTH = 200;
export const MAX_SERIES_MEMBERS = 100;
export const MAX_ATTENDEES = 200;
export const DEFAULT_TEMPLATE_ID = "builtin:team-meeting";
export const ONE_ON_ONE_TEMPLATE_ID = "builtin:one-on-one";

const SECTION_TITLES: Record<TemplateLanguage, SectionTitles & { notScheduled: string }> = {
  en: { runningTopics: "Running topics", openTasks: "Open tasks", notScheduled: "not scheduled yet" },
  de: { runningTopics: "Laufende Themen", openTasks: "Offene Aufgaben", notScheduled: "noch nicht geplant" },
};

export interface SeriesScheduleInput {
  rhythm: Rhythm;
  startsOn: string;
  startTime: string;
  timeZone: string;
  durationMinutes: number;
}

export interface CreateSeriesInput extends SeriesScheduleInput {
  name: string;
  reminder?: MeetingReminder | undefined;
  parentId: string | null;
  members: string[];
  templateId: string;
}

function activeAccount(account: SQL, organizationId: string | null): SQL {
  return sql`(${account}.state in ('active', 'invited')
    and ${organizationMembership(sql`${organizationId}::uuid`, sql`${account}.id`)})`;
}

export interface SeriesMember {
  id: string;
  name: string | null;
  active: boolean;
  canRead: boolean;
}

export interface MeetingSummary {
  id: string;
  title: string;
  state: MeetingState;
  startsAt: Date | null;
  recurrenceId: Date | null;
  durationMinutes: number;
  attendees: number;
  present: number;
}

export interface SeriesDetails {
  id: string;
  spaceId: string;
  title: string;
  parentId: string | null;
  archived: boolean;
  oneOnOne: boolean;
  members: SeriesMember[];
  schedule: {
    rhythm: Rhythm | null;
    recurrence: string | null;
    startsOn: string;
    startTime: string;
    timeZone: string;
    durationMinutes: number;
  };
  template: { id: string; name: string | null };
  reminder: MeetingReminder;
  source: ScheduleSource;
  calendarUid: string | null;
  upcoming: MeetingSummary | null;
  openTopics: number;
  createdAt: Date;
}

export interface MeetingAttendee {
  id: string;
  name: string | null;
  attendance: Attendance | null;
  member: boolean | null;
  active: boolean;
  canRead: boolean;
}

export interface MeetingDetails {
  id: string;
  seriesId: string | null;
  seriesTitle: string | null;
  title: string;
  state: MeetingState;
  current: boolean;
  startsAt: Date | null;
  recurrenceId: Date | null;
  durationMinutes: number;
  timeZone: string | null;
  closedAt: Date | null;
  closedBy: { id: string; name: string | null } | null;
  nextMeetingId: string | null;
  rhythm: boolean | null;
  attendees: MeetingAttendee[];
  calendarUid: string | null;
}

export interface UpcomingMeeting {
  id: string;
  title: string;
  startsAt: Date | null;
  durationMinutes: number;
  seriesId: string | null;
  seriesTitle: string | null;
  spaceId: string;
  spaceKey: string;
  oneOnOne: boolean;
}

type SeriesRow = {
  item_id: string;
  space_id: string;
  organization_id: string | null;
  title: string;
  recurrence: string | null;
  starts_on: string;
  start_time: string;
  time_zone: string;
  duration_minutes: number;
  template_id: string;
  archived: boolean;
  trashed: boolean;
};

type MeetingRow = {
  item_id: string;
  series_id: string;
  recurrence_id: Date | string | null;
  starts_at: Date | string | null;
  duration_minutes: number;
  state: MeetingState;
  closed_at: Date | string | null;
  closed_by: string | null;
  next_meeting_id: string | null;
  calendar_uid: string | null;
  title: string;
};

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function scheduleOf(row: SeriesRow): Schedule {
  return {
    recurrence: row.recurrence,
    startsOn: row.starts_on,
    startTime: row.start_time,
    timeZone: row.time_zone,
  };
}

function cleanName(name: string): string {
  const value = name.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > SERIES_NAME_MAX_LENGTH) {
    throw new SpaceError("invalidTitle", `The name needs 1 to ${SERIES_NAME_MAX_LENGTH} characters`);
  }
  return value;
}

function cleanDuration(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    throw new SpaceError("invalidDuration", "Choose a duration between 5 minutes and 24 hours");
  }
  return minutes;
}

function scheduleFrom(input: SeriesScheduleInput): Schedule {
  try {
    const schedule = {
      recurrence: recurrenceOf(input.rhythm),
      startsOn: input.startsOn,
      startTime: input.startTime,
      timeZone: input.timeZone,
    };
    validateSchedule(schedule);
    return schedule;
  } catch (error) {
    if (error instanceof ScheduleError) throw new SpaceError(error.code, error.message);
    throw error;
  }
}

export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function displayDate(instant: Date, timeZone: string, language: TemplateLanguage): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-AT" : "en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(instant);
}

export class MeetingService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #documents: PageDocumentService;
  readonly #templates: TemplateService;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;
  readonly #activity: ContentActivity;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    documents: PageDocumentService;
    templates: TemplateService;
    people: PeopleService;
    notifications: NotificationService;
    activity: ContentActivity;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#documents = options.documents;
    this.#templates = options.templates;
    this.#people = options.people;
    this.#notifications = options.notifications;
    this.#activity = options.activity;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #series(executor: Executor, seriesId: string, lock = false): Promise<SeriesRow> {
    const result = await executor.execute<SeriesRow>(sql`
      select ms.item_id, t.space_id, s.organization_id, t.title, ms.recurrence, ms.starts_on, ms.start_time,
        ms.time_zone, ms.duration_minutes, ms.template_id,
        (t.archived_root_id is not null or s.archived_at is not null) as archived,
        (t.trash_entry_id is not null or s.deleted_at is not null) as trashed
      from meeting_series ms join tree_items t on t.id = ms.item_id join spaces s on s.id = t.space_id
      where ms.item_id = ${seriesId} ${lock ? sql`for update of ms` : sql``}`);
    const row = result.rows[0];
    if (!row || row.trashed) throw new SpaceError("seriesNotFound", "The meeting series does not exist");
    return row;
  }

  async #writableSeries(tx: Transaction, seriesId: string): Promise<SeriesRow> {
    const series = await this.#series(tx, seriesId, true);
    if (series.archived) {
      throw new SpaceError(
        "seriesEnded",
        "The series has ended; bring it back from the archive to plan meetings",
      );
    }
    return series;
  }

  async #meeting(executor: Executor, meetingId: string, lock = false): Promise<MeetingRow> {
    const result = await executor.execute<MeetingRow>(sql`
      select m.item_id, m.series_id, m.recurrence_id, m.starts_at, m.duration_minutes, m.state, m.closed_at,
        m.closed_by, m.next_meeting_id, m.calendar_uid, t.title
      from meetings m join tree_items t on t.id = m.item_id
      where m.item_id = ${meetingId} and t.trash_entry_id is null ${lock ? sql`for update of m` : sql``}`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("meetingNotFound", "The meeting does not exist");
    return row;
  }

  async seriesOfMeeting(meetingId: string, executor: Executor = this.#database): Promise<string | null> {
    const result = await executor.execute<{ series_id: string }>(
      sql`select series_id from meetings where item_id = ${meetingId}`,
    );
    return result.rows[0]?.series_id ?? null;
  }

  async #overrides(executor: Executor, seriesId: string): Promise<Override[]> {
    const result = await executor.execute<{ recurrence_id: Date | string; starts_at: Date | string | null }>(
      sql`select recurrence_id, starts_at from meeting_occurrence_overrides where series_id = ${seriesId}`,
    );
    return result.rows.map((row) => ({
      recurrenceId: new Date(row.recurrence_id),
      startsAt: toDate(row.starts_at),
    }));
  }

  async #validMembers(
    tx: Executor,
    actor: Principal,
    spaceId: string,
    members: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(members.map((id) => id.toLowerCase()))];
    if (unique.length > MAX_SERIES_MEMBERS) {
      throw new SpaceError("tooManyMembers", `A series can have up to ${MAX_SERIES_MEMBERS} members`);
    }
    for (const id of unique) {
      if (!(await this.#people.canSee(actor, id, tx))) {
        throw new SpaceError("invalidMember", "Choose members among the people you can see");
      }
    }
    const space = await tx.execute<{ confidential: boolean }>(
      sql`select confidential from spaces where id = ${spaceId}`,
    );
    if (space.rows[0]?.confidential && unique.length > 0) {
      const holders = await tx.execute<{ principal_id: string }>(sql`
        select principal_id from space_permissions
        where space_id = ${spaceId} and principal_kind = 'account' and principal_id = any(${sql.param(unique)}::uuid[])`);
      if (holders.rows.length !== unique.length) {
        throw new SpaceError(
          "invalidMember",
          "Members of a series in a confidential space must be members of the space first",
        );
      }
    }
    return unique;
  }

  async #template(actor: Principal, spaceId: string, templateId: string): Promise<PageTemplate> {
    const usable = await this.#templates.usable(actor, spaceId);
    const found = usable.find((template) => template.id === templateId);
    if (found) return found;
    const fallback = usable.find((template) => template.id === DEFAULT_TEMPLATE_ID);
    if (!fallback) throw new SpaceError("templateNotFound", "The template does not exist");
    return fallback;
  }

  async #openTopicIds(executor: Executor, seriesId: string): Promise<string[]> {
    const result = await executor.execute<{ item_id: string }>(sql`
      select mt.item_id from meeting_topics mt join tree_items t on t.id = mt.item_id
      where mt.series_id = ${seriesId} and mt.status = 'open' and t.trash_entry_id is null
      order by t.created_at, t.id`);
    return result.rows.map((row) => row.item_id);
  }

  async #createMeeting(
    tx: Transaction,
    actor: Principal,
    series: SeriesRow,
    at: { recurrenceId: Date | null; startsAt: Date | null },
    options: { carry?: DocumentJson } = {},
  ): Promise<string> {
    const language = await this.#templates.language(actor);
    const labels = SECTION_TITLES[language];
    const template = await this.#template(actor, series.space_id, series.template_id);
    const date = at.startsAt ?? this.#clock();
    const values = Object.fromEntries(
      template.fields
        .filter((field) => field.type === "date" && field.required)
        .map((field) => [field.key, localDate(date, series.time_zone)]),
    );
    const prepared = await this.#templates.prepare(actor, template, values, language);
    let document: DocumentJson = options.carry ? withoutStableIds(options.carry) : prepared.document;
    document = addTopicUpdates(document, await this.#openTopicIds(tx, series.item_id), labels);
    document = withSeriesTaskReport(document, series.item_id, labels);
    const when = at.startsAt ? displayDate(at.startsAt, series.time_zone, language) : labels.notScheduled;
    const title = `${series.title} · ${when}`.slice(0, 255);
    const first = await tx.execute<{ position: string | null }>(sql`
      select min(position) as position from tree_items where parent_id = ${series.item_id}`);
    const position = positionBetween(null, first.rows[0]?.position ?? null);
    const actorId = actorIdOf(actor);
    const id = uuidv7();
    await tx.execute(sql`
      insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id)
      values (${id}, ${series.space_id}, ${series.item_id}, 'page', ${position}, ${title}, 'live', ${actorId}, ${actorId})`);
    await insertInitialDocument(tx, id, actorId, document);
    await tx.execute(sql`
      insert into meetings (item_id, series_id, recurrence_id, starts_at, duration_minutes, state)
      values (${id}, ${series.item_id}, ${at.recurrenceId}, ${at.startsAt}, ${series.duration_minutes}, 'upcoming')`);
    await tx.execute(sql`
      insert into meeting_attendees (meeting_id, account_id, position, added_by)
      select ${id}, mm.account_id, mm.position, ${actorId} from meeting_series_members mm
      join accounts a on a.id = mm.account_id and a.state in ('active', 'invited')
      where mm.series_id = ${series.item_id}`);
    await this.#activity.revealed(tx, await refreshReaderVisibility(tx, [id]));
    await this.#documents.afterInsert(tx, id, actorId);
    await signalSpaceChange(tx, { spaceId: series.space_id, kind: "tree", itemId: id });
    await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
    return id;
  }

  async createSeries(
    actor: Principal,
    spaceId: string,
    input: CreateSeriesInput,
    options: { tx?: Transaction; oneOnOne?: boolean } = {},
  ): Promise<string> {
    const name = cleanName(input.name);
    const durationMinutes = cleanDuration(input.durationMinutes);
    const schedule = scheduleFrom(input);
    const run = async (tx: Transaction) => {
      await lockSpaces(tx, [spaceId]);
      if (input.parentId) await this.#checkParent(tx, actor, spaceId, input.parentId);
      const members = await this.#validMembers(tx, actor, spaceId, input.members);
      const template = await this.#template(actor, spaceId, input.templateId);
      const last = await tx.execute<{ position: string | null }>(sql`
        select max(position) as position from tree_items
        where space_id = ${spaceId} and parent_id is not distinct from ${input.parentId}`);
      const actorId = actorIdOf(actor);
      const id = uuidv7();
      await tx.execute(sql`
        insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id)
        values (${id}, ${spaceId}, ${input.parentId}, 'meetingSeries', ${positionBetween(last.rows[0]?.position ?? null, null)},
          ${name}, 'live', ${actorId}, ${actorId})`);
      await tx.execute(sql`
        insert into meeting_series (item_id, recurrence, starts_on, start_time, time_zone, duration_minutes,
          template_id, reminder, created_by)
        values (${id}, ${schedule.recurrence}, ${schedule.startsOn}, ${schedule.startTime}, ${schedule.timeZone},
          ${durationMinutes}, ${template.id}, ${input.reminder ?? "oneDay"}, ${actorId})`);
      for (const [position, accountId] of members.entries()) {
        await tx.execute(sql`
          insert into meeting_series_members (series_id, account_id, position)
          values (${id}, ${accountId}, ${position})`);
      }
      await refreshReaderVisibility(tx, [id]);
      await this.#activity.created(tx, id, actorId);
      const series = await this.#series(tx, id, true);
      const start = firstStart(schedule);
      const first = schedule.recurrence
        ? nextOccurrence(schedule, [], { after: null, notBefore: new Date(start.getTime() - 1) })
        : null;
      await this.#createMeeting(tx, actor, series, first ?? { recurrenceId: null, startsAt: start });
      return id;
    };
    return options.tx ? run(options.tx) : this.#database.transaction(run);
  }

  async #checkParent(tx: Transaction, actor: Principal, spaceId: string, parentId: string): Promise<void> {
    const visible = await this.#authorization.explain(
      actor,
      "item.view",
      { type: "item", id: parentId },
      {
        executor: tx,
        fresh: true,
      },
    );
    const parent = await tx.execute<{ space_id: string; kind: string; in_tree: boolean }>(sql`
      select space_id, kind, (trash_entry_id is null and archived_root_id is null) as in_tree
      from tree_items where id = ${parentId}`);
    const row = parent.rows[0];
    if (
      !visible.allowed ||
      !row ||
      row.space_id !== spaceId ||
      !row.in_tree ||
      !["page", "folder"].includes(row.kind)
    ) {
      throw new SpaceError(
        "invalidPlacement",
        "A series can be placed below a page or folder of the same space",
      );
    }
  }

  async details(viewer: Principal, seriesId: string): Promise<SeriesDetails> {
    const series = await this.#series(this.#database, seriesId);
    const extra = await this.#database.execute<{
      source: ScheduleSource;
      reminder: MeetingReminder;
      calendar_uid: string | null;
      created_at: Date | string;
      parent_id: string | null;
      one_on_one: boolean;
      open_topics: string;
    }>(sql`
      select ms.source, ms.reminder, ms.calendar_uid, ms.created_at, t.parent_id, s.one_on_one,
        (select count(*) from meeting_topics mt join tree_items tt on tt.id = mt.item_id
          join spaces ts on ts.id = tt.space_id
          where mt.series_id = ms.item_id and mt.status = 'open'
            and ${visibleItem(this.#authorization, viewer, sql`tt`, sql`ts`)}) as open_topics
      from meeting_series ms join tree_items t on t.id = ms.item_id join spaces s on s.id = t.space_id
      where ms.item_id = ${seriesId}`);
    const row = extra.rows[0];
    if (!row) throw new SpaceError("seriesNotFound", "The meeting series does not exist");
    const members = await this.#members(viewer, series);
    const template = await this.#templates.get(series.template_id, await this.#templates.language(viewer));
    const upcoming = series.archived
      ? null
      : ((await this.meetings(viewer, seriesId, { upcoming: true })).items[0] ?? null);
    return {
      id: series.item_id,
      spaceId: series.space_id,
      title: series.title,
      parentId: row.parent_id,
      archived: series.archived,
      oneOnOne: row.one_on_one,
      members,
      schedule: {
        rhythm: rhythmOf(series.recurrence),
        recurrence: series.recurrence,
        startsOn: series.starts_on,
        startTime: series.start_time,
        timeZone: series.time_zone,
        durationMinutes: series.duration_minutes,
      },
      template: { id: series.template_id, name: template?.name ?? null },
      reminder: row.reminder,
      source: row.source,
      calendarUid: row.calendar_uid,
      upcoming,
      openTopics: Number(row.open_topics),
      createdAt: new Date(row.created_at),
    };
  }

  async #members(viewer: Principal, series: SeriesRow): Promise<SeriesMember[]> {
    const result = await this.#database.execute<{
      account_id: string;
      name: string | null;
      active: boolean;
    }>(sql`
      select mm.account_id, ${this.#people.visibleName(viewer, sql`a`)} as name,
        ${activeAccount(sql`a`, series.organization_id)} as active
      from meeting_series_members mm join accounts a on a.id = mm.account_id
      where mm.series_id = ${series.item_id} order by mm.position, mm.account_id`);
    const members: SeriesMember[] = [];
    for (const row of result.rows) {
      members.push({
        id: row.account_id,
        name: row.name,
        active: row.name === null || row.active,
        canRead: await this.#authorization.authorize(accountPrincipal(row.account_id), "item.view", {
          type: "item",
          id: series.item_id,
        }),
      });
    }
    return members;
  }

  async updateSeries(
    actor: Principal,
    seriesId: string,
    changes: {
      name?: string | undefined;
      members?: string[] | undefined;
      schedule?: SeriesScheduleInput | undefined;
      templateId?: string | undefined;
      reminder?: MeetingReminder | undefined;
    },
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const series = await this.#writableSeries(tx, seriesId);
      if (changes.name !== undefined) {
        const name = cleanName(changes.name);
        await tx.execute(
          sql`update tree_items set title = ${name}, updated_at = now() where id = ${seriesId}`,
        );
      }
      if (changes.templateId !== undefined) {
        const template = await this.#template(actor, series.space_id, changes.templateId);
        await tx.execute(sql`update meeting_series set template_id = ${template.id}, updated_at = now()
          where item_id = ${seriesId}`);
      }
      if (changes.reminder !== undefined) {
        await tx.execute(sql`update meeting_series set reminder = ${changes.reminder}, updated_at = now()
          where item_id = ${seriesId}`);
      }
      if (changes.members !== undefined) {
        const members = await this.#validMembers(tx, actor, series.space_id, changes.members);
        await tx.execute(sql`delete from meeting_series_members where series_id = ${seriesId}
          and not (account_id = any(${sql.param(members)}::uuid[]))`);
        for (const [position, accountId] of members.entries()) {
          await tx.execute(sql`
            insert into meeting_series_members (series_id, account_id, position)
            values (${seriesId}, ${accountId}, ${position})
            on conflict (series_id, account_id) do update set position = excluded.position, updated_at = now()`);
        }
        const upcoming = await tx.execute<{ item_id: string }>(
          sql`select item_id from meetings where series_id = ${seriesId} and state = 'upcoming'`,
        );
        const upcomingId = upcoming.rows[0]?.item_id;
        if (upcomingId) {
          await tx.execute(sql`
            insert into meeting_attendees (meeting_id, account_id, position, added_by)
            select ${upcomingId}, account_id, position, ${actorIdOf(actor)} from meeting_series_members
            where series_id = ${seriesId}
            on conflict (meeting_id, account_id) do nothing`);
        }
      }
      if (changes.schedule !== undefined) {
        const durationMinutes = cleanDuration(changes.schedule.durationMinutes);
        const schedule = scheduleFrom(changes.schedule);
        await tx.execute(sql`
          update meeting_series set recurrence = ${schedule.recurrence}, starts_on = ${schedule.startsOn},
            start_time = ${schedule.startTime}, time_zone = ${schedule.timeZone},
            duration_minutes = ${durationMinutes}, updated_at = now()
          where item_id = ${seriesId}`);
        await tx.execute(sql`delete from meeting_occurrence_overrides where series_id = ${seriesId}`);
        await this.#reschedule(tx, actor, {
          ...series,
          ...this.#rowSchedule(schedule),
          duration_minutes: durationMinutes,
        });
      }
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: seriesId });
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "tree", itemId: seriesId });
    });
  }

  #rowSchedule(schedule: Schedule) {
    return {
      recurrence: schedule.recurrence,
      starts_on: schedule.startsOn,
      start_time: schedule.startTime,
      time_zone: schedule.timeZone,
    };
  }

  async #reschedule(tx: Transaction, actor: Principal, series: SeriesRow): Promise<void> {
    const upcoming = await tx.execute<MeetingRow>(sql`
      select m.item_id, m.series_id, m.recurrence_id, m.starts_at, m.duration_minutes, m.state, m.closed_at,
        m.closed_by, m.next_meeting_id, m.calendar_uid, t.title
      from meetings m join tree_items t on t.id = m.item_id
      where m.series_id = ${series.item_id} and m.state = 'upcoming' for update of m`);
    const meeting = upcoming.rows[0];
    if (!meeting) return;
    const previous = await tx.execute<{
      recurrence_id: Date | string | null;
      starts_at: Date | string | null;
    }>(sql`
      select recurrence_id, starts_at from meetings
      where series_id = ${series.item_id} and item_id <> ${meeting.item_id} and state in ('closed', 'skipped', 'reopened')
      order by coalesce(recurrence_id, starts_at) desc nulls last limit 1`);
    const schedule = scheduleOf(series);
    const after = toDate(previous.rows[0]?.recurrence_id ?? previous.rows[0]?.starts_at ?? null);
    const now = this.#clock();
    let at: { recurrenceId: Date | null; startsAt: Date | null };
    if (schedule.recurrence) {
      const next = nextOccurrence(schedule, [], {
        after,
        notBefore: after === null ? new Date(firstStart(schedule).getTime() - 1) : now,
      });
      at = next
        ? { recurrenceId: next.recurrenceId, startsAt: next.startsAt }
        : { recurrenceId: null, startsAt: null };
    } else {
      at = { recurrenceId: null, startsAt: toDate(meeting.starts_at) };
    }
    await tx.execute(sql`
      update meetings set recurrence_id = ${at.recurrenceId}, starts_at = ${at.startsAt},
        duration_minutes = ${series.duration_minutes}, updated_at = now()
      where item_id = ${meeting.item_id}`);
    await this.#retitle(tx, actor, series, meeting, at.startsAt);
  }

  async #retitle(
    tx: Transaction,
    actor: Principal,
    series: SeriesRow,
    meeting: MeetingRow,
    startsAt: Date | null,
  ): Promise<void> {
    const language = await this.#templates.language(actor);
    const labels = SECTION_TITLES[language];
    const known = new Set<string>();
    for (const lang of ["en", "de"] as const) {
      const old = toDate(meeting.starts_at);
      known.add(
        `${series.title} · ${old ? displayDate(old, series.time_zone, lang) : SECTION_TITLES[lang].notScheduled}`,
      );
    }
    if (!known.has(meeting.title)) return;
    const when = startsAt ? displayDate(startsAt, series.time_zone, language) : labels.notScheduled;
    await tx.execute(sql`update tree_items set title = ${`${series.title} · ${when}`.slice(0, 255)}, updated_at = now()
      where id = ${meeting.item_id}`);
  }

  async meetings(
    viewer: Principal,
    seriesId: string,
    options: { upcoming?: boolean; after?: [string, string] | undefined; limit?: number | undefined } = {},
  ): Promise<{ items: MeetingSummary[]; next: [string, string] | null }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const sortKey = sql`coalesce(m.starts_at, 'infinity'::timestamptz)`;
    const result = await this.#database.execute<{
      item_id: string;
      title: string;
      state: MeetingState;
      starts_at: Date | string | null;
      recurrence_id: Date | string | null;
      duration_minutes: number;
      attendees: string;
      present: string;
      sort_key: string;
    }>(sql`
      select m.item_id, t.title, m.state, m.starts_at, m.recurrence_id, m.duration_minutes, ${sortKey}::text as sort_key,
        (select count(*) from meeting_attendees a where a.meeting_id = m.item_id) as attendees,
        (select count(*) from meeting_attendees a where a.meeting_id = m.item_id and a.attendance = 'present') as present
      from meetings m join tree_items t on t.id = m.item_id join spaces s on s.id = t.space_id
      where m.series_id = ${seriesId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${options.upcoming ? sql`and m.state = 'upcoming'` : sql``}
        ${options.after ? sql`and (${sortKey}, m.item_id) < (${options.after[0]}::timestamptz, ${options.after[1]}::uuid)` : sql``}
      order by ${sortKey} desc, m.item_id desc
      limit ${limit + 1}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.item_id,
        title: row.title,
        state: row.state,
        startsAt: toDate(row.starts_at),
        recurrenceId: toDate(row.recurrence_id),
        durationMinutes: row.duration_minutes,
        attendees: Number(row.attendees),
        present: Number(row.present),
      })),
      next: result.rows.length > limit && last ? [last.sort_key, last.item_id] : null,
    };
  }

  async meeting(viewer: Principal, meetingId: string): Promise<MeetingDetails> {
    const meeting = await this.#meeting(this.#database, meetingId);
    const series = await this.#series(this.#database, meeting.series_id);
    const seriesVisible = await this.#authorization.authorize(viewer, "item.view", {
      type: "item",
      id: series.item_id,
    });
    const attendees = await this.#database.execute<{
      account_id: string;
      name: string | null;
      attendance: Attendance | null;
      member: boolean;
      active: boolean;
    }>(sql`
      select a.account_id, ${this.#people.visibleName(viewer, sql`p`)} as name, a.attendance,
        ${activeAccount(sql`p`, series.organization_id)} as active,
        exists (select 1 from meeting_series_members mm where mm.series_id = ${meeting.series_id}
          and mm.account_id = a.account_id) as member
      from meeting_attendees a join accounts p on p.id = a.account_id
      where a.meeting_id = ${meetingId} order by a.position, lower(p.name), a.account_id`);
    const list: MeetingAttendee[] = [];
    for (const row of attendees.rows) {
      list.push({
        id: row.account_id,
        name: row.name,
        attendance: row.attendance,
        member: seriesVisible ? row.member : null,
        active: row.name === null || row.active,
        canRead: await this.#authorization.authorize(accountPrincipal(row.account_id), "item.view", {
          type: "item",
          id: meetingId,
        }),
      });
    }
    const closer = meeting.closed_by
      ? await this.#people.visibleNames(viewer, [meeting.closed_by])
      : new Map();
    return {
      id: meeting.item_id,
      seriesId: seriesVisible ? meeting.series_id : null,
      seriesTitle: seriesVisible ? series.title : null,
      title: meeting.title,
      state: meeting.state,
      current:
        (!seriesVisible || !series.archived) &&
        (meeting.state === "upcoming" || meeting.state === "reopened"),
      startsAt: toDate(meeting.starts_at),
      recurrenceId: toDate(meeting.recurrence_id),
      durationMinutes: meeting.duration_minutes,
      timeZone: seriesVisible ? series.time_zone : null,
      closedAt: toDate(meeting.closed_at),
      closedBy: meeting.closed_by
        ? { id: meeting.closed_by, name: closer.get(meeting.closed_by) ?? null }
        : null,
      nextMeetingId: seriesVisible ? meeting.next_meeting_id : null,
      rhythm: seriesVisible ? series.recurrence !== null : null,
      attendees: list,
      calendarUid: meeting.calendar_uid,
    };
  }

  async #nextAt(
    tx: Transaction,
    series: SeriesRow,
    meeting: MeetingRow,
    input: { nextStartsAt?: Date | null | undefined },
  ): Promise<{ recurrenceId: Date | null; startsAt: Date | null }> {
    const schedule = scheduleOf(series);
    if (schedule.recurrence) {
      const next = nextOccurrence(schedule, await this.#overrides(tx, series.item_id), {
        after: toDate(meeting.recurrence_id) ?? toDate(meeting.starts_at),
        notBefore: this.#clock(),
      });
      if (next) return next;
      return { recurrenceId: null, startsAt: null };
    }
    if (input.nextStartsAt === undefined) {
      throw new SpaceError(
        "nextDateRequired",
        "The series has no fixed rhythm; choose the date of the next meeting",
      );
    }
    return { recurrenceId: null, startsAt: input.nextStartsAt };
  }

  async close(
    actor: Principal,
    meetingId: string,
    input: { nextStartsAt?: Date | null | undefined } = {},
  ): Promise<{ nextMeetingId: string | null }> {
    return this.#database.transaction(async (tx) => {
      const located = await this.#meeting(tx, meetingId);
      const series = await this.#writableSeries(tx, located.series_id);
      const meeting = await this.#meeting(tx, meetingId, true);
      if (meeting.state === "closed" || meeting.state === "skipped") {
        throw new SpaceError("meetingClosed", "Someone closed this meeting already");
      }
      const next = meeting.state === "upcoming" ? await this.#nextAt(tx, series, meeting, input) : null;
      await tx.execute(sql`
        update meetings set state = 'closed', closed_at = now(), closed_by = ${actorIdOf(actor)}, updated_at = now()
        where item_id = ${meetingId}`);
      let nextMeetingId: string | null = null;
      if (next) {
        nextMeetingId = await this.#createMeeting(tx, actor, series, next);
        await tx.execute(
          sql`update meetings set next_meeting_id = ${nextMeetingId} where item_id = ${meetingId}`,
        );
      }
      await this.#notifyAttendees(tx, actor, series, meeting);
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
      return { nextMeetingId };
    });
  }

  async #notifyAttendees(
    tx: Transaction,
    actor: Principal,
    series: SeriesRow,
    meeting: MeetingRow,
  ): Promise<void> {
    const attendees = await tx.execute<{ account_id: string }>(sql`
      select account_id from meeting_attendees where meeting_id = ${meeting.item_id}
        and account_id is distinct from ${actorIdOf(actor)}`);
    const recipients: string[] = [];
    for (const row of attendees.rows) {
      const allowed = await this.#authorization.explain(
        accountPrincipal(row.account_id),
        "item.view",
        {
          type: "item",
          id: meeting.item_id,
        },
        { executor: tx },
      );
      if (allowed.allowed) recipients.push(row.account_id);
    }
    if (recipients.length === 0) return;
    const space = await tx.execute<{ key: string }>(
      sql`select key from spaces where id = ${series.space_id}`,
    );
    await this.#notifications.notify(tx, {
      type: "meeting.notesAvailable",
      recipients,
      organizationId: series.organization_id,
      targetId: meeting.item_id,
      actor,
      params: {
        itemTitle: meeting.title,
        spaceKey: space.rows[0]?.key ?? "",
        startsAt: toDate(meeting.starts_at)?.toISOString() ?? null,
      },
    });
  }

  async undoClose(_actor: Principal, meetingId: string): Promise<{ removedMeetingId: string | null }> {
    return this.#database.transaction(async (tx) => {
      const located = await this.#meeting(tx, meetingId);
      const series = await this.#writableSeries(tx, located.series_id);
      const meeting = await this.#meeting(tx, meetingId, true);
      if (meeting.state !== "closed") throw new SpaceError("meetingNotClosed", "The meeting is not closed");
      const next = meeting.next_meeting_id;
      let removed: string | null = null;
      if (next && (await this.#untouched(tx, next))) {
        await tx.execute(sql`delete from tree_items where id = ${next}`);
        removed = next;
      }
      await tx.execute(sql`
        update meetings set state = ${removed ? "upcoming" : "reopened"}, closed_at = null, closed_by = null,
          next_meeting_id = ${removed ? null : next}, updated_at = now()
        where item_id = ${meetingId}`);
      await tx.execute(sql`
        delete from notifications where type = 'meeting.notesAvailable' and target_id = ${meetingId}
          and read_at is null`);
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "tree", itemId: series.item_id });
      return { removedMeetingId: removed };
    });
  }

  async #untouched(tx: Transaction, meetingId: string): Promise<boolean> {
    const result = await tx.execute<{ untouched: boolean }>(sql`
      select m.state = 'upcoming' and d.revision = 1
        and not exists (select 1 from meeting_attendees a where a.meeting_id = m.item_id and a.attendance is not null)
        and not exists (select 1 from meeting_topics t where t.raised_in_id = m.item_id)
        and not exists (select 1 from comments c where c.item_id = m.item_id)
        and not exists (select 1 from meeting_private_notes n where n.meeting_id = m.item_id)
        as untouched
      from meetings m join page_documents d on d.item_id = m.item_id where m.item_id = ${meetingId}
      for update of m`);
    return result.rows[0]?.untouched === true;
  }

  async reopen(_actor: Principal, meetingId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const located = await this.#meeting(tx, meetingId);
      const series = await this.#writableSeries(tx, located.series_id);
      const meeting = await this.#meeting(tx, meetingId, true);
      if (meeting.state !== "closed") throw new SpaceError("meetingNotClosed", "The meeting is not closed");
      await tx.execute(sql`
        update meetings set state = 'reopened', closed_at = null, closed_by = null, updated_at = now()
        where item_id = ${meetingId}`);
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
    });
  }

  async move(actor: Principal, meetingId: string, startsAt: Date | null): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const located = await this.#meeting(tx, meetingId);
      const series = await this.#writableSeries(tx, located.series_id);
      const meeting = await this.#meeting(tx, meetingId, true);
      if (meeting.state !== "upcoming") {
        throw new SpaceError("meetingNotUpcoming", "Only the upcoming meeting can be moved");
      }
      if (startsAt === null && series.recurrence !== null) {
        throw new SpaceError("startRequired", "Choose the new date and time of the meeting");
      }
      await tx.execute(
        sql`update meetings set starts_at = ${startsAt}, updated_at = now() where item_id = ${meetingId}`,
      );
      const recurrenceId = toDate(meeting.recurrence_id);
      if (recurrenceId) {
        await tx.execute(sql`
          insert into meeting_occurrence_overrides (series_id, recurrence_id, starts_at)
          values (${series.item_id}, ${recurrenceId}, ${startsAt})
          on conflict (series_id, recurrence_id) do update set starts_at = excluded.starts_at, updated_at = now()`);
      }
      await this.#retitle(tx, actor, series, meeting, startsAt);
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "tree", itemId: meetingId });
    });
  }

  async skip(
    actor: Principal,
    meetingId: string,
    input: { nextStartsAt?: Date | null | undefined } = {},
  ): Promise<{ nextMeetingId: string }> {
    return this.#database.transaction(async (tx) => {
      const located = await this.#meeting(tx, meetingId);
      const series = await this.#writableSeries(tx, located.series_id);
      const meeting = await this.#meeting(tx, meetingId, true);
      if (meeting.state !== "upcoming") {
        throw new SpaceError("meetingNotUpcoming", "Only the upcoming meeting can be skipped");
      }
      const agenda = await this.#documents.snapshot(meetingId);
      const at = await this.#nextAt(tx, series, meeting, input);
      await tx.execute(sql`
        update meetings set state = 'skipped', closed_at = now(), closed_by = ${actorIdOf(actor)}, updated_at = now()
        where item_id = ${meetingId}`);
      const nextMeetingId = await this.#createMeeting(
        tx,
        actor,
        series,
        at,
        agenda ? { carry: agenda.document } : {},
      );
      await tx.execute(
        sql`update meetings set next_meeting_id = ${nextMeetingId} where item_id = ${meetingId}`,
      );
      await signalSpaceChange(tx, { spaceId: series.space_id, kind: "meetings", itemId: series.item_id });
      return { nextMeetingId };
    });
  }

  async setAttendance(
    _actor: Principal,
    meetingId: string,
    accountId: string,
    attendance: Attendance | null,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const meeting = await this.#meeting(tx, meetingId, true);
      const updated = await tx.execute(sql`
        update meeting_attendees set attendance = ${attendance}, updated_at = now()
        where meeting_id = ${meetingId} and account_id = ${accountId} returning account_id`);
      if (updated.rows.length === 0)
        throw new SpaceError("attendeeNotFound", "The person is not an attendee");
      await this.#signalMeeting(tx, meeting);
    });
  }

  async addAttendee(actor: Principal, meetingId: string, accountId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const meeting = await this.#meeting(tx, meetingId, true);
      const id = accountId.toLowerCase();
      const located = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${meetingId}`,
      );
      await this.#validMembers(tx, actor, located.rows[0]?.space_id ?? "", [id]);
      const count = await tx.execute<{ count: string }>(
        sql`select count(*) as count from meeting_attendees where meeting_id = ${meetingId}`,
      );
      if (Number(count.rows[0]?.count ?? 0) >= MAX_ATTENDEES) {
        throw new SpaceError("tooManyAttendees", `A meeting can have up to ${MAX_ATTENDEES} attendees`);
      }
      await tx.execute(sql`
        insert into meeting_attendees (meeting_id, account_id, position, added_by)
        values (${meetingId}, ${id}, ${MAX_SERIES_MEMBERS + Number(count.rows[0]?.count ?? 0)}, ${actorIdOf(actor)})
        on conflict (meeting_id, account_id) do nothing`);
      await this.#signalMeeting(tx, meeting);
    });
  }

  async removeAttendee(_actor: Principal, meetingId: string, accountId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const meeting = await this.#meeting(tx, meetingId, true);
      await tx.execute(
        sql`delete from meeting_attendees where meeting_id = ${meetingId} and account_id = ${accountId}`,
      );
      await this.#signalMeeting(tx, meeting);
    });
  }

  async #signalMeeting(tx: Transaction, meeting: MeetingRow): Promise<void> {
    const space = await tx.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${meeting.item_id}`,
    );
    const spaceId = space.rows[0]?.space_id;
    if (spaceId) await signalSpaceChange(tx, { spaceId, kind: "meetings", itemId: meeting.item_id });
  }

  async addTopicToUpcoming(
    tx: Transaction,
    actor: Principal,
    seriesId: string,
    topicId: string,
  ): Promise<void> {
    const upcoming = await tx.execute<{ item_id: string }>(
      sql`select item_id from meetings where series_id = ${seriesId} and state = 'upcoming'`,
    );
    const meetingId = upcoming.rows[0]?.item_id;
    if (!meetingId) return;
    const labels = SECTION_TITLES[await this.#templates.language(actor)];
    await this.#documents.editLocked(
      tx,
      meetingId,
      (document) => {
        const next = addTopicUpdates(document, [topicId], labels);
        return next === document ? null : next;
      },
      actorIdOf(actor),
    );
  }

  async removeTopicFromLater(
    tx: Transaction,
    actor: Principal,
    seriesId: string,
    topicId: string,
    closedIn: string | null,
  ): Promise<void> {
    const later = await tx.execute<{ item_id: string }>(sql`
      select item_id from meetings where series_id = ${seriesId} and state = 'upcoming'
        and item_id is distinct from ${closedIn}`);
    for (const row of later.rows) {
      await this.#documents.editLocked(
        tx,
        row.item_id,
        (document) => removeEmptyTopicUpdate(document, topicId),
        actorIdOf(actor),
      );
    }
  }

  async currentMeeting(executor: Executor, seriesId: string): Promise<string | null> {
    const result = await executor.execute<{ item_id: string }>(sql`
      select item_id from meetings where series_id = ${seriesId} and state in ('upcoming', 'reopened')
      order by (state = 'reopened') desc, coalesce(starts_at, 'infinity'::timestamptz) limit 1`);
    return result.rows[0]?.item_id ?? null;
  }

  async upcoming(
    viewer: Principal,
    options: { limit?: number; oneOnOne?: boolean } = {},
  ): Promise<UpcomingMeeting[]> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const result = await this.#database.execute<{
      item_id: string;
      title: string;
      starts_at: Date | string | null;
      duration_minutes: number;
      series_id: string;
      series_title: string;
      series_visible: boolean;
      space_id: string;
      key: string;
      one_on_one: boolean;
    }>(sql`
      select m.item_id, t.title, m.starts_at, m.duration_minutes, m.series_id, st.title as series_title,
        ${visibleItem(this.#authorization, viewer, sql`st`, sql`s`)} as series_visible,
        s.id as space_id, s.key, s.one_on_one
      from meetings m join tree_items t on t.id = m.item_id join tree_items st on st.id = m.series_id
      join spaces s on s.id = t.space_id
      where m.state = 'upcoming' and st.archived_root_id is null and s.archived_at is null
        and ${options.oneOnOne === undefined ? sql`true` : sql`s.one_on_one = ${options.oneOnOne}`}
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by m.starts_at nulls last, m.item_id
      limit ${limit}`);
    return result.rows.map((row) => ({
      id: row.item_id,
      title: row.title,
      startsAt: toDate(row.starts_at),
      durationMinutes: row.duration_minutes,
      seriesId: row.series_visible ? row.series_id : null,
      seriesTitle: row.series_visible ? row.series_title : null,
      spaceId: row.space_id,
      spaceKey: row.key,
      oneOnOne: row.one_on_one,
    }));
  }

  async listSeries(
    viewer: Principal,
    spaceId: string,
  ): Promise<{ id: string; title: string; archived: boolean; upcomingAt: Date | null }[]> {
    const result = await this.#database.execute<{
      item_id: string;
      title: string;
      archived: boolean;
      upcoming_at: Date | string | null;
    }>(sql`
      select ms.item_id, t.title, t.archived_root_id is not null as archived,
        (select m.starts_at from meetings m where m.series_id = ms.item_id and m.state = 'upcoming') as upcoming_at
      from meeting_series ms join tree_items t on t.id = ms.item_id join spaces s on s.id = t.space_id
      where t.space_id = ${spaceId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by t.archived_root_id is not null, lower(t.title), t.id
      limit 500`);
    return result.rows.map((row) => ({
      id: row.item_id,
      title: row.title,
      archived: row.archived,
      upcomingAt: toDate(row.upcoming_at),
    }));
  }
}
