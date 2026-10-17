import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const copyItemsJob = defineJob({
  name: "copies.run",
  payload: z.object({ copyId: z.uuid() }),
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 60 * 60,
});

export const copyWatchdogJob = defineJob({
  name: "copies.watchdog",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const COPY_WATCHDOG_SCHEDULE = "*/15 * * * *";
