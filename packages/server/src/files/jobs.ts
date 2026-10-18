import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { DisplayVersionService } from "./display-versions.js";
import { DISPLAY_VERSIONS_CHANNEL } from "./files.js";

export const fileCleanupJob = defineJob({
  name: "files.remove-orphaned",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 30 * 60,
});

export const FILE_CLEANUP_SCHEDULE = "41 * * * *";

export const displayVersionJob = defineJob({
  name: "files.create-display-versions",
  payload: z.object({ fileId: z.uuid() }),
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
});

export const queueDisplayVersionsJob = defineJob({
  name: "files.queue-display-versions",
  payload: z.object({}),
  retryLimit: 5,
  retryDelaySeconds: 10,
  retryBackoff: true,
});

export const DISPLAY_VERSIONS_WATCHDOG_SCHEDULE = "17 * * * *";
export const DISPLAY_VERSION_CONCURRENCY = 2;
const QUEUE_DELAY_MS = 250;

export async function startDisplayVersions(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  displayVersions: DisplayVersionService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, displayVersions, logger } = options;
  await jobs.work(
    displayVersionJob,
    async (job) => {
      const outcome = await displayVersions.create(job.payload.fileId, {
        lastAttempt: job.retryCount >= displayVersionJob.retryLimit,
      });
      if (outcome === "done") job.logger.debug({ fileId: job.payload.fileId }, "Display versions created");
    },
    { concurrency: DISPLAY_VERSION_CONCURRENCY },
  );
  await jobs.work(queueDisplayVersionsJob, async (job) => {
    const queued = await displayVersions.queuePending(async (fileId) => {
      await jobs.enqueue(displayVersionJob, { fileId }, { idempotencyKey: fileId });
    });
    if (queued > 0)
      job.logger.info({ queued, ...(await displayVersions.counts()) }, "Display versions queued");
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(queueDisplayVersionsJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue display versions of images");
      });
    }, QUEUE_DELAY_MS);
    timer.unref();
  };
  await listener.listen(DISPLAY_VERSIONS_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(queueDisplayVersionsJob, {});
  await jobs.schedule(queueDisplayVersionsJob, DISPLAY_VERSIONS_WATCHDOG_SCHEDULE, {}, { key: "watchdog" });
}
