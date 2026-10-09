import type { TestProject } from "vitest/node";
import { createMigratedDatabase, testDatabaseBaseUrl } from "./database.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Migrated database for this test run, or an empty string when none is configured. */
    databaseUrl: string;
  }
}

/** Creates one migrated database per test run and drops it afterwards. */
export default async function setup(project: TestProject) {
  const baseUrl = testDatabaseBaseUrl();
  if (!baseUrl) {
    project.provide("databaseUrl", "");
    return;
  }
  const database = await createMigratedDatabase(baseUrl);
  project.provide("databaseUrl", database.url);
  return () => database.drop();
}
