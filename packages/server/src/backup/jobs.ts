import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const backupRunJob = defineJob({
  name: "backup.run",
  payload: z.object({
    trigger: z.enum(["scheduled", "manual"]),
    slot: z.iso.datetime().nullable(),
    actorId: z.uuid().nullable(),
  }),
  retryLimit: 0,
  expireInSeconds: 12 * 60 * 60,
});

export const backupTestRestoreJob = defineJob({
  name: "backup.test-restore",
  payload: z.object({ testId: z.uuid() }),
  retryLimit: 0,
  expireInSeconds: 12 * 60 * 60,
});
