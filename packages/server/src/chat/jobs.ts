import { z } from "zod";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import { CHAT_DELIVERIES_CHANNEL, type ChatChannelService } from "./channels.js";

export const chatDeliveryJob = defineJob({
  name: "chat.deliver",
  payload: z.object({ deliveryId: z.uuid() }),
  retryLimit: 5,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 2 * 60,
});

export const chatDispatchJob = defineJob({
  name: "chat.dispatch",
  payload: z.object({}),
  retryLimit: 5,
  retryDelaySeconds: 5,
  retryBackoff: true,
});

const DISPATCH_DELAY_MS = 100;

export const CHAT_WATCHDOG_SCHEDULE = "*/10 * * * *";

export class ChatDeliveryRetry extends Error {
  override name = "ChatDeliveryRetry";

  constructor() {
    super("The chat service did not accept the message yet");
  }
}

export async function startChatDelivery(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  channels: ChatChannelService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, channels, logger } = options;
  await jobs.work(chatDeliveryJob, async (job) => {
    const lastAttempt = job.retryCount >= chatDeliveryJob.retryLimit;
    let result: Awaited<ReturnType<ChatChannelService["deliver"]>>;
    try {
      result = await channels.deliver(job.payload.deliveryId, lastAttempt);
    } catch (error) {
      if (!lastAttempt) throw error;
      await channels.failDelivery(job.payload.deliveryId);
      logger.warn({ err: error }, "A chat message failed for good");
      return;
    }
    if (result === "retry") throw new ChatDeliveryRetry();
  });
  await jobs.work(chatDispatchJob, async () => {
    await channels.failAbandoned();
    await channels.queuePending(async (deliveryId, startAfter) => {
      await jobs.enqueue(chatDeliveryJob, { deliveryId }, { idempotencyKey: deliveryId, startAfter });
    });
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(chatDispatchJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue chat messages");
      });
    }, DISPATCH_DELAY_MS);
    timer.unref();
  };
  await listener.listen(CHAT_DELIVERIES_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(chatDispatchJob, {});
  await jobs.schedule(chatDispatchJob, CHAT_WATCHDOG_SCHEDULE, {}, { key: "watchdog" });
}
