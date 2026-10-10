import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export const IMPORT_CHANGES_CHANNEL = "pagehall_imports";

export interface ImportChangeSignal {
  importId: string;
  organizationId: string;
}

export function parseImportChangeSignal(payload: string): ImportChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<ImportChangeSignal>;
    if (typeof parsed.importId === "string" && typeof parsed.organizationId === "string") {
      return { importId: parsed.importId, organizationId: parsed.organizationId };
    }
  } catch {
    return null;
  }
  return null;
}

export async function signalImportChange(executor: Executor, signal: ImportChangeSignal): Promise<void> {
  await executor.execute(sql`select pg_notify(${IMPORT_CHANGES_CHANNEL}, ${JSON.stringify(signal)})`);
}
