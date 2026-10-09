import type { NodeJson } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import { normalizeLabel, type PageDocumentService } from "../spaces/documents.js";
import { positionBetween } from "../spaces/fractional-index.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { refreshReaderVisibility, visibleItem } from "../spaces/visibility.js";
import { addDecision } from "./meeting-document.js";
import type { MeetingService } from "./meetings.js";
import type { TopicOutcome, TopicStatus } from "./schema.js";

export const TOPIC_TITLE_MAX_LENGTH = 255;
export const MAX_TOPIC_LABELS = 20;
export const MAX_STATEMENT_LENGTH = 2000;

export interface TopicSummary {
  id: string;
  seriesId: string;
  title: string;
  status: TopicStatus;
  outcome: TopicOutcome | null;
  owner: { id: string; name: string | null } | null;
  labels: string[];
  raisedIn: { id: string; title: string; startsAt: Date | null } | null;
  updates: number;
  lastUpdateAt: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  decisionId: string | null;
}

export interface TopicUpdateEntry {
  meetingId: string;
  meetingTitle: string;
  startsAt: Date | null;
  content: NodeJson[];
  updatedAt: Date;
}

export interface TopicDetails extends TopicSummary {
  spaceId: string;
  seriesTitle: string;
  timeline: TopicUpdateEntry[];
  decision: { id: string; itemId: string; itemTitle: string; statement: NodeJson[]; text: string } | null;
}

export interface TopicFilter {
  status?: TopicStatus | "all" | undefined;
  ownerId?: string | undefined;
  label?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  text?: string | undefined;
  limit?: number | undefined;
}

type TopicRow = {
  item_id: string;
  series_id: string;
  title: string;
  status: TopicStatus;
  outcome: TopicOutcome | null;
  owner_id: string | null;
  owner_name: string | null;
  labels: string[] | null;
  raised_in_id: string | null;
  raised_in_title: string | null;
  raised_in_starts_at: Date | string | null;
  updates: string;
  last_update_at: Date | string | null;
  created_at: Date | string;
  closed_at: Date | string | null;
  decision_id: string | null;
  space_id: string;
};

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function cleanTitle(title: string): string {
  const value = title.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > TOPIC_TITLE_MAX_LENGTH) {
    throw new SpaceError("invalidTitle", `The title needs 1 to ${TOPIC_TITLE_MAX_LENGTH} characters`);
  }
  return value;
}

function cleanLabels(labels: readonly string[]): string[] {
  const cleaned = [...new Set(labels.map(normalizeLabel))];
  if (cleaned.length > MAX_TOPIC_LABELS) {
    throw new SpaceError("tooManyLabels", `A topic can have up to ${MAX_TOPIC_LABELS} labels`);
  }
  return cleaned;
}

function statementOf(text: string): NodeJson[] {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length > MAX_STATEMENT_LENGTH) {
    throw new SpaceError("invalidStatement", `A decision can have up to ${MAX_STATEMENT_LENGTH} characters`);
  }
  return value ? [{ type: "paragraph", content: [{ type: "text", text: value }] }] : [];
}

export class TopicService {
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

  #select(viewer: Principal): SQL {
    return sql`select mt.item_id, mt.series_id, t.title, mt.status, mt.outcome, t.owner_id,
        ${this.#people.visibleName(viewer, sql`o`)} as owner_name,
        (select array_agg(l.label order by l.label) from page_labels l where l.item_id = t.id) as labels,
        case when ${visibleItem(this.#authorization, viewer, sql`rt`, sql`s`)} then mt.raised_in_id end as raised_in_id,
        case when ${visibleItem(this.#authorization, viewer, sql`rt`, sql`s`)} then rt.title end as raised_in_title,
        rm.starts_at as raised_in_starts_at,
        (select count(*) from meeting_topic_updates u join meetings um on um.item_id = u.item_id
          join tree_items ut on ut.id = u.item_id
          where u.topic_id = mt.item_id and um.state <> 'skipped'
            and ${visibleItem(this.#authorization, viewer, sql`ut`, sql`s`)}) as updates,
        mt.last_update_at, t.created_at, mt.closed_at, mt.decision_id, t.space_id
      from meeting_topics mt join tree_items t on t.id = mt.item_id join spaces s on s.id = t.space_id
      left join accounts o on o.id = t.owner_id
      left join tree_items rt on rt.id = mt.raised_in_id
      left join meetings rm on rm.item_id = mt.raised_in_id`;
  }

  #summary(row: TopicRow): TopicSummary {
    return {
      id: row.item_id,
      seriesId: row.series_id,
      title: row.title,
      status: row.status,
      outcome: row.outcome,
      owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : null,
      labels: row.labels ?? [],
      raisedIn: row.raised_in_id
        ? {
            id: row.raised_in_id,
            title: row.raised_in_title ?? "",
            startsAt: toDate(row.raised_in_starts_at),
          }
        : null,
      updates: Number(row.updates),
      lastUpdateAt: toDate(row.last_update_at),
      createdAt: new Date(row.created_at),
      closedAt: toDate(row.closed_at),
      decisionId: row.decision_id,
    };
  }

  async seriesOf(topicId: string, executor: Executor = this.#database): Promise<string | null> {
    const result = await executor.execute<{ series_id: string }>(
      sql`select series_id from meeting_topics where item_id = ${topicId}`,
    );
    return result.rows[0]?.series_id ?? null;
  }

  async list(viewer: Principal, seriesId: string, filter: TopicFilter = {}): Promise<TopicSummary[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
    const status = filter.status ?? "open";
    const text = filter.text?.trim() ?? "";
    const pattern = `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const result = await this.#database.execute<TopicRow>(sql`
      ${this.#select(viewer)}
      where mt.series_id = ${seriesId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${status === "all" ? sql`` : sql`and mt.status = ${status}`}
        ${filter.ownerId ? sql`and t.owner_id = ${filter.ownerId}` : sql``}
        ${filter.label ? sql`and exists (select 1 from page_labels l where l.item_id = t.id and l.label = ${normalizeLabel(filter.label)})` : sql``}
        ${filter.from ? sql`and coalesce(mt.last_update_at, t.created_at) >= ${filter.from}` : sql``}
        ${filter.to ? sql`and coalesce(mt.last_update_at, t.created_at) < ${filter.to}` : sql``}
        ${text ? sql`and t.title ilike ${pattern}` : sql``}
      order by coalesce(mt.last_update_at, t.created_at) desc, t.id desc
      limit ${limit}`);
    return result.rows.map((row) => this.#summary(row));
  }

  async get(viewer: Principal, topicId: string): Promise<TopicDetails> {
    const result = await this.#database.execute<TopicRow>(
      sql`${this.#select(viewer)} where mt.item_id = ${topicId}`,
    );
    const row = result.rows[0];
    if (!row) throw new SpaceError("topicNotFound", "The topic does not exist");
    const timeline = await this.#database.execute<{
      item_id: string;
      title: string;
      starts_at: Date | string | null;
      content: NodeJson[];
      updated_at: Date | string;
    }>(sql`
      select u.item_id, t.title, m.starts_at, u.content, u.updated_at
      from meeting_topic_updates u join meetings m on m.item_id = u.item_id join tree_items t on t.id = u.item_id
      join spaces s on s.id = t.space_id
      where u.topic_id = ${topicId} and m.state <> 'skipped'
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by coalesce(m.starts_at, u.updated_at), u.item_id`);
    const decision = row.decision_id
      ? await this.#database.execute<{
          id: string;
          item_id: string;
          title: string;
          statement: NodeJson[];
          text: string;
        }>(sql`
          select d.id, d.item_id, t.title, d.statement, d.text from decisions d
          join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
          where d.id = ${row.decision_id} and d.published
            and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`)
      : null;
    const found = decision?.rows[0];
    const series = await this.#database.execute<{ title: string }>(sql`
      select t.title from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${row.series_id} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const seriesRow = series.rows[0];
    if (!seriesRow) throw new SpaceError("topicNotFound", "The topic does not exist");
    return {
      ...this.#summary(row),
      spaceId: row.space_id,
      seriesTitle: seriesRow.title,
      timeline: timeline.rows.map((entry) => ({
        meetingId: entry.item_id,
        meetingTitle: entry.title,
        startsAt: toDate(entry.starts_at),
        content: entry.content,
        updatedAt: new Date(entry.updated_at),
      })),
      decision: found
        ? {
            id: found.id,
            itemId: found.item_id,
            itemTitle: found.title,
            statement: found.statement,
            text: found.text,
          }
        : null,
    };
  }

  async create(
    actor: Principal,
    seriesId: string,
    input: {
      title: string;
      ownerId?: string | null | undefined;
      labels?: string[] | undefined;
      meetingId?: string | undefined;
    },
  ): Promise<string> {
    const title = cleanTitle(input.title);
    const labels = cleanLabels(input.labels ?? []);
    const actorId = actorIdOf(actor);
    return this.#database.transaction(async (tx) => {
      const series = await tx.execute<{ space_id: string; archived: boolean }>(sql`
        select t.space_id, (t.archived_root_id is not null) as archived from meeting_series ms
        join tree_items t on t.id = ms.item_id where ms.item_id = ${seriesId} and t.trash_entry_id is null
        for update of ms`);
      const row = series.rows[0];
      if (!row) throw new SpaceError("seriesNotFound", "The meeting series does not exist");
      if (row.archived) throw new SpaceError("seriesEnded", "The series has ended");
      const ownerId = input.ownerId === undefined ? actorId : input.ownerId;
      if (ownerId && !(await this.#people.canSee(actor, ownerId, tx))) {
        throw new SpaceError("invalidMember", "Choose an owner among the people you can see");
      }
      const raisedIn = input.meetingId ?? (await this.#meetings.currentMeeting(tx, seriesId));
      if (input.meetingId && (await this.#meetings.seriesOfMeeting(input.meetingId, tx)) !== seriesId) {
        throw new SpaceError("meetingNotFound", "The meeting does not belong to this series");
      }
      const last = await tx.execute<{ position: string | null }>(sql`
        select max(position) as position from tree_items where parent_id = ${seriesId}`);
      const id = uuidv7();
      await tx.execute(sql`
        insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id)
        values (${id}, ${row.space_id}, ${seriesId}, 'meetingTopic', ${positionBetween(last.rows[0]?.position ?? null, null)},
          ${title}, 'live', ${actorId}, ${ownerId})`);
      await tx.execute(sql`
        insert into meeting_topics (item_id, series_id, raised_in_id) values (${id}, ${seriesId}, ${raisedIn})`);
      for (const label of labels) {
        await tx.execute(
          sql`insert into page_labels (item_id, label, created_by) values (${id}, ${label}, ${actorId})`,
        );
      }
      await refreshReaderVisibility(tx, [id]);
      await this.#meetings.addTopicToUpcoming(tx, actor, seriesId, id);
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "meetings", itemId: seriesId });
      return id;
    });
  }

  async #lock(tx: Transaction, topicId: string) {
    const result = await tx.execute<{
      series_id: string;
      space_id: string;
      status: TopicStatus;
      archived: boolean;
    }>(sql`
      select mt.series_id, t.space_id, mt.status, (t.archived_root_id is not null) as archived
      from meeting_topics mt join tree_items t on t.id = mt.item_id
      where mt.item_id = ${topicId} and t.trash_entry_id is null for update of mt`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("topicNotFound", "The topic does not exist");
    if (row.archived) throw new SpaceError("seriesEnded", "The series has ended");
    return row;
  }

  async update(
    actor: Principal,
    topicId: string,
    changes: {
      title?: string | undefined;
      ownerId?: string | null | undefined;
      labels?: string[] | undefined;
    },
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const topic = await this.#lock(tx, topicId);
      if (changes.title !== undefined) {
        await tx.execute(sql`update tree_items set title = ${cleanTitle(changes.title)}, updated_at = now()
          where id = ${topicId}`);
      }
      if (changes.ownerId !== undefined) {
        if (changes.ownerId && !(await this.#people.canSee(actor, changes.ownerId, tx))) {
          throw new SpaceError("invalidMember", "Choose an owner among the people you can see");
        }
        await tx.execute(
          sql`update tree_items set owner_id = ${changes.ownerId}, updated_at = now() where id = ${topicId}`,
        );
      }
      if (changes.labels !== undefined) {
        const labels = cleanLabels(changes.labels);
        await tx.execute(sql`delete from page_labels where item_id = ${topicId}
          and not (label = any(${sql.param(labels)}::text[]))`);
        for (const label of labels) {
          await tx.execute(sql`insert into page_labels (item_id, label, created_by)
            values (${topicId}, ${label}, ${actorIdOf(actor)}) on conflict do nothing`);
        }
      }
      await signalSpaceChange(tx, { spaceId: topic.space_id, kind: "meetings", itemId: topic.series_id });
    });
  }

  async close(
    actor: Principal,
    topicId: string,
    input: { outcome: Exclude<TopicOutcome, "decided">; meetingId?: string | undefined },
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const topic = await this.#lock(tx, topicId);
      if (topic.status === "closed") throw new SpaceError("topicClosed", "The topic is closed already");
      if (
        input.meetingId &&
        (await this.#meetings.seriesOfMeeting(input.meetingId, tx)) !== topic.series_id
      ) {
        throw new SpaceError("meetingNotFound", "The meeting does not belong to this series");
      }
      const meetingId = input.meetingId ?? (await this.#meetings.currentMeeting(tx, topic.series_id));
      await tx.execute(sql`
        update meeting_topics set status = 'closed', outcome = ${input.outcome}, closed_at = now(),
          closed_by = ${actorIdOf(actor)}, closed_in_id = ${meetingId}, updated_at = now()
        where item_id = ${topicId}`);
      await this.#meetings.removeTopicFromLater(tx, actor, topic.series_id, topicId, meetingId);
      await signalSpaceChange(tx, { spaceId: topic.space_id, kind: "meetings", itemId: topic.series_id });
    });
  }

  async reopen(actor: Principal, topicId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const topic = await this.#lock(tx, topicId);
      if (topic.status === "open") return;
      await tx.execute(sql`
        update meeting_topics set status = 'open', outcome = null, closed_at = null, closed_by = null,
          closed_in_id = null, decision_id = null, updated_at = now()
        where item_id = ${topicId}`);
      await this.#meetings.addTopicToUpcoming(tx, actor, topic.series_id, topicId);
      await signalSpaceChange(tx, { spaceId: topic.space_id, kind: "meetings", itemId: topic.series_id });
    });
  }

  async closeAsDecision(
    actor: Principal,
    topicId: string,
    input: { statement: string; meetingId?: string | undefined },
  ): Promise<{ decisionId: string; meetingId: string }> {
    const statement = statementOf(input.statement);
    return this.#database.transaction(async (tx) => {
      const topic = await this.#lock(tx, topicId);
      if (topic.status === "closed") throw new SpaceError("topicClosed", "The topic is closed already");
      const meetingId = input.meetingId ?? (await this.#meetings.currentMeeting(tx, topic.series_id));
      if (!meetingId || (await this.#meetings.seriesOfMeeting(meetingId, tx)) !== topic.series_id) {
        throw new SpaceError("meetingNotFound", "There is no current meeting to record the decision in");
      }
      const editable = await this.#authorization.explain(
        actor,
        "item.edit",
        { type: "item", id: meetingId },
        {
          executor: tx,
        },
      );
      if (!editable.allowed) throw new SpaceError("meetingNotEditable", "You cannot edit the meeting notes");
      const decisionId = uuidv7();
      await tx.execute(
        sql`insert into decisions (id, item_id, topic_id) values (${decisionId}, ${meetingId}, ${topicId})`,
      );
      await this.#documents.editLocked(
        tx,
        meetingId,
        (document) => addDecision(document, { id: decisionId, topicId, statement }),
        actorIdOf(actor),
      );
      await tx.execute(sql`
        update meeting_topics set status = 'closed', outcome = 'decided', closed_at = now(),
          closed_by = ${actorIdOf(actor)}, closed_in_id = ${meetingId}, decision_id = ${decisionId}, updated_at = now()
        where item_id = ${topicId}`);
      await this.#meetings.removeTopicFromLater(tx, actor, topic.series_id, topicId, meetingId);
      await signalSpaceChange(tx, { spaceId: topic.space_id, kind: "meetings", itemId: topic.series_id });
      return { decisionId, meetingId };
    });
  }
}
