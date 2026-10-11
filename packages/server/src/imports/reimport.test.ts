import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { tinyLinkCode } from "./links.js";
import type { ChangeTab } from "./reimport.js";
import { ALICE, BOB } from "./testing/fixture.js";
import { importHarness } from "./testing/harness.js";
import { foreignExport, RE, RE_COMMENT, reimportAfter, reimportBefore } from "./testing/reimport-fixture.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe.skipIf(!baseUrl)("Confluence re-imports", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function world() {
    const organization = await fixtures.organization();
    const otherAdmin = await fixtures.member(organization.id);
    await test.database.execute(sql`
      insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role)
      values (gen_random_uuid(), 'organization', ${organization.id}, 'account', ${otherAdmin}, 'administrator')`);
    const readers = await test.services.groups.create(SYSTEM, organization.id, { name: "readers" });
    const key = `R${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const first = await harness.accepted(reimportBefore(), {
      organizationId: organization.id,
      admin: organization.owner,
      key,
    });
    expect(first.state).toBe("accepted");
    const spaceId = first.quarantineSpace?.id ?? "";
    await test.services.spacePermissions.apply(as(organization.owner), spaceId, {
      action: "grant",
      principalKind: "account",
      principalId: otherAdmin,
      role: "reader",
    });
    const item = (sourceId: string) => harness.target(first.id, "page", sourceId);
    return {
      organizationId: organization.id,
      admin: organization.owner,
      otherAdmin,
      readers: readers.id,
      spaceId,
      key,
      first,
      item,
    };
  }

  type World = Awaited<ReturnType<typeof world>>;

  async function promote(w: World) {
    await test.database.execute(sql`
      update space_permissions set role = 'admin' where space_id = ${w.spaceId} and principal_kind = 'account'
        and principal_id = ${w.otherAdmin}`);
  }

  async function editLocally(w: World) {
    for (const sourceId of [RE.keepHere, RE.takeSource, RE.keepBoth]) {
      await test.services.documents.replace(
        as(w.admin),
        await w.item(sourceId),
        paragraph(`Local ${sourceId}`),
      );
    }
    await test.services.tree.move(as(w.admin), await w.item(RE.stays), { parentId: await w.item(RE.keep) });
    const steady = await w.item(RE.steady);
    await test.database.execute(sql`delete from page_labels where item_id = ${steady} and label = 'touched'`);
    await test.database.execute(sql`
      insert into page_labels (item_id, label, created_by, created_at)
      values (${steady}, 'touched', ${w.admin}, now() + interval '1 second')`);
    await openSession(await w.item(RE.editing));
  }

  async function openSession(itemId: string) {
    await test.database.execute(sql`
      insert into collaboration_presence (item_id, node, connections, seen_at) values (${itemId}, 'node-a', 1, now())
      on conflict (item_id, node) do update set seen_at = now()`);
  }

  async function closeSession(itemId: string) {
    await test.database.execute(sql`delete from collaboration_presence where item_id = ${itemId}`);
  }

  async function snapshot(spaceId: string) {
    const result = await test.database.execute<Record<string, unknown>>(sql`
      select
        (select count(*) from tree_items where space_id = ${spaceId})::int as items,
        (select count(*) from page_versions v join tree_items t on t.id = v.item_id where t.space_id = ${spaceId})::int
          as versions,
        (select count(*) from comments c join tree_items t on t.id = c.item_id where t.space_id = ${spaceId})::int as comments,
        (select count(*) from attachment_versions v join attachments a on a.id = v.attachment_id
          join tree_items t on t.id = a.item_id where t.space_id = ${spaceId})::int as attachment_versions,
        (select count(*) from page_labels l join tree_items t on t.id = l.item_id where t.space_id = ${spaceId})::int
          as labels,
        (select count(*) from trash_entries where space_id = ${spaceId})::int as trash`);
    return result.rows[0];
  }

  async function access(spaceId: string) {
    const result = await test.database.execute<{ entries: string[] }>(sql`
      select array(
        select principal_kind || ':' || coalesce(principal_id::text, '') || ':' || role from space_permissions
        where space_id = ${spaceId}
        union all
        select 'r:' || r.item_id || ':' || r.kind from page_restrictions r join tree_items t on t.id = r.item_id
        where t.space_id = ${spaceId}
        union all
        select 'h:' || h.item_id || ':' || h.kind || ':' || h.principal_id from page_restriction_holders h
        join tree_items t on t.id = h.item_id where t.space_id = ${spaceId}
        union all
        select 's:' || s.item_id || ':' || s.principal_id || ':' || s.role from page_shares s
        join tree_items t on t.id = s.item_id where t.space_id = ${spaceId}
        order by 1) as entries`);
    return result.rows[0]?.entries ?? [];
  }

  async function changes(viewer: string, importId: string, tab: ChangeTab) {
    return (await test.services.imports.reimports.changes(as(viewer), importId, { tab, limit: 100 })).entries;
  }

  async function idOf(viewer: string, importId: string, tab: ChangeTab, itemId: string) {
    const entry = (await changes(viewer, importId, tab)).find((candidate) => candidate.item?.id === itemId);
    if (!entry) throw new Error(`No change for ${itemId}`);
    return entry.id;
  }

  async function notifications() {
    const result = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from notifications`,
    );
    return result.rows[0]?.count ?? 0;
  }

  async function decideAll(w: World, importId: string) {
    const reimports = test.services.imports.reimports;
    const decide = async (
      tab: ChangeTab,
      sourceId: string,
      decision: "pagehall" | "source" | "both" | "trash" | "keep",
    ) =>
      reimports.decide(as(w.admin), importId, {
        ids: [await idOf(w.admin, importId, tab, await w.item(sourceId))],
        decision,
      });
    await decide("conflicts", RE.keepHere, "pagehall");
    await decide("conflicts", RE.takeSource, "source");
    await decide("conflicts", RE.keepBoth, "both");
    await decide("deleted", RE.trash, "trash");
    await decide("deleted", RE.keep, "keep");
  }

  async function document(itemId: string) {
    const result = await test.database.execute<{
      snapshot: unknown;
      title: string;
      parent_id: string | null;
    }>(sql`
      select d.snapshot, t.title, t.parent_id from page_documents d join tree_items t on t.id = d.item_id
      where t.id = ${itemId}`);
    return result.rows[0];
  }

  async function versions(itemId: string) {
    const result = await test.database.execute<{ number: number; reason: string; document: unknown }>(sql`
      select number, reason::text as reason, document from page_versions where item_id = ${itemId} order by number`);
    return result.rows;
  }

  it("lists every kind of change and changes nothing until the changes are applied", async () => {
    const w = await world();
    await editLocally(w);
    const before = await snapshot(w.spaceId);
    const permissions = await access(w.spaceId);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    expect(reimport.state).toBe("review");
    expect(reimport.targetSpace?.id).toBe(w.spaceId);
    expect(reimport.counts).toMatchObject({
      new: 2,
      updated: 2,
      conflicts: 4,
      deleted: 2,
      moved: 1,
      movedHere: 1,
      labels: 1,
      newComments: 1,
      goneComments: 1,
      newAttachmentVersions: 2,
    });
    expect(await snapshot(w.spaceId)).toEqual(before);
    expect(await access(w.spaceId)).toEqual(permissions);

    const conflicts = await changes(w.admin, reimport.id, "conflicts");
    expect(conflicts.map((entry) => entry.title).sort()).toEqual(
      ["Being edited", "Keep both", "Keep here", "Take source"].sort(),
    );
    expect(conflicts.find((entry) => entry.title === "Being edited")).toMatchObject({
      reason: "editing",
      editing: true,
    });
    expect(conflicts.find((entry) => entry.title === "Keep here")?.changedHere?.by?.id).toBe(w.admin);
    const moved = await changes(w.admin, reimport.id, "moved");
    expect(moved.map((entry) => [entry.title, entry.change, entry.to?.title]).sort()).toEqual([
      ["Follows the source", "moved", "Move target"],
      ["Stays here", "movedHere", "Move target"],
    ]);
    const deleted = await changes(w.admin, reimport.id, "deleted");
    expect(deleted.map((entry) => [entry.kind, entry.change]).sort()).toEqual([
      ["comment", "gone"],
      ["page", "deleted"],
      ["page", "deleted"],
    ]);
  });

  it("applies the changes with the decisions taken and keeps every earlier version", async () => {
    const w = await world();
    await editLocally(w);
    const permissions = await access(w.spaceId);
    const sent = await notifications();
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await decideAll(w, reimport.id);
    const applied = await harness.applyChanges(w.admin, reimport.id);
    expect(applied.state).toBe("review");

    const created = await harness.target(reimport.id, "page", RE.created);
    const child = await harness.target(reimport.id, "page", RE.createdChild);
    expect((await document(created))?.parent_id).toBe(await w.item(RE.target));
    expect((await document(child))?.parent_id).toBe(created);
    const sourceOnly = await w.item(RE.sourceOnly);
    expect((await document(sourceOnly))?.title).toBe("Source only, renamed");
    expect((await versions(sourceOnly)).map((entry) => entry.reason)).toEqual(["published", "imported"]);
    expect(JSON.stringify((await document(sourceOnly))?.snapshot)).toContain("New text from the source");

    const keepHere = await w.item(RE.keepHere);
    expect(JSON.stringify((await document(keepHere))?.snapshot)).toContain(`Local ${RE.keepHere}`);
    expect(await versions(keepHere)).toHaveLength(1);

    const takeSource = await w.item(RE.takeSource);
    expect(JSON.stringify((await document(takeSource))?.snapshot)).toContain("Source take source");
    expect((await versions(takeSource)).map((entry) => entry.reason)).toEqual(["published", "imported"]);
    const drafts = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from discarded_drafts where item_id = ${takeSource}`,
    );
    expect(drafts.rows[0]?.count).toBe(1);

    const keepBoth = await w.item(RE.keepBoth);
    expect(JSON.stringify((await document(keepBoth))?.snapshot)).toContain(`Local ${RE.keepBoth}`);
    const both = await versions(keepBoth);
    expect(both.map((entry) => entry.reason)).toEqual(["published", "importedNotApplied"]);
    expect(JSON.stringify(both[1]?.document)).toContain("Source keep both");

    const editing = await w.item(RE.editing);
    expect(JSON.stringify((await document(editing))?.snapshot)).toContain("Original editing");
    expect(
      (await changes(w.admin, reimport.id, "conflicts")).filter((entry) => entry.appliedAt === null),
    ).toHaveLength(1);

    const trashed = await test.database.execute<{ trashed: boolean }>(sql`
      select trash_entry_id is not null as trashed from tree_items where id = ${await w.item(RE.trash)}`);
    expect(trashed.rows[0]?.trashed).toBe(true);
    const kept = await test.database.execute<{ trashed: boolean }>(sql`
      select trash_entry_id is not null as trashed from tree_items where id = ${await w.item(RE.keep)}`);
    expect(kept.rows[0]?.trashed).toBe(false);

    expect((await document(await w.item(RE.follows)))?.parent_id).toBe(await w.item(RE.target));
    expect((await document(await w.item(RE.stays)))?.parent_id).toBe(await w.item(RE.keep));

    const labels = await test.database.execute<{ label: string }>(sql`
      select label from page_labels where item_id = ${await w.item(RE.steady)} order by label`);
    expect(labels.rows.map((row) => row.label)).toEqual(["fresh", "stays", "touched"]);

    const comments = await test.database.execute<{ source_id: string }>(sql`
      select i.source_id from import_items i join comments c on c.id = i.target_id
      where i.import_id = ${reimport.id} and i.kind = 'comment' order by i.source_id`);
    expect(comments.rows.map((row) => row.source_id)).toEqual(
      [RE_COMMENT.kept, RE_COMMENT.gone, RE_COMMENT.added].sort(),
    );
    const attachments = await test.database.execute<{ name: string; versions: number }>(sql`
      select a.name, count(v.id)::int as versions from attachments a join attachment_versions v on v.attachment_id = a.id
      join tree_items t on t.id = a.item_id where t.space_id = ${w.spaceId} group by a.name order by a.name`);
    expect(attachments.rows).toEqual([
      { name: "new.txt", versions: 1 },
      { name: "notes.txt", versions: 2 },
    ]);

    expect(await access(w.spaceId)).toEqual(
      [...permissions, ...(await newPageAccess(w.spaceId, [created, child]))].sort(),
    );
    expect(await notifications()).toBe(sent);
  });

  async function newPageAccess(spaceId: string, itemIds: string[]) {
    const all = await access(spaceId);
    return all.filter((entry) => itemIds.some((id) => entry.includes(id)));
  }

  it("gives the same result when the changes are applied twice", async () => {
    const w = await world();
    await editLocally(w);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await decideAll(w, reimport.id);
    await harness.applyChanges(w.admin, reimport.id);
    const once = await snapshot(w.spaceId);
    const permissions = await access(w.spaceId);
    await harness.applyChanges(w.admin, reimport.id);
    expect(await snapshot(w.spaceId)).toEqual(once);
    expect(await access(w.spaceId)).toEqual(permissions);
  });

  it("resumes after a crash in the middle of applying and leaves consistent data", async () => {
    const w = await world();
    await editLocally(w);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await decideAll(w, reimport.id);
    const crashing = harness.worker();
    await test.services.imports.reimports.apply(as(w.admin), reimport.id);
    await test.database.execute(sql`
      create or replace function pagehall_test_crash() returns trigger language plpgsql as $$
      begin raise exception 'simulated crash'; end $$`);
    await test.database.execute(sql`
      create trigger pagehall_test_crash before insert on page_labels
      for each row when (new.label = 'fresh') execute function pagehall_test_crash()`);
    try {
      await expect(harness.drive(reimport.id, crashing)).rejects.toThrow();
    } finally {
      await test.database.execute(sql`drop trigger pagehall_test_crash on page_labels`);
      await test.database.execute(sql`drop function pagehall_test_crash()`);
    }
    const halfway = await test.database.execute<{ applied: number; open: number }>(sql`
      select count(*) filter (where applied_at is not null)::int as applied,
        count(*) filter (where applied_at is null and change = 'labels')::int as open
      from import_changes where import_id = ${reimport.id}`);
    expect(halfway.rows[0]?.applied).toBeGreaterThan(0);
    expect(halfway.rows[0]?.open).toBe(1);
    const created = await harness.target(reimport.id, "page", RE.created);
    expect(created).not.toBe("");
    const labelsBefore = await test.database.execute<{ label: string }>(sql`
      select label from page_labels where item_id = ${await w.item(RE.steady)} order by label`);
    expect(labelsBefore.rows.map((row) => row.label)).toEqual(["dropped", "stays", "touched"]);

    await harness.drive(reimport.id);
    const done = await test.services.imports.get(as(w.admin), reimport.id);
    expect(done.state).toBe("review");
    const labels = await test.database.execute<{ label: string }>(sql`
      select label from page_labels where item_id = ${await w.item(RE.steady)} order by label`);
    expect(labels.rows.map((row) => row.label)).toEqual(["fresh", "stays", "touched"]);
    const titles = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items where space_id = ${w.spaceId} and title = 'Created at the source'`);
    expect(titles.rows[0]?.count).toBe(1);
    expect((await versions(await w.item(RE.sourceOnly))).map((entry) => entry.reason)).toEqual([
      "published",
      "imported",
    ]);
  });

  it("applies once when two nodes apply at the same moment and keeps a decision taken meanwhile", async () => {
    const w = await world();
    await editLocally(w);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await decideAll(w, reimport.id);
    const editing = await idOf(w.admin, reimport.id, "conflicts", await w.item(RE.editing));
    await promote(w);
    const reimports = test.services.imports.reimports;
    await Promise.all([
      reimports.apply(as(w.admin), reimport.id),
      reimports.apply(as(w.otherAdmin), reimport.id),
    ]);
    await Promise.all([
      harness.drive(reimport.id, harness.worker()),
      harness.drive(reimport.id, harness.worker()),
      reimports.decide(as(w.otherAdmin), reimport.id, { ids: [editing], decision: "pagehall" }),
    ]);
    const titles = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items where space_id = ${w.spaceId}
        and title in ('Created at the source', 'Child of the new page')`);
    expect(titles.rows[0]?.count).toBe(2);
    expect((await versions(await w.item(RE.takeSource))).map((entry) => entry.reason)).toEqual([
      "published",
      "imported",
    ]);
    const decided = (await changes(w.admin, reimport.id, "conflicts")).find((entry) => entry.id === editing);
    expect(decided?.decision).toBe("pagehall");
    expect(decided?.decidedBy?.id).toBe(w.otherAdmin);
    if ((await test.services.imports.get(as(w.admin), reimport.id)).state === "review") {
      await harness.applyChanges(w.admin, reimport.id);
    }
    expect((await test.services.imports.get(as(w.admin), reimport.id)).state).toBe("accepted");
  });

  it("holds a page with an open editing session even after the decision to take the source", async () => {
    const w = await world();
    await editLocally(w);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const item = await w.item(RE.editing);
    const id = await idOf(w.admin, reimport.id, "conflicts", item);
    await test.services.imports.reimports.decide(as(w.admin), reimport.id, { ids: [id], decision: "source" });
    await harness.applyChanges(w.admin, reimport.id);
    expect(JSON.stringify((await document(item))?.snapshot)).toContain("Original editing");
    const held = (await changes(w.admin, reimport.id, "conflicts")).find((entry) => entry.id === id);
    expect(held).toMatchObject({ appliedAt: null, editing: true, decision: "source" });
    await closeSession(item);
    await harness.applyChanges(w.admin, reimport.id);
    expect(JSON.stringify((await document(item))?.snapshot)).toContain("Source editing");
  });

  it("turns an update into a conflict when the page is edited after the comparison", async () => {
    const w = await world();
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const item = await w.item(RE.sourceOnly);
    await test.services.documents.replace(as(w.admin), item, paragraph("Edited in between"));
    await harness.applyChanges(w.admin, reimport.id);
    expect(JSON.stringify((await document(item))?.snapshot)).toContain("Edited in between");
    const conflict = (await changes(w.admin, reimport.id, "conflicts")).find(
      (entry) => entry.item?.id === item,
    );
    expect(conflict).toMatchObject({ change: "conflict", reason: "both", appliedAt: null });
  });

  it("evaluates open conflicts again with a newer export and replaces the older re-import", async () => {
    const w = await world();
    await editLocally(w);
    const first = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await decideAll(w, first.id);
    await harness.applyChanges(w.admin, first.id);
    const second = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    expect((await test.services.imports.get(as(w.admin), first.id)).state).toBe("superseded");
    expect(second.counts).toMatchObject({
      new: 0,
      updated: 1,
      conflicts: 1,
      deleted: 0,
      moved: 0,
      movedHere: 0,
      labels: 0,
    });
    expect((await changes(w.admin, second.id, "conflicts")).map((entry) => entry.title)).toEqual([
      "Being edited",
    ]);
    expect((await changes(w.admin, second.id, "permissions")).length).toBeGreaterThan(0);
  });

  it("refuses an export of another space with a clear message and an audit event", async () => {
    const w = await world();
    const id = await harness.analyzedReimport(foreignExport(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const view = await test.services.imports.get(as(w.admin), id);
    expect(view).toMatchObject({ state: "draft", errorCode: "foreignSpace" });
    const events = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_events where name = 'import.reimportRefused' and target_id = ${id}`);
    expect(events.rows[0]?.count).toBe(1);
    await expect(
      test.services.imports.setPeopleSource(as(w.admin), id, { kind: "skip", confirmed: true }),
    ).resolves.toBeDefined();
    await expect(test.services.imports.start(as(w.admin), id)).rejects.toMatchObject({
      code: "importStarted",
    });
  });

  it("refuses a re-import into a space that no import created", async () => {
    const w = await world();
    const space = await test.services.spaces.create(
      as(w.admin),
      w.organizationId,
      {
        name: "Hand made",
        key: `H${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        visibility: "private",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await expect(
      test.services.imports.create(as(w.admin), w.organizationId, {
        source: "confluence-xml",
        spaceId: space.id,
      }),
    ).rejects.toMatchObject({ code: "spaceNotImported" });
  });

  it("hides restricted pages from administrators without access in the change list", async () => {
    const w = await world();
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const restricted = await w.item(RE.restricted);
    await promote(w);
    const reimports = test.services.imports.reimports;
    const summary = await reimports.summary(as(w.otherAdmin), reimport.id);
    expect(summary.hidden).toBeGreaterThan(0);
    for (const tab of ["conflicts", "updates", "deleted", "moved", "permissions"] as const) {
      const entries = await changes(w.otherAdmin, reimport.id, tab);
      expect(JSON.stringify(entries)).not.toContain(restricted);
      expect(JSON.stringify(entries)).not.toContain("Restricted plans");
    }
    const hidden = await test.database.execute<{ id: string }>(sql`
      select id from import_changes where import_id = ${reimport.id} and item_id = ${restricted} limit 1`);
    await expect(
      reimports.decide(as(w.otherAdmin), reimport.id, { ids: [hidden.rows[0]?.id ?? ""], decision: "keep" }),
    ).rejects.toMatchObject({ code: "changeNotFound" });
    await test.database.execute(sql`
      insert into page_shares (id, item_id, principal_kind, principal_id, role, created_by)
      values (gen_random_uuid(), ${restricted}, 'account', ${w.otherAdmin}, 'reader', ${w.admin})`);

    const visible = await changes(w.otherAdmin, reimport.id, "permissions");
    expect(visible.some((entry) => entry.item?.id === restricted)).toBe(true);
  });

  it("never changes permissions itself and applies each difference after showing its effect", async () => {
    const w = await world();
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const before = await access(w.spaceId);
    await harness.applyChanges(w.admin, reimport.id);
    const unchanged = await access(w.spaceId);
    expect(unchanged.filter((entry) => !entry.startsWith("s:"))).toEqual(
      before.filter((entry) => !entry.startsWith("s:")),
    );
    const differences = await changes(w.admin, reimport.id, "permissions");
    const readers = differences.find((entry) => entry.permission?.holder?.kind === "group");
    expect(readers?.permission).toMatchObject({
      scope: "space",
      action: "grant",
      role: "editor",
      applicable: true,
    });
    const reimports = test.services.imports.reimports;
    const impact = await reimports.preview(as(w.admin), reimport.id, readers?.id ?? "");
    expect(impact.space).not.toBeNull();
    await reimports.applyDifference(as(w.admin), reimport.id, readers?.id ?? "");
    const granted = await test.database.execute<{ role: string }>(sql`
      select role::text as role from space_permissions where space_id = ${w.spaceId} and principal_kind = 'group'
        and principal_id = ${w.readers}`);
    expect(granted.rows[0]?.role).toBe("editor");
    const events = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_events where name = 'import.permissionDifferenceApplied'
        and target_id = ${reimport.id}`);
    expect(events.rows[0]?.count).toBe(1);
    const next = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const listed = await changes(w.admin, next.id, "permissions");
    expect(listed.some((entry) => entry.permission?.holder?.kind === "group")).toBe(false);
  });

  it("opens imported pages from old Confluence links and treats hidden pages like unknown ones", async () => {
    const w = await world();
    const links = test.services.imports.links;
    const steady = await w.item(RE.steady);
    for (const url of [
      `https://example.atlassian.net/wiki/spaces/REI/pages/${RE.steady}/Steady`,
      `https://wiki.example.org/pages/viewpage.action?pageId=${RE.steady}`,
      "https://wiki.example.org/display/REI/Steady",
      `https://wiki.example.org/x/${tinyLinkCode(RE.steady)}`,
    ]) {
      expect(await links.resolve(as(w.admin), url)).toMatchObject({
        itemId: steady,
        spaceKey: w.key,
        kind: "page",
      });
    }
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    await harness.applyChanges(w.admin, reimport.id);
    const renamed = await w.item(RE.sourceOnly);
    for (const title of ["Source+only", "Source+only,+renamed"]) {
      expect((await links.resolve(as(w.admin), `https://wiki.example.org/display/REI/${title}`)).itemId).toBe(
        renamed,
      );
    }
    const created = await harness.target(reimport.id, "page", RE.created);
    expect((await links.resolve(as(w.admin), `/pages/viewpage.action?pageId=${RE.created}`)).itemId).toBe(
      created,
    );

    const outsider = await fixtures.member(w.organizationId);
    const failure = async (viewer: string, url: string) => {
      const error = await links.resolve(as(viewer), url).then(
        () => null,
        (caught: unknown) => caught as { code: string; message: string },
      );
      return error ? { code: error.code, message: error.message } : null;
    };
    const unknown = await failure(w.admin, "https://wiki.example.org/pages/viewpage.action?pageId=99999999");
    expect(unknown?.code).toBe("confluenceLinkNotFound");
    expect(
      await failure(w.admin, `https://wiki.example.org/pages/viewpage.action?pageId=${RE.restricted}`),
    ).toEqual(unknown);
    expect(await failure(w.admin, "https://wiki.example.org/display/REI/Restricted+plans")).toEqual(unknown);
    expect(await failure(outsider, `https://wiki.example.org/x/${tinyLinkCode(RE.steady)}`)).toEqual(unknown);
    expect(await failure(w.admin, "not a link")).toEqual(unknown);
  });

  it("lets only people who manage the space start, decide and apply a re-import", async () => {
    const w = await world();
    await expect(
      test.services.imports.create(as(w.otherAdmin), w.organizationId, {
        source: "confluence-xml",
        spaceId: w.spaceId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const reimports = test.services.imports.reimports;
    const deleted = (await changes(w.otherAdmin, reimport.id, "deleted")).find(
      (entry) => entry.change === "deleted",
    );
    await expect(
      reimports.decide(as(w.otherAdmin), reimport.id, { ids: [deleted?.id ?? ""], decision: "trash" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reimports.apply(as(w.otherAdmin), reimport.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await test.services.imports.get(as(w.admin), reimport.id)).state).toBe("review");
  });

  it("changes only pages the applying person may edit", async () => {
    const w = await world();
    const reimport = await harness.reimported(reimportAfter(), {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const restricted = await w.item(RE.restricted);
    await harness.applyChanges(w.admin, reimport.id);
    expect(JSON.stringify((await document(restricted))?.snapshot)).toContain("Secret original");
    expect(await versions(restricted)).toHaveLength(1);
    const open = await test.database.execute<{ change: string }>(sql`
      select change from import_changes where import_id = ${reimport.id} and item_id = ${restricted}
        and applied_at is null and kind = 'page'`);
    expect(open.rows.map((row) => row.change)).toEqual(["updated"]);
  });

  it("holds the source version and new comments of a page restricted further at the source", async () => {
    const w = await world();
    const after = reimportAfter();
    const narrowed = {
      ...after,
      restrictions: [
        ...(after.restrictions ?? []),
        { id: "3961", contentId: RE.sourceOnly, kind: "View" as const, userKey: ALICE.key },
      ],
      comments: [
        ...(after.comments ?? []),
        { id: "3561", pageId: RE.sourceOnly, creatorKey: BOB.key, body: "<p>Confidential remark</p>" },
      ],
    };
    const reimport = await harness.reimported(narrowed, {
      organizationId: w.organizationId,
      admin: w.admin,
      spaceId: w.spaceId,
    });
    const item = await w.item(RE.sourceOnly);
    const conflict = (await changes(w.admin, reimport.id, "conflicts")).find(
      (entry) => entry.item?.id === item,
    );
    expect(conflict).toMatchObject({ change: "conflict", reason: "restricted" });
    const restriction = (await changes(w.admin, reimport.id, "permissions")).find(
      (entry) => entry.item?.id === item && entry.permission?.action === "restrict",
    );
    expect(restriction).toBeDefined();
    await harness.applyChanges(w.admin, reimport.id);
    expect(JSON.stringify((await document(item))?.snapshot)).toContain("Old text");
    const comments = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from comments where item_id = ${item}`,
    );
    expect(comments.rows[0]?.count).toBe(0);
    await test.services.imports.reimports.applyDifference(as(w.admin), reimport.id, restriction?.id ?? "");
    await harness.applyChanges(w.admin, reimport.id).catch(() => undefined);
    const restricted = await test.database.execute<{ kind: string }>(
      sql`select kind::text as kind from page_restrictions where item_id = ${item}`,
    );
    expect(restricted.rows.map((row) => row.kind)).toEqual(["view"]);
  });

  it("records version, checksum and titles of every imported item", async () => {
    const w = await world();
    const baselines = await test.database.execute<{ kind: string; count: number }>(sql`
      select kind, count(*)::int as count from import_baselines where space_id = ${w.spaceId} group by kind order by kind`);
    expect(baselines.rows).toEqual([
      { kind: "page", count: reimportBefore().pages.length },
      { kind: "spacePermission", count: 2 },
    ]);
    const titles = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from import_titles where space_id = ${w.spaceId}`,
    );
    expect(titles.rows[0]?.count).toBe(reimportBefore().pages.length);
  });
});
