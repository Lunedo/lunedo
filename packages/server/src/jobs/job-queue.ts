import type { z } from "zod";
import type { Logger } from "../logging/logger.js";

export interface JobDefinition<TPayload> {
  /** Queue name, `<module>.<action>`, e.g. `encryption.rotate-data-keys`. */
  name: string;
  payload: z.ZodType<TPayload>;
  retryLimit: number;
  retryDelaySeconds: number;
  /** Doubles the delay after each failed attempt. */
  retryBackoff: boolean;
  /** An attempt that runs longer is failed and retried. */
  expireInSeconds: number;
  duringMaintenance: MaintenanceBehavior;
}

export type MaintenanceBehavior = "run" | "wait";

export function defineJob<TPayload>(
  definition: Pick<JobDefinition<TPayload>, "name" | "payload" | "duringMaintenance"> &
    Partial<JobDefinition<TPayload>>,
): JobDefinition<TPayload> {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(definition.name)) {
    throw new Error(`Job name ${definition.name} must look like <module>.<action>`);
  }
  return {
    retryLimit: 3,
    retryDelaySeconds: 10,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    ...definition,
  };
}

export interface EnqueueOptions {
  /** Enqueueing again with the same key returns the existing job instead of a new one. */
  idempotencyKey?: string;
  startAfter?: Date;
  priority?: number;
}

/**
 * Schedules of the same job run independently. An occurrence is skipped while the previous
 * occurrence of the same schedule is still waiting, retrying or running, so a slow job never
 * runs twice in parallel.
 */
export interface ScheduleOptions {
  /** Distinguishes several schedules of the same job. */
  key?: string;
  timeZone?: string;
}

export interface JobProgress {
  done: number;
  total: number | null;
  message: string | null;
}

export interface JobContext<TPayload> {
  id: string;
  name: string;
  payload: TPayload;
  /** 0 for the first attempt. */
  retryCount: number;
  /** Aborted when the job is cancelled or the worker shuts down. */
  signal: AbortSignal;
  logger: Logger;
  reportProgress(done: number, total?: number, message?: string): Promise<void>;
}

export type JobHandler<TPayload> = (job: JobContext<TPayload>) => Promise<void>;

export type JobState = "created" | "retry" | "active" | "completed" | "cancelled" | "failed";

export interface JobInfo {
  id: string;
  name: string;
  state: JobState;
  retryCount: number;
  retryLimit: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  progress: JobProgress | null;
  /** Error message of a failed attempt. */
  error: string | null;
}

export interface QueueCounts {
  queued: number;
  active: number;
  deferred: number;
  failed: number;
}

export interface JobFinishedEvent {
  name: string;
  state: "completed" | "failed";
  durationSeconds: number;
}

/**
 * Background jobs. Modules depend on this interface only; the implementation
 * is chosen at startup.
 */
export interface JobQueue {
  /** Creates the queue for a job; required before enqueueing or working on it. */
  register<TPayload>(definition: JobDefinition<TPayload>): Promise<void>;
  enqueue<TPayload>(
    definition: JobDefinition<TPayload>,
    payload: TPayload,
    options?: EnqueueOptions,
  ): Promise<string>;
  schedule<TPayload>(
    definition: JobDefinition<TPayload>,
    cron: string,
    payload: TPayload,
    options?: ScheduleOptions,
  ): Promise<void>;
  unschedule<TPayload>(definition: JobDefinition<TPayload>, key?: string): Promise<void>;
  /** Runs `handler` for jobs of this definition in this process. Only the worker role calls this. */
  work<TPayload>(
    definition: JobDefinition<TPayload>,
    handler: JobHandler<TPayload>,
    options?: { concurrency?: number },
  ): Promise<void>;
  get<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<JobInfo | null>;
  listFailed<TPayload>(definition: JobDefinition<TPayload>, options?: { limit?: number }): Promise<JobInfo[]>;
  cancel<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<void>;
  /** Queues a failed job again. */
  retry<TPayload>(definition: JobDefinition<TPayload>, id: string): Promise<void>;
  counts(): Promise<Record<string, QueueCounts>>;
  pauseForMaintenance(paused: boolean): Promise<void>;
  /** Stops fetching jobs, lets running jobs finish until the timeout and hands the rest back to the queue. */
  stop(options: { timeoutSeconds: number }): Promise<void>;
}
