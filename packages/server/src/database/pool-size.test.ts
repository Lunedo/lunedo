import { describe, expect, it } from "vitest";
import {
  apiPoolSize,
  connectionsOfAllRoles,
  defaultApiProcesses,
  defaultPoolSize,
  defaultSearchSlots,
  MAX_API_PROCESSES,
  MAX_POOL_SIZE,
  MIN_API_POOL_SIZE,
  MIN_POOL_SIZE,
} from "./pool-size.js";

const POSTGRES_DEFAULT_LIMIT = 100;
const COMPOSE_LIMIT = 200;
const RESERVED_FOR_ADMINISTRATORS = 3;
const ROOM_FOR_TOOLS = 5;

function defaults(cpus: number) {
  const poolSize = defaultPoolSize(cpus);
  const apiProcesses = defaultApiProcesses(cpus);
  return {
    poolSize,
    apiProcesses,
    apiPoolSize: apiPoolSize(poolSize, apiProcesses),
    searchSlots: defaultSearchSlots(cpus),
  };
}

describe("the default pool size", () => {
  it("grows with the CPUs of the container", () => {
    expect([1, 2, 4, 8, 16].map(defaultPoolSize)).toEqual([6, 6, 10, 18, 24]);
  });

  it("stays between the minimum and the maximum for any CPU count", () => {
    for (const cpus of [0, 1, 3, 12, 64, 1024]) {
      expect(defaultPoolSize(cpus)).toBeGreaterThanOrEqual(MIN_POOL_SIZE);
      expect(defaultPoolSize(cpus)).toBeLessThanOrEqual(MAX_POOL_SIZE);
    }
  });

  it("starts one API process per CPU, at most eight", () => {
    expect([0, 1, 2, 4, 8, 16].map(defaultApiProcesses)).toEqual([1, 1, 2, 4, 8, MAX_API_PROCESSES]);
  });

  it("splits the pool of the API among its processes and keeps a single process at the full pool", () => {
    expect(apiPoolSize(10, 1)).toBe(10);
    expect(apiPoolSize(10, 4)).toBe(MIN_API_POOL_SIZE);
    expect(apiPoolSize(24, 4)).toBe(6);
    expect(apiPoolSize(25, 2)).toBe(13);
  });

  it("runs one search at once per four CPUs, at least one and at most four", () => {
    expect([1, 4, 7, 8, 16, 64].map(defaultSearchSlots)).toEqual([1, 1, 1, 2, 4, 4]);
  });

  it("counts the pools, notification and job queue connections of every process", () => {
    expect(connectionsOfAllRoles({ poolSize: 10, apiPoolSize: 4, apiProcesses: 4, searchSlots: 1 })).toBe(
      4 * (4 + 1 + 1 + 1) + (10 + 4 + 1) + (10 + 1),
    );
  });

  it("keeps one container up to seven CPUs below the PostgreSQL default limit with room for tools", () => {
    for (let cpus = 1; cpus <= 7; cpus++) {
      expect(connectionsOfAllRoles(defaults(cpus)), `${cpus} CPUs`).toBeLessThanOrEqual(
        POSTGRES_DEFAULT_LIMIT - RESERVED_FOR_ADMINISTRATORS - ROOM_FOR_TOOLS,
      );
    }
  });

  it("keeps one container on any CPU count below the limit the Compose file sets", () => {
    for (let cpus = 1; cpus <= 1024; cpus++) {
      expect(connectionsOfAllRoles(defaults(cpus)), `${cpus} CPUs`).toBeLessThanOrEqual(
        COMPOSE_LIMIT - RESERVED_FOR_ADMINISTRATORS - ROOM_FOR_TOOLS,
      );
    }
  });
});
