import { randomUUID } from "node:crypto";
import type { DecisionReportRequest, DocumentJson, NodeJson, PageReportRequest } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { renderPageMarkdown } from "./documents.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function decision(text: string): NodeJson {
  return {
    type: "decision",
    attrs: { id: randomUUID() },
    content: [text ? paragraph(text) : { type: "paragraph" }],
  };
}

function task(text: string): NodeJson {
  return {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { id: randomUUID() }, content: [paragraph(text)] }],
  };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

const pageDefaults: PageReportRequest = {
  spaceId: null,
  labels: [],
  sort: "title",
  reverse: false,
  limit: 20,
};
const decisionDefaults: DecisionReportRequest = {
  spaceId: null,
  labels: [],
  parentId: null,
  order: "newest",
};

describe.skipIf(!baseUrl)("page, decision and task reports", () => {
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
    const hidden = await space(org.id, editorId);
    const page = async (
      spaceId: string,
      title: string,
      content: DocumentJson,
      options: { parentId?: string | null; labels?: string[]; mode?: "live" | "publish" } = {},
    ) => {
      const created = await test.services.tree.create(editor, spaceId, {
        kind: "page",
        title,
        mode: options.mode ?? "live",
        placement: { parentId: options.parentId ?? null },
      });
      await test.services.documents.replace(editor, created.id, content);
      for (const label of options.labels ?? [])
        await test.services.documents.addLabel(editor, created.id, label);
      return created.id;
    };
    const alpha = await page(shared.id, "Alpha", doc(decision("Use WireGuard"), task("Order keys")), {
      labels: ["vpn"],
    });
    const child = await page(
      shared.id,
      "Child",
      doc(decision("Rotate keys yearly"), decision(""), task("Rotate")),
      {
        parentId: alpha,
        labels: ["vpn", "security"],
      },
    );
    const secret = await page(
      shared.id,
      "Secret plan",
      doc(decision("Buy the competitor"), task("Call bank")),
      {
        labels: ["vpn"],
      },
    );
    const secretChild = await page(shared.id, "Secret child", doc(decision("Keep it quiet"), task("Hide")), {
      parentId: secret,
      labels: ["vpn"],
    });
    await test.services.pageAccess.change(editor, secret, [{ action: "restrict", kind: "view" }]);
    const draft = await page(shared.id, "Unpublished draft", doc(decision("Not yet"), task("Draft task")), {
      mode: "publish",
      labels: ["vpn"],
    });
    const elsewhere = await page(hidden.id, "Other space", doc(decision("Elsewhere"), task("Far away")), {
      labels: ["vpn"],
    });
    const closedParent = await page(hidden.id, "Closed parent", doc(paragraph("Closed")));
    const sharedChild = await page(
      hidden.id,
      "Shared child",
      doc(decision("Shared decision"), task("Shared task")),
      { parentId: closedParent },
    );
    await test.services.pageAccess.change(editor, sharedChild, [
      {
        action: "share",
        holderKind: "account",
        holderId: outsiderId,
        role: "reader",
        includeDescendants: false,
      },
    ]);
    return {
      editor,
      reader,
      outsider,
      shared,
      hidden,
      alpha,
      child,
      secret,
      secretChild,
      draft,
      elsewhere,
      closedParent,
      sharedChild,
    };
  }

  it("list only pages the reader can see, in every space or one, filtered by label", async () => {
    const w = await world();
    const titles = async (
      viewer: typeof w.reader,
      request: Partial<typeof pageDefaults> & { labels?: string[] },
    ) =>
      (await test.services.reports.pages(viewer, { ...pageDefaults, ...request })).map((page) => page.title);
    expect(await titles(w.reader, { spaceId: w.shared.id })).toEqual(["Alpha", "Child", w.shared.name]);
    expect(await titles(w.reader, { spaceId: w.shared.id, labels: ["vpn"] })).toEqual(["Alpha", "Child"]);
    expect(await titles(w.reader, { labels: ["vpn"] })).toEqual(
      expect.not.arrayContaining(["Secret plan", "Secret child", "Unpublished draft", "Other space"]),
    );
    expect(await titles(w.outsider, { spaceId: w.shared.id })).toEqual([]);
    expect(await titles(w.editor, { spaceId: w.shared.id, labels: ["vpn"] })).toEqual([
      "Alpha",
      "Child",
      "Secret child",
      "Secret plan",
      "Unpublished draft",
    ]);
    expect(await titles(w.editor, { spaceId: w.shared.id, labels: ["security", "missing"] })).toEqual([
      "Child",
    ]);
    expect(
      await titles(w.editor, { spaceId: w.shared.id, labels: ["vpn"], reverse: true, limit: 2 }),
    ).toEqual(["Unpublished draft", "Secret plan"]);
  });

  it("sort by last change and creation, newest first unless reversed, and name the author", async () => {
    const w = await world();
    await test.database.execute(sql`
      update tree_items set content_updated_at = now() - interval '2 days', created_at = now() - interval '9 days'
      where id = ${w.alpha}`);
    const request = { ...pageDefaults, spaceId: w.shared.id, labels: ["vpn"] };
    const modified = await test.services.reports.pages(w.reader, { ...request, sort: "modified" });
    expect(modified.map((page) => page.title)).toEqual(["Child", "Alpha"]);
    expect(modified[0]?.author?.name).toBe("Editor");
    expect(modified[0]?.path).toBe(`/spaces/${w.shared.key}/pages/${w.child}/child`);
    const created = await test.services.reports.pages(w.reader, {
      ...request,
      sort: "created",
      reverse: true,
    });
    expect(created.map((page) => page.title)).toEqual(["Alpha", "Child"]);
  });

  it("list decisions only from pages the reader can see, without empty ones, by parent and label", async () => {
    const w = await world();
    const texts = async (
      viewer: typeof w.reader,
      request: Partial<typeof decisionDefaults> & { labels?: string[] },
    ) =>
      (await test.services.reports.decisions(viewer, { ...decisionDefaults, ...request })).items.map(
        (entry) => entry.text,
      );
    expect((await texts(w.reader, { spaceId: w.shared.id })).sort()).toEqual([
      "Rotate keys yearly",
      "Use WireGuard",
    ]);
    expect(await texts(w.reader, { labels: ["vpn"] })).not.toContain("Buy the competitor");
    expect(await texts(w.reader, { labels: ["vpn"] })).not.toContain("Elsewhere");
    expect(await texts(w.reader, { parentId: w.secret })).toEqual([]);
    expect(await texts(w.editor, { parentId: w.secret })).toEqual(["Keep it quiet"]);
    expect(await texts(w.editor, { spaceId: w.shared.id, labels: ["security"] })).toEqual([
      "Rotate keys yearly",
    ]);
    expect(await texts(w.outsider, { spaceId: w.shared.id })).toEqual([]);
  });

  it("page through decisions in both orders without gaps or repeats", async () => {
    const w = await world();
    const request = { ...decisionDefaults, spaceId: w.shared.id };
    for (const order of ["newest", "oldest"] as const) {
      const seen: string[] = [];
      let after: [string, string] | undefined;
      for (let round = 0; round < 10; round += 1) {
        const page = await test.services.reports.decisions(
          w.editor,
          { ...request, order },
          { after, limit: 2 },
        );
        seen.push(...page.items.map((entry) => entry.text));
        if (!page.next) break;
        after = page.next;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(4);
    }
  });

  it("filter tasks by pages with their descendants and by labels, never through a restricted page", async () => {
    const w = await world();
    const texts = async (viewer: typeof w.reader, filter: { pageIds?: string[]; labels?: string[] }) =>
      (await test.services.tasks.list(viewer, { ...filter, status: "all" })).items
        .map((entry) => entry.text)
        .sort();
    expect(await texts(w.reader, { pageIds: [w.alpha] })).toEqual(["Order keys", "Rotate"]);
    expect(await texts(w.reader, { pageIds: [w.secret] })).toEqual([]);
    expect(await texts(w.editor, { pageIds: [w.secret] })).toEqual(["Call bank", "Hide"]);
    expect(await texts(w.reader, { pageIds: [w.alpha], labels: ["security"] })).toEqual(["Rotate"]);
    expect(await texts(w.reader, { labels: ["vpn"] })).toEqual(["Order keys", "Rotate"]);
    const counts = await test.services.tasks.list(w.reader, { pageIds: [w.secret, w.elsewhere] });
    expect(counts.counts).toEqual({ open: 0, done: 0, overdue: 0 });
  });

  it("treat a page the viewer cannot see in the page and parent filters exactly like an unknown page", async () => {
    const w = await world();
    const unknown = randomUUID();
    expect(
      (await test.services.reports.decisions(w.outsider, decisionDefaults)).items.map((entry) => entry.text),
    ).toEqual(["Shared decision"]);
    expect(
      (await test.services.tasks.list(w.outsider, { status: "all" })).items.map((entry) => entry.text),
    ).toEqual(["Shared task"]);
    const decisions = async (parentId: string) =>
      test.services.reports.decisions(w.outsider, { ...decisionDefaults, parentId });
    expect(await decisions(w.closedParent)).toEqual(await decisions(unknown));
    expect(await decisions(unknown)).toEqual({ items: [], next: null });
    expect((await decisions(w.closedParent)).items).toEqual([]);
    expect(
      (
        await test.services.reports.decisions(w.editor, { ...decisionDefaults, parentId: w.closedParent })
      ).items.map((entry) => entry.text),
    ).toEqual(["Shared decision"]);
    const tasks = async (pageIds: string[]) =>
      test.services.tasks.list(w.outsider, { pageIds, status: "all" });
    expect(await tasks([w.closedParent])).toEqual(await tasks([unknown]));
    expect((await tasks([w.closedParent])).items).toEqual([]);
    expect(await tasks([w.closedParent, w.sharedChild])).toEqual(await tasks([unknown, w.sharedChild]));
    expect((await tasks([unknown, w.sharedChild])).items.map((entry) => entry.text)).toEqual(["Shared task"]);
    expect(
      (await test.services.tasks.list(w.editor, { pageIds: [w.closedParent], status: "all" })).items.map(
        (entry) => entry.text,
      ),
    ).toEqual(["Shared task"]);
    const rendered = async (parentId: string) => {
      const document = doc({ type: "decisionReport", attrs: { ...decisionDefaults, parentId } });
      return renderPageMarkdown(
        document,
        { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
        {
          childPages: new Map(),
          attachments: null,
          ...(await test.services.reports.forDocument(w.outsider, document)),
        },
      );
    };
    expect(await rendered(w.closedParent)).toBe(await rendered(unknown));
    expect(await rendered(w.closedParent)).not.toContain("Shared decision");
  });

  it("render the reports of a page as Markdown with what the reader may see", async () => {
    const w = await world();
    const document = doc(
      { type: "pageReport", attrs: { ...pageDefaults, spaceId: w.shared.id, labels: ["vpn"] } },
      { type: "decisionReport", attrs: { ...decisionDefaults, spaceId: w.shared.id } },
    );
    const references = { people: {}, pages: {}, topics: {}, tooLargeImages: [] };
    const forReader = renderPageMarkdown(document, references, {
      childPages: new Map(),
      attachments: null,
      ...(await test.services.reports.forDocument(w.reader, document)),
    });
    expect(forReader).toContain("Alpha");
    expect(forReader).toContain("Use WireGuard");
    for (const hidden of ["Secret", "Buy the competitor", "Keep it quiet", "Unpublished", "Not yet"]) {
      expect(forReader).not.toContain(hidden);
    }
    const forOutsider = renderPageMarkdown(document, references, {
      childPages: new Map(),
      attachments: null,
      ...(await test.services.reports.forDocument(w.outsider, document)),
    });
    expect(forOutsider).toBe("*No pages match the filters*\n\n*No decisions match the filters*\n");
  });
});
