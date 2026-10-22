import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import type { Rhythm } from "../meetings/schedule.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();
const WEEKLY: Rhythm = { frequency: "weekly", interval: 1, weekdays: ["MO"] };

describe.skipIf(!baseUrl)("tree changes while another transaction inserts below them", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query(
      "insert into instance (id, setup_completed_at) values (1, now()) on conflict do nothing",
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const leadId = org.owner;
    const readerId = await member(org.id, "member", "Rita Reader");
    const created = await space(org.id, leadId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    const admin = accountPrincipal(leadId);
    const page = (title: string, parentId: string | null) =>
      test.services.tree.create(admin, created.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId },
      });
    const parent = await page("Projects", null);
    const child = await page("Network", parent.id);
    const restricted = await page("HR only", null);
    await test.services.pageAccess.change(admin, restricted.id, [{ action: "restrict", kind: "view" }]);
    return {
      admin,
      leadId,
      reader: accountPrincipal(readerId),
      spaceId: created.id,
      parent,
      child,
      restricted,
    };
  }

  async function connection() {
    const client = new pg.Client({ connectionString: test.url });
    await client.connect();
    await client.query("begin");
    return client;
  }

  async function insertOpen(spaceId: string, parentId: string, creatorId: string) {
    const client = await connection();
    const id = uuidv7();
    await client.query(
      `insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id)
       values ($1, $2, $3, 'page', 'a0', 'Inserted meanwhile', 'live', $4)`,
      [id, spaceId, parentId, creatorId],
    );
    return { id, client };
  }

  async function stillWaiting(change: Promise<unknown>): Promise<boolean> {
    const pause = new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 300));
    return (
      (await Promise.race([
        change.then(
          () => "done",
          () => "done",
        ),
        pause,
      ])) === "waiting"
    );
  }

  async function finish(client: pg.Client) {
    await client.query("commit");
    await client.end();
  }

  async function moveConfirmed(context: Awaited<ReturnType<typeof setup>>, pending?: Promise<unknown>) {
    const target = { parentId: context.restricted.id };
    if (pending) {
      const first = await pending.then(
        () => null,
        (error: unknown) => error,
      );
      if (!first) return;
      expect(first).toMatchObject({ code: "moveChangesAccess" });
    }
    const impact = await test.services.tree.moveImpact(context.admin, context.parent.id, target);
    await test.services.tree.move(context.admin, context.parent.id, {
      ...target,
      confirmation: impact.confirmation ?? "",
    });
  }

  function startMove(context: Awaited<ReturnType<typeof setup>>, confirmation: string) {
    return test.services.tree.move(context.admin, context.parent.id, {
      parentId: context.restricted.id,
      confirmation,
    });
  }

  async function rowOf(id: string) {
    const result = await test.database.execute<{ path: string[]; trash_entry_id: string | null }>(
      sql`select path::text[] as path, trash_entry_id from tree_items where id = ${id}`,
    );
    return result.rows[0];
  }

  it("moves a page only after an open insert below it, so the new page inherits the restriction", async () => {
    const context = await setup();
    const impact = await test.services.tree.moveImpact(context.admin, context.parent.id, {
      parentId: context.restricted.id,
    });
    const inserted = await insertOpen(context.spaceId, context.child.id, context.leadId);
    const move = startMove(context, impact.confirmation ?? "");
    expect(await stillWaiting(move)).toBe(true);
    await finish(inserted.client);
    await moveConfirmed(context, move);
    expect((await rowOf(inserted.id))?.path).toEqual([
      context.restricted.id,
      context.parent.id,
      context.child.id,
      inserted.id,
    ]);
    const decision = await test.services.authorization.explain(context.reader, "item.view", {
      type: "item",
      id: inserted.id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("puts a page inserted below a page that goes to the trash into the trash with it", async () => {
    const context = await setup();
    const inserted = await insertOpen(context.spaceId, context.child.id, context.leadId);
    const trash = test.services.trash.deleteItem(context.admin, context.parent.id);
    expect(await stillWaiting(trash)).toBe(true);
    await finish(inserted.client);
    await trash;
    expect((await rowOf(inserted.id))?.trash_entry_id).not.toBeNull();
  });

  it("gives a topic created while an ancestor of its series moves the new path", async () => {
    const context = await setup();
    const seriesId = await test.services.meetings.createSeries(context.admin, context.spaceId, {
      name: "Jour fixe",
      parentId: context.child.id,
      members: [context.leadId],
      templateId: "builtin:team-meeting",
      rhythm: WEEKLY,
      startsOn: "2030-03-18",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
    });
    const impact = await test.services.tree.moveImpact(context.admin, context.parent.id, {
      parentId: context.restricted.id,
    });
    const blocker = await connection();
    let topic: Promise<string> | null = null;
    try {
      await blocker.query("lock table meeting_topics in share mode");
      topic = test.services.topics.create(context.admin, seriesId, { title: "Printer outage" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const move = startMove(context, impact.confirmation ?? "");
      expect(await stillWaiting(move)).toBe(true);
      await finish(blocker);
      const topicId = await topic;
      await moveConfirmed(context, move);
      expect((await rowOf(topicId))?.path.slice(0, 2)).toEqual([context.restricted.id, context.parent.id]);
    } finally {
      await blocker.end().catch(() => {});
      await topic?.catch(() => {});
    }
  });
});
