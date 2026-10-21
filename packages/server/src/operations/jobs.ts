import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const removeOldErrorEventsJob = defineJob({
  name: "operations.remove-old-errors",
  payload: z.object({}),
  retryLimit: 2,
  expireInSeconds: 15 * 60,
});

export const REMOVE_OLD_ERROR_EVENTS_SCHEDULE = "53 3 * * *";
