import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { LoggedError } from "../logging/logger.js";

const HOUR_MS = 60 * 60 * 1000;
export const ERROR_EVENT_RETENTION_DAYS = 7;
export const MAX_ERROR_TYPES_PER_FLUSH = 200;

interface Pending {
  hour: Date;
  type: string;
  code: string;
  count: number;
  lastAt: Date;
}

export interface RecentErrorType {
  type: string;
  code: string | null;
  services: string[];
  count: number;
  lastAt: Date;
}

export class ErrorEvents {
  readonly #service: string;
  readonly #now: () => Date;
  #pending = new Map<string, Pending>();
  #listeners: ((error: LoggedError) => void)[] = [];

  constructor(options: { service: string; now?: () => Date }) {
    this.#service = options.service;
    this.#now = options.now ?? (() => new Date());
  }

  onRecord(listener: (error: LoggedError) => void): void {
    this.#listeners.push(listener);
  }

  readonly record = (error: LoggedError): void => {
    const now = this.#now();
    const hour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
    const code = error.code ?? "";
    const key = `${hour.getTime()}\u0000${error.type}\u0000${code}`;
    const pending = this.#pending.get(key);
    if (pending) {
      pending.count += 1;
      pending.lastAt = now;
    } else if (this.#pending.size < MAX_ERROR_TYPES_PER_FLUSH) {
      this.#pending.set(key, { hour, type: error.type, code, count: 1, lastAt: now });
    }
    for (const listener of this.#listeners) listener(error);
  };

  async flush(database: Database): Promise<number> {
    if (this.#pending.size === 0) return 0;
    const entries = [...this.#pending.values()];
    this.#pending = new Map();
    try {
      for (const entry of entries) {
        await database.execute(sql`
          insert into operations_error_events (hour, service, type, code, count, last_at)
          values (${entry.hour}, ${this.#service}, ${entry.type}, ${entry.code}, ${entry.count}, ${entry.lastAt})
          on conflict (hour, service, type, code) do update
            set count = operations_error_events.count + excluded.count,
                last_at = greatest(operations_error_events.last_at, excluded.last_at)
        `);
      }
    } catch (error) {
      for (const entry of entries) {
        const key = `${entry.hour.getTime()}\u0000${entry.type}\u0000${entry.code}`;
        const pending = this.#pending.get(key);
        if (pending) {
          pending.count += entry.count;
        } else if (this.#pending.size < MAX_ERROR_TYPES_PER_FLUSH) {
          this.#pending.set(key, entry);
        }
      }
      throw error;
    }
    return entries.length;
  }
}

export async function recentErrorTypes(
  database: Database,
  options: { since: Date; limit: number },
): Promise<RecentErrorType[]> {
  const result = await database.execute<{
    type: string;
    code: string;
    services: string[];
    count: string | number;
    last_at: Date | string;
  }>(sql`
    select type, code, array_agg(distinct service order by service) as services,
           sum(count) as count, max(last_at) as last_at
    from operations_error_events
    where hour >= ${new Date(Math.floor(options.since.getTime() / HOUR_MS) * HOUR_MS)}
      and last_at >= ${options.since}
    group by type, code
    order by max(last_at) desc
    limit ${options.limit}
  `);
  return result.rows.map((row) => ({
    type: row.type,
    code: row.code === "" ? null : row.code,
    services: row.services,
    count: Number(row.count),
    lastAt: new Date(row.last_at),
  }));
}

export async function removeOldErrorEvents(database: Database, now = new Date()): Promise<number> {
  const result = await database.execute(sql`
    delete from operations_error_events
    where hour < ${new Date(now.getTime() - ERROR_EVENT_RETENTION_DAYS * 24 * HOUR_MS)}
  `);
  return result.rowCount ?? 0;
}
