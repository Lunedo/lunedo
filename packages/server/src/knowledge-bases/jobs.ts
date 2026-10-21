import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { ArticleApiService } from "./article-api.js";
import { REVIEW_CHANGES_CHANNEL, type ReviewService } from "./reviews.js";

export const reviewReminderJob = defineJob({
  name: "knowledge-bases.remind-review",
  duringMaintenance: "run",
  payload: z.object({
    itemId: z.uuid(),
    kind: z.enum(["lead", "due"]),
    dueAt: z.iso.datetime(),
    leadDays: z.number().int().min(0),
  }),
  retryLimit: 5,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 2 * 60,
});

export const reviewDispatchJob = defineJob({
  name: "knowledge-bases.queue-reviews",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 5,
  retryDelaySeconds: 5,
  retryBackoff: true,
});

export const reviewSafetyNetJob = defineJob({
  name: "knowledge-bases.check-reviews",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const REVIEW_SAFETY_NET_SCHEDULE = "17 * * * *";

export const removedArticlesJob = defineJob({
  name: "knowledge-bases.prune-removed-articles",
  duringMaintenance: "wait",
  payload: z.object({}),
  retryLimit: 2,
  expireInSeconds: 10 * 60,
});

export const REMOVED_ARTICLES_SCHEDULE = "43 3 * * *";

export async function startRemovedArticlePruning(options: {
  jobs: JobQueue;
  articles: ArticleApiService;
}): Promise<void> {
  await options.jobs.work(removedArticlesJob, async (job) => {
    const removed = await options.articles.pruneRemoved();
    if (removed > 0)
      job.logger.info({ removed }, "Records of removed articles older than their keeping period deleted");
  });
  await options.jobs.schedule(removedArticlesJob, REMOVED_ARTICLES_SCHEDULE, {}, { key: "daily" });
}

const DISPATCH_DELAY_MS = 200;

export async function startReviewReminders(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  reviews: ReviewService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, reviews, logger } = options;
  const queueAll = async () => {
    for (;;) {
      const queued = await reviews.queuePending(async (reminder, startAfter) => {
        await jobs.enqueue(reviewReminderJob, reminder, {
          idempotencyKey: `${reminder.itemId}:${reminder.kind}:${reminder.dueAt}:${reminder.leadDays}`,
          startAfter,
        });
      });
      if (queued === 0) return;
    }
  };
  await jobs.work(reviewReminderJob, async (job) => {
    await reviews.remind(job.payload);
  });
  await jobs.work(reviewDispatchJob, queueAll);
  await jobs.work(reviewSafetyNetJob, async (job) => {
    await queueAll();
    const sent = await reviews.remindOverdue();
    if (sent > 0) job.logger.warn({ sent }, "Review reminders sent by the safety net");
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(reviewDispatchJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue review reminders");
      });
    }, DISPATCH_DELAY_MS);
    timer.unref();
  };
  await listener.listen(REVIEW_CHANGES_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(reviewDispatchJob, {});
  await jobs.schedule(reviewSafetyNetJob, REVIEW_SAFETY_NET_SCHEDULE, {}, { key: "hourly" });
}
