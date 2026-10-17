import { availableParallelism } from "node:os";

export interface Host {
  cores: number;
  platform: NodeJS.Platform;
}

export interface TurboPlan {
  concurrency: number;
  workers: number;
}

const DEFAULT_END_TO_END_WORKERS = 3;
const WORKERS_PER_TASK = 4;

function currentHost(): Host {
  return { cores: availableParallelism(), platform: process.platform };
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parallelismLimit(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return positiveInteger(env.CI_PARALLELISM);
}

export function localBudget(env: NodeJS.ProcessEnv = process.env, host: Host = currentHost()): number {
  const override = positiveInteger(env.PAGEHALL_PARALLELISM);
  if (override !== undefined) return override;
  return Math.max(1, host.platform === "win32" ? Math.floor(host.cores / 2) : host.cores);
}

export function turboPlan(
  env: NodeJS.ProcessEnv = process.env,
  host: Host = currentHost(),
): TurboPlan | undefined {
  if (env.CI) return undefined;
  const budget = localBudget(env, host);
  const concurrency = Math.max(1, Math.floor(budget / WORKERS_PER_TASK));
  return { concurrency, workers: Math.max(1, Math.floor(budget / concurrency)) };
}

export function vitestWorkers(
  env: NodeJS.ProcessEnv = process.env,
  host: Host = currentHost(),
): number | undefined {
  const limit = parallelismLimit(env);
  if (limit !== undefined) return limit;
  if (env.CI) return undefined;
  return positiveInteger(env.PAGEHALL_TEST_WORKERS) ?? localBudget(env, host);
}

export function endToEndWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const workers = positiveInteger(env.PAGEHALL_E2E_WORKERS);
  if (workers !== undefined) return workers;
  if (env.CI) return parallelismLimit(env) ?? DEFAULT_END_TO_END_WORKERS;
  return DEFAULT_END_TO_END_WORKERS;
}
