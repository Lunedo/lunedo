import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { clearRequestCache } from "../observability/request-context.js";
import type { DatabasePool } from "./pool.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type Executor = Database | Transaction;

const READ_ONLY = /^\s*(select|with)\b/i;
const WRITES = /\b(insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i;

export function isReadOnlyQuery(query: string): boolean {
  return READ_ONLY.test(query) && !WRITES.test(query);
}

/** Drizzle client with the snake_case naming convention used by every table. */
export function createDatabase(pool: DatabasePool): Database {
  return drizzle({
    client: pool,
    schema,
    casing: "snake_case",
    logger: {
      logQuery: (query) => {
        if (!isReadOnlyQuery(query)) clearRequestCache();
      },
    },
  });
}
