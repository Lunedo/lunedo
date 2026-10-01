import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { createDatabasePool } from "../database/pool.js";
import { defineJob } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { createServerRuntime, type ServerRuntime } from "./runtime.js";
import { registerShutdown } from "./shutdown.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

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

describe.skipIf(!databaseUrl)("shutting down the worker runtime", () => {
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
