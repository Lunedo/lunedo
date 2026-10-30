export const MIN_POOL_SIZE = 6;
export const MAX_POOL_SIZE = 24;
export const MIN_API_POOL_SIZE = 8;
export const MAX_API_PROCESSES = 8;
export const MAX_SEARCH_SLOTS = 4;
export const JOB_QUEUE_CONNECTIONS = 4;
export const JOB_PRODUCER_CONNECTIONS = 1;
export const LISTENER_CONNECTIONS = 1;

export function defaultPoolSize(cpus: number): number {
  return Math.min(Math.max(2 * Math.max(Math.floor(cpus), 1) + 2, MIN_POOL_SIZE), MAX_POOL_SIZE);
}

export function defaultApiProcesses(cpus: number): number {
  return Math.min(Math.max(Math.floor(cpus), 1), MAX_API_PROCESSES);
}

export function defaultSearchSlots(cpus: number): number {
  return Math.min(Math.max(1, Math.floor(cpus / 4)), MAX_SEARCH_SLOTS);
}

export function apiPoolSize(poolSize: number, processes: number): number {
  return processes <= 1 ? poolSize : Math.max(MIN_API_POOL_SIZE, Math.ceil(poolSize / processes));
}

export interface ProcessPools {
  poolSize: number;
  apiPoolSize: number;
  apiProcesses: number;
  searchSlots: number;
}

export function connectionsOfAllRoles(pools: ProcessPools): number {
  const api =
    pools.apiProcesses *
    (pools.apiPoolSize + pools.searchSlots + JOB_PRODUCER_CONNECTIONS + LISTENER_CONNECTIONS);
  const worker = pools.poolSize + JOB_QUEUE_CONNECTIONS + LISTENER_CONNECTIONS;
  const collab = pools.poolSize + LISTENER_CONNECTIONS;
  return api + worker + collab;
}
