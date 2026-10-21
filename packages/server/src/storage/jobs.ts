import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const storageCheckJob = defineJob({
  name: "storage.check",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 0,
  expireInSeconds: 5 * 60,
});

export const storageReconcileJob = defineJob({
  name: "storage.reconcile",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 2,
  expireInSeconds: 60 * 60,
});

export const STORAGE_CHECK_SCHEDULE = "* * * * *";
export const STORAGE_RECONCILE_SCHEDULE = "23 3 * * *";
