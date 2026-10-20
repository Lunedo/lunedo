import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readState } from "./environment.js";

const run = promisify(execFile);
const serverRoot = fileURLToPath(new URL("../../../../packages/server", import.meta.url));

const PUBLISH_NOW = `
const { createDatabase, createDatabasePool, createLogger, PgBossQueue, scheduledBlogPostsJob } =
  await import("@pagehall/server");
const [connectionString, postId] = process.argv.slice(1);
const pool = createDatabasePool({ connectionString, applicationName: "pagehall-e2e", max: 2 });
const queue = new PgBossQueue({
  connectionString,
  database: createDatabase(pool),
  logger: createLogger({ service: "e2e", level: "silent" }),
  role: "producer",
});
try {
  await pool.query(
    "update blog_posts set scheduled_at = now() - interval '1 second' where item_id = $1 and scheduled_at is not null",
    [postId],
  );
  await queue.enqueue(scheduledBlogPostsJob, {});
} finally {
  await queue.stop({ timeoutSeconds: 5 });
  await pool.end();
}
`;

export async function publishScheduledPostNow(postId: string): Promise<void> {
  await run(
    process.execPath,
    ["--input-type=module", "-e", PUBLISH_NOW, readState().databaseUrl ?? "", postId],
    {
      cwd: serverRoot,
      timeout: 30_000,
    },
  );
}

const MAKE_DUE = `
const { createDatabasePool } = await import("@pagehall/server");
const [connectionString, itemId] = process.argv.slice(1);
const pool = createDatabasePool({ connectionString, applicationName: "pagehall-e2e", max: 1 });
try {
  await pool.query(
    "update article_reviews set published_at = now() - interval '4 months', reviewed_at = null where item_id = $1",
    [itemId],
  );
} finally {
  await pool.end();
}
`;

export async function makeArticleDue(itemId: string): Promise<void> {
  await run(
    process.execPath,
    ["--input-type=module", "-e", MAKE_DUE, readState().databaseUrl ?? "", itemId],
    {
      cwd: serverRoot,
      timeout: 30_000,
    },
  );
}
