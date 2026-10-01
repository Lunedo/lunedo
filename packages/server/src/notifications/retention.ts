import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const notificationRetentionJob = defineJob({
  name: "notifications.apply-retention",
  payload: z.object({}),
  retryLimit: 2,
});

export const NOTIFICATION_RETENTION_SCHEDULE = "41 3 * * *";
