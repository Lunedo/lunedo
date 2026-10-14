import { randomUUID } from "node:crypto";
import type { DocumentJson } from "@pagehall/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { searchRequest } from "./search.testing.js";
import type { SearchRequest } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

function body(text: string): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe.skipIf(!baseUrl)("search index updates", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function drain() {
    return test.services.search.indexer.drain();
  }

  async function setup(options: { visibility?: "private" | "organization" } = {}) {
    const org = await fixtures.organization();
    const editorId = await fixtures.member(org.id, "member", "Editor");
    const readerId = await fixtures.member(org.id, "member", "Reader");
    const guestId = await fixtures.member(org.id, "guest", "Guest");
    const groupId = await fixtures.group(org.id, [readerId]);
    const space = await fixtures.space(org.id, editorId, {
      visibility: options.visibility ?? "private",
      grants: [{ principalKind: "group", principalId: groupId, role: "reader" }],
    });
    const editor = accountPrincipal(editorId);
    const word = `w${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const page = async (
      title: string,
      text: string,
      parentId: string | null = null,
      mode: "live" | "publish" = "live",
    ) =>
      test.services.tree.create(editor, space.id, {
        kind: "page",
        title,
        mode,
        placement: { parentId },
        document: body(text),
      });
    return {
      org,
      space,
      editor,
      editorId,
      reader: accountPrincipal(readerId),
      readerId,
      guest: accountPrincipal(guestId),
      guestId,
      groupId,
      word,
      page,
    };
  }

  async function titles(
    viewer: Principal,
    organizationId: string,
    query: string,
    overrides: Partial<SearchRequest> = {},
  ) {
    const result = await test.services.search.search(viewer, organizationId, searchRequest(query, overrides));
    return result.results.map((hit) => hit.title);
  }

  it("indexes the published version only and never the draft", async () => {
    const context = await setup();
    const created = await context.page("Release notes", `first ${context.word}`, null, "publish");
    await drain();
    expect(await titles(context.editor, context.org.id, context.word)).toEqual([]);
    await test.services.versions.publish(context.editor, created.id);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Release notes"]);
    await test.services.documents.replace(context.editor, created.id, body(`draft only ${context.word}x`));
    await drain();
    expect(await titles(context.editor, context.org.id, `${context.word}x`)).toEqual([]);
    await test.services.versions.publish(context.editor, created.id);
    await drain();
    expect(await titles(context.reader, context.org.id, `${context.word}x`)).toEqual(["Release notes"]);
    expect(await titles(context.reader, context.org.id, `first ${context.word}`)).toEqual([]);
  });

  it("indexes saves of live pages once they settle and coalesces repeated saves", async () => {
    const context = await setup();
    const created = await context.page("Runbook", "nothing yet");
    await drain();
    await test.services.documents.replace(context.editor, created.id, body(`step ${context.word}`));
    await test.services.documents.replace(context.editor, created.id, body(`steps ${context.word}`));
    const pending = await test.pool.query<{ generation: string; delayed: boolean }>(
      "select generation, due_at > now() as delayed from search_pending_items where item_id = $1",
      [created.id],
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]?.delayed).toBe(true);
    const early = await drain();
    expect(early.nextDueAt).not.toBeNull();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await test.pool.query("update search_pending_items set due_at = now() where item_id = $1", [created.id]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Runbook"]);
  });

  it("follows title, label and comment changes", async () => {
    const context = await setup();
    const created = await context.page("Old title", "body");
    await drain();
    await test.services.tree.update(context.editor, created.id, { title: `New ${context.word}` });
    await test.services.documents.addLabel(context.editor, created.id, `label-${context.word}`);
    await test.pool.query("insert into comments (id, item_id, author_id, body) values ($1, $2, $3, $4)", [
      randomUUID(),
      created.id,
      context.editorId,
      body(`comment ${context.word}c`),
    ]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([`New ${context.word}`]);
    expect(
      await titles(context.reader, context.org.id, `label:label-${context.word}`, { contentTypes: ["page"] }),
    ).toEqual([`New ${context.word}`]);
    const comments = await test.services.search.search(
      context.reader,
      context.org.id,
      searchRequest(`${context.word}c`),
    );
    expect(comments.results.map((hit) => [hit.type, hit.itemId])).toEqual([["comment", created.id]]);
  });

  it("hides a page at once when it gets a view restriction and shows it again after the update", async () => {
    const context = await setup();
    const created = await context.page("Salaries", context.word);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Salaries"]);
    await test.services.pageAccess.change(context.editor, created.id, [{ action: "restrict", kind: "view" }]);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    expect(await titles(context.editor, context.org.id, context.word)).toEqual(["Salaries"]);
    await test.services.pageAccess.change(context.editor, created.id, [
      { action: "unrestrict", kind: "view" },
    ]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Salaries"]);
  });

  it("hides a page at once when it moves below a restricted page", async () => {
    const context = await setup();
    const restricted = await context.page("Board", "board");
    await test.services.pageAccess.change(context.editor, restricted.id, [
      { action: "restrict", kind: "view" },
    ]);
    const moving = await context.page("Plans", context.word);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Plans"]);
    const impact = await test.services.tree.moveImpact(context.editor, moving.id, {
      parentId: restricted.id,
    });
    await test.services.tree.move(context.editor, moving.id, {
      parentId: restricted.id,
      confirmation: impact.confirmation ?? "",
    });
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    expect(await titles(context.editor, context.org.id, context.word)).toEqual(["Plans"]);
  });

  it("checks a page against its new space at once when it moves to another space", async () => {
    const context = await setup();
    const target = await fixtures.space(context.org.id, context.editorId, { visibility: "private" });
    const moving = await context.page("Roadmap", context.word);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Roadmap"]);
    const impact = await test.services.tree.moveImpact(context.editor, moving.id, {
      spaceId: target.id,
      parentId: null,
    });
    await test.services.tree.move(context.editor, moving.id, {
      spaceId: target.id,
      parentId: null,
      confirmation: impact.confirmation ?? "",
    });
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await test.pool.query("delete from search_pending_spaces where space_id = any($1::uuid[])", [
      [context.space.id, target.id],
    ]);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    expect(await titles(context.editor, context.org.id, context.word, { spaceIds: [target.id] })).toEqual([
      "Roadmap",
    ]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    expect(await titles(context.editor, context.org.id, context.word)).toEqual(["Roadmap"]);
  });

  it("follows shares and drops a removed share at once", async () => {
    const context = await setup();
    const parent = await context.page("Handbook", `${context.word} parent`);
    const child = await context.page("Travel", `${context.word} child`, parent.id);
    await drain();
    expect(await titles(context.guest, context.org.id, context.word)).toEqual([]);
    await test.services.pageAccess.change(context.editor, parent.id, [
      {
        action: "share",
        holderKind: "account",
        holderId: context.guestId,
        role: "reader",
        includeDescendants: true,
      },
    ]);
    await drain();
    const shared = await test.services.search.search(
      context.guest,
      context.org.id,
      searchRequest(context.word),
    );
    expect(shared.results.map((hit) => hit.title).sort()).toEqual(["Handbook", "Travel"]);
    for (const hit of shared.results) {
      expect(hit).toMatchObject({ sharedWithYou: true, space: null, path: [] });
    }
    expect(shared.facets?.spaces).toEqual([{ value: null, count: 2, key: null, name: null }]);
    const share = await test.pool.query<{ id: string }>("select id from page_shares where item_id = $1", [
      parent.id,
    ]);
    await test.services.pageAccess.change(context.editor, parent.id, [
      { action: "removeShare", shareId: share.rows[0]?.id ?? "" },
    ]);
    expect(await titles(context.guest, context.org.id, context.word)).toEqual([]);
    expect(child.id).toBeTruthy();
  });

  it("drops access at once when a space permission, a group membership or an organization membership ends", async () => {
    const context = await setup();
    await context.page("Roadmap", context.word);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Roadmap"]);
    await test.services.groups.removeMember(SYSTEM, context.groupId, context.readerId);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await test.services.groups.addMember(SYSTEM, context.groupId, context.readerId);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Roadmap"]);
    await test.pool.query("delete from space_permissions where space_id = $1 and principal_kind = 'group'", [
      context.space.id,
    ]);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);

    const other = await setup({ visibility: "organization" });
    await other.page("Wiki home", other.word);
    await drain();
    expect(await titles(other.reader, other.org.id, other.word)).toEqual(["Wiki home"]);
    await test.services.memberships.remove(SYSTEM, other.org.id, other.readerId, "removed", {
      releaseHome: true,
    });
    expect(await titles(other.reader, other.org.id, other.word)).toEqual([]);
  });

  it("finds nothing for a deactivated account", async () => {
    const context = await setup({ visibility: "organization" });
    await context.page("Office", context.word);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual(["Office"]);
    await fixtures.deactivate(context.readerId);
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
  });

  it("removes trashed pages at once, puts restored pages back and forgets permanently deleted pages", async () => {
    const context = await setup();
    const created = await context.page("Expenses", context.word);
    await drain();
    const entry = await test.services.trash.deleteItem(context.editor, created.id);
    expect(await titles(context.editor, context.org.id, context.word)).toEqual([]);
    await drain();
    const left = await test.pool.query(
      "select count(*)::int as count from search_chunks where item_id = $1",
      [created.id],
    );
    expect(left.rows[0]?.count).toBe(0);
    await test.services.trash.restore(context.editor, entry.id);
    await drain();
    expect(await titles(context.editor, context.org.id, context.word)).toEqual(["Expenses"]);
    const again = await test.services.trash.deleteItem(context.editor, created.id);
    await drain();
    await test.services.trash.deleteImmediately(
      accountPrincipal(context.org.owner),
      again.id,
      "Legal erasure request",
    );
    await drain();
    expect(await titles(context.editor, context.org.id, context.word)).toEqual([]);
    const pending = await test.pool.query(
      "select count(*)::int as count from search_pending_items where item_id = $1",
      [created.id],
    );
    expect(pending.rows[0]?.count).toBe(0);
  });

  it("hides archived pages unless archived content is included", async () => {
    const context = await setup();
    const created = await context.page("Old process", context.word);
    await drain();
    await test.services.archive.archive(context.editor, created.id);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([]);
    const included = await test.services.search.search(
      context.reader,
      context.org.id,
      searchRequest(context.word, { includeArchived: true }),
    );
    expect(included.results.map((hit) => [hit.title, hit.archived])).toEqual([["Old process", true]]);
  });

  it("hides a deleted space at once", async () => {
    const context = await setup();
    await context.page("Team page", context.word);
    await drain();
    await test.services.trash.deleteSpace(context.editor, context.space.id, context.space.name);
    expect(await titles(context.editor, context.org.id, context.word)).toEqual([]);
    await drain();
    expect(await titles(context.editor, context.org.id, context.word)).toEqual([]);
  });

  it("keeps confidential spaces from organization administrators", async () => {
    const context = await setup();
    const administratorId = await fixtures.member(context.org.id, "member", "Administrator");
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: context.org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administratorId },
    });
    const confidential = await test.services.spaces.create(
      context.editor,
      context.org.id,
      {
        name: "One on one",
        key: `C${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`,
        visibility: "private",
        grants: [],
        confidential: true,
      },
      test.services.spacePermissions.holders,
    );
    await test.services.tree.create(context.editor, confidential.id, {
      kind: "page",
      title: "Feedback",
      mode: "live",
      placement: { parentId: null },
      document: body(context.word),
    });
    await drain();
    expect(await titles(context.editor, context.org.id, context.word)).toEqual(["Feedback"]);
    expect(await titles(accountPrincipal(administratorId), context.org.id, context.word)).toEqual([]);
  });

  it("picks up content written directly to the tables, as imports do", async () => {
    const context = await setup();
    const created = await context.page("Imported", "placeholder");
    await drain();
    await test.pool.query("update tree_items set title = $1 where id = $2", [
      `Imported ${context.word}`,
      created.id,
    ]);
    await drain();
    expect(await titles(context.reader, context.org.id, context.word)).toEqual([`Imported ${context.word}`]);
  });
});
