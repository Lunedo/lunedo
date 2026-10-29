import { describe, expect, it } from "vitest";
import {
  connectionsOfAllRoles,
  connectionsPerProcess,
  defaultPoolSize,
  JOB_QUEUE_CONNECTIONS,
  LISTENER_CONNECTIONS,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
} from "./pool-size.js";

const POSTGRES_DEFAULT_LIMIT = 100;
const RESERVED_FOR_ADMINISTRATORS = 3;
const ROOM_FOR_TOOLS = 5;

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

  it("counts the notification and job queue connections of each process", () => {
    expect(connectionsPerProcess(10)).toBe(10 + JOB_QUEUE_CONNECTIONS + LISTENER_CONNECTIONS);
  });

  it("keeps the three processes of one container below the PostgreSQL default limit with room for tools", () => {
    for (let cpus = 1; cpus <= 1024; cpus++) {
      expect(connectionsOfAllRoles(defaultPoolSize(cpus))).toBeLessThanOrEqual(
        POSTGRES_DEFAULT_LIMIT - RESERVED_FOR_ADMINISTRATORS - ROOM_FOR_TOOLS,
      );
    }
  });
});
