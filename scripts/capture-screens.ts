import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArguments, parseLog, renderIndex } from "./screen-index.ts";

const root = path.resolve(import.meta.dirname, "..");
let options: ReturnType<typeof parseArguments>;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const output = path.resolve(process.env.INIT_CWD ?? process.cwd(), options.output);
mkdirSync(output, { recursive: true });
const log = path.join(output, "capture.jsonl");
rmSync(log, { force: true });

const pnpm = process.env.npm_execpath ?? "";
function run(args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const [command, prefix] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm]] : [pnpm || "pnpm", []];
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: !/\.[cm]?js$/.test(pnpm) && process.platform === "win32",
  });
  return result.status ?? 1;
}

if (options.build) {
  if (run(["build"]) !== 0 || run(["--filter", "@lunedo/web", "build:e2e"]) !== 0) {
    console.error("The build failed; fix it and run the capture again.");
    process.exit(1);
  }
}

const status = run(
  [
    "--filter",
    "@lunedo/web",
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.screens.config.ts",
    ...(options.only ? ["--project", options.only] : []),
  ],
  {
    ...process.env,
    LUNEDO_SCREENS_DIR: output,
    ...(options.only ? { LUNEDO_SCREENS_ONLY: options.only } : {}),
    LUNEDO_E2E_PORT: process.env.LUNEDO_E2E_PORT ?? "4410",
    LUNEDO_E2E_STATE_DIR: process.env.LUNEDO_E2E_STATE_DIR ?? path.join(tmpdir(), "lunedo-screens-state"),
  },
);

const entries = existsSync(log) ? parseLog(readFileSync(log, "utf8")) : [];
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();
writeFileSync(
  path.join(output, "index.md"),
  renderIndex(entries, { date: new Date().toISOString().slice(0, 10), commit }),
);
rmSync(log, { force: true });
const captured = entries.filter((entry) => entry.kind === "captured").length;
const failed = entries.filter((entry) => entry.kind === "failed").length;
console.log(`\n${captured} screenshots in ${output}, listed in index.md.`);
if (status !== 0 || failed > 0) {
  console.error('Some screens could not be captured; index.md lists them under "Not captured".');
  process.exit(1);
}
