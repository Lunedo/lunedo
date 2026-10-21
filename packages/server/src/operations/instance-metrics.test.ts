import { describe, expect, it } from "vitest";
import type { Database } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { StorageService } from "../storage/storage.js";
import { INSTANCE_METRICS_CACHE_MS, instanceMetricsSource } from "./instance-metrics.js";
import { MAINTENANCE_OFF, type MaintenanceService } from "./maintenance.js";
import type { OperationsStatusService } from "./status.js";
import type { UpdateCheckService } from "./update-check.js";

function source(options: { now: () => number; failDatabaseSize?: () => boolean }) {
  let reads = 0;
  const read = instanceMetricsSource({
    database: {
      execute: async () => ({ rows: [{ pending: "3", failing: "1" }] }),
    } as unknown as Database,
    storage: {
      status: async () => ({ measured: false, usedBytes: null, totalBytes: null, percent: null, level: 0 }),
    } as unknown as StorageService,
    mail: {
      deliveryState: async () => ({
        lastSuccessAt: null,
        lastFailure: null,
        failedAttempts: 0,
        failedMessages: 0,
      }),
    } as unknown as MailService,
    operations: {
      databaseSizeBytes: async () => {
        reads += 1;
        if (options.failDatabaseSize?.()) throw new Error("down");
        return 42;
      },
      backups: async () => null,
    } as unknown as OperationsStatusService,
    maintenance: { status: async () => MAINTENANCE_OFF } as unknown as MaintenanceService,
    updates: { updateAvailable: async () => null } as unknown as UpdateCheckService,
    now: options.now,
  });
  return { read, reads: () => reads };
}

describe("instanceMetricsSource", () => {
  it("reads the instance values once per cache period", async () => {
    let now = 0;
    const metrics = source({ now: () => now });
    const first = await metrics.read();
    expect(first).toMatchObject({
      databaseSizeBytes: 42,
      storage: null,
      backup: null,
      search: { pendingItems: 3, failingItems: 1 },
      collaborationReady: null,
    });
    now = INSTANCE_METRICS_CACHE_MS - 1;
    await metrics.read();
    expect(metrics.reads()).toBe(1);
    now = INSTANCE_METRICS_CACHE_MS;
    await metrics.read();
    expect(metrics.reads()).toBe(2);
  });

  it("does not keep a failed read", async () => {
    let fail = true;
    const metrics = source({ now: () => 0, failDatabaseSize: () => fail });
    await expect(metrics.read()).rejects.toThrow("down");
    fail = false;
    await expect(metrics.read()).resolves.toMatchObject({ databaseSizeBytes: 42 });
  });
});
