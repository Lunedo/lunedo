#!/usr/bin/env node
// Development loop for Node packages: rebuilds on changes and restarts the entry point.
// Usage: lunedo-dev [--start dist/main.js] [--watch <dir>]... [--build "<command>"]
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { snapshot } from "./file-snapshot.ts";

const POLL_INTERVAL_MS = 700;

const { values } = parseArgs({
  options: {
    start: { type: "string" },
    watch: { type: "string", multiple: true, default: ["src"] },
    build: { type: "string", default: "tsc -p tsconfig.build.json" },
  },
});

let child: ChildProcess | undefined;

function stop(): Promise<void> {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    running.once("exit", () => resolve());
    running.kill("SIGTERM");
  });
}

async function rebuild(): Promise<void> {
  const result = spawnSync(values.build, { shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[dev] Build failed, waiting for changes.");
    return;
  }
  if (!values.start) return;
  await stop();
  child = spawn(process.execPath, ["--enable-source-maps", values.start], { stdio: "inherit" });
}

let last = snapshot(values.watch);
let busy = false;
await rebuild();

async function poll(): Promise<void> {
  const current = snapshot(values.watch);
  if (current === last) return;
  last = current;
  await rebuild();
  last = snapshot(values.watch);
}

setInterval(() => {
  if (busy) return;
  busy = true;
  poll()
    .catch((error: unknown) => console.error("[dev] Rebuild failed:", error))
    .finally(() => {
      busy = false;
    });
}, POLL_INTERVAL_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
