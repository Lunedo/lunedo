import { z } from "zod";
import type { FileService } from "../files/files.js";
import { defineJob } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { RetentionResult, TrashService } from "./trash.js";
import type { VersionService } from "./versions.js";

export const trashRetentionJob = defineJob({
  name: "trash.apply-retention",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 60 * 60,
});

export const TRASH_RETENTION_SCHEDULE = "17 * * * *";

export const liveVersionsJob = defineJob({
  name: "pages.version-live-sessions",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const LIVE_VERSIONS_SCHEDULE = "* * * * *";

export async function applyTrashRetention(
  services: { trash: TrashService; versions: VersionService; files: FileService },
  job: { signal: AbortSignal; logger: Logger },
): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async <T>(step: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      failures.push(error);
      return fallback;
    }
  };
  const result = await attempt<RetentionResult>(() => services.trash.applyRetention({ signal: job.signal }), {
    moved: 0,
    purged: 0,
    failed: 0,
  });
  const drafts = await attempt(() => services.versions.removeExpiredDrafts(), 0);
  const files = await attempt(() => services.files.deleteOrphaned(), 0);
  if (result.moved + result.purged + result.failed + drafts + files > 0) {
    job.logger.info({ ...result, drafts, files }, "Trash retention applied");
  }
  if (failures.length > 0) throw failures[0];
}
