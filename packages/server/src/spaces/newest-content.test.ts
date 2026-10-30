import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("newest content of a space", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function world() {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const outsiderId = await member(org.id, "member", "Outsider");
    const editor = accountPrincipal(editorId);
    const reader = accountPrincipal(readerId);
    const outsider = accountPrincipal(outsiderId);
    const shared = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    const closed = await space(org.id, editorId);
    const add = async (
      spaceId: string,
      title: string,
      options: { kind?: "page" | "blogPost"; mode?: "live" | "publish"; ageDays?: number } = {},
    ) => {
      const created =
        options.kind === "blogPost"
          ? await test.services.blog.create(editor, spaceId, { title })
          : await test.services.tree.create(editor, spaceId, {
              kind: "page",
              title,
              mode: options.mode ?? "live",
              placement: { parentId: null },
            });
      if (options.kind === "blogPost") await test.services.versions.publish(editor, created.id);
      await test.database.execute(sql`
        update tree_items set content_updated_at = now() - make_interval(days => ${options.ageDays ?? 0})
        where id = ${created.id}`);
      return created.id;
    };
    const titles = async (viewer: typeof editor, spaceId: string, limit = 20) =>
      (await test.services.reports.newestContent(viewer, { spaceId, limit })).map((item) => item.title);
    return { org, editorId, outsiderId, editor, reader, outsider, shared, closed, add, titles };
  }

  it("lists pages and blog posts newest first with author and address", async () => {
    const w = await world();
    await w.add(w.shared.id, "Old page", { ageDays: 5 });
    const post = await w.add(w.shared.id, "Fresh post", { kind: "blogPost", ageDays: 1 });
    await w.add(w.shared.id, "Middle page", { ageDays: 3 });
    const list = await test.services.reports.newestContent(w.reader, { spaceId: w.shared.id, limit: 20 });
    expect(list.map((item) => item.title)).toEqual([w.shared.name, "Fresh post", "Middle page", "Old page"]);
    const fresh = list.find((item) => item.id === post);
    const number = await test.database.execute<{ number: string }>(
      sql`select number from tree_items where id = ${post}`,
    );
    expect(fresh).toMatchObject({
      kind: "blogPost",
      path: `/spaces/${w.shared.key}/blog/${number.rows[0]?.number}/fresh-post`,
      author: { id: w.editorId, name: "Editor" },
    });
    expect(fresh?.contentUpdatedAt).toBeInstanceOf(Date);
  });

  it("limits the list and never returns more than the maximum", async () => {
    const w = await world();
    for (const title of ["One", "Two", "Three"]) await w.add(w.shared.id, title, { ageDays: 1 });
    expect(await w.titles(w.reader, w.shared.id, 2)).toHaveLength(2);
    expect(await w.titles(w.reader, w.shared.id, 0)).toHaveLength(1);
    expect(await w.titles(w.reader, w.shared.id, 10_000)).toHaveLength(4);
  });

  it("leaves out pages with a view restriction for readers who are not listed", async () => {
    const w = await world();
    await w.add(w.shared.id, "Open page", { ageDays: 1 });
    const secret = await w.add(w.shared.id, "Secret plan", { ageDays: 1 });
    const secretChild = await w.add(w.shared.id, "Secret child", { ageDays: 1 });
    await test.database.execute(sql`update tree_items set parent_id = ${secret} where id = ${secretChild}`);
    await test.services.pageAccess.change(w.editor, secret, [{ action: "restrict", kind: "view" }]);
    const readable = await w.titles(w.reader, w.shared.id);
    expect(readable).toContain("Open page");
    expect(readable).not.toContain("Secret plan");
    expect(readable).not.toContain("Secret child");
    expect(await w.titles(w.editor, w.shared.id)).toEqual(
      expect.arrayContaining(["Secret plan", "Secret child"]),
    );
  });

  it("hides the pages of a private space from people without access", async () => {
    const w = await world();
    await w.add(w.closed.id, "Closed page");
    expect(await w.titles(w.outsider, w.closed.id)).toEqual([]);
    expect(await w.titles(w.reader, w.closed.id)).toEqual([]);
    expect(await w.titles(w.editor, w.closed.id)).toContain("Closed page");
  });

  it("shows only the pages shared with the viewer in a space the viewer cannot read", async () => {
    const w = await world();
    await w.add(w.closed.id, "Closed page");
    const sharedPage = await w.add(w.closed.id, "Shared page");
    await test.services.pageAccess.change(w.editor, sharedPage, [
      {
        action: "share",
        holderKind: "account",
        holderId: w.outsiderId,
        role: "reader",
        includeDescendants: false,
      },
    ]);
    expect(await w.titles(w.outsider, w.closed.id)).toEqual(["Shared page"]);
  });

  it("hides unpublished drafts from readers but not from editors", async () => {
    const w = await world();
    await w.add(w.shared.id, "Unpublished draft", { mode: "publish" });
    expect(await w.titles(w.reader, w.shared.id)).not.toContain("Unpublished draft");
    expect(await w.titles(w.editor, w.shared.id)).toContain("Unpublished draft");
  });

  it("leaves out archived and deleted content and content of other spaces", async () => {
    const w = await world();
    const archived = await w.add(w.shared.id, "Archived page");
    const trashed = await w.add(w.shared.id, "Deleted page");
    await w.add(w.closed.id, "Page elsewhere");
    await test.services.archive.archive(w.editor, archived);
    await test.services.trash.deleteItem(w.editor, trashed);
    const titles = await w.titles(w.editor, w.shared.id);
    expect(titles).toEqual([w.shared.name]);
  });

  it("is backed by an index on the space and the last change", async () => {
    const index = await test.database.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where tablename = 'tree_items' and indexname = 'tree_items_newest_index'`);
    expect(index.rows[0]?.indexdef).toMatch(/\(space_id, content_updated_at DESC, id DESC\)/);
  });
});
