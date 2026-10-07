import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

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
