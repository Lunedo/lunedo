import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { EnqueueOptions, JobDefinition, JobQueue } from "../jobs/job-queue.js";
import { PortalStatistics, searchAggregationJob } from "../portal/statistics.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { periodRange } from "./statistics.js";

const baseUrl = testDatabaseBaseUrl();

describe("statistics periods", () => {
  it("end today and include the first day", () => {
    const now = new Date("2026-10-19T15:00:00Z");
    expect(periodRange("7d", now)).toEqual({ from: "2026-10-13", to: "2026-10-19" });
    expect(periodRange("30d", now)).toEqual({ from: "2026-09-20", to: "2026-10-19" });
    expect(periodRange("90d", now)).toEqual({ from: "2026-07-22", to: "2026-10-19" });
    expect(periodRange("12m", now)).toEqual({ from: "2025-10-20", to: "2026-10-19" });
  });
});

describe.skipIf(!baseUrl)("knowledge base statistics", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const adminId = await member(org.id, "member", "Admin");
    const editorId = await member(org.id, "member", "Editor");
    const admin = accountPrincipal(adminId);
    const editor = accountPrincipal(editorId);
    const name = `Help ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      admin,
      org.id,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        grants: [{ principalKind: "account", principalId: editorId, role: "editor" }],
      },
      test.services.spacePermissions.holders,
    );
    return { admin, editor, kb };
  }

  async function article(actor: Principal, spaceId: string, title: string) {
    const created = await test.services.tree.create(actor, spaceId, {
      kind: "page",
      title,
      placement: { parentId: null },
    });
    await test.services.versions.publish(actor, created.id);
    return created.id;
  }

  async function search(spaceId: string, term: string, results: number, times: number) {
    for (let index = 0; index < times; index++) {
      await test.services.portalStatistics.recordSearch(spaceId, { term, results, categoryId: null });
    }
  }

  it("shows a term only from 3 searches on", async () => {
    const context = await setup();
    await search(context.kb.id, "VPN", 4, 3);
    await search(context.kb.id, "Parkausweis", 0, 3);
    await search(context.kb.id, "Lea Hoffmann", 0, 2);
    const overview = await test.services.knowledgeBaseStatistics.overview(
      context.editor,
      context.kb.id,
      "30d",
    );
    expect(overview.searches).toEqual({ total: 8, zeroResults: 5 });
    expect(overview.topTerms.map((entry) => entry.term)).toEqual(["parkausweis", "vpn"]);
    expect(overview.zeroResultTerms.map((entry) => [entry.term, entry.searches])).toEqual([
      ["parkausweis", 3],
    ]);
  });

  it("leaves out articles the caller cannot see, with their ratings, views and notes", async () => {
    const context = await setup();
    const open = await article(context.editor, context.kb.id, "Printer");
    const hidden = await article(context.admin, context.kb.id, "Salaries");
    await test.services.pageAccess.change(context.admin, hidden, [{ action: "restrict", kind: "view" }]);
    const statistics = test.services.portalStatistics;
    for (const itemId of [open, hidden]) {
      await statistics.recordView(context.kb.id, itemId);
      await statistics.recordRating(context.kb.id, itemId, true);
      await statistics.recordRating(context.kb.id, itemId, false);
      await statistics.recordFeedback(context.kb.id, itemId, "Step 2 looks different");
    }
    const service = test.services.knowledgeBaseStatistics;
    const forEditor = await service.overview(context.editor, context.kb.id, "7d");
    expect(forEditor.unhelpful).toEqual([
      {
        article: { id: open, title: "Printer", categoryPath: [] },
        helpful: 1,
        unhelpful: 1,
        feedback: 1,
      },
    ]);
    expect(forEditor.mostRead.map((entry) => entry.article.id)).toEqual([open]);
    expect(forEditor.ratings).toEqual({ helpful: 1, unhelpful: 1 });
    expect(forEditor.views).toBe(1);
    await expect(
      service.feedback(context.editor, context.kb.id, hidden, { period: "7d" }),
    ).rejects.toMatchObject({ code: "notFound" });
    const forAdmin = await service.overview(context.admin, context.kb.id, "7d");
    expect(forAdmin.unhelpful.map((entry) => entry.article.id).sort()).toEqual([open, hidden].sort());
    const notes = await service.feedback(context.admin, context.kb.id, hidden, { period: "7d" });
    expect(notes.items.map((note) => note.text)).toEqual(["Step 2 looks different"]);
  });

  it("deletes a note for good and audits it without its text", async () => {
    const context = await setup();
    const itemId = await article(context.editor, context.kb.id, "VPN");
    await test.services.portalStatistics.recordFeedback(context.kb.id, itemId, "Call Lea at 0171 123456");
    const service = test.services.knowledgeBaseStatistics;
    const [note] = (await service.feedback(context.admin, context.kb.id, itemId, { period: "7d" })).items;
    if (!note) throw new Error("No note recorded");
    const other = await setup();
    await expect(service.deleteFeedback(other.admin, other.kb.id, note.id)).rejects.toMatchObject({
      code: "feedbackNotFound",
    });
    await service.deleteFeedback(context.admin, context.kb.id, note.id);
    expect((await service.feedback(context.admin, context.kb.id, itemId, { period: "7d" })).items).toEqual(
      [],
    );
    await expect(service.deleteFeedback(context.admin, context.kb.id, note.id)).rejects.toMatchObject({
      code: "feedbackNotFound",
    });
    const audited = await test.database.execute<{ name: string; fields: unknown }>(
      sql`select name, fields from audit_events where target_id = ${itemId} and name = 'article.feedbackDeleted'`,
    );
    expect(audited.rows).toHaveLength(1);
    expect(JSON.stringify(audited.rows[0]?.fields)).not.toContain("0171");
  });

  it("counts searches older than 12 months per term and month, and drops terms searched fewer than 3 times", async () => {
    const context = await setup();
    const queued: { payload: unknown; options: EnqueueOptions | undefined }[] = [];
    const jobs = {
      enqueue: async <T>(definition: JobDefinition<T>, payload: T, options?: EnqueueOptions) => {
        if (definition.name === searchAggregationJob.name) queued.push({ payload, options });
        return randomUUID();
      },
    } as unknown as JobQueue;
    const at = (now: string) =>
      new PortalStatistics({ database: test.database, jobs, clock: () => new Date(now) });
    const record = async (now: string, term: string, results: number) =>
      at(now).recordSearch(context.kb.id, { term, results, categoryId: null });
    await record("2025-09-03T10:20:00Z", "VPN", 3);
    await record("2025-09-03T11:40:00Z", "VPN", 0);
    await record("2025-09-05T09:00:00Z", "Lea Hoffmann", 0);
    await record("2025-09-28T08:00:00Z", "vpn", 1);
    await record("2025-09-29T08:00:00Z", "lea hoffmann", 0);
    await record("2025-10-19T13:00:00Z", "Drucker", 1);
    expect(queued[0]).toEqual({
      payload: { spaceId: context.kb.id },
      options: {
        idempotencyKey: `${context.kb.id}:2025-09-03`,
        startAfter: new Date("2026-09-04T00:05:00Z"),
      },
    });

    expect(await at("2026-09-04T00:05:00Z").aggregateSearches(context.kb.id)).toBe(2);
    expect(await at("2026-10-19T12:00:00Z").aggregateSearches(context.kb.id)).toBe(3);
    expect(await at("2026-10-19T12:00:00Z").aggregateSearches(context.kb.id)).toBe(0);
    const months = await test.database.execute<{
      term: string;
      month: string;
      searches: number;
      zero: number;
    }>(
      sql`select term, month::text as month, searches, zero_results as zero from portal_search_months
        where space_id = ${context.kb.id}`,
    );
    expect(months.rows).toEqual([{ term: "vpn", month: "2025-09-01", searches: 3, zero: 1 }]);
    const raw = await test.database.execute<{ term: string }>(
      sql`select term from portal_searches where space_id = ${context.kb.id}`,
    );
    expect(raw.rows.map((row) => row.term)).toEqual(["drucker"]);
  });
});
