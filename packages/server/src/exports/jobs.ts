import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const exportBuildJob = defineJob({
  name: "exports.build",
  payload: z.object({ exportId: z.uuid() }),
  retryLimit: 3,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 4 * 60 * 60,
});

export const exportWatchdogJob = defineJob({
  name: "exports.watchdog",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const exportCleanupJob = defineJob({
  name: "exports.cleanup",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 30 * 60,
});

export const EXPORT_WATCHDOG_SCHEDULE = "*/5 * * * *";
export const EXPORT_CLEANUP_SCHEDULE = "17 * * * *";
