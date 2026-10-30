import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Executor } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import * as schema from "../database/schema.js";

export const SEARCH_RETRY_AFTER_SECONDS = 2;
const FIRST_RETRY_MS = 10;
const LONGEST_RETRY_MS = 200;

export class SearchBusyError extends Error {
  override name = "SearchBusyError";
  readonly retryAfterSeconds = SEARCH_RETRY_AFTER_SECONDS;

  constructor() {
    super("Search is busy; try again in a moment");
  }
}

export class SearchTimeoutError extends Error {
  override name = "SearchTimeoutError";

  constructor() {
    super("The search took too long");
  }
}

export interface SearchLaneObserver {
  waited(seconds: number): void;
  rejected(): void;
  using(change: 1 | -1): void;
}

const MISSED = Symbol("missed");
const ACQUIRE_TIMEOUT = "timeout exceeded when trying to connect";
const QUERY_CANCELED = "57014";

function canceled(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === QUERY_CANCELED) return true;
  }
  return false;
}

export class SearchLane {
  readonly #pool: DatabasePool;
  readonly #database: ReturnType<typeof drizzle<typeof schema>>;
  readonly #slots: number;
  readonly #waitMs: number;
  readonly #observer: SearchLaneObserver | undefined;
  readonly #sleep: (ms: number) => Promise<unknown>;

  constructor(options: {
    pool: DatabasePool;
    slots: number;
    waitMs: number;
    observer?: SearchLaneObserver;
    sleep?: (ms: number) => Promise<unknown>;
  }) {
    this.#pool = options.pool;
    this.#database = drizzle({ client: options.pool, schema, casing: "snake_case" });
    this.#slots = Math.max(1, options.slots);
    this.#waitMs = options.waitMs;
    this.#observer = options.observer;
    this.#sleep = options.sleep ?? ((ms) => delay(ms));
  }

  get pool(): DatabasePool {
    return this.#pool;
  }

  async run<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    const started = performance.now();
    let retry = FIRST_RETRY_MS;
    for (;;) {
      const outcome = await this.#attempt(work, started);
      if (outcome !== MISSED) return outcome.value;
      const waited = performance.now() - started;
      if (waited + retry > this.#waitMs) {
        this.#observer?.rejected();
        throw new SearchBusyError();
      }
      await this.#sleep(retry + Math.random() * retry);
      retry = Math.min(retry * 2, LONGEST_RETRY_MS);
    }
  }

  async #attempt<T>(work: (executor: Executor) => Promise<T>, started: number) {
    try {
      return await this.#database.transaction(async (tx) => {
        const slot = await tx.execute<{ slot: number }>(sql`
          select s as slot from generate_series(0, ${this.#slots - 1}) s
          where pg_try_advisory_xact_lock(hashtext('lunedo:search-slots'), s) limit 1`);
        if (slot.rows.length === 0) return MISSED;
        this.#observer?.waited((performance.now() - started) / 1000);
        this.#observer?.using(1);
        try {
          return { value: await work(tx) };
        } catch (error) {
          if (canceled(error)) throw new SearchTimeoutError();
          throw error;
        } finally {
          this.#observer?.using(-1);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === ACQUIRE_TIMEOUT) return MISSED;
      throw error;
    }
  }
}
