import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SERVER_TOOL_ROOT = "/usr/lib/postgresql";

export const PG_DUMP_MISSING = "pg_dump not found, runs in CI";

export const PG_DUMP_REQUIRED = "pg_dump not found: the backup tests need the PostgreSQL client tools";

export const SKIP_WITHOUT_PG_DUMP = !process.env.CI;

export function pgDumpFound(): boolean {
  if (!spawnSync("pg_dump", ["--version"], { stdio: "ignore" }).error) return true;
  if (!existsSync(SERVER_TOOL_ROOT)) return false;
  return readdirSync(SERVER_TOOL_ROOT).some((version) =>
    existsSync(path.join(SERVER_TOOL_ROOT, version, "bin", "pg_dump")),
  );
}
