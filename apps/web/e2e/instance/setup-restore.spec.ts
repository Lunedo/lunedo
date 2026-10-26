import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import pg from "pg";
import {
  PG_DUMP_MISSING,
  PG_DUMP_REQUIRED,
  pgDumpFound,
  SKIP_WITHOUT_PG_DUMP,
} from "../support/backup-tools.js";
import { DATABASE_BASE_URL, E2E_PORT, OWNER, readState, STATE_DIR } from "../support/environment.js";
import { freshTotp, signInWithPassword } from "../support/helpers.js";

const appRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const webRoot = fileURLToPath(new URL("../../dist", import.meta.url));
const PORT = E2E_PORT + 10;
const SETUP_CODE = "RESTORE-FROM-SERVER-2026";
const BACKUP = "lunedo-backup-20261024T020000Z-manual-0e2e0e2e.ldbak";

function databaseUrl(name: string): string {
  const url = new URL(DATABASE_BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function startApi(env: NodeJS.ProcessEnv, log: string[]): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--enable-source-maps", path.join(appRoot, "apps/api/dist/main.js")],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => log.push(chunk.toString("utf8")));
  return child;
}

async function ready(): Promise<void> {
  await expect
    .poll(
      () =>
        fetch(`http://localhost:${PORT}/health/ready`).then(
          (response) => response.ok,
          () => false,
        ),
      { timeout: 120_000 },
    )
    .toBe(true);
}

const pgDump = pgDumpFound();
test.skip(!pgDump && SKIP_WITHOUT_PG_DUMP, PG_DUMP_MISSING);
test.beforeAll(() => expect(pgDump, PG_DUMP_REQUIRED).toBe(true));

test("restores a backup of this instance from the server folder into a new, empty instance", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const { databaseUrl: sourceDatabase, dataDir, ownerSecret } = readState();
  expect(sourceDatabase && dataDir && ownerSecret).toBeTruthy();
  const work = mkdtempSync(path.join(STATE_DIR, "setup-restore-"));
  const backups = path.join(work, "backups");
  mkdirSync(backups, { recursive: true });

  await promisify(execFile)(
    process.execPath,
    [
      path.join(appRoot, "apps/worker/dist/cli/main.js"),
      "backup",
      "create",
      "--output",
      path.join(backups, BACKUP),
    ],
    {
      env: {
        ...process.env,
        LUNEDO_DATABASE_URL: sourceDatabase,
        LUNEDO_SECRETS_DIR: path.join(dataDir ?? "", "secrets"),
        LUNEDO_FILES_DIR: path.join(dataDir ?? "", "files"),
        LUNEDO_WORK_DIR: path.join(work, "source-work"),
        LUNEDO_LOG_LEVEL: "warn",
      },
    },
  );

  const database = `lunedo_e2e_restore_${Date.now()}`;
  const admin = new pg.Client({ connectionString: DATABASE_BASE_URL });
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUNEDO_DATABASE_URL: databaseUrl(database),
    LUNEDO_HOST: process.env.LUNEDO_E2E_HOST ?? "127.0.0.1",
    LUNEDO_API_PORT: String(PORT),
    LUNEDO_WEB_ROOT: webRoot,
    LUNEDO_SETUP_CODE: SETUP_CODE,
    LUNEDO_SECRETS_DIR: path.join(work, "secrets"),
    LUNEDO_FILES_DIR: path.join(work, "files"),
    LUNEDO_BACKUP_DIR: backups,
    LUNEDO_WORK_DIR: path.join(work, "work"),
    LUNEDO_LOG_LEVEL: "info",
    LUNEDO_TRUSTED_PROXIES: "127.0.0.1,::1",
    LUNEDO_UPDATE_CHECK: "false",
    LUNEDO_BACKUP_BEFORE_UPDATE: "false",
  };
  mkdirSync(path.join(work, "files"), { recursive: true });
  const log: string[] = [];
  let api = startApi(env, log);
  try {
    await ready();
    const exited = new Promise<number | null>((resolve) => api.once("exit", resolve));

    await page.goto(`http://localhost:${PORT}/setup#code=${SETUP_CODE}`);
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("button", { name: /^From the server/ }).click();
    await expect(page.getByRole("heading", { name: "From the server" })).toBeVisible();
    await page.getByRole("radio", { name: new RegExp(BACKUP) }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Keys" })).toBeVisible();
    await page
      .getByLabel("Backup key")
      .fill(readFileSync(path.join(dataDir ?? "", "secrets", "backup-keys"), "utf8"));
    await page.getByLabel("Master keys").setInputFiles(path.join(dataDir ?? "", "secrets", "master-keys"));
    await page.getByRole("button", { name: "Restore" }).click();

    await expect(page.getByRole("heading", { name: "Restoring" })).toBeVisible();
    await expect(page.getByText("Backup verified")).toBeVisible();
    expect(await exited).toBe(0);
    api = startApi(env, log);
    await ready();
    await expect(page.getByText("Restored", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Go to sign-in" })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: "Go to sign-in" }).click();

    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await signInWithPassword(page, OWNER.email, OWNER.password);
    await page.getByLabel("Code from your authenticator app").fill(await freshTotp(ownerSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
    await page.goto(`http://localhost:${PORT}/settings/instance/backups`);
    await expect(
      page
        .getByText(
          "This instance was restored from a backup. Backups are paused until you confirm the target.",
        )
        .first(),
    ).toBeVisible();
  } finally {
    api.kill();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const cleanup = new pg.Client({ connectionString: DATABASE_BASE_URL });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${database} with (force)`);
    await cleanup.end();
    await test.info().attach("restore-server.log", { body: log.join(""), contentType: "text/plain" });
  }
});
