import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson, PropertiesReportRequest } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import mammoth from "mammoth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { bytesOf } from "../exports/fixtures.testing.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

const text = (value: string): NodeJson => ({ type: "text", text: value });
const paragraph = (...content: NodeJson[]): NodeJson => ({ type: "paragraph", content });
const doc = (...content: NodeJson[]): DocumentJson => ({ type: "doc", content });
const stored = (value: string): NodeJson => ({
  type: "paragraph",
  attrs: { textAlign: "left", indent: 0 },
  content: [text(value)],
});

function properties(rows: Record<string, string>, attrs: Record<string, unknown> = {}): NodeJson {
  return {
    type: "pageProperties",
    attrs,
    content: Object.entries(rows).map(([key, value]) => ({
      type: "pageProperty",
      content: [
        { type: "pagePropertyKey", content: [text(key)] },
        { type: "pagePropertyValue", content: [value ? paragraph(text(value)) : { type: "paragraph" }] },
      ],
    })),
  };
}

const report = (request: Partial<PropertiesReportRequest>): PropertiesReportRequest => ({
  spaceIds: [],
  labels: [],
  setId: null,
  columns: [],
  sortBy: null,
  reverse: false,
  pageSize: 30,
  ...request,
});

describe.skipIf(!baseUrl)("page properties, label reports and includes", () => {
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
    const editor = accountPrincipal(editorId);
    const reader = accountPrincipal(readerId);
    const grants = [{ principalKind: "account" as const, principalId: readerId, role: "reader" as const }];
    const first = await space(org.id, editorId, { grants });
    const second = await space(org.id, editorId, { grants });
    const third = await space(org.id, editorId, { grants });
    const closed = await space(org.id, editorId);
    const page = async (
      spaceId: string,
      title: string,
      content: DocumentJson,
      options: { labels?: string[]; mode?: "live" | "publish"; kind?: "page" | "blogPost" } = {},
    ) => {
      const created = await test.services.tree.create(editor, spaceId, {
        kind: options.kind ?? "page",
        title,
        mode: options.mode ?? "live",
        placement: { parentId: null },
      });
      await test.services.documents.replace(editor, created.id, content);
      for (const label of options.labels ?? [])
        await test.services.documents.addLabel(editor, created.id, label);
      return created.id;
    };
    const site = ["site"];
    const graz = await page(first.id, "Graz", doc(properties({ Owner: "Lukas", Switches: "6" })), {
      labels: [...site, "network"],
    });
    const linz = await page(second.id, "Linz", doc(properties({ Owner: "Julia", Switches: "12" })), {
      labels: site,
    });
    const secret = await page(
      first.id,
      "Aardvark secret site",
      doc(properties({ Owner: "Board", Switches: "1", "Secret key": "x" })),
      { labels: [...site, "confidential"] },
    );
    await test.services.pageAccess.change(editor, secret, [{ action: "restrict", kind: "view" }]);
    const draft = await page(second.id, "Draft site", doc(properties({ Owner: "Nobody", Switches: "2" })), {
      labels: site,
      mode: "publish",
    });
    const wien = await page(third.id, "Wien", doc(properties({ Owner: "Bernd", Switches: "9" })), {
      labels: site,
      mode: "publish",
    });
    await test.services.versions.publish(editor, wien);
    await test.services.documents.replace(editor, wien, doc(properties({ Owner: "Changed in draft" })));
    const elsewhere = await page(closed.id, "Closed site", doc(properties({ Owner: "Hidden" })), {
      labels: site,
    });
    return {
      org,
      editor,
      reader,
      first,
      second,
      third,
      closed,
      graz,
      linz,
      secret,
      draft,
      wien,
      elsewhere,
      page,
    };
  }

  async function titles(viewer: Principal, request: PropertiesReportRequest) {
    const result = await test.services.reports.properties(viewer, request);
    return { titles: result.rows.map((row) => row.page.title), total: result.total, result };
  }

  describe("page properties report", () => {
    it("stores the values of the published version only", async () => {
      const w = await world();
      const rows = await test.database.execute<{ item_id: string; key: string; text: string }>(sql`
        select item_id, key, text from page_properties
        where item_id = any(${sql.param([w.wien, w.draft])}::uuid[]) order by item_id, position`);
      expect(rows.rows).toEqual([
        { item_id: w.wien, key: "Owner", text: "Bernd" },
        { item_id: w.wien, key: "Switches", text: "9" },
      ]);
    });

    it("lists only pages the viewer may read, in counts and sorting too", async () => {
      const w = await world();
      const request = report({
        spaceIds: [w.first.id, w.second.id, w.third.id],
        labels: ["site"],
        sortBy: "Switches",
      });
      const forReader = await titles(w.reader, request);
      expect(forReader.titles).toEqual(["Graz", "Wien", "Linz"]);
      expect(forReader.total).toBe(3);
      expect(forReader.result.keys).toEqual(["Owner", "Switches"]);
      expect(forReader.result.rows[1]?.cells).toEqual([[stored("Bernd")], [stored("9")]]);
      const forEditor = await titles(w.editor, request);
      expect(forEditor.titles).toEqual(["Aardvark secret site", "Graz", "Wien", "Linz"]);
      expect(forEditor.result.keys).toEqual(["Owner", "Switches", "Secret key"]);
      const reversed = await titles(w.reader, { ...request, reverse: true });
      expect(reversed.titles).toEqual(["Linz", "Wien", "Graz"]);
      const byTitle = await titles(w.reader, { ...request, sortBy: null, pageSize: 2 });
      expect(byTitle.titles).toEqual(["Graz", "Linz"]);
      expect(byTitle.total).toBe(3);
      const next = await test.services.reports.properties(
        w.reader,
        { ...request, sortBy: null, pageSize: 2 },
        {
          offset: 2,
        },
      );
      expect(next.rows.map((row) => row.page.title)).toEqual(["Wien"]);
    });

    it("shows the chosen columns and only the values of the chosen property set", async () => {
      const w = await world();
      const sets = await w.page(
        w.first.id,
        "Two sets",
        doc(
          properties({ Owner: "General" }),
          properties({ Owner: "Network team", Uplink: "1G" }, { setId: "net" }),
        ),
        { labels: ["sets"] },
      );
      const all = await test.services.reports.properties(
        w.reader,
        report({ labels: ["sets"], columns: ["uplink", "Owner"] }),
      );
      expect(all.columns).toEqual(["uplink", "Owner"]);
      expect(all.rows[0]?.cells).toEqual([[stored("1G")], [stored("General")]]);
      const net = await test.services.reports.properties(
        w.reader,
        report({ labels: ["sets"], setId: "net" }),
      );
      expect(net.columns).toEqual(["Owner", "Uplink"]);
      expect(net.rows.map((row) => [row.page.id, row.cells])).toEqual([
        [sets, [[stored("Network team")], [stored("1G")]]],
      ]);
      expect(
        (await test.services.reports.properties(w.reader, report({ labels: ["sets"], setId: "other" })))
          .total,
      ).toBe(0);
    });

    it("answers within a second for a space with thousands of pages", async () => {
      const w = await world();
      const template = await w.page(
        w.first.id,
        "Template",
        doc(properties({ Owner: "Seed", Switches: "1" })),
        {
          labels: ["bulk"],
        },
      );
      await test.database.execute(sql`
        with copies as (
          select n, gen_random_uuid() as id from generate_series(1, 3000) as n
        ), inserted as (
          insert into tree_items
          select (jsonb_populate_record(null::tree_items, to_jsonb(t) || jsonb_build_object(
            'id', c.id, 'title', 'Site ' || c.n, 'position', t.position || lpad(c.n::text, 5, '0'),
            'path', jsonb_build_array(c.id)))).*
          from tree_items t cross join copies c where t.id = ${template}
          returning id, title
        ), labels as (
          insert into page_labels (item_id, label) select id, 'bulk' from inserted
        )
        insert into page_properties (item_id, block, position, set_id, key, key_normalized, value, text, sort_key)
        select i.id, 0, p.position, null, p.key, p.key_normalized, v.value, p.text, v.sort_key
        from inserted i cross join (values
          (0, 'Owner', 'owner', 'Seed'), (1, 'Switches', 'switches', 'n')) as p(position, key, key_normalized, text)
          cross join lateral (select jsonb_build_array(jsonb_build_object('type', 'paragraph')) as value,
            lpad(split_part(i.title, ' ', 2), 20, '0') as sort_key) v
        `);
      const started = performance.now();
      const result = await test.services.reports.properties(
        w.reader,
        report({ spaceIds: [w.first.id], labels: ["bulk"], sortBy: "Switches", reverse: true, pageSize: 50 }),
      );
      const elapsed = performance.now() - started;
      expect(result.total).toBe(3001);
      expect(result.rows).toHaveLength(50);
      expect(elapsed).toBeLessThan(1000);
    }, 60_000);
  });

  describe("content by label", () => {
    it("lists readable pages with all or any of the labels and their excerpts", async () => {
      const w = await world();
      const guide = await w.page(
        w.first.id,
        "Guide",
        doc(paragraph(text("Intro")), {
          type: "excerpt",
          attrs: { name: null, hidden: true },
          content: [paragraph(text("Short version"))],
        }),
        { labels: ["network", "how-to"] },
      );
      const request = {
        labels: ["network", "how-to"],
        matchAll: false,
        spaceIds: [],
        kinds: ["page" as const, "blogPost" as const],
        sort: "title" as const,
        reverse: false,
        limit: 10,
        excerpts: true,
      };
      const any = await test.services.reports.labeledContent(w.reader, request);
      expect(any.map((item) => [item.title, item.excerpt, item.labels])).toEqual([
        ["Graz", null, ["network", "site"]],
        ["Guide", "Short version", ["how-to", "network"]],
      ]);
      expect(any[1]?.path).toBe(`/spaces/${encodeURIComponent(w.first.key)}/pages/${guide}/guide`);
      const all = await test.services.reports.labeledContent(w.reader, { ...request, matchAll: true });
      expect(all.map((item) => item.title)).toEqual(["Guide"]);
      const confidential = await test.services.reports.labeledContent(w.reader, {
        ...request,
        labels: ["confidential"],
      });
      expect(confidential).toEqual([]);
      expect(
        (await test.services.reports.labeledContent(w.editor, { ...request, labels: ["confidential"] })).map(
          (item) => item.title,
        ),
      ).toEqual(["Aardvark secret site"]);
      expect(
        await test.services.reports.labeledContent(w.reader, { ...request, kinds: ["blogPost"] }),
      ).toEqual([]);
    });
  });

  describe("related labels", () => {
    it("lists labels used together with the labels of the page on readable pages only", async () => {
      const w = await world();
      const related = await test.services.reports.relatedLabels(w.reader, w.linz, []);
      expect(related).toEqual([
        { label: "network", href: `/spaces/${encodeURIComponent(w.second.key)}/labels/network` },
      ]);
      const forEditor = await test.services.reports.relatedLabels(w.editor, w.linz, []);
      expect(forEditor.map((label) => label.label).sort()).toEqual(["confidential", "network"]);
      expect(await test.services.reports.relatedLabels(w.reader, w.linz, ["unknown"])).toEqual([]);
    });
  });

  describe("includes", () => {
    const include = (attrs: Record<string, unknown>) => ({
      pageId: null,
      sourceSpace: null,
      sourceTitle: null,
      excerpt: false,
      name: null,
      ...attrs,
    });

    it("give the published content of a readable page and nothing for a hidden or unknown one", async () => {
      const w = await world();
      const content = await test.services.includes.content(w.reader, w.graz, include({ pageId: w.wien }));
      expect(content).toMatchObject({ state: "visible", page: { id: w.wien, title: "Wien" } });
      expect(JSON.stringify(content?.state === "visible" ? content.document : null)).toContain("Bernd");
      expect(JSON.stringify(content?.state === "visible" ? content.document : null)).not.toContain("Changed");
      expect(
        await test.services.includes.content(w.reader, w.graz, include({ pageId: w.secret })),
      ).toBeNull();
      expect(await test.services.includes.content(w.reader, w.graz, include({ pageId: w.draft }))).toBeNull();
      expect(
        await test.services.includes.content(w.reader, w.graz, include({ pageId: randomUUID() })),
      ).toBeNull();
    });

    it("tell editors of the including page when some of its readers cannot read the included page", async () => {
      const w = await world();
      const hidden = await test.services.includes.content(w.editor, w.graz, include({ pageId: w.secret }));
      expect(hidden).toMatchObject({ state: "visible", hiddenFromSomeReaders: true });
      const excerpt = await test.services.includes.content(
        w.editor,
        w.graz,
        include({ pageId: w.secret, excerpt: true }),
      );
      expect(excerpt?.hiddenFromSomeReaders).toBe(true);
      const shared = await test.services.includes.content(w.editor, w.graz, include({ pageId: w.wien }));
      expect(shared?.hiddenFromSomeReaders).toBe(false);
      const forReader = await test.services.includes.content(w.reader, w.graz, include({ pageId: w.wien }));
      expect(forReader?.hiddenFromSomeReaders).toBe(false);
    });

    it("give an excerpt by name, or say the page has none", async () => {
      const w = await world();
      const source = await w.page(
        w.first.id,
        "Contacts",
        doc(
          { type: "excerpt", attrs: { name: null }, content: [paragraph(text("First"))] },
          { type: "excerpt", attrs: { name: "phone", hidden: true }, content: [stored("Call 123")] },
        ),
      );
      const named = await test.services.includes.content(
        w.reader,
        w.graz,
        include({ pageId: source, excerpt: true, name: "phone" }),
      );
      expect(named?.state === "visible" ? named.document : null).toEqual(doc(stored("Call 123")));
      const none = await test.services.includes.content(
        w.reader,
        w.graz,
        include({ pageId: w.linz, excerpt: true }),
      );
      expect(none).toMatchObject({ state: "noExcerpt", page: { id: w.linz } });
    });

    it("find a page imported later by its Confluence space key and title, within the organization", async () => {
      const w = await world();
      const other = await organization();
      const outside = await space(other.id, other.owner);
      for (const target of [w.third.id, outside.id]) {
        await test.database.execute(sql`
          insert into imported_spaces (space_id, source, source_space_id, source_space_key)
          values (${target}, 'confluence-xml', ${randomUUID()}, 'ops')`);
      }
      const request = include({ sourceSpace: "OPS", sourceTitle: " wien " });
      expect(await test.services.includes.target(w.reader, w.graz, request)).toMatchObject({ id: w.wien });
      expect(
        await test.services.includes.target(
          w.reader,
          w.graz,
          include({ sourceSpace: "OPS", sourceTitle: "Nowhere" }),
        ),
      ).toBeNull();
      expect(
        await test.services.includes.target(
          w.reader,
          w.graz,
          include({ sourceSpace: "XYZ", sourceTitle: "Wien" }),
        ),
      ).toBeNull();
    });
  });

  describe("print and Word", () => {
    const includePage = (pageId: string): NodeJson => ({ type: "includePage", attrs: { pageId } });

    async function printed(viewer: Principal, pageId: string) {
      const file = await test.services.exports.page(viewer, pageId, "print");
      return (await bytesOf(file)).toString("utf8");
    }

    it("render included content and reports with the exporter's permissions", async () => {
      const w = await world();
      const host = await w.page(
        w.first.id,
        "Host",
        doc(
          paragraph(text("Host text")),
          includePage(w.wien),
          includePage(w.secret),
          { type: "includeExcerpt", attrs: { pageId: w.linz } },
          { type: "propertiesReport", attrs: { labels: ["site"], columns: ["Owner"] } },
          { type: "contentByLabel", attrs: { labels: ["confidential", "network"] } },
          { type: "relatedLabels", attrs: { labels: ["site"] } },
        ),
      );
      const html = await printed(w.reader, host);
      expect(html).toContain("Bernd");
      expect(html).not.toContain("Changed in draft");
      expect(html).not.toContain("Board");
      expect(html).not.toContain("Restricted content");
      expect(html).toContain("The included page has no excerpt.");
      expect(html).toContain("Lukas");
      expect(html).not.toContain("Aardvark");
      expect(html).not.toContain(">confidential</a>");
      expect(html).toContain(">network</a>");
      const editorHtml = await printed(w.editor, host);
      expect(editorHtml).toContain("Board");
      expect(editorHtml).toContain("Aardvark secret site");
      const word = await bytesOf(await test.services.exports.page(w.reader, host, "docx"));
      const content = (await mammoth.convertToHtml({ buffer: word })).value;
      expect(content).toContain("Host text");
      expect(content).toContain("Bernd");
      expect(content).not.toContain("Board");
    });

    it("stop loops and include at most three levels", async () => {
      const w = await world();
      const chain: string[] = [];
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        chain.push(await w.page(w.first.id, name, doc(paragraph(text(`${name} text`)))));
      }
      for (const [index, id] of chain.entries()) {
        const next = chain[index + 1];
        await test.services.documents.replace(
          w.editor,
          id,
          doc(paragraph(text(`Level ${index} text`)), includePage(next ?? (chain[0] as string))),
        );
      }
      const html = await printed(w.reader, chain[0] as string);
      expect(html).toContain("Level 0 text");
      expect(html).toContain("Level 3 text");
      expect(html).not.toContain("Level 4 text");
      expect(html).toContain("included pages are nested too deeply");
      const loop = await w.page(w.first.id, "Loop", doc(paragraph(text("Loop text"))));
      const back = await w.page(w.first.id, "Back", doc(paragraph(text("Back text")), includePage(loop)));
      await test.services.documents.replace(
        w.editor,
        loop,
        doc(paragraph(text("Loop text")), includePage(back)),
      );
      const looped = await printed(w.reader, loop);
      expect(looped).toContain("Back text");
      expect(looped).toContain("would include itself");
    });
  });
});
