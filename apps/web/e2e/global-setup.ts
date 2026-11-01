import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { BASE_URL, DATABASE_BASE_URL, E2E_PORT, STATE_DIR, writeState } from "./support/environment.js";
import {
  FOLDER_EXPORT_TEMPLATE,
  IMPORT_DIR,
  PEOPLE_EXPORT_TEMPLATE,
  REIMPORT_AFTER_TEMPLATE,
  REIMPORT_BEFORE_TEMPLATE,
  writeSyntheticExport,
} from "./support/imports.js";

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
        `Port ${port} is already in use, probably by another end-to-end run. Wait for it to finish, or choose other ports with LUNEDO_E2E_PORT.`,
      );
    }
  }
  rmSync(STATE_DIR, { recursive: true, force: true });
  mkdirSync(STATE_DIR, { recursive: true });
  const database = `lunedo_e2e_${Date.now()}`;
  const admin = new pg.Client({ connectionString: DATABASE_BASE_URL });
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();

  writeState({ databaseUrl: databaseUrl(database) });
  const dataDir = mkdtempSync(path.join(STATE_DIR, "data-"));
  writeState({ dataDir });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUNEDO_DATABASE_URL: databaseUrl(database),
    LUNEDO_HOST: process.env.LUNEDO_E2E_HOST ?? "127.0.0.1",
    LUNEDO_API_PORT: String(E2E_PORT),
    LUNEDO_COLLAB_PORT: String(E2E_PORT + 1),
    LUNEDO_WORKER_PORT: String(E2E_PORT + 2),
    LUNEDO_API_PROCESSES: process.env.LUNEDO_API_PROCESSES ?? "2",
    LUNEDO_DATABASE_POOL_SIZE: process.env.LUNEDO_DATABASE_POOL_SIZE ?? "10",
    LUNEDO_SEARCH_SLOTS: process.env.LUNEDO_SEARCH_SLOTS ?? "2",
    ...(process.env.LUNEDO_E2E_REDIS_URL ? { LUNEDO_REDIS_URL: process.env.LUNEDO_E2E_REDIS_URL } : {}),
    LUNEDO_WEB_ROOT: webRoot,
    LUNEDO_SECRETS_DIR: path.join(dataDir, "secrets"),
    LUNEDO_FILES_DIR: path.join(dataDir, "files"),
    LUNEDO_BACKUP_DIR: path.join(dataDir, "backups"),
    LUNEDO_WORK_DIR: path.join(dataDir, "work"),
    LUNEDO_IMPORT_DIR: IMPORT_DIR,
    LUNEDO_LOG_LEVEL: "info",
    LUNEDO_TRUSTED_PROXIES: "127.0.0.1,::1",
    LUNEDO_UPDATE_CHECK: "false",
    LUNEDO_INSECURE_IDENTITY_PROVIDERS: process.env.LUNEDO_E2E_IDP === "1" ? "true" : "false",
  };
  mkdirSync(env.LUNEDO_FILES_DIR as string, { recursive: true });
  mkdirSync(env.LUNEDO_BACKUP_DIR as string, { recursive: true });
  mkdirSync(IMPORT_DIR, { recursive: true });
  await writeSyntheticExport("csv", FOLDER_EXPORT_TEMPLATE);
  await writeSyntheticExport("csv", PEOPLE_EXPORT_TEMPLATE, "people");
  await writeSyntheticExport("xml", REIMPORT_BEFORE_TEMPLATE, "reimportBefore");
  await writeSyntheticExport("xml", REIMPORT_AFTER_TEMPLATE, "reimportAfter");

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
