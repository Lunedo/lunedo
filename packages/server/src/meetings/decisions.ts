import type { NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { visibleItem } from "../spaces/visibility.js";

export interface DecisionEntry {
  id: string;
  statement: NodeJson[];
  text: string;
  meeting: { id: string; number: number; title: string; startsAt: Date | null };
  topic: { id: string; number: number; title: string } | null;
  recordedAt: Date;
}

export interface DecisionFilter {
  from?: Date | undefined;
  to?: Date | undefined;
  topicId?: string | undefined;
  text?: string | undefined;
  limit?: number | undefined;
}

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

export class DecisionService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
  }

  async log(viewer: Principal, seriesId: string, filter: DecisionFilter = {}): Promise<DecisionEntry[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const text = filter.text?.trim() ?? "";
    const pattern = `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const when = sql`coalesce(m.starts_at, d.created_at)`;
    const result = await this.#database.execute<{
      id: string;
      statement: NodeJson[];
      text: string;
      item_id: string;
      number: string;
      title: string;
      starts_at: Date | string | null;
      topic_id: string | null;
      topic_number: string | null;
      topic_title: string | null;
      created_at: Date | string;
    }>(sql`
      select d.id, d.statement, d.text, d.item_id, t.number, t.title, m.starts_at, d.created_at,
        case when tt.id is not null and ${visibleItem(this.#authorization, viewer, sql`tt`, sql`s`)} then tt.id end as topic_id,
        case when tt.id is not null and ${visibleItem(this.#authorization, viewer, sql`tt`, sql`s`)} then tt.number end as topic_number,
        case when tt.id is not null and ${visibleItem(this.#authorization, viewer, sql`tt`, sql`s`)} then tt.title end as topic_title
      from decisions d join meetings m on m.item_id = d.item_id join tree_items t on t.id = d.item_id
      join spaces s on s.id = t.space_id left join tree_items tt on tt.id = d.topic_id
      where d.published and m.series_id = ${seriesId} and m.state <> 'skipped'
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${filter.topicId ? sql`and d.topic_id = ${filter.topicId}` : sql``}
        ${filter.from ? sql`and ${when} >= ${filter.from}` : sql``}
        ${filter.to ? sql`and ${when} < ${filter.to}` : sql``}
        ${text ? sql`and d.text ilike ${pattern}` : sql``}
      order by ${when} desc, d.position, d.id
      limit ${limit}`);
    return result.rows.map((row) => ({
      id: row.id,
      statement: row.statement,
      text: row.text,
      meeting: {
        id: row.item_id,
        number: Number(row.number),
        title: row.title,
        startsAt: toDate(row.starts_at),
      },
      topic: row.topic_id
        ? { id: row.topic_id, number: Number(row.topic_number), title: row.topic_title ?? "" }
        : null,
      recordedAt: new Date(row.created_at),
    }));
  }
}
