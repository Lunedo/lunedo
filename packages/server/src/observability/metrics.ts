import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import { secretsEqual } from "../crypto/constant-time.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobFinishedEvent, JobQueue } from "../jobs/job-queue.js";

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const JOB_DURATION_BUCKETS = [0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600];

/** Prometheus metrics of one process. */
export class Metrics {
  readonly registry = new Registry();
  readonly #httpRequests: Counter<"method" | "route" | "status">;
  readonly #httpDuration: Histogram<"method" | "route" | "status">;
  readonly #jobDuration: Histogram<"queue" | "state">;

  constructor(service: string) {
    this.registry.setDefaultLabels({ service });
    collectDefaultMetrics({ register: this.registry });
    this.#httpRequests = new Counter({
      name: "pagehall_http_requests_total",
      help: "HTTP requests by method, route template and status code.",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });
    this.#httpDuration = new Histogram({
      name: "pagehall_http_request_duration_seconds",
      help: "HTTP request latency by method, route template and status code.",
      labelNames: ["method", "route", "status"],
      buckets: DURATION_BUCKETS,
      registers: [this.registry],
    });
    this.#jobDuration = new Histogram({
      name: "pagehall_job_duration_seconds",
      help: "Duration of job attempts in this process by queue and outcome.",
      labelNames: ["queue", "state"],
      buckets: JOB_DURATION_BUCKETS,
      registers: [this.registry],
    });
  }

  /** `route` must be the route template, never the raw path, to keep label values bounded. */
  observeHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) };
    this.#httpRequests.inc(labels);
    this.#httpDuration.observe(labels, durationSeconds);
  }

  readonly observeJob = (event: JobFinishedEvent): void => {
    this.#jobDuration.observe({ queue: event.name, state: event.state }, event.durationSeconds);
  };

  observeDatabasePool(pool: DatabasePool): void {
    new Gauge({
      name: "pagehall_db_pool_connections",
      help: "Connections of this process's database pool by state.",
      labelNames: ["state"],
      registers: [this.registry],
      collect() {
        this.set({ state: "total" }, pool.totalCount);
        this.set({ state: "idle" }, pool.idleCount);
        this.set({ state: "waiting" }, pool.waitingCount);
      },
    });
  }

  observeJobQueue(queue: JobQueue): void {
    new Gauge({
      name: "pagehall_jobs",
      help: "Jobs per queue and state.",
      labelNames: ["queue", "state"],
      registers: [this.registry],
      async collect() {
        this.reset();
        for (const [name, counts] of Object.entries(await queue.counts())) {
          for (const [state, count] of Object.entries(counts)) this.set({ queue: name, state }, count);
        }
      },
    });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}

/** Checks an `Authorization: Bearer <token>` header in constant time. */
export function isAuthorizedMetricsRequest(authorization: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  return secretsEqual(match?.[1] ?? "", token) && match !== null;
}
