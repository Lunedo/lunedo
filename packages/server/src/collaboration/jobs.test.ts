import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import type { JobDefinition, JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { blogAnnouncementsJob, startBlogAnnouncements } from "./jobs.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

class RecordingQueue {
  readonly enqueued: string[] = [];
  readonly handlers = new Map<string, JobHandler<unknown>>();

  async enqueue<T>(definition: JobDefinition<T>): Promise<string> {
    this.enqueued.push(definition.name);
    return randomUUID();
  }

  async work<T>(definition: JobDefinition<T>, handler: JobHandler<T>): Promise<void> {
    this.handlers.set(definition.name, handler as JobHandler<unknown>);
  }
}

describe.skipIf(!baseUrl)("blog announcement jobs", () => {
  let test: TestServices;
  let listener: NotificationListener;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    listener = new NotificationListener({ connectionString: test.url, logger });
  });

  afterAll(async () => {
    await listener?.close();
    await test?.close();
  });

  it("queues a delivery once at start and after every first publication, and the job delivers it", async () => {
    const queue = new RecordingQueue();
    await startBlogAnnouncements({
      jobs: queue as unknown as JobQueue,
      listener,
      subscriptions: test.services.blogSubscriptions,
      logger,
    });
    expect(queue.enqueued).toEqual([blogAnnouncementsJob.name]);
    const org = await fixtures.organization();
    const authorId = await fixtures.member(org.id);
    const readerId = await fixtures.member(org.id);
    const space = await fixtures.space(org.id, authorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    await test.services.blogSubscriptions.follow(accountPrincipal(readerId), space.id);
    const post = await test.services.blog.create(accountPrincipal(authorId), space.id, { title: "News" });
    await test.services.versions.publish(accountPrincipal(authorId), post.id);
    await vi.waitFor(() => expect(queue.enqueued.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });

    const handler = queue.handlers.get(blogAnnouncementsJob.name);
    if (!handler) throw new Error("No handler for the announcement job");
    await handler(testJobContext(blogAnnouncementsJob.name, {}));
    const delivered = await test.database.execute(sql`
      select 1 from notifications where recipient_id = ${readerId} and target_id = ${post.id}
        and type = 'blogPost.published'`);
    expect(delivered.rows).toHaveLength(1);
  });
});
