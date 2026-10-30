export const MIN_POOL_SIZE = 6;
export const MAX_POOL_SIZE = 24;
export const JOB_QUEUE_CONNECTIONS = 4;
export const LISTENER_CONNECTIONS = 1;
export const PROCESS_ROLES = 3;

export function defaultPoolSize(cpus: number): number {
  return Math.min(Math.max(2 * Math.max(Math.floor(cpus), 1) + 2, MIN_POOL_SIZE), MAX_POOL_SIZE);
}

export function connectionsPerProcess(poolSize: number): number {
  return poolSize + JOB_QUEUE_CONNECTIONS + LISTENER_CONNECTIONS;
}

export function connectionsOfAllRoles(poolSize: number): number {
  return PROCESS_ROLES * connectionsPerProcess(poolSize);
}
