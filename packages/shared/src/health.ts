export type HealthStatus = "ok" | "error";

export interface HealthCheckResult {
  status: HealthStatus;
  durationMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  checks: Record<string, HealthCheckResult>;
}

export type HealthCheck = () => Promise<void>;

const DEFAULT_TIMEOUT_MS = 3000;

async function withTimeout(check: HealthCheck, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health check timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs all checks in parallel. The report contains no error details because
 * health endpoints are unauthenticated; callers log failures themselves.
 */
export async function runHealthChecks(
  checks: Record<string, HealthCheck>,
  options: { timeoutMs?: number; onFailure?: (name: string, error: unknown) => void } = {},
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, HealthCheckResult]> => {
      const started = performance.now();
      try {
        await withTimeout(check, timeoutMs);
        return [name, { status: "ok", durationMs: Math.round(performance.now() - started) }];
      } catch (error) {
        options.onFailure?.(name, error);
        return [name, { status: "error", durationMs: Math.round(performance.now() - started) }];
      }
    }),
  );
  const results = Object.fromEntries(entries);
  const status = entries.every(([, result]) => result.status === "ok") ? "ok" : "error";
  return { status, checks: results };
}
