import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const importWorkJob = defineJob({
  name: "imports.work",
  payload: z.object({ importId: z.uuid() }),
  retryLimit: 10,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 2 * 60 * 60,
});

export const importWatchdogJob = defineJob({
  name: "imports.watchdog",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const importCleanupJob = defineJob({
  name: "imports.cleanup",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 30 * 60,
});

export const IMPORT_WATCHDOG_SCHEDULE = "*/5 * * * *";
export const IMPORT_CLEANUP_SCHEDULE = "23 * * * *";
