import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import { secretsEqual } from "../crypto/constant-time.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobFinishedEvent, JobQueue } from "../jobs/job-queue.js";
import type { LoggedError } from "../logging/logger.js";
import type { InstanceMetricsSource } from "../operations/instance-metrics.js";

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const JOB_DURATION_BUCKETS = [0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600];

/** Prometheus metrics of one process. */
export class Metrics {
  readonly registry = new Registry();
  readonly #httpRequests: Counter<"method" | "route" | "status">;
  readonly #httpDuration: Histogram<"method" | "route" | "status">;
  readonly #jobDuration: Histogram<"queue" | "state">;
  readonly #loggedErrors: Counter<"type">;

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
    this.#loggedErrors = new Counter({
      name: "pagehall_log_errors_total",
      help: "Error-level log events of this process by type, without content or personal data.",
      labelNames: ["type"],
      registers: [this.registry],
    });
  }

  observeBuild(version: string): void {
    new Gauge({
      name: "pagehall_build_info",
      help: "Always 1; the version label is the running Pagehall version.",
      labelNames: ["version"],
      registers: [this.registry],
    }).set({ version }, 1);
  }

  readonly countLoggedError = (error: LoggedError): void => {
    this.#loggedErrors.inc({ type: error.type });
  };

  observeCollaboration(source: () => { connections: number; documents: number }): void {
    new Gauge({
      name: "pagehall_collab_connections",
      help: "Open editor connections of this collaboration server.",
      registers: [this.registry],
      collect() {
        this.set(source().connections);
      },
    });
    new Gauge({
      name: "pagehall_collab_documents",
      help: "Documents this collaboration server holds open.",
      registers: [this.registry],
      collect() {
        this.set(source().documents);
      },
    });
  }

  observeInstance(source: InstanceMetricsSource): void {
    const registers = [this.registry];
    const gauge = (
      name: string,
      help: string,
      read: (snapshot: Awaited<ReturnType<InstanceMetricsSource>>) => number | null,
    ) =>
      new Gauge({
        name,
        help,
        registers,
        async collect() {
          this.reset();
          const value = read(await source());
          if (value === null) this.remove();
          else this.set(value);
        },
      });
    const counter = (
      name: string,
      help: string,
      read: (snapshot: Awaited<ReturnType<InstanceMetricsSource>>) => number | null,
    ) =>
      new Counter({
        name,
        help,
        registers,
        async collect() {
          this.reset();
          const value = read(await source());
          if (value === null) this.remove();
          else this.inc(value);
        },
      });
    const seconds = (date: Date | null | undefined) => (date ? date.getTime() / 1000 : null);
    gauge("pagehall_database_size_bytes", "Size of the Pagehall database.", (s) => s.databaseSizeBytes);
    gauge(
      "pagehall_storage_used_bytes",
      "Bytes used in the file store.",
      (s) => s.storage?.usedBytes ?? null,
    );
    gauge(
      "pagehall_storage_size_bytes",
      "Size of the file store volume, or the configured limit for S3 storage.",
      (s) => s.storage?.totalBytes ?? null,
    );
    gauge(
      "pagehall_storage_usage_ratio",
      "Used share of the file store, from 0 to 1.",
      (s) => s.storage?.ratio ?? null,
    );
    gauge(
      "pagehall_storage_level",
      "Active storage warning level: 0 none, 1 warning, 2 large writes paused, 3 critical.",
      (s) => s.storageLevel,
    );
    gauge("pagehall_backup_last_success_timestamp_seconds", "Time of the last successful backup.", (s) =>
      seconds(s.backup?.lastSuccessAt),
    );
    counter("pagehall_backup_failures_total", "Backups that failed.", (s) => s.backup?.failuresTotal ?? null);
    gauge("pagehall_backup_scheduled", "1 when scheduled backups are on.", (s) =>
      s.backup ? Number(s.backup.scheduled && s.backup.targetConfigured) : null,
    );
    counter(
      "pagehall_mail_delivery_failures_total",
      "Failed attempts to deliver an e-mail.",
      (s) => s.mail.failedAttempts,
    );
    counter(
      "pagehall_mail_undelivered_total",
      "E-mails given up after the last attempt.",
      (s) => s.mail.failedMessages,
    );
    gauge("pagehall_mail_last_success_timestamp_seconds", "Time of the last delivered e-mail.", (s) =>
      seconds(s.mail.lastSuccessAt),
    );
    gauge("pagehall_mail_last_failure_timestamp_seconds", "Time of the last failed delivery attempt.", (s) =>
      seconds(s.mail.lastFailureAt),
    );
    gauge(
      "pagehall_search_pending_items",
      "Items waiting to be indexed for search.",
      (s) => s.search.pendingItems,
    );
    gauge(
      "pagehall_search_failing_items",
      "Items whose indexing failed at least once and is retried.",
      (s) => s.search.failingItems,
    );
    gauge("pagehall_maintenance_mode", "1 while the instance is in maintenance mode.", (s) =>
      Number(s.maintenance),
    );
    gauge("pagehall_collab_up", "1 when the collaboration server answers its readiness check.", (s) =>
      s.collaborationReady === null ? null : Number(s.collaborationReady),
    );
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
