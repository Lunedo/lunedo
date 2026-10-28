import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import { SEARCH_CHANGES_CHANNEL, type SearchIndexer } from "./indexer.js";

export const searchIndexJob = defineJob({
  name: "search.update-index",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 10,
  retryDelaySeconds: 5,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
});

const NOTIFICATION_DELAY_MS = 500;

export async function updateSearchIndex(
  indexer: SearchIndexer,
  jobs: JobQueue,
  job: { signal: AbortSignal; logger: Logger },
  concurrency = 1,
): Promise<void> {
  const result = await indexer.drain({ signal: job.signal, logger: job.logger, concurrency });
  if (result.items + result.spaces + result.failed > 0) {
    job.logger.info(
      { items: result.items, spaces: result.spaces, failed: result.failed },
      "Search index updated",
    );
  }
  if (result.nextDueAt && !job.signal.aborted) {
    await jobs.enqueue(searchIndexJob, {}, { startAfter: result.nextDueAt });
  }
}

export async function startSearchIndexing(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  indexer: SearchIndexer;
  logger: Logger;
  concurrency?: number;
}): Promise<void> {
  const { jobs, listener, indexer, logger } = options;
  const concurrency = options.concurrency ?? 1;
  await jobs.work(searchIndexJob, (job) => updateSearchIndex(indexer, jobs, job, concurrency), {
    coalesce: true,
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(searchIndexJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue a search index update");
      });
    }, NOTIFICATION_DELAY_MS);
    timer.unref();
  };
  await listener.listen(SEARCH_CHANGES_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(searchIndexJob, {});
}
