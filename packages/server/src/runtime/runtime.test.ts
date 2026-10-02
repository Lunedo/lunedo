import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { IncompleteRestoreError, writeRestoreMarker } from "../backup/restore-marker.js";
import type { EncryptedColumn } from "../crypto/encrypted-column.js";
import { Encryption } from "../crypto/envelope.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { MasterKeyError } from "../crypto/key-usage.js";
import { createDatabasePool } from "../database/pool.js";
import { defineJob } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../testing/database.js";
import { createServerRuntime, type ServerRuntime, startupWarnings } from "./runtime.js";
import { registerShutdown } from "./shutdown.js";
import { StartupError } from "./startup-error.js";

const testDatabaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

/** Runtimes here work every queue, so they get a database of their own instead of the shared one. */
let database: TemporaryDatabase | undefined;
let databaseUrl = "";

beforeAll(async () => {
  if (!testDatabaseUrl) return;
  database = await createTemporaryDatabase(testDatabaseUrl, "pagehall_runtime");
  databaseUrl = database.url;
});

afterAll(async () => {
  await database?.drop();
});
function fakeProcess() {
  const signals = new EventEmitter();
  const exits: number[] = [];
  let exited: (code: number) => void = () => {};
  const exitedPromise = new Promise<number>((resolve) => {
    exited = resolve;
  });
  return {
    signals: signals as unknown as Pick<NodeJS.Process, "once">,
    send: (signal: NodeJS.Signals) => signals.emit(signal, signal),
    exit: (code: number) => {
      exits.push(code);
      exited(code);
    },
    exits,
    exited: exitedPromise,
  };
}

describe("startupWarnings", () => {
  it("warns at the start when identity providers may be insecure", () => {
    expect(startupWarnings({ insecureIdentityProviders: true })).toEqual([
      expect.stringContaining("PAGEHALL_INSECURE_IDENTITY_PROVIDERS"),
    ]);
    expect(startupWarnings({ insecureIdentityProviders: false })).toEqual([]);
  });
});

describe("registerShutdown", () => {
  it("ends the process forcibly only after the timeout plus the margin", async () => {
    vi.useFakeTimers();
    try {
      const process = fakeProcess();
      registerShutdown(logger, () => new Promise(() => {}), {
        timeoutSeconds: 30,
        signals: process.signals,
        exit: process.exit,
      });
      process.send("SIGTERM");
      await vi.advanceTimersByTimeAsync(39_000);
      expect(process.exits).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(process.exits).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes once even when several signals arrive", async () => {
    const process = fakeProcess();
    const close = vi.fn(async () => {});
    registerShutdown(logger, close, { timeoutSeconds: 1, signals: process.signals, exit: process.exit });
    process.send("SIGTERM");
    process.send("SIGINT");
    expect(await process.exited).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("starting after an incomplete restore", () => {
  it("refuses to start and names the next step", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pagehall-runtime-"));
    try {
      const filesDir = path.join(dir, "files");
      await mkdir(filesDir);
      await writeRestoreMarker(filesDir, "/var/lib/pagehall/backups/pagehall.phbak");
      const started = createServerRuntime({
        role: "api",
        env: {
          PAGEHALL_DATABASE_URL: "postgres://pagehall:pagehall@127.0.0.1:1/unreachable",
          PAGEHALL_SECRETS_DIR: path.join(dir, "secrets"),
          PAGEHALL_FILES_DIR: filesDir,
          PAGEHALL_LOG_LEVEL: "silent",
        },
      });
      const error = await started.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(IncompleteRestoreError);
      expect(error).toBeInstanceOf(StartupError);
      expect((error as Error).message).toContain(
        "Run the restore again with: pagehall backup restore --input /var/lib/pagehall/backups/pagehall.phbak --force.",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!testDatabaseUrl)("shutting down the worker runtime", () => {
  let dir: string | undefined;
  let runtime: ServerRuntime | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
    runtime = undefined;
  });

  async function startWorker(): Promise<ServerRuntime> {
    dir = await mkdtemp(path.join(tmpdir(), "pagehall-runtime-"));
    runtime = await createServerRuntime({
      role: "worker",
      env: {
        PAGEHALL_DATABASE_URL: databaseUrl,
        PAGEHALL_SECRETS_DIR: path.join(dir, "secrets"),
        PAGEHALL_FILES_DIR: path.join(dir, "files"),
        PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS: "1",
        PAGEHALL_LOG_LEVEL: "silent",
      },
    });
    return runtime;
  }

  /** Reads the job state on a connection of its own, since the runtime's pool is closed by then. */
  async function jobState(id: string): Promise<string | undefined> {
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    try {
      const result = await pool.query<{ state: string }>("select state from pgboss.job where id = $1", [id]);
      return result.rows[0]?.state;
    } finally {
      await pool.end();
    }
  }

  it("schedules the cleanup of job progress", async () => {
    const worker = await startWorker();
    try {
      const schedules = await worker.database.execute<{ key: string }>(
        sql`select key from pgboss.schedule where name = 'jobs.cleanup-progress'`,
      );
      expect(schedules.rows.map((row) => row.key)).toEqual(["hourly"]);
    } finally {
      await worker.close();
    }
  });

  it("hands a job that is still running back to the queue and exits cleanly", async () => {
    const worker = await startWorker();
    const job = defineJob({
      name: `test.shutdown-${randomBytes(4).toString("hex")}`,
      payload: z.object({}),
      retryLimit: 2,
    });
    let started = false;
    let aborted = false;
    await worker.jobs?.work(job, async ({ signal }) => {
      started = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          resolve();
        });
      });
    });
    const id = (await worker.jobs?.enqueue(job, {})) ?? "";
    const deadline = Date.now() + 15_000;
    while (!started && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started).toBe(true);

    const process = fakeProcess();
    registerShutdown(worker.logger, () => worker.close(), {
      timeoutSeconds: 1,
      signals: process.signals,
      exit: process.exit,
    });
    process.send("SIGTERM");
    expect(await process.exited).toBe(0);
    expect(process.exits).toEqual([0]);
    expect(aborted).toBe(true);
    expect(await jobState(id)).toBe("retry");
  });
});

describe.skipIf(!testDatabaseUrl)("starting with encrypted data", () => {
  const table = `test_secrets_${randomBytes(4).toString("hex")}`;
  const column: EncryptedColumn = { table, idColumn: "id", column: "value" };
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    try {
      await pool.query(`drop table if exists "${table}"`);
    } finally {
      await pool.end();
    }
  });

  /** Stores one value encrypted with master key version 2. */
  async function storeEncryptedValue() {
    const ring = parseKeyRing(formatKeyEntry(2, randomBytes(32)));
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    try {
      await pool.query(`create table "${table}" (id uuid primary key, value bytea)`);
      const id = uuidv7();
      await pool.query(`insert into "${table}" values ($1, $2)`, [
        id,
        new Encryption(() => ring).encrypt("secret", id),
      ]);
    } finally {
      await pool.end();
    }
  }

  async function start(masterKeys?: string) {
    dir = await mkdtemp(path.join(tmpdir(), "pagehall-runtime-"));
    const secretsDir = path.join(dir, "secrets");
    if (masterKeys !== undefined) {
      await mkdir(secretsDir, { recursive: true });
      await writeFile(path.join(secretsDir, "master-keys"), masterKeys, { mode: 0o600 });
    }
    const runtime = createServerRuntime({
      role: "api",
      env: {
        PAGEHALL_DATABASE_URL: databaseUrl,
        PAGEHALL_SECRETS_DIR: secretsDir,
        PAGEHALL_FILES_DIR: path.join(dir, "files"),
        PAGEHALL_LOG_LEVEL: "silent",
      },
      encrypted: { columns: [column], streamOwners: [] },
    });
    return { runtime, keyFile: path.join(secretsDir, "master-keys") };
  }

  it("never creates a new master key", async () => {
    await storeEncryptedValue();
    const { runtime, keyFile } = await start();
    const error = await runtime.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MasterKeyError);
    expect(error).toBeInstanceOf(StartupError);
    expect((error as Error).message).toMatch(
      /^The database contains data encrypted with master key version 2, but no master key ring is available: .*Restore the master key ring/,
    );
    expect(existsSync(keyFile)).toBe(false);
  });

  it("refuses to start without every key version in use", async () => {
    await storeEncryptedValue();
    const { runtime } = await start(formatKeyEntry(1, randomBytes(32)));
    await expect(runtime).rejects.toThrow(
      "Stored data uses master key version 2, which the master key ring does not contain.",
    );
  });

  it("creates the first master key while nothing is encrypted", async () => {
    const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    try {
      await pool.query(`create table "${table}" (id uuid primary key, value bytea)`);
    } finally {
      await pool.end();
    }
    const { runtime, keyFile } = await start();
    await (await runtime).close();
    expect(existsSync(keyFile)).toBe(true);
  });
});
