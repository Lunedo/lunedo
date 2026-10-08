import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const scheduledBlogPostsJob = defineJob({
  name: "blog.publish-scheduled",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const SCHEDULED_BLOG_POSTS_SCHEDULE = "* * * * *";

export const collaborationCleanupJob = defineJob({
  name: "content.cleanup",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 60 * 60,
});

export const COLLABORATION_CLEANUP_SCHEDULE = "41 * * * *";
