import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../database/columns.js";

/** Progress reported by running jobs. The key is the job ID assigned by the queue. */
export const jobProgress = pgTable("job_progress", {
  jobId: uuid().primaryKey(),
  queue: text().notNull(),
  done: integer().notNull(),
  total: integer(),
  message: text(),
  ...timestamps(),
});
