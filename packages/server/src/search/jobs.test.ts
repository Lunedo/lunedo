import { randomUUID } from "node:crypto";
import type { DocumentJson } from "@lunedo/editor-schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import type { EnqueueOptions, JobDefinition, JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { SearchIndexer } from "./indexer.js";
import { searchIndexJob, startSearchIndexing, updateSearchIndex } from "./jobs.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

function body(text: string): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

class RecordingQueue {
  readonly enqueued: { name: string; options: EnqueueOptions }[] = [];
  readonly handlers = new Map<string, JobHandler<unknown>>();

  async enqueue<T>(definition: JobDefinition<T>, _payload: T, options: EnqueueOptions = {}): Promise<string> {
    this.enqueued.push({ name: definition.name, options });
    return randomUUID();
  }

  async work<T>(definition: JobDefinition<T>, handler: JobHandler<T>): Promise<void> {
    this.handlers.set(definition.name, handler as JobHandler<unknown>);
  }
}

describe.skipIf(!baseUrl)("search index jobs", () => {
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

  it("queues an update after every committed change and once at start", async () => {
    const queue = new RecordingQueue();
    await startSearchIndexing({
      jobs: queue as unknown as JobQueue,
      listener,
      indexer: test.services.search.indexer,
      logger,
    });
    expect(queue.handlers.has(searchIndexJob.name)).toBe(true);
    expect(queue.enqueued).toHaveLength(1);
    const org = await fixtures.organization();
    const memberId = await fixtures.member(org.id);
    const space = await fixtures.space(org.id, memberId);
    await test.services.tree.create(accountPrincipal(memberId), space.id, {
      kind: "page",
      title: "Change",
      mode: "live",
      placement: { parentId: null },
      document: body("change"),
    });
    await vi.waitFor(() => expect(queue.enqueued.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(queue.enqueued.every((job) => job.name === searchIndexJob.name)).toBe(true);
  });

  it("indexes with the configured number of pages at once", async () => {
    const queue = new RecordingQueue();
    const drains: (number | undefined)[] = [];
    const indexer = {
      drain: async (options: { concurrency?: number }) => {
        drains.push(options.concurrency);
        return { items: 0, spaces: 0, failed: 0, nextDueAt: null };
      },
    };
    await startSearchIndexing({
      jobs: queue as unknown as JobQueue,
      listener,
      indexer: indexer as unknown as SearchIndexer,
      logger,
      concurrency: 6,
    });
    await queue.handlers.get(searchIndexJob.name)?.(testJobContext(searchIndexJob.name, {}));
    expect(drains).toEqual([6]);
  });

  it("queues a later run for changes that are not due yet", async () => {
    const org = await fixtures.organization();
    const memberId = await fixtures.member(org.id);
    const space = await fixtures.space(org.id, memberId);
    const member = accountPrincipal(memberId);
    const page = await test.services.tree.create(member, space.id, {
      kind: "page",
      title: "Live page",
      mode: "live",
      placement: { parentId: null },
      document: body("first"),
    });
    await test.services.search.indexer.drain();
    await test.services.documents.replace(member, page.id, body("second"));
    const queue = new RecordingQueue();
    await updateSearchIndex(
      test.services.search.indexer,
      queue as unknown as JobQueue,
      testJobContext(searchIndexJob.name, {}),
    );
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.options.startAfter?.getTime()).toBeGreaterThan(Date.now());
  });
});
