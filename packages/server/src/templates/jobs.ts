import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";

export const adoptTemplateFilesJob = defineJob({
  name: "templates.adopt-files",
  payload: z.object({}),
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  expireInSeconds: 60 * 60,
});
