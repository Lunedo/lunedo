import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { FileStore } from "../files/store.js";

type RecordedDelta = {
  key: string;
  delta: string | number;
  pages: number;
  fetching: boolean;
  done: boolean;
};

function missedByListing(delta: RecordedDelta, lastKeys: readonly string[]): boolean {
  if (delta.done) return true;
  const passed = delta.pages > 0 ? lastKeys[delta.pages - 1] : undefined;
  if (passed !== undefined && delta.key <= passed) return true;
  const fetching = delta.fetching ? lastKeys[delta.pages] : undefined;
  return fetching !== undefined && delta.key <= fetching;
}

export class StorageUsage {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  async add(delta: number, key?: string): Promise<void> {
    if (delta === 0) return;
    await this.#database.execute(sql`
      with state as (
        insert into storage_state (singleton, used_bytes) values (true, greatest(0, ${delta}))
        on conflict (singleton) do update
          set used_bytes = greatest(0, storage_state.used_bytes + ${delta}), updated_at = now()
        returning reconcile_run, reconcile_pages, reconcile_fetching, reconcile_done
      )
      insert into storage_reconcile_deltas (id, run, key, delta, pages, fetching, done)
      select ${uuidv7()}, reconcile_run, ${key ?? null}, ${delta}, reconcile_pages, reconcile_fetching, reconcile_done
      from state where reconcile_run is not null and ${key ?? null}::text is not null`);
  }

  async total(): Promise<number> {
    const result = await this.#database.execute<{ used_bytes: string | number }>(
      sql`select used_bytes from storage_state where singleton`,
    );
    return Number(result.rows[0]?.used_bytes ?? 0);
  }

  async reconcile(store: FileStore, at: Date): Promise<number> {
    const run = uuidv7();
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        insert into storage_state (singleton, reconcile_run) values (true, ${run})
        on conflict (singleton) do update
          set reconcile_run = ${run}, reconcile_pages = 0, reconcile_fetching = false, reconcile_done = false`);
      await tx.execute(sql`delete from storage_reconcile_deltas`);
    });
    const lastKeys: string[] = [];
    let sum = 0;
    const listing = store.list(undefined, {
      fetching: async () => {
        await this.#database.execute(sql`
          update storage_state set reconcile_fetching = true where singleton and reconcile_run = ${run}`);
      },
      fetched: async (lastKey, more) => {
        lastKeys.push(lastKey ?? lastKeys.at(-1) ?? "");
        await this.#database.execute(sql`
          update storage_state set reconcile_pages = ${lastKeys.length}, reconcile_fetching = false,
            reconcile_done = ${!more}
          where singleton and reconcile_run = ${run}`);
      },
    });
    for await (const object of listing) sum += object.size;
    return this.#database.transaction(async (tx) => {
      const state = await tx.execute<{ reconcile_run: string | null }>(
        sql`select reconcile_run from storage_state where singleton for update`,
      );
      if (state.rows[0]?.reconcile_run !== run) return this.total();
      const recorded = await tx.execute<RecordedDelta>(sql`
        select key, delta, pages, fetching, done from storage_reconcile_deltas where run = ${run}`);
      const missed = recorded.rows
        .filter((delta) => missedByListing(delta, lastKeys))
        .reduce((total, delta) => total + Number(delta.delta), 0);
      const used = Math.max(0, sum + missed);
      await tx.execute(sql`
        update storage_state set used_bytes = ${used}, reconciled_at = ${at}, updated_at = now(),
          reconcile_run = null, reconcile_pages = 0, reconcile_fetching = false, reconcile_done = false
        where singleton`);
      await tx.execute(sql`delete from storage_reconcile_deltas where run = ${run}`);
      return used;
    });
  }

  async reconciledAt(): Promise<Date | null> {
    const result = await this.#database.execute<{ reconciled_at: Date | string | null }>(
      sql`select reconciled_at from storage_state where singleton`,
    );
    const value = result.rows[0]?.reconciled_at;
    return value ? new Date(value) : null;
  }
}
