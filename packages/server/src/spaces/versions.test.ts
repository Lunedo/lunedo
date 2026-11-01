import { type DocumentJson, editorSchemaVersion } from "@lunedo/editor-schema";
import { applyDocument } from "@lunedo/editor-schema/yjs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { liveVersionIdleMinutesSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function documentWith(...blocks: unknown[]) {
  return { type: "doc", content: blocks };
}

function linkTo(pageId: string) {
  return {
    type: "paragraph",
    content: [{ type: "pageLink", attrs: { pageId, spaceId: null, title: null } }],
  };
}

describe.skipIf(!baseUrl)("publish and live modes with versions", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id);
    const readerId = await member(org.id);
    const created = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    return {
      org,
      editorId,
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      space: created,
    };
  }

  async function publishedPage(context: Awaited<ReturnType<typeof setup>>, title: string, text: string) {
    const page = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title,
      mode: "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph(text)));
    await test.services.versions.publish(context.editor, page.id);
    return page;
  }

  it("keeps a draft note only with the draft it was written for", async () => {
    const context = await setup();
    const page = await publishedPage(context, "Notiz", "Erste Fassung");
    const draftNote = async (note: string | null) => {
      await test.pool.query("update page_documents set draft_note = $1 where item_id = $2", [note, page.id]);
    };
    const noteOf = async (number: number) => {
      const found = await test.pool.query<{ note: string | null }>(
        "select note from page_versions where item_id = $1 and number = $2",
        [page.id, number],
      );
      return found.rows[0]?.note ?? "";
    };
    await test.services.documents.replace(
      context.editor,
      page.id,
      documentWith(paragraph("Vom Assistenten")),
    );
    await draftNote("Geprüft von Anna Huber");
    await test.services.versions.discard(context.editor, page.id);
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Tippfehler")));
    const afterDiscard = await test.services.versions.publish(context.editor, page.id);
    expect(await noteOf(afterDiscard.version)).toBe("");
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Wieder")));
    await draftNote("Geprüft von Anna Huber");
    await test.services.versions.restore(context.editor, page.id, 1);
    const afterRestore = await test.services.versions.publish(context.editor, page.id);
    expect(await noteOf(afterRestore.version)).toBe("");
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Geplant")));
    await draftNote("Geprüft von Anna Huber");
    const published = await test.services.versions.publish(context.editor, page.id, { note: "Eigene Notiz" });
    expect(await noteOf(published.version)).toBe("Eigene Notiz");
    const left = await test.pool.query<{ draft_note: string | null }>(
      "select draft_note from page_documents where item_id = $1",
      [page.id],
    );
    expect(left.rows[0]?.draft_note).toBeNull();
  });

  it("keeps a page without draft changes when the editor only adds an empty paragraph at the end on opening", async () => {
    const context = await setup();
    const page = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: "Tabelle",
      mode: "publish",
      placement: { parentId: null },
    });
    const table = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Zelle")] }] }],
    };
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Oben"), table));
    await test.services.versions.publish(context.editor, page.id);
    const before = await test.services.versions.draft(page.id);
    expect(before.hasChanges).toBe(false);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await test.services.documents.state(page.id)) ?? new Uint8Array());
    applyDocument(doc, documentWith(paragraph("Oben"), table, { type: "paragraph" }));
    const revision = await test.services.documents.store(page.id, doc, { actorId: context.editorId });
    expect(revision).toBe(before.revision);
    expect(await test.services.versions.draft(page.id)).toMatchObject({ hasChanges: false, changes: 0 });
    const typed = new Y.Doc();
    Y.applyUpdate(typed, (await test.services.documents.state(page.id)) ?? new Uint8Array());
    applyDocument(typed, documentWith(paragraph("Oben"), table, paragraph("Neu")));
    expect(await test.services.documents.store(page.id, typed, { actorId: context.editorId })).toBe(
      before.revision + 1,
    );
    expect((await test.services.versions.draft(page.id)).hasChanges).toBe(true);
  });

  describe("readers never see the draft", () => {
    it("hides a new page in publish mode from readers until its first publication", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Secret plan",
        mode: "publish",
        placement: { parentId: null },
      });
      const readerTree = await test.services.tree.children(context.reader, context.space.id, null);
      expect(readerTree.items.map((item) => item.id)).not.toContain(page.id);
      const editorTree = await test.services.tree.children(context.editor, context.space.id, null);
      expect(editorTree.items.find((item) => item.id === page.id)).toMatchObject({ published: false });
      expect(
        (await test.services.tree.search(context.reader, { query: "Secret", spaceId: context.space.id })).map(
          (item) => item.id,
        ),
      ).not.toContain(page.id);
      expect(
        (
          await test.services.authorization.explain(context.reader, "item.view", {
            type: "item",
            id: page.id,
          })
        ).allowed,
      ).toBe(false);
      expect(
        (
          await test.services.authorization.explain(context.editor, "item.view", {
            type: "item",
            id: page.id,
          })
        ).allowed,
      ).toBe(true);
      expect(await test.services.documents.readable(page.id)).toBeNull();

      await test.services.versions.publish(context.editor, page.id);
      expect(
        (await test.services.tree.children(context.reader, context.space.id, null)).items.map(
          (item) => item.id,
        ),
      ).toContain(page.id);
    });

    it("shows readers the published content and title while editors change the draft", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Runbook", "Published text");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Draft text")));
      await test.services.tree.update(context.editor, page.id, { title: "Draft title" });

      const readable = await test.services.documents.readable(page.id);
      expect(readable).toMatchObject({ title: "Runbook", version: 1 });
      expect(JSON.stringify(readable?.document)).toContain("Published text");
      expect(JSON.stringify(readable?.document)).not.toContain("Draft text");
      expect((await test.services.tree.details(context.reader, page.id))?.title).toBe("Runbook");
      expect(
        (await test.services.tree.search(context.reader, { query: "Draft title", spaceId: context.space.id }))
          .length,
      ).toBe(0);

      const draft = await test.services.versions.draft(page.id);
      expect(draft).toMatchObject({ title: "Draft title", hasChanges: true, basedOn: 1 });
      expect(draft.changes).toBeGreaterThan(0);
    });

    it("takes backlinks and link titles from the published content only", async () => {
      const context = await setup();
      const target = await publishedPage(context, "Target", "Target text");
      const source = await publishedPage(context, "Source", "No link yet");
      await test.services.documents.replace(context.editor, source.id, documentWith(linkTo(target.id)));
      expect(await test.services.documents.backlinks(context.reader, target.id)).toEqual([]);
      await test.services.versions.publish(context.editor, source.id);
      expect(
        (await test.services.documents.backlinks(context.reader, target.id)).map((link) => link.title),
      ).toEqual(["Source"]);

      const draftOnly = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Unpublished target",
        mode: "publish",
        placement: { parentId: null },
      });
      const references = await test.services.documents.references(
        context.reader,
        documentWith(linkTo(draftOnly.id)) as never,
      );
      expect(references.pages[draftOnly.id]).toMatchObject({ title: "", accessible: false });
      const forEditor = await test.services.documents.references(
        context.editor,
        documentWith(linkTo(draftOnly.id)) as never,
      );
      expect(forEditor.pages[draftOnly.id]).toMatchObject({ title: "Unpublished target", accessible: true });
    });

    it("lists unpublished pages on the labels page for editors only", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Labelled draft",
        mode: "publish",
        placement: { parentId: null },
      });
      await test.services.documents.addLabel(context.editor, page.id, "secret");
      expect(
        await test.services.documents.pagesWithLabel(context.reader, context.space.id, "secret"),
      ).toEqual([]);
      expect(await test.services.documents.labelSuggestions(context.reader, context.space.id, "sec")).toEqual(
        [],
      );
      expect(
        (await test.services.documents.pagesWithLabel(context.editor, context.space.id, "secret")).map(
          (item) => item.title,
        ),
      ).toEqual(["Labelled draft"]);
    });

    it("keeps the version list to published states", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Policy", "One");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Draft")));
      const versions = await test.services.versions.list(page.id);
      expect(versions.map((version) => version.number)).toEqual([1]);
      const version = await test.services.versions.get(page.id, 1);
      expect(JSON.stringify(version?.document)).not.toContain("Draft");
      expect(version?.contributors.map((person) => person.id)).toContain(context.editorId);
    });
  });

  describe("readers and unpublished ancestors", () => {
    type Context = Awaited<ReturnType<typeof setup>>;

    async function seen(context: Context, itemId: string) {
      return (
        await test.services.authorization.explain(context.reader, "item.view", { type: "item", id: itemId })
      ).allowed;
    }

    async function hiddenBranch(context: Context) {
      const target = await publishedPage(context, "Link target", "Target");
      const parent = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Unpublished parent",
        mode: "publish",
        placement: { parentId: null },
      });
      const child = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Published child",
        mode: "publish",
        placement: { parentId: parent.id },
      });
      await test.services.documents.replace(context.editor, child.id, documentWith(linkTo(target.id)));
      await test.services.versions.publish(context.editor, child.id);
      await test.services.documents.addLabel(context.editor, child.id, "hidden-branch");
      const folder = await test.services.tree.create(context.editor, context.space.id, {
        kind: "folder",
        title: "Nested folder",
        placement: { parentId: child.id },
      });
      const live = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Nested live page",
        mode: "live",
        placement: { parentId: folder.id },
      });
      return { target, parent, child, folder, live };
    }

    async function readerPaths(context: Context, branch: Awaited<ReturnType<typeof hiddenBranch>>) {
      const reader = context.reader;
      const spaceId = context.space.id;
      const ids = [branch.child.id, branch.folder.id, branch.live.id];
      const references = await test.services.documents.references(
        reader,
        documentWith(linkTo(branch.child.id)) as DocumentJson,
      );
      return {
        view: await Promise.all(ids.map((id) => seen(context, id))),
        root: (await test.services.tree.children(reader, spaceId, null)).items.map((item) => item.id),
        children: (await test.services.tree.children(reader, spaceId, branch.child.id)).items.map(
          (item) => item.id,
        ),
        search: (await test.services.tree.search(reader, { query: "Nested live page", spaceId })).map(
          (item) => item.id,
        ),
        labels: (await test.services.documents.pagesWithLabel(reader, spaceId, "hidden-branch")).map(
          (page) => page.itemId,
        ),
        suggestions: await test.services.documents.labelSuggestions(reader, spaceId, "hidden"),
        backlinks: (await test.services.documents.backlinks(reader, branch.target.id)).map(
          (link) => link.itemId,
        ),
        linkAccessible: references.pages[branch.child.id]?.accessible ?? false,
      };
    }

    it("hides a published page and everything below it while an ancestor is unpublished", async () => {
      const context = await setup();
      const branch = await hiddenBranch(context);
      const paths = await readerPaths(context, branch);
      expect(paths).toMatchObject({
        view: [false, false, false],
        children: [],
        search: [],
        labels: [],
        suggestions: [],
        backlinks: [],
        linkAccessible: false,
      });
      expect(paths.root).not.toContain(branch.parent.id);
      expect(await seen(context, branch.target.id)).toBe(true);
      expect(
        (
          await test.services.authorization.explain(context.editor, "item.view", {
            type: "item",
            id: branch.live.id,
          })
        ).allowed,
      ).toBe(true);
      expect((await test.services.tree.details(context.editor, branch.child.id))?.ancestors).toEqual([
        {
          id: branch.parent.id,
          number: branch.parent.number,
          kind: "page",
          title: "Unpublished parent",
          published: false,
        },
      ]);
    });

    it("shows the branch with its own published versions once the ancestor is published", async () => {
      const context = await setup();
      const branch = await hiddenBranch(context);
      await test.services.documents.replace(
        context.editor,
        branch.child.id,
        documentWith(paragraph("Draft only")),
      );
      await test.services.versions.publish(context.editor, branch.parent.id);
      const paths = await readerPaths(context, branch);
      expect(paths).toMatchObject({
        view: [true, true, true],
        children: [branch.folder.id],
        search: [branch.live.id],
        labels: [branch.child.id],
        suggestions: ["hidden-branch"],
        backlinks: [branch.child.id],
        linkAccessible: true,
      });
      expect(paths.root).toContain(branch.parent.id);
      expect(
        JSON.stringify((await test.services.documents.readable(branch.child.id))?.document),
      ).not.toContain("Draft only");
      expect((await test.services.tree.details(context.reader, branch.child.id))?.ancestors).toEqual([
        {
          id: branch.parent.id,
          number: branch.parent.number,
          kind: "page",
          title: "Unpublished parent",
          published: true,
        },
      ]);
    });

    it("counts folders and pages in live mode as published ancestors", async () => {
      const context = await setup();
      const branch = await hiddenBranch(context);
      await test.services.versions.changeMode(context.editor, branch.parent.id, "live", {
        confirmDraft: true,
      });
      expect((await readerPaths(context, branch)).view).toEqual([true, true, true]);
      await test.services.versions.changeMode(context.editor, branch.parent.id, "publish");
      await test.services.tree.convert(context.editor, branch.parent.id, "folder");
      expect((await readerPaths(context, branch)).view).toEqual([true, true, true]);
    });

    it("hides a published page moved below an unpublished page and shows it again when moved back", async () => {
      const context = await setup();
      const parent = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Not yet published",
        mode: "publish",
        placement: { parentId: null },
      });
      const page = await publishedPage(context, "Moving page", "Text");
      const below = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Below the moving page",
        mode: "live",
        placement: { parentId: page.id },
      });
      expect([await seen(context, page.id), await seen(context, below.id)]).toEqual([true, true]);
      await test.services.tree.move(context.editor, page.id, { parentId: parent.id });
      expect([await seen(context, page.id), await seen(context, below.id)]).toEqual([false, false]);
      await test.services.tree.move(context.editor, page.id, { parentId: null });
      expect([await seen(context, page.id), await seen(context, below.id)]).toEqual([true, true]);
    });

    it("stays right when a page is moved below an ancestor that is published at the same moment", async () => {
      const context = await setup();
      for (let round = 0; round < 5; round++) {
        const parent = await test.services.tree.create(context.editor, context.space.id, {
          kind: "page",
          title: `Parent ${round}`,
          mode: "publish",
          placement: { parentId: null },
        });
        const page = await publishedPage(context, `Moved ${round}`, "Text");
        await Promise.all([
          test.services.versions.publish(context.editor, parent.id),
          test.services.tree.move(context.editor, page.id, { parentId: parent.id }),
        ]);
        expect(await seen(context, page.id)).toBe(true);
      }
    });

    it("keeps deleted, restored and archived pages hidden while their ancestor is unpublished", async () => {
      const context = await setup();
      const branch = await hiddenBranch(context);
      const entry = await test.services.trash.deleteItem(context.editor, branch.child.id);
      await test.services.trash.restore(context.editor, entry.id);
      expect((await readerPaths(context, branch)).view).toEqual([false, false, false]);
      await test.services.archive.archive(context.editor, branch.child.id);
      expect(await seen(context, branch.child.id)).toBe(false);
      await test.services.versions.publish(context.editor, branch.parent.id);
      expect(await seen(context, branch.child.id)).toBe(true);
      await test.services.archive.unarchive(context.editor, branch.child.id);
      expect((await readerPaths(context, branch)).view).toEqual([true, true, true]);
    });
  });

  describe("publishing", () => {
    it("creates one version when two people publish at the same moment", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Shared", "Start");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Next")));
      const results = await Promise.all([
        test.services.versions.publish(context.editor, page.id, { note: "first" }),
        test.services.versions.publish(context.editor, page.id, { note: "second" }),
      ]);
      expect(results.map((result) => result.created).sort()).toEqual([false, true]);
      expect(results.map((result) => result.version)).toEqual([2, 2]);
      expect((await test.services.versions.list(page.id)).map((version) => version.number)).toEqual([2, 1]);
    });

    it("refuses publishing in live mode and notes that are too long", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Live",
        mode: "live",
        placement: { parentId: null },
      });
      await expect(test.services.versions.publish(context.editor, page.id)).rejects.toMatchObject({
        code: "notPublishMode",
      });
      const other = await publishedPage(context, "Publish", "x");
      await expect(
        test.services.versions.publish(context.editor, other.id, { note: "n".repeat(501) }),
      ).rejects.toMatchObject({ code: "invalidNote" });
    });

    it("records the publication in the audit log", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Audited", "x");
      const events = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${page.id} order by sequence`,
      );
      expect(events.rows.map((row) => row.name)).toContain("page.published");
    });
  });

  describe("discarding", () => {
    it("resets the draft for everyone, keeps the discarded state and restores it on undo", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Guide", "Published");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Unwanted")));
      await test.services.tree.update(context.editor, page.id, { title: "Unwanted title" });
      const { discardedDraftId } = await test.services.versions.discard(context.editor, page.id);
      const draft = await test.services.versions.draft(page.id);
      expect(draft).toMatchObject({ title: "Guide", hasChanges: false, changes: 0 });
      expect(JSON.stringify(draft.document)).toContain("Published");
      const discarded = await test.services.versions.discardedDrafts(page.id);
      expect(discarded).toHaveLength(1);
      expect(discarded[0]).toMatchObject({
        id: discardedDraftId,
        title: "Unwanted title",
        reason: "discarded",
      });
      expect(discarded[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

      await test.services.versions.restoreDiscarded(context.editor, page.id, discardedDraftId);
      const restored = await test.services.versions.draft(page.id);
      expect(restored.title).toBe("Unwanted title");
      expect(JSON.stringify(restored.document)).toContain("Unwanted");
      expect(await test.services.versions.discardedDrafts(page.id)).toEqual([]);
      await expect(test.services.versions.discard(context.editor, page.id)).resolves.toBeTruthy();
    });

    it("refuses to discard a draft without changes", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Clean", "x");
      await expect(test.services.versions.discard(context.editor, page.id)).rejects.toMatchObject({
        code: "nothingToDiscard",
      });
    });
  });

  describe("restoring", () => {
    it("makes an old version the draft in publish mode and keeps the replaced draft", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Doc", "Version one");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Version two")));
      await test.services.versions.publish(context.editor, page.id);
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Draft three")));
      const result = await test.services.versions.restore(context.editor, page.id, 1);
      expect(result).toEqual({ mode: "publish", version: null });
      expect(JSON.stringify((await test.services.versions.draft(page.id)).document)).toContain("Version one");
      expect(JSON.stringify((await test.services.documents.readable(page.id))?.document)).toContain(
        "Version two",
      );
      expect((await test.services.versions.discardedDrafts(page.id))[0]?.reason).toBe("replaced");
      expect((await test.services.versions.list(page.id)).map((version) => version.number)).toEqual([2, 1]);
    });

    it("makes an old version current with a new version in live mode", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Live doc",
        mode: "live",
        placement: { parentId: null },
      });
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("First")));
      await test.services.versions.versionLiveSession(page.id);
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Second")));
      await test.services.versions.versionLiveSession(page.id);
      const result = await test.services.versions.restore(context.editor, page.id, 1);
      expect(result).toEqual({ mode: "live", version: 3 });
      expect(JSON.stringify((await test.services.documents.readable(page.id))?.document)).toContain("First");
      const versions = await test.services.versions.list(page.id);
      expect(versions[0]).toMatchObject({ number: 3, reason: "restored", restoredFrom: 1 });
      expect(versions).toHaveLength(3);
    });
  });

  describe("modes", () => {
    it("publishes the current state when switching to publish mode", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Switch",
        mode: "live",
        placement: { parentId: null },
      });
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Visible")));
      await test.services.versions.changeMode(context.editor, page.id, "publish");
      expect((await test.services.documents.readable(page.id))?.version).toBe(1);
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Hidden draft")));
      expect(JSON.stringify((await test.services.documents.readable(page.id))?.document)).not.toContain(
        "Hidden",
      );
    });

    it("asks before an open draft becomes visible when switching to live mode", async () => {
      const context = await setup();
      const page = await publishedPage(context, "Back", "Published");
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Pending")));
      await expect(test.services.versions.changeMode(context.editor, page.id, "live")).rejects.toMatchObject({
        code: "draftPending",
      });
      await test.services.versions.changeMode(context.editor, page.id, "live", { confirmDraft: true });
      expect(JSON.stringify((await test.services.documents.readable(page.id))?.document)).toContain(
        "Pending",
      );
      expect((await test.services.versions.list(page.id))[0]?.reason).toBe("modeChanged");
    });

    it("uses the default mode of the space for new pages", async () => {
      const context = await setup();
      await test.settings.set(
        (await import("./settings.js")).defaultPageModeSetting,
        { organization: context.org.id, space: context.space.id },
        "space",
        "live",
      );
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Default",
        placement: { parentId: null },
      });
      expect(page.mode).toBe("live");
    });
  });

  describe("live sessions", () => {
    it("creates exactly one version when the last editor of several nodes leaves", async () => {
      const context = await setup();
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Session",
        mode: "live",
        placement: { parentId: null },
      });
      await test.services.versions.touchPresence(page.id, "node-a", 1);
      await test.services.versions.touchPresence(page.id, "node-b", 1);
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Edited")));
      expect(await test.services.versions.endSession(page.id, "node-a")).toBeNull();
      const results = await Promise.all([
        test.services.versions.endSession(page.id, "node-b"),
        test.services.versions.versionLiveSession(page.id),
      ]);
      expect(results.filter((result) => result !== null)).toEqual([1]);
      expect(await test.services.versions.list(page.id)).toHaveLength(1);
      expect(await test.services.versions.versionLiveSession(page.id)).toBeNull();
    });

    it("creates a version after the idle period of the space", async () => {
      const context = await setup();
      await test.settings.set(
        liveVersionIdleMinutesSetting,
        { organization: context.org.id, space: context.space.id },
        "space",
        5,
      );
      const page = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Idle",
        mode: "live",
        placement: { parentId: null },
      });
      await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Typed")));
      await test.database.execute(
        sql`update page_documents set changed_at = now() - interval '3 minutes' where item_id = ${page.id}`,
      );
      await test.services.versions.versionIdlePages();
      expect(await test.services.versions.list(page.id)).toHaveLength(0);
      await test.database.execute(
        sql`update page_documents set changed_at = now() - interval '6 minutes' where item_id = ${page.id}`,
      );
      await test.services.versions.versionIdlePages();
      expect((await test.services.versions.list(page.id)).map((version) => version.reason)).toEqual([
        "session",
      ]);
    });
  });

  it("migrates stored versions to the current schema", async () => {
    const context = await setup();
    const page = await publishedPage(context, "Old", "Stored");
    await test.database.execute(sql`update page_versions set schema_version = 1 where item_id = ${page.id}`);
    const version = await test.services.versions.get(page.id, 1);
    expect(JSON.stringify(version?.document)).toContain("Stored");
    expect((await test.services.documents.readable(page.id))?.schemaVersion).toBe(editorSchemaVersion);
  });

  it("compares a version with the draft", async () => {
    const context = await setup();
    const page = await publishedPage(context, "Compare", "Alpha beta");
    await test.services.documents.replace(context.editor, page.id, documentWith(paragraph("Alpha gamma")));
    const result = await test.services.versions.compare(page.id, 1, "draft");
    expect(result.diff.changes).toBe(1);
    expect(result.diff.blocks[0]?.change).toBe("changed");
  });
});
