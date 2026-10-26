import { validateDocument } from "@lunedo/editor-schema";
import { applyDocument, documentFromYDoc } from "@lunedo/editor-schema/yjs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { accountPrincipal } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { DocumentInvalidError, MERGE_ORIGIN, normalizeLabel } from "./documents.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function documentWith(...blocks: unknown[]) {
  return { type: "doc", content: blocks };
}

describe.skipIf(!baseUrl)("page tree and page content", () => {
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
    const editor = await member(org.id);
    const created = await space(org.id, editor);
    return { org, editor, actor: accountPrincipal(editor), space: created };
  }

  async function page(
    actor: ReturnType<typeof accountPrincipal>,
    spaceId: string,
    title: string,
    parentId: string | null = null,
  ) {
    return test.services.tree.create(actor, spaceId, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId },
    });
  }

  async function titles(spaceId: string, parentId: string | null) {
    const children = await test.services.tree.children(
      accountPrincipal((await anyAdmin(spaceId)) ?? ""),
      spaceId,
      parentId,
    );
    return children.items.map((item) => item.title);
  }

  async function anyAdmin(spaceId: string) {
    const result = await test.database.execute<{ principal_id: string }>(
      sql`select principal_id from space_permissions where space_id = ${spaceId} and role = 'admin' limit 1`,
    );
    return result.rows[0]?.principal_id;
  }

  async function integrity(spaceId: string) {
    const rows = await test.database.execute<{ id: string; parent_id: string | null; position: string }>(
      sql`select id, parent_id, position from tree_items where space_id = ${spaceId}`,
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    for (const row of rows.rows) {
      const seen = new Set<string>();
      let current: string | null = row.id;
      while (current) {
        if (seen.has(current)) throw new Error(`Cycle at ${row.id}`);
        seen.add(current);
        current = byId.get(current)?.parent_id ?? null;
      }
    }
    const positions = rows.rows.map((row) => `${row.parent_id}:${row.position}`);
    expect(new Set(positions).size).toBe(positions.length);
    return rows.rows.length;
  }

  describe("tree", () => {
    it("orders items by placement without changing their neighbors", async () => {
      const { actor, space: created } = await setup();
      const first = await page(actor, created.id, "First");
      const third = await page(actor, created.id, "Third");
      const second = await test.services.tree.create(actor, created.id, {
        kind: "page",
        title: "Second",
        placement: { parentId: null, afterId: first.id },
      });
      const zero = await test.services.tree.create(actor, created.id, {
        kind: "folder",
        title: "Zero",
        placement: { parentId: null, beforeId: first.id },
      });
      expect(await titles(created.id, null)).toEqual([created.name, "Zero", "First", "Second", "Third"]);
      const positions = await test.database.execute<{ id: string; position: string }>(
        sql`select id, position from tree_items where id = any(${sql.param([first.id, third.id])}::uuid[])`,
      );
      expect(new Map(positions.rows.map((row) => [row.id, row.position]))).toEqual(
        new Map([
          [first.id, first.position],
          [third.id, third.position],
        ]),
      );
      expect(second.position > first.position && second.position < third.position).toBe(true);
      expect(zero.kind).toBe("folder");
    });

    it("loads children on demand and reports whether an item has children", async () => {
      const { actor, space: created } = await setup();
      const parent = await page(actor, created.id, "Parent");
      await page(actor, created.id, "Child", parent.id);
      const root = await test.services.tree.children(actor, created.id, null);
      expect(root.items.find((item) => item.id === parent.id)?.hasChildren).toBe(true);
      const children = await test.services.tree.children(actor, created.id, parent.id);
      expect(children.items.map((item) => item.title)).toEqual(["Child"]);
      const details = await test.services.tree.details(actor, children.items[0]?.id ?? "");
      expect(details?.ancestors.map((ancestor) => ancestor.title)).toEqual(["Parent"]);
      expect(details?.spaceKey).toBe(created.key);
    });

    it("pages through large lists of children", async () => {
      const { actor, space: created } = await setup();
      const folder = await test.services.tree.create(actor, created.id, {
        kind: "folder",
        title: "Many",
        placement: { parentId: null },
      });
      for (let index = 0; index < 12; index++) await page(actor, created.id, `Page ${index}`, folder.id);
      const first = await test.services.tree.children(actor, created.id, folder.id, { limit: 5 });
      expect(first.items).toHaveLength(5);
      const second = await test.services.tree.children(actor, created.id, folder.id, {
        limit: 10,
        after: first.next ?? "",
      });
      expect(second.items).toHaveLength(7);
      expect(second.next).toBeNull();
    });

    it("refuses to move an item below itself or its descendants", async () => {
      const { actor, space: created } = await setup();
      const top = await page(actor, created.id, "Top");
      const middle = await page(actor, created.id, "Middle", top.id);
      const bottom = await page(actor, created.id, "Bottom", middle.id);
      await expect(test.services.tree.move(actor, top.id, { parentId: top.id })).rejects.toMatchObject({
        code: "moveIntoDescendant",
      });
      await expect(test.services.tree.move(actor, top.id, { parentId: bottom.id })).rejects.toMatchObject({
        code: "moveIntoDescendant",
      });
      const moved = await test.services.tree.move(actor, bottom.id, { parentId: null, afterId: top.id });
      expect(moved.parentId).toBeNull();
    });

    it("never creates a cycle, a duplicate position or a lost item when people move items at the same moment", async () => {
      const { actor, space: created } = await setup();
      const items: string[] = [];
      for (let index = 0; index < 8; index++) items.push((await page(actor, created.id, `Item ${index}`)).id);
      const before = await integrity(created.id);
      const moves: Promise<unknown>[] = [];
      for (let round = 0; round < 6; round++) {
        for (let index = 0; index < items.length; index++) {
          const item = items[index] as string;
          const target = items[(index + round + 1) % items.length] as string;
          moves.push(test.services.tree.move(actor, item, { parentId: target }).catch(() => undefined));
          moves.push(test.services.tree.move(actor, target, { parentId: item }).catch(() => undefined));
          moves.push(
            test.services.tree.move(actor, item, { parentId: null, afterId: null }).catch(() => undefined),
          );
        }
      }
      await Promise.all(moves);
      expect(await integrity(created.id)).toBe(before);
    });

    it("never lets two items end up below each other when both are moved at the same moment", async () => {
      const { actor, space: created } = await setup();
      const left = await page(actor, created.id, "Left");
      const right = await page(actor, created.id, "Right");
      const otherNode = test.anotherNode();
      for (let round = 0; round < 30; round++) {
        await Promise.allSettled([
          test.services.tree.move(actor, left.id, { parentId: right.id }),
          otherNode.tree.move(actor, right.id, { parentId: left.id }),
        ]);
        await integrity(created.id);
        await test.services.tree.move(actor, left.id, { parentId: null }).catch(() => undefined);
        await test.services.tree.move(actor, right.id, { parentId: null }).catch(() => undefined);
      }
    });

    it("gives two items placed at the same spot at the same moment different positions", async () => {
      const { actor, space: created } = await setup();
      const anchor = await page(actor, created.id, "Anchor");
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          test.services.tree.create(actor, created.id, {
            kind: "page",
            title: `Concurrent ${index}`,
            placement: { parentId: null, afterId: anchor.id },
          }),
        ),
      );
      await integrity(created.id);
      expect((await titles(created.id, null)).filter((title) => title.startsWith("Concurrent"))).toHaveLength(
        10,
      );
    });

    it("moves across spaces only with edit permission in both and shows how access changes", async () => {
      const { org, editor, actor, space: source } = await setup();
      const reader = await member(org.id, "member", "Reading person");
      const readOnly = await space(org.id, await member(org.id), {
        grants: [
          { principalKind: "account", principalId: editor, role: "reader" },
          { principalKind: "account", principalId: reader, role: "reader" },
        ],
      });
      const target = await space(org.id, editor, {
        grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
      });
      const moving = await page(actor, source.id, "Moving");
      await page(actor, source.id, "Child", moving.id);
      await expect(
        test.services.tree.move(actor, moving.id, { spaceId: readOnly.id, parentId: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        test.services.tree.moveImpact(actor, moving.id, { spaceId: readOnly.id, parentId: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const impact = await test.services.tree.moveImpact(actor, moving.id, {
        spaceId: target.id,
        parentId: null,
      });
      expect(impact.changes.map((change) => change.name)).toContain("Reading person");
      await expect(
        test.services.tree.move(actor, moving.id, { spaceId: target.id, parentId: null }),
      ).rejects.toMatchObject({ code: "moveChangesAccess" });
      await test.services.tree.move(actor, moving.id, {
        spaceId: target.id,
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
      const moved = await test.database.execute<{ space_id: string }>(
        sql`select distinct space_id from tree_items where id = ${moving.id} or parent_id = ${moving.id}`,
      );
      expect(moved.rows).toEqual([{ space_id: target.id }]);
      await expect(
        test.services.tree.move(actor, source.overviewItemId ?? "", { spaceId: target.id, parentId: null }),
      ).rejects.toMatchObject({ code: "overviewPage" });
    });

    it("converts between folder and page and keeps the children", async () => {
      const { actor, space: created } = await setup();
      const folder = await test.services.tree.create(actor, created.id, {
        kind: "folder",
        title: "Folder",
        description: "Runbooks for the team",
        placement: { parentId: null },
      });
      await page(actor, created.id, "Inside", folder.id);
      const converted = await test.services.tree.convert(actor, folder.id, "page");
      expect(converted.kind).toBe("page");
      expect(converted.hasChildren).toBe(true);
      expect(await test.services.documents.snapshot(folder.id)).not.toBeNull();
      const back = await test.services.tree.convert(actor, folder.id, "folder");
      expect(back.kind).toBe("folder");
      expect(await titles(created.id, folder.id)).toEqual(["Inside"]);
    });

    it("hides the title of links to content the viewer cannot read", async () => {
      const { org, editor, actor, space: created } = await setup();
      const viewer = await member(org.id);
      const shared = await space(org.id, editor, {
        grants: [{ principalKind: "account", principalId: viewer, role: "reader" }],
      });
      const secret = await page(actor, created.id, "Salary bands");
      const link = await test.services.tree.create(actor, shared.id, {
        kind: "link",
        title: "Salary bands",
        placement: { parentId: null },
        link: { itemId: secret.id },
      });
      const external = await test.services.tree.create(actor, shared.id, {
        kind: "link",
        title: "Status page",
        placement: { parentId: null },
        link: { url: "https://status.example.org" },
      });
      const seen = await test.services.tree.children(accountPrincipal(viewer), shared.id, null);
      const hidden = seen.items.find((item) => item.id === link.id);
      expect(hidden?.title).toBe("");
      expect(hidden?.link).toMatchObject({ accessible: false, target: null, itemId: null });
      expect(seen.items.find((item) => item.id === external.id)?.link).toMatchObject({
        accessible: true,
        url: "https://status.example.org/",
      });
      const own = await test.services.tree.get(actor, link.id);
      expect(own?.link?.target?.title).toBe("Salary bands");
      await expect(
        test.services.tree.create(actor, shared.id, {
          kind: "link",
          title: "Bad",
          placement: { parentId: null },
          link: { url: "javascript:alert(1)" },
        }),
      ).rejects.toMatchObject({ code: "invalidLinkUrl" });
    });

    it("finds readable pages by title only", async () => {
      const { org, editor, actor, space: created } = await setup();
      const outsider = await member(org.id);
      await page(actor, created.id, "Quarterly planning");
      const found = await test.services.tree.search(actor, { query: "quarterly" });
      expect(found.map((item) => item.title)).toContain("Quarterly planning");
      expect(await test.services.tree.search(accountPrincipal(outsider), { query: "quarterly" })).toEqual([]);
      expect(editor).toBeTruthy();
    });
  });

  describe("content", () => {
    it("stores the Yjs state and the snapshot together and merges what another node stored", async () => {
      const { actor, space: created } = await setup();
      const created_page = await page(actor, created.id, "Shared");
      const state = await test.services.documents.state(created_page.id);
      const first = new Y.Doc();
      const second = new Y.Doc();
      Y.applyUpdate(first, state ?? new Uint8Array());
      Y.applyUpdate(second, state ?? new Uint8Array());
      applyDocument(first, documentWith(paragraph("From the first node")));
      applyDocument(second, documentWith(paragraph("From the second node")));
      const otherNode = test.anotherNode();
      await Promise.all([
        test.services.documents.store(created_page.id, first, { actorId: null }),
        otherNode.documents.store(created_page.id, second, { actorId: null }),
      ]);
      const snapshot = await test.services.documents.snapshot(created_page.id);
      const text = JSON.stringify(snapshot?.document);
      expect(text).toContain("From the first node");
      expect(text).toContain("From the second node");
      const stored = new Y.Doc();
      Y.applyUpdate(stored, (await test.services.documents.state(created_page.id)) ?? new Uint8Array());
      const derived = validateDocument(documentFromYDoc(stored));
      expect(derived.ok && derived.document).toEqual(snapshot?.document);
    });

    it("rejects invalid documents and keeps the stored content", async () => {
      const { actor, space: created } = await setup();
      const target = await page(actor, created.id, "Guarded");
      await test.services.documents.replace(actor, target.id, documentWith(paragraph("Kept")));
      await expect(
        test.services.documents.replace(actor, target.id, documentWith({ type: "script", content: [] })),
      ).rejects.toBeInstanceOf(DocumentInvalidError);
      expect(JSON.stringify((await test.services.documents.snapshot(target.id))?.document)).toContain("Kept");
    });

    it("applies API writes on top of concurrent edits and records the writing account", async () => {
      const { editor, actor, space: created } = await setup();
      const target = await page(actor, created.id, "Written");
      const snapshot = await test.services.documents.replace(
        actor,
        target.id,
        documentWith(paragraph("Hello")),
      );
      expect(snapshot.revision).toBeGreaterThan(1);
      const clients = await test.database.execute<{ account_id: string }>(
        sql`select account_id from collaboration_clients where item_id = ${target.id}`,
      );
      expect(clients.rows.map((row) => row.account_id)).toContain(editor);
      const live = new Y.Doc();
      Y.applyUpdate(live, (await test.services.documents.state(target.id)) ?? new Uint8Array(), MERGE_ORIGIN);
      expect(JSON.stringify(documentFromYDoc(live))).toContain("Hello");
    });

    it("extracts backlinks and shows only those the viewer can read", async () => {
      const { org, editor, actor, space: created } = await setup();
      const viewer = await member(org.id);
      const open = await space(org.id, editor, {
        grants: [{ principalKind: "account", principalId: viewer, role: "reader" }],
      });
      const target = await page(actor, open.id, "Target");
      const hiddenSource = await page(actor, created.id, "Hidden source");
      const openSource = await page(actor, open.id, "Open source");
      const linking = documentWith({
        type: "paragraph",
        content: [{ type: "pageLink", attrs: { pageId: target.id, spaceId: null, title: null } }],
      });
      await test.services.documents.replace(actor, hiddenSource.id, linking);
      await test.services.documents.replace(actor, openSource.id, linking);
      expect(
        (await test.services.documents.backlinks(actor, target.id)).map((link) => link.title).sort(),
      ).toEqual(["Hidden source", "Open source"]);
      expect(
        (await test.services.documents.backlinks(accountPrincipal(viewer), target.id)).map((link) => [
          link.title,
          link.number,
        ]),
      ).toEqual([["Open source", openSource.number]]);
      const references = await test.services.documents.references(
        accountPrincipal(viewer),
        documentWith({
          type: "paragraph",
          content: [{ type: "pageLink", attrs: { pageId: hiddenSource.id, spaceId: null, title: null } }],
        }) as never,
      );
      expect(references.pages[hiddenSource.id]).toEqual({
        title: "",
        spaceKey: "",
        kind: "page",
        number: null,
        accessible: false,
        inTrash: false,
      });
    });

    it("creates a page when a link to a missing page is followed and links it by ID", async () => {
      const { actor, space: created } = await setup();
      const source = await page(actor, created.id, "Index");
      await test.services.documents.replace(
        actor,
        source.id,
        documentWith({
          type: "paragraph",
          content: [{ type: "pageLink", attrs: { pageId: null, spaceId: created.id, title: "Glossary" } }],
        }),
      );
      const followed = await test.services.tree.followTitleLink(actor, source.id, {
        spaceId: created.id,
        title: "Glossary",
      });
      expect(followed.created).toBe(true);
      const again = await test.services.tree.followTitleLink(actor, source.id, {
        spaceId: created.id,
        title: "glossary",
      });
      expect(again).toEqual({ itemId: followed.itemId, created: false });
      expect(JSON.stringify((await test.services.documents.snapshot(source.id))?.document)).toContain(
        followed.itemId,
      );
      expect(
        (await test.services.documents.backlinks(actor, followed.itemId)).map((link) => link.itemId),
      ).toEqual([source.id]);
    });

    it("answers a hidden space like an unknown one when following a link or moving", async () => {
      const { org, actor, space: created } = await setup();
      const source = await page(actor, created.id, "Index");
      const stranger = await member(org.id);
      const hidden = await space(org.id, stranger);
      const unknown = "01929b1e-0000-7000-8000-00000000dead";
      for (const spaceId of [hidden.id, unknown]) {
        await expect(
          test.services.tree.followTitleLink(actor, source.id, { spaceId, title: "Secret" }),
        ).rejects.toMatchObject({ code: "spaceNotFound" });
        await expect(
          test.services.tree.move(actor, source.id, { spaceId, parentId: null }),
        ).rejects.toMatchObject({ code: "spaceNotFound" });
      }
      const readable = await space(org.id, stranger, {
        grants: [{ principalKind: "account", principalId: actor.id, role: "reader" }],
      });
      await expect(
        test.services.tree.move(actor, source.id, { spaceId: readable.id, parentId: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("normalizes labels, suggests readable ones and lists pages by label", async () => {
      const { org, editor, actor, space: created } = await setup();
      const target = await page(actor, created.id, "Labelled");
      expect(await test.services.documents.addLabel(actor, target.id, "  Release Notes ")).toEqual([
        "release-notes",
      ]);
      expect(await test.services.documents.addLabel(actor, target.id, "release-notes")).toEqual([
        "release-notes",
      ]);
      expect(() => normalizeLabel("   ")).toThrow();
      const other = await member(org.id);
      const otherSpace = await space(org.id, other);
      expect(await test.services.documents.labelSuggestions(actor, created.id, "rel")).toEqual([
        "release-notes",
      ]);
      expect(
        await test.services.documents.labelSuggestions(accountPrincipal(other), otherSpace.id, "rel"),
      ).toEqual([]);
      expect(
        (await test.services.documents.pagesWithLabel(actor, created.id, "Release-Notes")).map((item) => [
          item.title,
          item.number,
        ]),
      ).toEqual([["Labelled", target.number]]);
      expect(await test.services.documents.removeLabel(target.id, "release-notes")).toEqual([]);
      expect(editor).toBeTruthy();
    });
  });
});
