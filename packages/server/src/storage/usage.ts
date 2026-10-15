import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { FileStore } from "../files/store.js";

export class StorageUsage {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  async add(delta: number): Promise<void> {
    if (delta === 0) return;
    await this.#database.execute(sql`
      insert into storage_state (singleton, used_bytes) values (true, greatest(0, ${delta}))
      on conflict (singleton) do update
        set used_bytes = greatest(0, storage_state.used_bytes + ${delta}), updated_at = now()`);
  }

  async total(): Promise<number> {
    const result = await this.#database.execute<{ used_bytes: string | number }>(
      sql`select used_bytes from storage_state where singleton`,
    );
    return Number(result.rows[0]?.used_bytes ?? 0);
  }

  async reconcile(store: FileStore, at: Date): Promise<number> {
    let sum = 0;
    for await (const object of store.list()) sum += object.size;
    await this.#database.execute(sql`
      insert into storage_state (singleton, used_bytes, reconciled_at) values (true, ${sum}, ${at})
      on conflict (singleton) do update
        set used_bytes = ${sum}, reconciled_at = ${at}, updated_at = now()`);
    return sum;
  }

  async reconciledAt(): Promise<Date | null> {
    const result = await this.#database.execute<{ reconciled_at: Date | string | null }>(
      sql`select reconciled_at from storage_state where singleton`,
    );
    const value = result.rows[0]?.reconciled_at;
    return value ? new Date(value) : null;
  }
}
