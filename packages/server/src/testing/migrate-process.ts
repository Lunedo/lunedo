// Child process for the concurrent migration test.
import { runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";

const pool = createDatabasePool({
  connectionString: process.env.MIGRATE_DATABASE_URL ?? "",
  applicationName: "lunedo-test-migrate",
});
try {
  await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }) });
} finally {
  await pool.end();
}
