import type { TestProject } from "vitest/node";
import { createMigratedDatabase, startDatabaseRun, testDatabaseBaseUrl } from "./database.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Migrated database for this test run, or an empty string when none is configured. */
    databaseUrl: string;
  }
}

/**
 * Creates one migrated database per test run and removes it, and every other database the
 * run created, afterwards.
 */
export default async function setup(project: TestProject) {
  const baseUrl = testDatabaseBaseUrl();
  if (!baseUrl) {
    project.provide("databaseUrl", "");
    return;
  }
  const finishRun = startDatabaseRun(baseUrl);
  const database = await createMigratedDatabase(baseUrl);
  project.provide("databaseUrl", database.url);
  return async () => {
    await database.drop();
    await finishRun();
  };
}
