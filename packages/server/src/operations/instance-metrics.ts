import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { StorageService } from "../storage/storage.js";
import type { BackupStatus } from "./backup-status.js";
import type { OperationsStatusService } from "./status.js";

export interface InstanceMetricsSnapshot {
  databaseSizeBytes: number;
  storage: { usedBytes: number; totalBytes: number; ratio: number; level: number } | null;
  storageLevel: number;
  backup: BackupStatus | null;
  mail: {
    failedAttempts: number;
    failedMessages: number;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  };
  search: { pendingItems: number; failingItems: number };
  collaborationReady: boolean | null;
}

export type InstanceMetricsSource = () => Promise<InstanceMetricsSnapshot>;

export const INSTANCE_METRICS_CACHE_MS = 10_000;

export function instanceMetricsSource(options: {
  database: Database;
  storage: StorageService;
  mail: MailService;
  operations: OperationsStatusService;
  collaborationProbe?: (() => Promise<boolean>) | undefined;
  now?: () => number;
}): InstanceMetricsSource {
  const now = options.now ?? Date.now;
  let cached: { at: number; value: Promise<InstanceMetricsSnapshot> } | null = null;

  const read = async (): Promise<InstanceMetricsSnapshot> => {
    const [databaseSizeBytes, storage, backup, delivery, search, collaborationReady] = await Promise.all([
      options.operations.databaseSizeBytes(),
      options.storage.status(),
      options.operations.backups(),
      options.mail.deliveryState(),
      options.database.execute<{ pending: string | number; failing: string | number }>(sql`
        select count(*) as pending, count(*) filter (where attempts > 0) as failing from search_pending_items
      `),
      options.collaborationProbe ? options.collaborationProbe().catch(() => false) : Promise.resolve(null),
    ]);
    const measured =
      storage.measured &&
      storage.usedBytes !== null &&
      storage.totalBytes !== null &&
      storage.percent !== null;
    return {
      databaseSizeBytes,
      storage: measured
        ? {
            usedBytes: storage.usedBytes ?? 0,
            totalBytes: storage.totalBytes ?? 0,
            ratio: (storage.percent ?? 0) / 100,
            level: storage.level,
          }
        : null,
      storageLevel: storage.level,
      backup,
      mail: {
        failedAttempts: delivery.failedAttempts,
        failedMessages: delivery.failedMessages,
        lastSuccessAt: delivery.lastSuccessAt,
        lastFailureAt: delivery.lastFailure?.at ?? null,
      },
      search: {
        pendingItems: Number(search.rows[0]?.pending ?? 0),
        failingItems: Number(search.rows[0]?.failing ?? 0),
      },
      collaborationReady,
    };
  };

  return () => {
    const at = now();
    if (!cached || at - cached.at >= INSTANCE_METRICS_CACHE_MS) {
      const value = read();
      cached = { at, value };
      value.catch(() => {
        if (cached?.value === value) cached = null;
      });
    }
    return cached.value;
  };
}
