import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import type { EnqueueOptions, JobDefinition, JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { reviewDispatchJob, reviewReminderJob, reviewSafetyNetJob, startReviewReminders } from "./jobs.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

class RecordingQueue {
  readonly enqueued: { name: string; payload: unknown; options: EnqueueOptions | undefined }[] = [];
  readonly scheduled: string[] = [];
  readonly handlers = new Map<string, JobHandler<unknown>>();

  async enqueue<T>(definition: JobDefinition<T>, payload: T, options?: EnqueueOptions): Promise<string> {
    this.enqueued.push({ name: definition.name, payload, options });
    return randomUUID();
  }

  async work<T>(definition: JobDefinition<T>, handler: JobHandler<T>): Promise<void> {
    this.handlers.set(definition.name, handler as JobHandler<unknown>);
  }

  async schedule<T>(definition: JobDefinition<T>): Promise<void> {
    this.scheduled.push(definition.name);
  }
}

describe.skipIf(!baseUrl)("review reminder jobs", () => {
  let test: TestServices;
  let listener: NotificationListener;
  const { organization, member } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    listener = new NotificationListener({ connectionString: test.url, logger });
  });

  afterAll(async () => {
    await listener?.close();
    await test?.close();
  });

  it("queue a reminder job for the due date as soon as an article gets one", async () => {
    const queue = new RecordingQueue();
    await startReviewReminders({
      jobs: queue as unknown as JobQueue,
      listener,
      reviews: test.services.reviews,
      logger,
    });
    expect(queue.enqueued.map((entry) => entry.name)).toEqual([reviewDispatchJob.name]);
    expect(queue.scheduled).toEqual([reviewSafetyNetJob.name]);

    const org = await organization();
    const adminId = await member(org.id);
    const admin = accountPrincipal(adminId);
    const name = `Help ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      admin,
      org.id,
      { name, key: await test.services.spaces.suggestKey(name), type: "knowledgeBase", grants: [] },
      test.services.spacePermissions.holders,
    );
    const article = await test.services.tree.create(admin, kb.id, {
      kind: "page",
      title: "VPN",
      placement: { parentId: null },
    });
    await test.services.versions.publish(admin, article.id);
    const before = queue.enqueued.length;
    await test.services.reviews.updateSettings(admin, kb.id, { intervalMonths: 3 });
    await vi.waitFor(() => expect(queue.enqueued.length).toBeGreaterThan(before), { timeout: 5000 });

    const dispatch = queue.handlers.get(reviewDispatchJob.name);
    if (!dispatch) throw new Error("No handler for the dispatch job");
    await dispatch(testJobContext(reviewDispatchJob.name, {}));
    const reminders = queue.enqueued.filter(
      (entry) =>
        entry.name === reviewReminderJob.name && (entry.payload as { itemId: string }).itemId === article.id,
    );
    expect(reminders.map((entry) => (entry.payload as { kind: string }).kind)).toEqual(["lead", "due"]);
    const due = reminders[1];
    if (!due) throw new Error("No reminder for the due date");
    expect(due.options?.idempotencyKey).toContain(article.id);
    expect(due.options?.startAfter?.toISOString()).toBe((due.payload as { dueAt: string }).dueAt);
  });
});
