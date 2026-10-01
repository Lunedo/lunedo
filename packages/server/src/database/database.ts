import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DatabasePool } from "./pool.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type Executor = Database | Transaction;

/** Drizzle client with the snake_case naming convention used by every table. */
export function createDatabase(pool: DatabasePool): Database {
  return drizzle({ client: pool, schema, casing: "snake_case" });
}
