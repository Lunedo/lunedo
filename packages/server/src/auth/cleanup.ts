import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const authCleanupJob = defineJob({
  name: "auth.cleanup",
  payload: z.object({}),
  retryLimit: 2,
});

export const AUTH_CLEANUP_SCHEDULE = "*/10 * * * *";
