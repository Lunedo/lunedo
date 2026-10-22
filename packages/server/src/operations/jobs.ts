import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import { parseSettingChangeSignal, SETTING_CHANGES_CHANNEL } from "../settings/service.js";
import { updateCheckSetting } from "./settings.js";
import type { UpdateCheckService } from "./update-check.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const removeOldErrorEventsJob = defineJob({
  name: "operations.remove-old-errors",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 2,
  expireInSeconds: 15 * 60,
});

export const REMOVE_OLD_ERROR_EVENTS_SCHEDULE = "53 3 * * *";

export const checkForUpdatesJob = defineJob({
  name: "operations.check-for-updates",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 0,
  expireInSeconds: 5 * 60,
});

export const CHECK_FOR_UPDATES_SCHEDULE = "11 4 * * *";

export async function startUpdateChecks(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  updates: UpdateCheckService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, updates, logger } = options;
  await jobs.work(checkForUpdatesJob, async () => {
    await updates.check();
  });
  await jobs.schedule(checkForUpdatesJob, CHECK_FOR_UPDATES_SCHEDULE, {}, { key: "daily" });
  await listener.listen(SETTING_CHANGES_CHANNEL, (payload) => {
    const signal = parseSettingChangeSignal(payload);
    if (signal?.key !== updateCheckSetting.key) return;
    jobs
      .enqueue(checkForUpdatesJob, {}, { idempotencyKey: "setting-changed" })
      .catch((error: unknown) => logger.warn({ err: error }, "Could not queue an update check"));
  });
  if (!(await updates.checkedSince(new Date(Date.now() - DAY_MS)))) {
    await jobs.enqueue(checkForUpdatesJob, {}, { idempotencyKey: "start" });
  }
}
