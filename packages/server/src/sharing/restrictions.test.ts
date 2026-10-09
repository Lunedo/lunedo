import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(...content: NodeJson[]): NodeJson {
  return { type: "paragraph", content };
}

function text(value: string): NodeJson {
  return { type: "text", text: value };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

describe.skipIf(!baseUrl)("page restrictions", () => {
  let test: TestServices;
  const { organization, member, space, group, deactivate } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const ownerId = await member(org.id, "member", "Owner of the page");
    const insiderId = await member(org.id, "member", "Insider");
    const outsiderId = await member(org.id, "member", "Outsider");
    const adminId = await member(org.id, "member", "Space admin");
    const created = await space(org.id, adminId, {
      grants: [
        { principalKind: "account", principalId: ownerId, role: "editor" },
        { principalKind: "account", principalId: insiderId, role: "editor" },
        { principalKind: "account", principalId: outsiderId, role: "editor" },
      ],
    });
    const owner = accountPrincipal(ownerId);
    const parent = await test.services.tree.create(owner, created.id, {
      kind: "page",
      title: "Salaries 2027",
      mode: "live",
      placement: { parentId: null },
    });
    const child = await test.services.tree.create(owner, created.id, {
      kind: "page",
      title: "Bonus plan",
      mode: "live",
      placement: { parentId: parent.id },
    });
    await test.services.pageAccess.change(owner, parent.id, [
      { action: "share", holderKind: "account", holderId: insiderId, role: "editor" },
      { action: "restrict", kind: "view" },
    ]);
    return {
      org,
      space: created,
      parent,
      child,
      ownerId,
      insiderId,
      outsiderId,
      adminId,
      owner,
      insider: accountPrincipal(insiderId),
      outsider: accountPrincipal(outsiderId),
      admin: accountPrincipal(adminId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function can(viewer: Principal, action: string, resource: { type: string; id: string }) {
    return (await test.services.authorization.explain(viewer, action, resource, { fresh: true })).allowed;
  }

  async function titles(viewer: Principal, context: Context, parentId: string | null = null) {
    return (await test.services.tree.children(viewer, context.space.id, parentId)).items.map(
      (item) => item.title,
    );
  }

  async function openPage(context: Context, title: string, content: DocumentJson) {
    return test.services.tree.create(context.owner, context.space.id, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId: null },
      document: content,
    });
  }

  it("hides the page and its descendants from people without access, including space admins", async () => {
    const context = await setup();
    for (const viewer of [context.outsider, context.admin]) {
      expect(await can(viewer, "item.view", { type: "item", id: context.parent.id })).toBe(false);
      expect(await can(viewer, "item.view", { type: "item", id: context.child.id })).toBe(false);
      expect(await can(viewer, "item.edit", { type: "item", id: context.child.id })).toBe(false);
    }
    expect(await can(context.insider, "item.view", { type: "item", id: context.child.id })).toBe(true);
    expect(await can(context.owner, "item.edit", { type: "item", id: context.child.id })).toBe(true);
  });

  it("is missing from the tree for people without access", async () => {
    const context = await setup();
    expect(await titles(context.outsider, context)).not.toContain("Salaries 2027");
    expect(await titles(context.admin, context)).not.toContain("Salaries 2027");
    expect(await titles(context.insider, context)).toContain("Salaries 2027");
    expect(await titles(context.outsider, context, context.parent.id)).toEqual([]);
    const listed = (await test.services.tree.children(context.insider, context.space.id, null)).items.find(
      (item) => item.id === context.parent.id,
    );
    expect(listed).toMatchObject({ hasChildren: true, viewRestriction: "own" });
  });

  it("does not count a restricted child as a child of a visible page", async () => {
    const context = await setup();
    const open = await openPage(context, "Team", doc(paragraph(text("x"))));
    const hidden = await test.services.tree.create(context.owner, context.space.id, {
      kind: "page",
      title: "Hidden child",
      mode: "live",
      placement: { parentId: open.id },
    });
    await test.services.pageAccess.change(context.owner, hidden.id, [{ action: "restrict", kind: "view" }]);
    const row = (await test.services.tree.children(context.outsider, context.space.id, null)).items.find(
      (item) => item.id === open.id,
    );
    expect(row?.hasChildren).toBe(false);
  });

  it("hides the title in links of the page tree", async () => {
    const context = await setup();
    const link = await test.services.tree.create(context.owner, context.space.id, {
      kind: "link",
      title: "Shortcut to salaries",
      placement: { parentId: null },
      link: { itemId: context.child.id },
    });
    const seen = (await test.services.tree.children(context.outsider, context.space.id, null)).items.find(
      (item) => item.id === link.id,
    );
    expect(seen?.link).toMatchObject({ accessible: false, itemId: null, target: null });
    expect(seen?.title).toBe("");
  });

  it("hides the title in page links inside content", async () => {
    const context = await setup();
    const references = await test.services.documents.references(
      context.outsider,
      doc(paragraph({ type: "pageLink", attrs: { pageId: context.child.id } })),
    );
    expect(references.pages[context.child.id]).toMatchObject({ accessible: false, title: "" });
    const visible = await test.services.documents.references(
      context.insider,
      doc(paragraph({ type: "pageLink", attrs: { pageId: context.child.id } })),
    );
    expect(visible.pages[context.child.id]).toMatchObject({ accessible: true, title: "Bonus plan" });
  });

  it("leaves restricted pages out of backlinks", async () => {
    const context = await setup();
    const target = await openPage(context, "Glossary", doc(paragraph(text("terms"))));
    await test.services.documents.replace(
      context.owner,
      context.child.id,
      doc(paragraph({ type: "pageLink", attrs: { pageId: target.id } })),
    );
    expect(
      (await test.services.documents.backlinks(context.insider, target.id)).map((link) => link.title),
    ).toEqual(["Bonus plan"]);
    expect(await test.services.documents.backlinks(context.outsider, target.id)).toEqual([]);
  });

  it("leaves restricted ancestors out of breadcrumbs only when they are hidden", async () => {
    const context = await setup();
    const details = await test.services.tree.details(context.insider, context.child.id);
    expect(details?.ancestors.map((ancestor) => ancestor.title)).toEqual(["Salaries 2027"]);
  });

  it("leaves labels of restricted pages out of suggestions and label pages", async () => {
    const context = await setup();
    const label = `secret-${randomUUID().slice(0, 6)}`;
    await test.services.documents.addLabel(context.owner, context.child.id, label);
    expect(await test.services.documents.labelSuggestions(context.outsider, context.space.id, label)).toEqual(
      [],
    );
    expect(await test.services.documents.pagesWithLabel(context.outsider, context.space.id, label)).toEqual(
      [],
    );
    expect(await test.services.documents.labelSuggestions(context.insider, context.space.id, label)).toEqual([
      label,
    ]);
  });

  it("hides comments and refuses to show a comment by its ID", async () => {
    const context = await setup();
    const commentId = await test.services.comments.create(context.owner, context.child.id, {
      body: doc(paragraph(text("Only for the board"))),
    });
    expect(await can(context.outsider, "comment.view", { type: "comment", id: commentId })).toBe(false);
    expect(await can(context.insider, "comment.view", { type: "comment", id: commentId })).toBe(true);
  });

  it("hides tasks and leaves them out of My tasks", async () => {
    const context = await setup();
    const taskId = randomUUID();
    await test.services.documents.replace(
      context.owner,
      context.child.id,
      doc({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { id: taskId, assignee: context.outsiderId },
            content: [paragraph(text("Review the bonus plan"))],
          },
        ],
      }),
    );
    const tasks = await test.services.tasks.list(context.outsider, { assignee: "me" });
    expect(tasks.items.map((task) => task.text)).not.toContain("Review the bonus plan");
    const stored = await test.pool.query<{ id: string }>("select id from tasks where item_id = $1", [
      context.child.id,
    ]);
    for (const row of stored.rows) {
      expect(await can(context.outsider, "task.view", { type: "task", id: row.id })).toBe(false);
    }
  });

  it("sends no notification about a restricted page and hides earlier ones", async () => {
    const context = await setup();
    await test.services.documents.replace(
      context.owner,
      context.child.id,
      doc(paragraph({ type: "mention", attrs: { id: context.outsiderId } })),
    );
    const open = await openPage(context, "Announcement", doc(paragraph(text("draft"))));
    await test.services.documents.replace(
      context.owner,
      open.id,
      doc(paragraph({ type: "mention", attrs: { id: context.outsiderId } })),
    );
    const before = await test.services.notifications.list(context.outsiderId, { limit: 50 });
    expect(before.items.map((item) => item.target.id)).toEqual([open.id]);
    await test.services.pageAccess.change(context.owner, open.id, [{ action: "restrict", kind: "view" }]);
    const after = await test.services.notifications.list(context.outsiderId, { limit: 50 });
    expect(after.items).toEqual([]);
  });

  it("leaves restricted pages off home pages", async () => {
    const context = await setup();
    await test.services.home.recordView(context.outsider, context.child.id);
    await test.services.home.star(context.outsider, { itemId: context.child.id }, true);
    expect((await test.services.home.recent(context.outsider)).map((entry) => entry.id)).not.toContain(
      context.child.id,
    );
    expect((await test.services.home.starred(context.outsider)).items.map((entry) => entry.id)).not.toContain(
      context.child.id,
    );
    await test.services.home.setOrganizationHomePage(context.owner, context.org.id, context.parent.id);
    expect(await test.services.home.organizationHomePage(context.outsider, context.org.id)).toBeNull();
    expect((await test.services.home.organizationHomePage(context.insider, context.org.id))?.title).toBe(
      "Salaries 2027",
    );
  });

  it("is missing from the title search and from following a link by title", async () => {
    const context = await setup();
    const found = await test.services.tree.search(context.outsider, {
      query: "Bonus plan",
      spaceId: context.space.id,
    });
    expect(found).toEqual([]);
    const source = await openPage(context, "Links", doc(paragraph(text("x"))));
    const followed = await test.services.tree.followTitleLink(context.outsider, source.id, {
      spaceId: context.space.id,
      title: "Bonus plan",
    });
    expect(followed.itemId).not.toBe(context.child.id);
  });

  it("is missing from the trash and the archive for people without access", async () => {
    const context = await setup();
    const archived = await test.services.tree.create(context.owner, context.space.id, {
      kind: "page",
      title: "Archived salaries",
      mode: "live",
      placement: { parentId: context.parent.id },
    });
    await test.services.archive.archive(context.owner, archived.id);
    expect(
      (await test.services.archive.list(context.outsider, context.space.id)).map((item) => item.id),
    ).not.toContain(archived.id);
    const entry = await test.services.trash.deleteItem(context.owner, context.child.id);
    expect(
      (await test.services.trash.listSpace(context.outsider, context.space.id)).map((item) => item.id),
    ).not.toContain(entry.id);
    expect(await test.services.trash.accessible(context.outsider, entry.id)).toBe(false);
    expect(
      (await test.services.trash.listSpace(context.owner, context.space.id)).map((item) => item.id),
    ).toContain(entry.id);
  });

  it("refuses to create a child below a page the editor cannot see", async () => {
    const context = await setup();
    await expect(
      test.services.tree.create(context.outsider, context.space.id, {
        kind: "page",
        title: "Probe",
        placement: { parentId: context.parent.id },
      }),
    ).rejects.toMatchObject({ code: "invalidPlacement" });
  });

  it("limits editing to people with edit access on the list", async () => {
    const context = await setup();
    const open = await openPage(context, "Policy", doc(paragraph(text("rules"))));
    await test.services.pageAccess.change(context.owner, open.id, [
      { action: "share", holderKind: "account", holderId: context.insiderId, role: "reader" },
      { action: "restrict", kind: "edit" },
    ]);
    expect(await can(context.outsider, "item.view", { type: "item", id: open.id })).toBe(true);
    expect(await can(context.outsider, "item.edit", { type: "item", id: open.id })).toBe(false);
    expect(await can(context.insider, "item.edit", { type: "item", id: open.id })).toBe(false);
    expect(await can(context.owner, "item.edit", { type: "item", id: open.id })).toBe(true);
    expect(await can(context.outsider, "item.comment", { type: "item", id: open.id })).toBe(true);
  });

  it("applies to group members on the list and only narrows access", async () => {
    const context = await setup();
    const reader = await member(context.org.id, "member", "Group reader");
    const groupId = await group(context.org.id, [reader]);
    await test.services.pageAccess.change(context.owner, context.parent.id, [
      { action: "share", holderKind: "group", holderId: groupId, role: "reader" },
    ]);
    const viewer = accountPrincipal(reader);
    expect(await can(viewer, "item.view", { type: "item", id: context.parent.id })).toBe(true);
    expect(await can(viewer, "item.view", { type: "item", id: context.child.id })).toBe(false);
    const share = (await test.services.pageAccess.get(context.owner, context.parent.id)).shares.find(
      (entry) => entry.holder.id === groupId,
    );
    await test.services.pageAccess.change(context.owner, context.parent.id, [
      { action: "changeShare", shareId: share?.id ?? "", includeDescendants: true },
    ]);
    expect(await can(viewer, "item.view", { type: "item", id: context.child.id })).toBe(true);
    expect(await can(viewer, "item.edit", { type: "item", id: context.child.id })).toBe(false);
    const memberInSpace = await member(context.org.id, "member", "Space reader");
    await test.services.spacePermissions.apply(context.admin, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: memberInSpace,
      role: "editor",
    });
    expect(
      await can(accountPrincipal(memberInSpace), "item.view", { type: "item", id: context.parent.id }),
    ).toBe(false);
  });

  it("keeps a restricted page from losing its last viewer", async () => {
    const context = await setup();
    const access = await test.services.pageAccess.get(context.owner, context.parent.id);
    await expect(
      test.services.pageAccess.change(
        context.owner,
        context.parent.id,
        access.shares.map((share) => ({ action: "removeShare" as const, shareId: share.id })),
      ),
    ).rejects.toMatchObject({ code: "restrictionWithoutViewers" });
  });

  it("lists restricted pages for space admins, who can remove restrictions without reading", async () => {
    const context = await setup();
    const listed = await test.services.pageAccess.restrictedPages(context.space.id);
    expect(listed.map((page) => [page.title, page.view !== null])).toEqual([["Salaries 2027", true]]);
    await expect(
      test.services.pageAccess.removeRestrictionAsAdministrator(
        context.outsider,
        context.space.id,
        context.parent.id,
        "view",
      ),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    await test.services.pageAccess.removeRestrictionAsAdministrator(
      context.admin,
      context.space.id,
      context.parent.id,
      "view",
    );
    expect(await can(context.outsider, "item.view", { type: "item", id: context.child.id })).toBe(true);
    const audit = await test.pool.query<{ fields: { byAdministrator: boolean } }>(
      "select fields from audit_events where name = 'page.restrictionRemoved' and target_id = $1",
      [context.parent.id],
    );
    expect(audit.rows.map((row) => row.fields.byAdministrator)).toEqual([true]);
  });

  it("marks the page and notifies space admins when every person on the list is deactivated", async () => {
    const context = await setup();
    await test.services.memberships.deactivate(context.admin, context.insiderId).catch(async () => {
      await test.services.memberships.deactivate({ type: "system" }, context.insiderId);
    });
    let listed = await test.services.pageAccess.restrictedPages(context.space.id);
    expect(listed[0]?.orphaned).toBe(false);
    await test.services.memberships.deactivate({ type: "system" }, context.ownerId);
    listed = await test.services.pageAccess.restrictedPages(context.space.id);
    expect(listed[0]?.orphaned).toBe(true);
    const notifications = await test.services.notifications.list(context.adminId, { limit: 20 });
    expect(notifications.items.map((item) => item.type)).toContain("restriction.orphaned");
  });

  it("does not react to time but to the deactivation itself", async () => {
    const context = await setup();
    await deactivate(context.insiderId);
    await deactivate(context.ownerId);
    const listed = await test.services.pageAccess.restrictedPages(context.space.id);
    expect(listed[0]?.orphaned).toBe(false);
  });
});
