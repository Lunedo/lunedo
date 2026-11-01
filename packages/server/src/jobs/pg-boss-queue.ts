import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Clock, type Job, type JobResult, PgBoss, type QueueResult } from "pg-boss";
import type { Database } from "../database/database.js";
import { JOB_PRODUCER_CONNECTIONS, JOB_QUEUE_CONNECTIONS } from "../database/pool-size.js";
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
  WorkOptions,
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
const COALESCE_BATCH = 100;

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
  readonly #workers = new Map<string, { waits: boolean; start: () => Promise<void> }>();
  #maintenance = false;
  #maintenanceChange: Promise<void> = Promise.resolve();
  #started: Promise<unknown> | undefined;

  constructor(options: PgBossQueueOptions) {
    this.#options = options;
    const worker = options.role === "worker";
    this.#boss = new PgBoss({
      connectionString: options.connectionString,
      schema: SCHEMA,
      application_name: `lunedo-jobs-${options.role}`,
      max: worker ? JOB_QUEUE_CONNECTIONS : JOB_PRODUCER_CONNECTIONS,
      supervise: worker,
      schedule: worker,
      useListenNotify: worker,
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
      notify: true,
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
    options: WorkOptions = {},
  ): Promise<void> {
    if (this.#options.role !== "worker") throw new Error("Only the worker role runs jobs");
    await this.register(definition);
    const start = () => this.#startWorking(definition, handler, options);
    this.#workers.set(definition.name, { waits: definition.duringMaintenance === "wait", start });
    if (this.#maintenance && definition.duringMaintenance === "wait") return;
    await start();
  }

  async #startWorking<TPayload>(
    definition: JobDefinition<TPayload>,
    handler: JobHandler<TPayload>,
    options: WorkOptions,
  ): Promise<void> {
    const concurrency = options.concurrency ?? 1;
    const pollingIntervalSeconds = this.#options.pollingIntervalSeconds ?? 2;
    if (options.coalesce) {
      await this.#boss.work<StoredData>(
        definition.name,
        {
          batchSize: COALESCE_BATCH,
          localConcurrency: 1,
          pollingIntervalSeconds,
          notifyPollingIntervalSeconds: pollingIntervalSeconds,
          burstWhenBatchFull: true,
        },
        async ([job]) => {
          if (job) await this.#run(definition, handler, job);
        },
      );
      return;
    }
    if (!options.batch || concurrency === 1) {
      await this.#boss.work<StoredData>(
        definition.name,
        {
          batchSize: 1,
          localConcurrency: concurrency,
          pollingIntervalSeconds,
          notifyPollingIntervalSeconds: pollingIntervalSeconds,
        },
        async ([job]) => {
          if (job) await this.#run(definition, handler, job);
        },
      );
      return;
    }
    await this.#boss.work<StoredData>(
      definition.name,
      {
        batchSize: concurrency,
        localConcurrency: 1,
        pollingIntervalSeconds,
        notifyPollingIntervalSeconds: pollingIntervalSeconds,
        burstWhenBatchFull: true,
        perJobResults: true,
      },
      (jobs) =>
        Promise.all(
          jobs.map((job) =>
            this.#run(definition, handler, job).then(
              (): JobResult => ({ id: job.id, status: "completed" }),
              (error: unknown): JobResult => ({
                id: job.id,
                status: "failed",
                output: { message: error instanceof Error ? error.message : String(error) },
              }),
            ),
          ),
        ),
    );
  }

  async pauseForMaintenance(paused: boolean): Promise<void> {
    const change = this.#maintenanceChange.then(async () => {
      if (this.#maintenance === paused) return;
      this.#maintenance = paused;
      for (const [name, worker] of this.#workers) {
        if (!worker.waits) continue;
        if (paused) await this.#boss.offWork(name, { wait: false });
        else await worker.start();
      }
    });
    this.#maintenanceChange = change.catch(() => {});
    await change;
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
    const oldest = await this.#boss
      .getDb()
      .executeSql(
        `select name, min(created_on) as oldest from ${SCHEMA}.job where state in ('created', 'retry') and start_after <= now() group by name`,
      );
    const oldestByQueue = new Map(
      (oldest.rows as { name: string; oldest: Date | string }[]).map((row) => [
        row.name,
        new Date(row.oldest),
      ]),
    );
    return Object.fromEntries(
      queues
        .filter((queue) => !queue.name.startsWith("__pgboss__"))
        .map((queue) => [
          queue.name,
          { ...queueCounts(queue), oldestQueuedAt: oldestByQueue.get(queue.name) ?? null },
        ]),
    );
  }

  async stop(options: { timeoutSeconds: number }): Promise<void> {
    if (!this.#started) return;
    await this.#boss.stop({ graceful: true, timeout: options.timeoutSeconds * 1000 });
  }
}

export function queueCounts(
  queue: Pick<QueueResult, "readyCount" | "blockedCount" | "activeCount" | "deferredCount" | "failedCount">,
): QueueCounts {
  return {
    queued: queue.readyCount + queue.blockedCount,
    active: queue.activeCount,
    deferred: queue.deferredCount,
    failed: queue.failedCount,
  };
}
