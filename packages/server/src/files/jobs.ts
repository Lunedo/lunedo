import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const fileCleanupJob = defineJob({
  name: "files.remove-orphaned",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 30 * 60,
});

export const FILE_CLEANUP_SCHEDULE = "41 * * * *";
