import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import type { PageDocumentService } from "../spaces/documents.js";
import { positionBetween } from "../spaces/fractional-index.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { visibleItem } from "../spaces/visibility.js";
import { addTopicUpdates } from "./meeting-document.js";
import type { MeetingService } from "./meetings.js";
import type { MeetingState, TopicOutcome, TopicStatus } from "./schema.js";

export const UPDATE_TEXT_MAX_LENGTH = 5000;
export const AGENDA_TASK_TEXT_MAX_LENGTH = 500;
const PREVIOUS_UPDATES = 3;

export interface AgendaTask {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  assignee: { id: string; name: string | null } | null;
  meetingId: string;
}

export interface AgendaTopic {
  id: string;
  number: number;
  title: string;
  status: TopicStatus;
  outcome: TopicOutcome | null;
  oneOff: boolean;
  owner: { id: string; name: string | null } | null;
  labels: string[];
  createdAt: Date;
  update: { text: string; formatted: boolean } | null;
  previous: AgendaHistoryEntry[];
  history: AgendaHistoryEntry[];
  meetings: number;
  tasks: AgendaTask[];
}

export interface AgendaHistoryEntry {
  meetingId: string;
  meetingNumber: number;
  meetingTitle: string;
  startsAt: Date | null;
  text: string;
}

export interface Agenda {
  meetingId: string;
  meetingNumber: number;
  seriesId: string;
  seriesNumber: number;
  current: boolean;
  topics: AgendaTopic[];
  closedTopics: number;
  decisions: { id: string; topicId: string | null; topicTitle: string | null; text: string }[];
  tasks: AgendaTask[];
}

function inlineText(node: NodeJson): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function plainParagraph(node: NodeJson): boolean {
  return (
    node.type === "paragraph" &&
    (node.content ?? []).every(
      (child) => (child.type === "text" && (child.marks ?? []).length === 0) || child.type === "hardBreak",
    )
  );
}

function findUpdate(document: NodeJson, topicId: string): NodeJson | null {
  if (document.type === "topicUpdate" && document.attrs?.topicId === topicId) return document;
  for (const child of document.content ?? []) {
    const found = findUpdate(child, topicId);
    if (found) return found;
  }
  return null;
}

export function mapUpdate(
  document: DocumentJson,
  topicId: string,
  change: (node: NodeJson) => NodeJson,
): DocumentJson {
  let done = false;
  const visit = (node: NodeJson): NodeJson => {
    if (!done && node.type === "topicUpdate" && node.attrs?.topicId === topicId) {
      done = true;
      return change(node);
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return visit(document) as DocumentJson;
}

export function updateTextOf(block: NodeJson): { text: string; formatted: boolean } {
  const content = block.content ?? [];
  const paragraphs = content.filter((node) => node.type === "paragraph");
  return {
    text: paragraphs.map(inlineText).join("\n").replace(/\n+$/, ""),
    formatted: content.some((node) => node.type !== "taskList" && !plainParagraph(node)),
  };
}

export function withUpdateText(block: NodeJson, text: string): NodeJson {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const paragraphs: NodeJson[] =
    text.trim().length === 0
      ? []
      : lines.map((line) =>
          line.length > 0
            ? { type: "paragraph", content: [{ type: "text", text: line }] }
            : { type: "paragraph" },
        );
  const rest = (block.content ?? []).filter((node) => node.type !== "paragraph");
  const content = [...paragraphs, ...rest];
  return { ...block, content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

export function withTask(
  block: NodeJson,
  task: { id: string; text: string; assignee: string | null; dueDate: string | null },
): NodeJson {
  const item: NodeJson = {
    type: "taskItem",
    attrs: { id: task.id, assignee: task.assignee, dueDate: task.dueDate },
    content: [{ type: "paragraph", content: [{ type: "text", text: task.text }] }],
  };
  const existing = block.content ?? [];
  const content =
    existing.length === 1 && existing[0]?.type === "paragraph" && (existing[0].content ?? []).length === 0
      ? []
      : [...existing];
  const last = content.at(-1);
  if (last?.type === "taskList") {
    content[content.length - 1] = { ...last, content: [...(last.content ?? []), item] };
  } else {
    content.push({ type: "taskList", content: [item] });
  }
  return { ...block, content };
}

function taskIdsIn(nodes: readonly NodeJson[], ids: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "taskItem" && typeof node.attrs?.id === "string") ids.push(node.attrs.id);
    taskIdsIn(node.content ?? [], ids);
  }
  return ids;
}

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

export class AgendaService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #documents: PageDocumentService;
  readonly #meetings: MeetingService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    documents: PageDocumentService;
    meetings: MeetingService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#documents = options.documents;
    this.#meetings = options.meetings;
  }

  async #meeting(meetingId: string) {
    const result = await this.#database.execute<{
      number: string;
      series_id: string;
      series_number: string;
      state: MeetingState;
      starts_at: Date | string | null;
      archived: boolean;
    }>(sql`
      select t.number, m.series_id, st.number as series_number, m.state, m.starts_at,
        (st.archived_root_id is not null or s.archived_at is not null) as archived
      from meetings m join tree_items t on t.id = m.item_id join tree_items st on st.id = m.series_id
      join spaces s on s.id = t.space_id
      where m.item_id = ${meetingId} and t.trash_entry_id is null`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("meetingNotFound", "The meeting does not exist");
    return row;
  }

  async #tasks(viewer: Principal, ids: readonly string[]): Promise<Map<string, AgendaTask>> {
    if (ids.length === 0) return new Map();
    const result = await this.#database.execute<{
      id: string;
      text: string;
      done: boolean;
      due_date: string | null;
      assignee_id: string | null;
      assignee_name: string | null;
      item_id: string;
    }>(sql`
      select k.id, k.text, k.done, k.due_date::text as due_date, k.assignee_id,
        ${this.#people.visibleName(viewer, sql`a`)} as assignee_name, k.item_id
      from tasks k join tree_items t on t.id = k.item_id join spaces s on s.id = t.space_id
      left join accounts a on a.id = k.assignee_id
      where k.id = any(${sql.param([...ids])}::uuid[]) and k.published
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          text: row.text,
          done: row.done,
          dueDate: row.due_date,
          assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
          meetingId: row.item_id,
        },
      ]),
    );
  }

  async agenda(viewer: Principal, meetingId: string): Promise<Agenda> {
    const meeting = await this.#meeting(meetingId);
    const current = !meeting.archived && (meeting.state === "upcoming" || meeting.state === "reopened");
    const start = toDate(meeting.starts_at);
    const topics = await this.#database.execute<{
      id: string;
      number: string;
      title: string;
      status: TopicStatus;
      outcome: TopicOutcome | null;
      one_off: boolean;
      owner_id: string | null;
      owner_name: string | null;
      labels: string[] | null;
      created_at: Date | string;
      meetings: string;
    }>(sql`
      select mt.item_id as id, t.number, t.title, mt.status, mt.outcome, mt.one_off, t.owner_id,
        ${this.#people.visibleName(viewer, sql`o`)} as owner_name,
        (select array_agg(l.label order by l.label) from page_labels l where l.item_id = t.id) as labels,
        t.created_at,
        case when mt.one_off then 1 else (
          select count(*) from meetings m2 join tree_items t2 on t2.id = m2.item_id
          where m2.series_id = mt.series_id and m2.state <> 'skipped' and t2.trash_entry_id is null
            and (m2.item_id = ${meetingId} or (
              m2.starts_at >= coalesce((select r.starts_at from meetings r where r.item_id = mt.raised_in_id), t.created_at)
              and m2.starts_at <= coalesce(${start?.toISOString() ?? null}::timestamptz, now())))
        ) end as meetings
      from meeting_topics mt join tree_items t on t.id = mt.item_id join spaces s on s.id = t.space_id
      left join accounts o on o.id = t.owner_id
      where mt.series_id = ${meeting.series_id} and t.trash_entry_id is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        and ${
          current
            ? sql`mt.status = 'open' and (not mt.one_off or mt.raised_in_id = ${meetingId})`
            : sql`(mt.closed_in_id = ${meetingId} or exists (select 1 from meeting_topic_updates u
                where u.topic_id = mt.item_id and u.item_id = ${meetingId}))`
        }
      order by mt.agenda_position nulls last, t.created_at, t.id`);
    const ids = topics.rows.map((row) => row.id);
    const updates =
      ids.length === 0
        ? { rows: [] }
        : await this.#database.execute<{
            topic_id: string;
            item_id: string;
            number: string;
            title: string;
            starts_at: Date | string | null;
            content: NodeJson[];
          }>(sql`
            select u.topic_id, u.item_id, t.number, t.title, m.starts_at, u.content
            from meeting_topic_updates u join meetings m on m.item_id = u.item_id
            join tree_items t on t.id = u.item_id join spaces s on s.id = t.space_id
            where u.topic_id = any(${sql.param(ids)}::uuid[]) and m.state <> 'skipped' and t.trash_entry_id is null
              and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
            order by coalesce(m.starts_at, u.updated_at) desc, u.item_id desc`);
    const snapshot = await this.#documents.snapshot(meetingId);
    const document = (snapshot?.document ?? null) as NodeJson | null;
    const taskIds = new Map<string, string[]>();
    for (const row of updates.rows) {
      if (row.item_id === meetingId) continue;
      taskIds.set(row.topic_id, [...(taskIds.get(row.topic_id) ?? []), ...taskIdsIn(row.content)]);
    }
    const own = new Map<string, NodeJson>();
    for (const id of ids) {
      const block = document ? findUpdate(document, id) : null;
      if (!block) continue;
      own.set(id, block);
      taskIds.set(id, [...(taskIds.get(id) ?? []), ...taskIdsIn(block.content ?? [])]);
    }
    const meetingTaskIds = document ? taskIdsIn([document]) : [];
    const tasks = await this.#tasks(viewer, [
      ...new Set([...[...taskIds.values()].flat(), ...meetingTaskIds]),
    ]);
    const closed = await this.#database.execute<{ count: string }>(sql`
      select count(*) as count from meeting_topics mt join tree_items t on t.id = mt.item_id
      join spaces s on s.id = t.space_id
      where mt.closed_in_id = ${meetingId} and t.trash_entry_id is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const decisions = await this.#database.execute<{
      id: string;
      topic_id: string | null;
      topic_title: string | null;
      text: string;
    }>(sql`
      select d.id, d.topic_id,
        case when ${visibleItem(this.#authorization, viewer, sql`tt`, sql`ts`)} then tt.title end as topic_title, d.text
      from decisions d left join tree_items tt on tt.id = d.topic_id left join spaces ts on ts.id = tt.space_id
      where d.item_id = ${meetingId} and d.published order by d.position, d.id`);
    return {
      meetingId,
      meetingNumber: Number(meeting.number),
      seriesId: meeting.series_id,
      seriesNumber: Number(meeting.series_number),
      current,
      closedTopics: Number(closed.rows[0]?.count ?? 0),
      topics: topics.rows.map((row) => {
        const block = own.get(row.id);
        const seen = new Set<string>();
        const earlier = updates.rows
          .filter((update) => update.topic_id === row.id && update.item_id !== meetingId)
          .map((update) => ({
            meetingId: update.item_id,
            meetingNumber: Number(update.number),
            meetingTitle: update.title,
            startsAt: toDate(update.starts_at),
            text: updateTextOf({ type: "topicUpdate", content: update.content }).text,
          }));
        return {
          id: row.id,
          number: Number(row.number),
          title: row.title,
          status: row.status,
          outcome: row.outcome,
          oneOff: row.one_off,
          owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : null,
          labels: row.labels ?? [],
          createdAt: new Date(row.created_at),
          update: block ? updateTextOf(block) : null,
          previous: earlier.slice(0, PREVIOUS_UPDATES),
          history: earlier.filter((entry) => !start || !entry.startsAt || entry.startsAt <= start).reverse(),
          meetings: Math.max(1, Number(row.meetings)),
          tasks: (taskIds.get(row.id) ?? []).flatMap((id) => {
            const task = tasks.get(id);
            if (!task || seen.has(id)) return [];
            seen.add(id);
            return [task];
          }),
        };
      }),
      decisions: decisions.rows.map((row) => ({
        id: row.id,
        topicId: row.topic_title === null ? null : row.topic_id,
        topicTitle: row.topic_title,
        text: row.text,
      })),
      tasks: meetingTaskIds.flatMap((id) => {
        const task = tasks.get(id);
        return task ? [task] : [];
      }),
    };
  }

  async #editable(tx: Transaction, meetingId: string, topicId: string): Promise<void> {
    const result = await tx.execute<{ state: MeetingState; topic_ok: boolean; archived: boolean }>(sql`
      select m.state, (st.archived_root_id is not null or s.archived_at is not null) as archived,
        exists (select 1 from meeting_topics mt join tree_items tt on tt.id = mt.item_id
          where mt.item_id = ${topicId} and mt.series_id = m.series_id and tt.trash_entry_id is null
            and (mt.status = 'open' or mt.closed_in_id = m.item_id)) as topic_ok
      from meetings m join tree_items st on st.id = m.series_id join spaces s on s.id = st.space_id
      where m.item_id = ${meetingId} for no key update of m`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("meetingNotFound", "The meeting does not exist");
    if (row.archived) throw new SpaceError("seriesEnded", "The series has ended");
    if (row.state !== "upcoming" && row.state !== "reopened") {
      throw new SpaceError("meetingClosed", "The meeting is closed; reopen it to change its notes");
    }
    if (!row.topic_ok) throw new SpaceError("topicNotFound", "The topic is not on this meeting's agenda");
  }

  async #edit(
    tx: Transaction,
    actor: Principal,
    meetingId: string,
    topicId: string,
    change: (block: NodeJson) => NodeJson,
  ): Promise<void> {
    const titles = await this.#meetings.sectionTitles(actor);
    await this.#documents.editLocked(
      tx,
      meetingId,
      (document) => mapUpdate(addTopicUpdates(document, [topicId], titles), topicId, change),
      actorIdOf(actor),
    );
  }

  async saveUpdate(actor: Principal, meetingId: string, topicId: string, text: string): Promise<void> {
    if (text.length > UPDATE_TEXT_MAX_LENGTH) {
      throw new SpaceError("invalidUpdate", `An update can have up to ${UPDATE_TEXT_MAX_LENGTH} characters`);
    }
    await this.#database.transaction(async (tx) => {
      await this.#editable(tx, meetingId, topicId);
      await this.#edit(tx, actor, meetingId, topicId, (block) => {
        if (updateTextOf(block).formatted) {
          throw new SpaceError(
            "updateFormatted",
            "This update has formatting; change it in the meeting notes so that nothing gets lost",
          );
        }
        return withUpdateText(block, text);
      });
    });
  }

  async addTask(
    actor: Principal,
    meetingId: string,
    topicId: string,
    input: { text: string; assigneeId?: string | null | undefined; dueDate?: string | null | undefined },
  ): Promise<string> {
    const text = input.text.replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length > AGENDA_TASK_TEXT_MAX_LENGTH) {
      throw new SpaceError("invalidTask", `A task needs 1 to ${AGENDA_TASK_TEXT_MAX_LENGTH} characters`);
    }
    const assignee = input.assigneeId?.toLowerCase() ?? null;
    const id = uuidv7();
    await this.#database.transaction(async (tx) => {
      await this.#editable(tx, meetingId, topicId);
      if (assignee && !(await this.#people.canSee(actor, assignee, tx))) {
        throw new SpaceError("invalidMember", "Assign the task to someone you can see");
      }
      await this.#edit(tx, actor, meetingId, topicId, (block) =>
        withTask(block, { id, text, assignee, dueDate: input.dueDate ?? null }),
      );
    });
    return id;
  }

  async moveTopic(
    _actor: Principal,
    seriesId: string,
    topicId: string,
    afterId: string | null,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const series = await tx.execute<{ space_id: string; archived: boolean }>(sql`
        select t.space_id, (t.archived_root_id is not null) as archived from meeting_series ms
        join tree_items t on t.id = ms.item_id where ms.item_id = ${seriesId} and t.trash_entry_id is null
        for update of ms`);
      const row = series.rows[0];
      if (!row) throw new SpaceError("seriesNotFound", "The meeting series does not exist");
      if (row.archived) throw new SpaceError("seriesEnded", "The series has ended");
      const open = await tx.execute<{ item_id: string }>(sql`
        select mt.item_id from meeting_topics mt join tree_items t on t.id = mt.item_id
        where mt.series_id = ${seriesId} and mt.status = 'open' and t.trash_entry_id is null
        order by mt.agenda_position nulls last, t.created_at, t.id`);
      const order = open.rows.map((topic) => topic.item_id);
      if (
        !order.includes(topicId) ||
        (afterId !== null && (afterId === topicId || !order.includes(afterId)))
      ) {
        throw new SpaceError("topicNotFound", "Both topics must be open topics of this series");
      }
      const rest = order.filter((id) => id !== topicId);
      rest.splice(afterId === null ? 0 : rest.indexOf(afterId) + 1, 0, topicId);
      let previous: string | null = null;
      for (const id of rest) {
        const position: string = positionBetween(previous, null);
        previous = position;
        await tx.execute(sql`update meeting_topics set agenda_position = ${position} where item_id = ${id}`);
      }
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "meetings", itemId: seriesId });
    });
  }
}
