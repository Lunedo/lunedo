import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  appliedMigrations,
  journalMigrations,
  MIGRATIONS_QUERY,
  unknownMigrations,
  unknownMigrationsMessage,
} from "./dev-migrations.ts";
import { DEV_DATABASE } from "./dev-reset.ts";

const root = path.resolve(import.meta.dirname, "..");
const compose = ["compose", "-f", path.join(root, "docker/compose.dev.yml")];

execFileSync("docker", [...compose, "up", "--detach", "--wait", "postgres"], { cwd: root, stdio: "inherit" });
const applied = appliedMigrations(
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "pagehall",
      "-d",
      DEV_DATABASE,
      "-At",
      "-c",
      MIGRATIONS_QUERY,
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const known = journalMigrations(
  readFileSync(path.join(root, "packages/server/drizzle/meta/_journal.json"), "utf8"),
);
const unknown = unknownMigrations(applied, known);
if (unknown.length > 0) {
  console.error(unknownMigrationsMessage(unknown.length));
  process.exit(1);
}
const started = spawnSync("docker", [...compose, "up", "--build"], { cwd: root, stdio: "inherit" });
process.exit(started.status ?? 1);
