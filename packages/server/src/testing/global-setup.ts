import type { TestProject } from "vitest/node";
import { runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, testDatabaseBaseUrl } from "./database.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Migrated database for this test run, or an empty string when none is configured. */
    databaseUrl: string;
  }
}

/** Creates and migrates one database per test run and drops it afterwards. */
export default async function setup(project: TestProject) {
  const baseUrl = testDatabaseBaseUrl();
  if (!baseUrl) {
    project.provide("databaseUrl", "");
    return;
  }
  const database = await createTemporaryDatabase(baseUrl);
  const pool = createDatabasePool({ connectionString: database.url, applicationName: "pagehall-test-setup" });
  try {
    await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }) });
  } finally {
    await pool.end();
  }
  project.provide("databaseUrl", database.url);
  return () => database.drop();
}
