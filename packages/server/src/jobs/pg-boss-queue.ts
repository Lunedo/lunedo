import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Clock, type Job, PgBoss } from "pg-boss";
import type { Database } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import { currentRequestContext, runWithRequestContext } from "../observability/request-context.js";
import type {
  EnqueueOptions,
  JobContext,
  JobDefinition,
  JobFinishedEvent,
  JobHandler,
  JobInfo,
  JobQueue,
  JobState,
  QueueCounts,
  ScheduleOptions,
} from "./job-queue.js";
import { jobProgress } from "./schema.js";

const SCHEMA = "pgboss";

interface StoredData {
  payload: unknown;
  requestId?: string;
  clientIp?: string;
  userAgent?: string;
}

type JobRow = {
  id: string;
  name: string;
  state: JobState;
  retry_count: number;
  retry_limit: number;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  output: { message?: unknown } | null;
};

/**
 * Every queue uses the `exclusive` policy of pg-boss: a unique index allows one job per queue
 * and singleton key while it is created, retrying or active. Completed, failed and cancelled
 * jobs free the key. Jobs without an idempotency key get a random key, so they never block
 * each other.
 */
const QUEUE_POLICY = "exclusive";
const IDEMPOTENCY_PREFIX = "key:";
const UNIQUE_PREFIX = "job:";
/** Each schedule has its own key: schedules never block each other, an occurrence only skips while the previous one of the same schedule is still pending. */
const SCHEDULE_PREFIX = "schedule:";
const DEFAULT_SCHEDULE_KEY = "default";
const ENQUEUE_ATTEMPTS = 5;

export interface PgBossQueueOptions {
  connectionString: string;
  database: Database;
  logger: Logger;
  /** Only the worker role runs maintenance, schedules and handlers. */
  role: "producer" | "worker";
  pollingIntervalSeconds?: number;
  onJobFinished?: (event: JobFinishedEvent) => void;
  /** Replaces the system clock, for tests of schedules. */
  clock?: Clock;
}

export class PgBossQueue implements JobQueue {
  readonly #boss: PgBoss;
  readonly #options: PgBossQueueOptions;
  readonly #registered = new Set<string>();
  #started: Promise<unknown> | undefined;

  constructor(options: PgBossQueueOptions) {
    this.#options = options;
    const worker = options.role === "worker";
    this.#boss = new PgBoss({
      connectionString: options.connectionString,
      schema: SCHEMA,
      application_name: `pagehall-jobs-${options.role}`,
      max: 4,
      supervise: worker,
      schedule: worker,
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.#boss.on("error", (error) => options.logger.error({ err: error }, "Job queue error"));
  }

  async start(): Promise<void> {
    this.#started ??= this.#boss.start();
    await this.#started;
  }

  async register<TPayload>(definition: JobDefinition<TPayload>): Promise<void> {
    await this.start();
    if (this.#registered.has(definition.name)) return;
    const queue = {
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelaySeconds,
      retryBackoff: definition.retryBackoff,
      expireInSeconds: definition.expireInSeconds,
    };
    const existing = await this.#boss.getQueue(definition.name);
    if (existing) {
      if (existing.policy !== QUEUE_POLICY) {
        throw new Error(
          `Queue ${definition.name} uses the ${existing.policy} policy instead of ${QUEUE_POLICY}; recreate it`,
        );
      }
      await this.#boss.updateQueue(definition.name, queue);
    } else {
      await this.#boss
        .createQueue(definition.name, { ...queue, policy: QUEUE_POLICY })
        .catch(async (error: unknown) => {
          if (!(await this.#boss.getQueue(definition.name))) throw error;
        });
    }
    this.#registered.add(definition.name);
  }

  async enqueue<TPayload>(
    definition: JobDefinition<TPayload>,
    payload: TPayload,
    options: EnqueueOptions = {},
  ): Promise<string> {
    await this.register(definition);
    const data: StoredData = { payload: definition.payload.parse(payload) };
    const request = currentRequestContext();
    if (request?.requestId) data.requestId = request.requestId;
    if (request?.clientIp) data.clientIp = request.clientIp;
    if (request?.userAgent) data.userAgent = request.userAgent;
    const singletonKey = options.idempotencyKey
      ? `${IDEMPOTENCY_PREFIX}${options.idempotencyKey}`
      : `${UNIQUE_PREFIX}${randomUUID()}`;
    // A rejected send means a job with this key is pending; it may finish before the lookup.
    for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt++) {
      const created = await this.#boss.send(definition.name, data, {
        singletonKey,
        ...(options.startAfter ? { startAfter: options.startAfter } : {}),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
      });
      if (created) return created;
      const pending = await this.#options.database.execute<{ id: string }>(
        sql`select id from ${sql.identifier(SCHEMA)}.job
            where name = ${definition.name} and singleton_key = ${singletonKey}
              and state in ('created', 'retry', 'active')`,
      );
      const id = pending.rows[0]?.id;
      if (id) return id;
    }
    throw new Error(`Job ${definition.name} was not enqueued`);
  }

  async schedule<TPayload>(
    definition: JobDefinition<TPayload>,
    cron: string,
    payload: TPayload,
    options: ScheduleOptions = {},
  ): Promise<void> {
    await this.register(definition);
    const data: StoredData = { payload: definition.payload.parse(payload) };
    const key = options.key ?? DEFAULT_SCHEDULE_KEY;
    await this.#boss.schedule(definition.name, cron, data, {
      key,
      singletonKey: `${SCHEDULE_PREFIX}${key}`,
      ...(options.timeZone ? { tz: options.timeZone } : {}),
    });
  }

  async unschedule<TPayload>(definition: JobDefinition<TPayload>, key?: string): Promise<void> {
    await this.start();
    await this.#boss.unschedule(definition.name, key ?? DEFAULT_SCHEDULE_KEY);
  }

  async work<TPayload>(
    definition: JobDefinition<TPayload>,
    handler: JobHandler<TPayload>,
    options: { concurrency?: number } = {},
  ): Promise<void> {
    if (this.#options.role !== "worker") throw new Error("Only the worker role runs jobs");
    await this.register(definition);
    await this.#boss.work<StoredData>(
      definition.name,
      {
        batchSize: 1,
        localConcurrency: options.concurrency ?? 1,
        pollingIntervalSeconds: this.#options.pollingIntervalSeconds ?? 2,
      },
      async ([job]) => {
        if (job) await this.#run(definition, handler, job);
      },
    );
  }

  async #run<TPayload>(
    definition: JobDefinition<TPayload>,
    handler: JobHandler<TPayload>,
    job: Job<StoredData>,
  ) {
    const requestId = job.data.requestId ?? job.id;
    const started = performance.now();
    const logger = this.#options.logger.child({ job: definition.name, jobId: job.id });
    const { clientIp, userAgent } = job.data;
    await runWithRequestContext(
      { requestId, ...(clientIp ? { clientIp } : {}), ...(userAgent ? { userAgent } : {}) },
      async () => {
        const controller = new AbortController();
        const abort = () => controller.abort(job.signal.reason);
        job.signal.addEventListener("abort", abort, { once: true });
        try {
          const payload = definition.payload.parse(job.data.payload);
          const context: JobContext<TPayload> = {
            id: job.id,
            name: definition.name,
            payload,
            retryCount: job.retryCount,
            signal: controller.signal,
            logger,
            reportProgress: async (done, total, message) => {
              await this.#saveProgress(definition.name, job.id, done, total, message);
              if ((await this.#state(job.id)) === "cancelled") controller.abort(new Error("Job cancelled"));
            },
          };
          await handler(context);
          this.#finished(definition.name, "completed", started);
        } catch (error) {
          logger.warn({ err: error, retryCount: job.retryCount }, "Job attempt failed");
          this.#finished(definition.name, "failed", started);
          throw error;
        } finally {
          job.signal.removeEventListener("abort", abort);
        }
      },
    );
  }

  #finished(name: string, state: "completed" | "failed", started: number) {
    this.#options.onJobFinished?.({ name, state, durationSeconds: (performance.now() - started) / 1000 });
  }

  async #saveProgress(queue: string, jobId: string, done: number, total?: number, message?: string) {
    const values = { done, total: total ?? null, message: message ?? null };
    await this.#options.database
      .insert(jobProgress)
      .values({ jobId, queue, ...values })
      .onConflictDoUpdate({ target: jobProgress.jobId, set: { ...values, updatedAt: new Date() } });
  }

  async #state(id: string): Promise<JobState | undefined> {
    const result = await this.#options.database.execute<{ state: JobState }>(
      sql`select state from ${sql.identifier(SCHEMA)}.job where id = ${id}`,
    );
    return result.rows[0]?.state;
  }

  async #toInfo(row: JobRow): Promise<JobInfo> {
    const [progress] = await this.#options.database
      .select({ done: jobProgress.done, total: jobProgress.total, message: jobProgress.message })
      .from(jobProgress)
      .where(sql`${jobProgress.jobId} = ${row.id}`);
    const message = row.state === "failed" || row.state === "retry" ? row.output?.message : undefined;
    return {
      id: row.id,
      name: row.name,
      state: row.state,
      retryCount: row.retry_count,
      retryLimit: row.retry_limit,
      createdAt: new Date(row.created_on),
      startedAt: row.started_on ? new Date(row.started_on) : null,
      completedAt: row.completed_on ? new Date(row.completed_on) : null,
      progress: progress ?? null,
      error: typeof message === "string" ? message : null,
    };
  }

  async get<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<JobInfo | null> {
    const result = await this.#options.database.execute<JobRow>(
      sql`select id, name, state, retry_count, retry_limit, created_on, started_on, completed_on, output
          from ${sql.identifier(SCHEMA)}.job where name = ${definition.name} and id = ${id}`,
    );
    const row = result.rows[0];
    return row ? this.#toInfo(row) : null;
  }

  async listFailed<TPayload>(
    definition: JobDefinition<TPayload>,
    options: { limit?: number } = {},
  ): Promise<JobInfo[]> {
    const result = await this.#options.database.execute<JobRow>(
      sql`select id, name, state, retry_count, retry_limit, created_on, started_on, completed_on, output
          from ${sql.identifier(SCHEMA)}.job where name = ${definition.name} and state = 'failed'
          order by completed_on desc limit ${options.limit ?? 50}`,
    );
    return Promise.all(result.rows.map((row) => this.#toInfo(row)));
  }

  async cancel<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<void> {
    await this.start();
    await this.#boss.cancel(definition.name, id);
  }

  async retry<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<void> {
    await this.start();
    await this.#boss.retry(definition.name, id);
  }

  async counts(): Promise<Record<string, QueueCounts>> {
    await this.start();
    const queues = await this.#boss.getQueues();
    return Object.fromEntries(
      queues
        .filter((queue) => !queue.name.startsWith("__pgboss__"))
        .map((queue) => [
          queue.name,
          {
            queued: queue.queuedCount,
            active: queue.activeCount,
            deferred: queue.deferredCount,
            failed: queue.failedCount,
          },
        ]),
    );
  }

  async stop(options: { timeoutSeconds: number }): Promise<void> {
    if (!this.#started) return;
    await this.#boss.stop({ graceful: true, timeout: options.timeoutSeconds * 1000 });
  }
}
