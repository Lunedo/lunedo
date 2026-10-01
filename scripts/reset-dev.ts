import { execFileSync } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { CONFIRMATION, isConfirmed, resetStatements } from "./dev-reset.ts";

const root = path.resolve(import.meta.dirname, "..");
const compose = ["compose", "-f", path.join(root, "docker/compose.dev.yml")];

function docker(args: string[], input?: string): string {
  return execFileSync("docker", [...compose, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "inherit"],
  });
}

function psql(sql: string): string {
  return docker(
    ["exec", "-T", "postgres", "psql", "-U", "pagehall", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    sql,
  );
}

console.log(
  [
    "This deletes all development data:",
    "  - the development database and every database left behind by tests",
    "  - the development secrets and files (master keys, backup keys, metrics token)",
  ].join("\n"),
);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question(`Type "${CONFIRMATION}" to continue: `);
prompt.close();
if (!isConfirmed(answer)) {
  console.log("Nothing was changed.");
  process.exit(1);
}

docker(["rm", "--stop", "--force", "app"]);
docker(["up", "--detach", "--wait", "postgres"]);
const databases = psql("SELECT datname FROM pg_database;").split("\n").filter(Boolean);
const statements = resetStatements(databases);
psql(statements.join("\n"));
const project = JSON.parse(docker(["config", "--format", "json"])) as { name: string };
execFileSync("docker", ["volume", "rm", "--force", `${project.name}_pagehall-data`], { stdio: "inherit" });
console.log(
  `Dropped ${statements.length - 2} test databases and reset the development database and secrets.`,
);
console.log("Start the environment again with pnpm dev.");
