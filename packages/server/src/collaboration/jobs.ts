import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import { BLOG_ANNOUNCEMENTS_CHANNEL, type BlogSubscriptionService } from "./blog-subscriptions.js";

export const scheduledBlogPostsJob = defineJob({
  name: "blog.publish-scheduled",
  duringMaintenance: "wait",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const SCHEDULED_BLOG_POSTS_SCHEDULE = "* * * * *";

export const collaborationCleanupJob = defineJob({
  name: "content.cleanup",
  duringMaintenance: "wait",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 60 * 60,
});

export const COLLABORATION_CLEANUP_SCHEDULE = "41 * * * *";

export const blogAnnouncementsJob = defineJob({
  name: "blog.announce-posts",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 10,
  retryDelaySeconds: 5,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
});

const ANNOUNCEMENT_DELAY_MS = 250;

export async function startBlogAnnouncements(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  subscriptions: BlogSubscriptionService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, subscriptions, logger } = options;
  await jobs.work(blogAnnouncementsJob, async (job) => {
    const delivered = await subscriptions.deliverPending({ signal: job.signal });
    if (delivered > 0) job.logger.info({ delivered }, "New blog posts announced to followers");
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(blogAnnouncementsJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue the announcement of new blog posts");
      });
    }, ANNOUNCEMENT_DELAY_MS);
    timer.unref();
  };
  await listener.listen(BLOG_ANNOUNCEMENTS_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(blogAnnouncementsJob, {});
}
