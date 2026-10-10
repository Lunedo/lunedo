import { sql } from "drizzle-orm";
import type { Database, Executor } from "../database/database.js";

export interface StagedRecord {
  readonly kind: string;
  readonly sourceId: string;
  readonly ref?: string | null;
  readonly parentId?: string | null;
  readonly sort?: string | null;
  readonly data: Record<string, unknown>;
}

export interface StoredRecord<T = Record<string, unknown>> {
  readonly sourceId: string;
  readonly ref: string | null;
  readonly parentId: string | null;
  readonly ordinal: number | null;
  readonly data: T;
}

type RecordRow = {
  source_id: string;
  ref: string | null;
  parent_id: string | null;
  ordinal: number | null;
  data: unknown;
} & Record<string, unknown>;

const BATCH = 500;

function toStored<T>(row: RecordRow): StoredRecord<T> {
  return {
    sourceId: row.source_id,
    ref: row.ref,
    parentId: row.parent_id,
    ordinal: row.ordinal,
    data: row.data as T,
  };
}

export class StagingStore {
  readonly #database: Database;
  readonly #importId: string;
  #pending: StagedRecord[] = [];

  constructor(database: Database, importId: string) {
    this.#database = database;
    this.#importId = importId;
  }

  async put(record: StagedRecord): Promise<void> {
    this.#pending.push(record);
    if (this.#pending.length >= BATCH) await this.flush();
  }

  async flush(executor: Executor = this.#database): Promise<void> {
    if (this.#pending.length === 0) return;
    const latest = new Map<string, StagedRecord>();
    for (const record of this.#pending) latest.set(`${record.kind}\u0000${record.sourceId}`, record);
    this.#pending = [];
    const rows = [...latest.values()].map((record) => ({
      kind: record.kind,
      source_id: record.sourceId,
      ref: record.ref ?? null,
      parent_id: record.parentId ?? null,
      sort: record.sort ?? null,
      data: record.data,
    }));
    await executor.execute(sql`
      insert into import_records (import_id, kind, source_id, ref, parent_id, sort, data)
      select ${this.#importId}, r.kind, r.source_id, r.ref, r.parent_id, r.sort, r.data
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        as r(kind text, source_id text, ref text, parent_id text, sort text, data jsonb)
      on conflict (import_id, kind, source_id) do update
        set ref = excluded.ref, parent_id = excluded.parent_id, sort = excluded.sort, data = excluded.data`);
  }

  async count(kind: string): Promise<number> {
    const result = await this.#database.execute<{ count: number }>(sql`
      select count(*)::int as count from import_records where import_id = ${this.#importId} and kind = ${kind}`);
    return result.rows[0]?.count ?? 0;
  }

  async *iterate<T>(
    kind: string,
    order: "ordinal" | "source" | "ref" = "source",
  ): AsyncGenerator<StoredRecord<T>> {
    let last: RecordRow | null = null;
    for (;;) {
      const previous: RecordRow | null = last;
      let condition = sql``;
      if (previous !== null) {
        if (order === "ordinal")
          condition = sql`and (ordinal, source_id) > (${previous.ordinal ?? 0}, ${previous.source_id})`;
        else if (order === "ref") {
          condition = sql`and (coalesce(ref, ''), source_id) > (${previous.ref ?? ""}, ${previous.source_id})`;
        } else condition = sql`and source_id > ${previous.source_id}`;
      }
      const ordering =
        order === "ordinal"
          ? sql`ordinal, source_id`
          : order === "ref"
            ? sql`coalesce(ref, ''), source_id`
            : sql`source_id`;
      const result = await this.#database.execute<RecordRow>(sql`
        select source_id, ref, parent_id, ordinal, data from import_records
        where import_id = ${this.#importId} and kind = ${kind}
          ${order === "ordinal" ? sql`and ordinal is not null` : sql``} ${condition}
        order by ${ordering}
        limit ${BATCH}`);
      for (const row of result.rows) yield toStored<T>(row);
      if (result.rows.length < BATCH) return;
      last = result.rows.at(-1) ?? null;
    }
  }

  async get<T>(kind: string, sourceIds: readonly string[]): Promise<Map<string, StoredRecord<T>>> {
    const found = new Map<string, StoredRecord<T>>();
    if (sourceIds.length === 0) return found;
    const result = await this.#database.execute<RecordRow>(sql`
      select source_id, ref, parent_id, ordinal, data from import_records
      where import_id = ${this.#importId} and kind = ${kind} and source_id = any(${sql.param([...sourceIds])}::text[])`);
    for (const row of result.rows) found.set(row.source_id, toStored<T>(row));
    return found;
  }

  async byRef<T>(kind: string, refs: readonly string[]): Promise<StoredRecord<T>[]> {
    if (refs.length === 0) return [];
    const result = await this.#database.execute<RecordRow>(sql`
      select source_id, ref, parent_id, ordinal, data from import_records
      where import_id = ${this.#importId} and kind = ${kind} and ref = any(${sql.param([...refs])}::text[])
      order by source_id`);
    return result.rows.map((row) => toStored<T>(row));
  }

  async orderTree(kind: string, roots: readonly string[] = []): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        update import_records set ordinal = null where import_id = ${this.#importId} and kind = ${kind}`);
      await tx.execute(sql`
        update import_records r set parent_id = null
        where r.import_id = ${this.#importId} and r.kind = ${kind} and r.parent_id is not null
          and (r.source_id = any(${sql.param([...roots])}::text[])
            or not exists (select 1 from import_records p
              where p.import_id = r.import_id and p.kind = r.kind and p.source_id = r.parent_id))`);
      await tx.execute(sql`
        with recursive walk(source_id, path, seen) as (
          select source_id, array[coalesce(sort, '') || chr(1) || source_id], array[source_id]
          from import_records where import_id = ${this.#importId} and kind = ${kind} and parent_id is null
          union all
          select c.source_id, w.path || (coalesce(c.sort, '') || chr(1) || c.source_id), w.seen || c.source_id
          from import_records c join walk w on c.parent_id = w.source_id
          where c.import_id = ${this.#importId} and c.kind = ${kind} and not c.source_id = any(w.seen)
            and cardinality(w.seen) < 1000
        ),
        ranked as (select source_id, row_number() over (order by path) as ordinal from walk)
        update import_records r set ordinal = ranked.ordinal
        from ranked where r.import_id = ${this.#importId} and r.kind = ${kind} and r.source_id = ranked.source_id`);
      await tx.execute(sql`
        with unreached as (
          select source_id, row_number() over (order by coalesce(sort, ''), source_id) as rank
          from import_records where import_id = ${this.#importId} and kind = ${kind} and ordinal is null
        ),
        base as (
          select coalesce(max(ordinal), 0) as top from import_records
          where import_id = ${this.#importId} and kind = ${kind}
        )
        update import_records r set ordinal = base.top + unreached.rank, parent_id = null
        from unreached, base
        where r.import_id = ${this.#importId} and r.kind = ${kind} and r.source_id = unreached.source_id`);
    });
  }

  async removeOtherThan(kind: string, field: string, value: string): Promise<void> {
    await this.#database.execute(sql`
      delete from import_records
      where import_id = ${this.#importId} and kind = ${kind} and data ->> ${field} is not null
        and data ->> ${field} <> ${value}`);
  }

  async clear(): Promise<void> {
    this.#pending = [];
    await this.#database.execute(sql`delete from import_records where import_id = ${this.#importId}`);
  }
}
