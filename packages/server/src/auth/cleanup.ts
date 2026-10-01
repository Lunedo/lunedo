import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

/** Deletes expired sessions, pending sign-ins, challenges, used or expired tokens and old counters. */
export const authCleanupJob = defineJob({
  name: "auth.cleanup",
  payload: z.object({}),
  retryLimit: 2,
});

export const AUTH_CLEANUP_SCHEDULE = "*/10 * * * *";
