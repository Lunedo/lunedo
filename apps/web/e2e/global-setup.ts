import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  BASE_URL,
  DATABASE_BASE_URL,
  E2E_PORT,
  MAILPIT_URL,
  STATE_DIR,
  writeState,
} from "./support/environment.js";

const appRoot = fileURLToPath(new URL("../../..", import.meta.url));
const webRoot = fileURLToPath(new URL("../dist", import.meta.url));

function databaseUrl(name: string): string {
  const url = new URL(DATABASE_BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function start(
  role: "api" | "collab" | "worker",
  env: NodeJS.ProcessEnv,
  onLine: (line: string) => void,
): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--enable-source-maps", path.join(appRoot, `apps/${role}/dist/main.js`)],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let buffer = "";
  const read = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      onLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  return child;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function answers(url: string): Promise<boolean> {
  return fetch(url).then(
    () => true,
    () => false,
  );
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  for (const port of [E2E_PORT, E2E_PORT + 1, E2E_PORT + 2]) {
    if (await answers(`http://localhost:${port}/`)) {
      throw new Error(
        `Port ${port} is already in use, probably by another end-to-end run. Wait for it to finish, or choose other ports with PAGEHALL_E2E_PORT.`,
      );
    }
  }
  rmSync(STATE_DIR, { recursive: true, force: true });
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
  mkdirSync(STATE_DIR, { recursive: true });
  const database = `pagehall_e2e_${Date.now()}`;
  const admin = new pg.Client({ connectionString: DATABASE_BASE_URL });
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();

  writeState({ databaseUrl: databaseUrl(database) });
  const dataDir = mkdtempSync(path.join(STATE_DIR, "data-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PAGEHALL_DATABASE_URL: databaseUrl(database),
    PAGEHALL_HOST: process.env.PAGEHALL_E2E_HOST ?? "127.0.0.1",
    PAGEHALL_API_PORT: String(E2E_PORT),
    PAGEHALL_COLLAB_PORT: String(E2E_PORT + 1),
    PAGEHALL_WORKER_PORT: String(E2E_PORT + 2),
    ...(process.env.PAGEHALL_E2E_REDIS_URL ? { PAGEHALL_REDIS_URL: process.env.PAGEHALL_E2E_REDIS_URL } : {}),
    PAGEHALL_WEB_ROOT: webRoot,
    PAGEHALL_SECRETS_DIR: path.join(dataDir, "secrets"),
    PAGEHALL_FILES_DIR: path.join(dataDir, "files"),
    PAGEHALL_LOG_LEVEL: "info",
    PAGEHALL_TRUSTED_PROXIES: "127.0.0.1,::1",
    PAGEHALL_INSECURE_IDENTITY_PROVIDERS: process.env.PAGEHALL_E2E_IDP === "1" ? "true" : "false",
  };
  mkdirSync(env.PAGEHALL_FILES_DIR as string, { recursive: true });

  const log: string[] = [];
  let setupCode: string | null = null;
  const capture = (line: string) => {
    log.push(line);
    const match = /setup#code=([0-9A-Z-]+)\./.exec(line);
    if (match?.[1]) setupCode = match[1];
  };
  const api = start("api", env, capture);
  let worker: ChildProcess | undefined;
  let collab: ChildProcess | undefined;
  try {
    await waitFor(async () => (await fetch(`${BASE_URL}/health/ready`)).ok, 120_000, "the API");
    worker = start("worker", env, (line) => log.push(line));
    collab = start("collab", env, (line) => log.push(line));
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${E2E_PORT + 1}/health/ready`)).ok,
      60_000,
      "the collaboration server",
    );
    await waitFor(async () => setupCode !== null, 10_000, "the setup code");
  } catch (error) {
    writeFileSync(path.join(STATE_DIR, "server.log"), log.join("\n"));
    for (const child of [api, worker, collab]) child?.kill();
    throw error;
  }
  writeState({ setupCode: setupCode ?? "" });

  return async () => {
    writeFileSync(path.join(STATE_DIR, "server.log"), log.join("\n"));
    for (const child of [api, worker, collab]) child?.kill();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const cleanup = new pg.Client({ connectionString: DATABASE_BASE_URL });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${database} with (force)`);
    await cleanup.end();
  };
}
