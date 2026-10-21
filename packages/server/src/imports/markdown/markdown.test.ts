import type { NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { languageSetting } from "../../settings/builtin.js";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { importHarness } from "../testing/harness.js";
import { createZip, type ZipFileSpec } from "../testing/zip-writer.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

function textOf(node: NodeJson): string {
  return nodes(node)
    .map((entry) => entry.text ?? "")
    .join("");
}

const wiki: ZipFileSpec[] = [
  {
    name: "handbook/README.md",
    data: "# Team handbook\n\nStart with [Onboarding](guides/onboarding.md) or [[Network]].\n",
  },
  {
    name: "handbook/guides/onboarding.md",
    data: [
      "---",
      "title: Onboarding for new colleagues",
      "tags: [onboarding, it]",
      "date: 2024-02-03",
      "updated: 2024-05-06T07:08:09Z",
      "owner: Lukas",
      "---",
      "Welcome! See the [network page](../network/index.md#vlan) and ![Logo](../assets/logo.png).",
      "",
      "- [x] Get a laptop",
      "- [ ] Read the [[Network|network rules]]",
      "",
      "| Tool | Owner |",
      "| --- | --- |",
      "| Wiki | **IT** |",
      "",
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "<div>raw html</div>",
      "",
      "![[diagram.png]] and [missing](nowhere.md)",
    ].join("\n"),
  },
  { name: "handbook/guides/02-printers.md", data: "Printers are on floor 2.\n" },
  { name: "handbook/guides/10-phones.md", data: "Phones.\n" },
  { name: "handbook/network/index.md", data: "# Network\n\n## VLAN\n\nDetails about VLANs.\n" },
  { name: "handbook/network/plan.pdf", data: "%PDF-1.4 plan" },
  { name: "handbook/assets/logo.png", data: PNG },
  { name: "handbook/assets/diagram.png", data: PNG },
  { name: "handbook/.obsidian/workspace.json", data: "{}" },
];

describe.skipIf(!baseUrl)("Markdown folder imports", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function documentOf(itemId: string): Promise<NodeJson> {
    const result = await test.database.execute<{ snapshot: NodeJson }>(
      sql`select snapshot from page_documents where item_id = ${itemId}`,
    );
    return result.rows[0]?.snapshot as NodeJson;
  }

  async function pages(spaceId: string) {
    const result = await test.database.execute<{ id: string; title: string; parent_id: string | null }>(sql`
      select id, title, parent_id from tree_items where space_id = ${spaceId} and trash_entry_id is null
      order by position`);
    return result.rows;
  }

  async function importWiki(files: ZipFileSpec[], key: string) {
    const organization = await fixtures.organization();
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "handbook.zip", data: createZip(files) }],
      key,
    });
    return { organization, view };
  }

  it("suggests the front matter title of the root index file as the space name", async () => {
    const organization = await fixtures.organization();
    const analyzed = async (files: ZipFileSpec[]) => {
      const id = await harness.analyzedFiles({
        organizationId: organization.id,
        admin: organization.owner,
        source: "markdown",
        files: [{ name: "handbook.zip", data: createZip(files) }],
      });
      const row = await test.database.execute<{ space_name: string | null; space_key: string | null }>(
        sql`select space_name, space_key from imports where id = ${id}`,
      );
      return row.rows[0];
    };
    const titled = wiki.map((file) =>
      file.name === "handbook/README.md"
        ? { ...file, data: "---\ntitle: Team handbook\n---\nStart with the guides.\n" }
        : file,
    );
    expect(await analyzed(titled)).toMatchObject({ space_name: "Team handbook" });
    expect(await analyzed(wiki)).toMatchObject({ space_name: "handbook" });
  });

  it("turns folders into the page tree with index files, front matter, links, images and diagrams", async () => {
    const { organization, view } = await importWiki(wiki, "MDWIKI");
    expect(view.state).toBe("review");
    const spaceId = view.quarantineSpace?.id as string;
    const tree = await pages(spaceId);
    const byTitle = new Map(tree.map((page) => [page.title, page]));
    expect([...byTitle.keys()]).toEqual(
      expect.arrayContaining([
        "Onboarding for new colleagues",
        "Network",
        "guides",
        "02 printers",
        "10 phones",
      ]),
    );
    const guides = byTitle.get("guides");
    expect(byTitle.get("Onboarding for new colleagues")?.parent_id).toBe(guides?.id);
    const order = tree.filter((page) => page.parent_id === guides?.id).map((page) => page.title);
    expect(order.indexOf("02 printers")).toBeLessThan(order.indexOf("10 phones"));
    expect(byTitle.has("workspace")).toBe(false);

    const onboarding = byTitle.get("Onboarding for new colleagues")?.id as string;
    const document = await documentOf(onboarding);
    const all = nodes(document);
    const network = byTitle.get("Network")?.id as string;
    const links = all.flatMap((node) => node.marks ?? []).filter((mark) => mark.type === "link");
    const pageLinks = all.filter((node) => node.type === "pageLink");
    expect([
      ...links.map((mark) => String(mark.attrs?.href)),
      ...pageLinks.map((node) => node.attrs?.pageId),
    ]).toEqual(expect.arrayContaining([expect.stringContaining(network)]));
    expect(all.some((node) => node.type === "image")).toBe(true);
    expect(all.find((node) => node.type === "mermaid")?.attrs?.source).toBe("graph TD; A-->B");
    expect(all.find((node) => node.type === "codeBlock")?.attrs?.language).toBe("typescript");
    const tasks = all.filter((node) => node.type === "taskItem").map((node) => String(node.attrs?.id));
    expect(tasks).toHaveLength(2);
    const done = await test.database.execute<{ id: string; done: boolean }>(
      sql`select id, done from tasks where id = any(${sql.param(tasks)}::uuid[])`,
    );
    expect(tasks.map((id) => done.rows.find((row) => row.id === id)?.done)).toEqual([true, false]);
    expect(all.some((node) => node.type === "table")).toBe(true);
    expect(all.some((node) => node.type === "pageProperties")).toBe(true);
    expect(textOf(document)).toContain("raw html");

    const labels = await test.database.execute<{ name: string }>(sql`
      select label as name from page_labels where item_id = ${onboarding} order by label`);
    expect(labels.rows.map((row) => row.name)).toEqual(["it", "onboarding"]);
    const item = await test.database.execute<{ created_at: Date }>(
      sql`select created_at from tree_items where id = ${onboarding}`,
    );
    expect(new Date(item.rows[0]?.created_at as Date).toISOString()).toBe("2024-02-03T00:00:00.000Z");

    const attachments = await test.database.execute<{ name: string; item_id: string }>(sql`
      select a.name, a.item_id from attachments a join tree_items t on t.id = a.item_id
      where t.space_id = ${spaceId} and a.deleted_at is null order by a.name`);
    expect(attachments.rows.filter((row) => row.item_id === onboarding).map((row) => row.name)).toEqual([
      "diagram.png",
      "logo.png",
    ]);
    expect(attachments.rows.find((row) => row.name === "plan.pdf")?.item_id).toBe(network);

    const report = await test.services.imports.entries(harness.as(organization.owner), view.id, {
      category: "source",
      limit: 50,
    });
    const codes = report.entries.map((entry) => [
      entry.code,
      entry.details.construct ?? entry.details.target,
    ]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ["unsupportedMarkdown", "html"],
        ["unresolvedFileLink", "nowhere.md"],
      ]),
    );
  });

  it("makes the root README the home page and resolves wiki links by file name", async () => {
    const { view } = await importWiki(wiki, "MDHOME");
    const spaceId = view.quarantineSpace?.id as string;
    const overview = await test.database.execute<{ id: string }>(sql`
      select overview_item_id as id from spaces where id = ${spaceId}`);
    const document = await documentOf(overview.rows[0]?.id as string);
    const linked = nodes(document).filter(
      (node) => node.type === "pageLink" || (node.marks ?? []).length > 0,
    );
    expect(linked.length).toBeGreaterThanOrEqual(2);
    expect(textOf(document)).toContain("Start with");
  });

  it("re-imports a newer ZIP of the same folder and lists only the changed pages", async () => {
    const organization = await fixtures.organization();
    const first = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "handbook.zip", data: createZip(wiki) }],
      key: "MDAGAIN",
    });
    await test.services.imports.accept(harness.as(organization.owner), first.id, {
      visibility: "private",
      grants: [],
    });
    const changed = wiki.map((file) =>
      file.name === "handbook/guides/02-printers.md" ? { ...file, data: "Printers moved to floor 3." } : file,
    );
    const again = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "handbook-2.zip", data: createZip(changed) }],
      spaceId: first.quarantineSpace?.id ?? "",
      key: "MDAGAIN",
    });
    expect(again.source).toBe("markdown");
    expect(again.state).toBe("review");
    expect(again.counts).toMatchObject({ new: 0, updated: 1, conflicts: 0, deleted: 0 });
  });

  it("keeps the folder pages of an earlier import when the folder now has its own file", async () => {
    const organization = await fixtures.organization();
    const admin = harness.as(organization.owner);
    const before: ZipFileSpec[] = [
      { name: "it/README.md", data: "# IT\n" },
      { name: "it/Netzwerk/VPN-Zugangsdaten.md", data: "Zugang nur für IT.\n" },
    ];
    const first = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "it.zip", data: createZip(before) }],
      key: "MDFOLD",
    });
    await test.services.imports.accept(admin, first.id, { visibility: "organization", grants: [] });
    const folder = await harness.target(first.id, "page", "md:Netzwerk/");
    const secret = await harness.target(first.id, "page", "md:Netzwerk/VPN-Zugangsdaten.md");
    expect(folder).not.toBe("");
    await test.services.pageAccess.change(admin, folder, [{ action: "restrict", kind: "view" }]);
    const again = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [
        {
          name: "it-2.zip",
          data: createZip([
            ...before,
            { name: "it/Netzwerk/Netzwerk.md", data: "# Netzwerk\n\nÜbersicht.\n" },
          ]),
        },
      ],
      spaceId: first.quarantineSpace?.id ?? "",
      key: "MDFOLD",
    });
    expect(again.state).toBe("review");
    expect(again.counts).toMatchObject({ moved: 0, deleted: 0 });
    await harness.applyChanges(organization.owner, again.id);
    const parents = await test.database.execute<{ id: string; parent_id: string | null }>(sql`
      select id, parent_id from tree_items where space_id = ${first.quarantineSpace?.id ?? ""} and kind = 'page'`);
    const parentOf = (id: string) => parents.rows.find((row) => row.id === id)?.parent_id;
    expect(parentOf(secret)).toBe(folder);
    const overview = await harness.target(again.id, "page", "md:Netzwerk/Netzwerk.md");
    expect(parentOf(overview)).toBe(folder);
  });

  it("imports a knowledge base in the language of the organization", async () => {
    const organization = await fixtures.organization();
    await test.settings.set(languageSetting, { organization: organization.id }, "organization", "de");
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "hilfe.zip", data: createZip([{ name: "hilfe/Drucker.md", data: "Drucker.\n" }]) }],
      options: { knowledgeBase: true },
      key: "MDLANG",
    });
    const languages = await test.database.execute<{ default_language: string; languages: string[] }>(sql`
      select default_language, languages from knowledge_bases where space_id = ${view.quarantineSpace?.id ?? ""}`);
    expect(languages.rows[0]).toEqual({ default_language: "de", languages: ["de"] });
  });

  it("imports translations only into languages that fit and reports the others", async () => {
    const organization = await fixtures.organization();
    await test.settings.set(languageSetting, { organization: organization.id }, "organization", "de");
    const file = (name: string, language: string, translation: boolean, text: string): ZipFileSpec => ({
      name: `hilfe/Drucker/${name}.md`,
      data: `---\npagehall:\n  kind: page\n  language: ${language}\n${translation ? "  translation: true\n" : ""}---\n${text}\n`,
    });
    const files = [
      file("Drucker", "de", false, "Drucker einrichten."),
      file("Printer 1", "en", true, "Set up the printer."),
      file("Printer 2", "en", true, "Set up the printer again."),
      file("Stampante", "it", true, "Configurare la stampante."),
      file("Unbekannt", "xx", true, "Unbekannte Sprache."),
      file("Doppelt", "de", true, "Noch einmal Deutsch."),
    ];
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "hilfe.zip", data: createZip(files) }],
      options: { knowledgeBase: true },
      key: "MDTRANS",
    });
    expect(view.state).toBe("review");
    const spaceId = view.quarantineSpace?.id ?? "";
    const items = await test.database.execute<{
      title: string;
      parent_id: string | null;
      translation_of: string | null;
      content_language: string | null;
    }>(sql`
      select title, parent_id, translation_of, content_language from tree_items
      where space_id = ${spaceId} and kind = 'page' order by title`);
    const byTitle = new Map(items.rows.map((row) => [row.title, row]));
    const original = await harness.target(view.id, "page", "md:Drucker/Drucker.md");
    expect(byTitle.get("Printer 1")).toMatchObject({ translation_of: original, content_language: "en" });
    expect(byTitle.get("Stampante")).toMatchObject({ translation_of: original, content_language: "it" });
    for (const title of ["Printer 2", "Unbekannt", "Doppelt"]) {
      expect(byTitle.get(title), title).toMatchObject({ translation_of: null, content_language: null });
      expect(byTitle.get(title)?.parent_id, title).not.toBe(original);
    }
    const languages = await test.database.execute<{ languages: string[] }>(
      sql`select languages from knowledge_bases where space_id = ${spaceId}`,
    );
    expect([...(languages.rows[0]?.languages ?? [])].sort()).toEqual(["de", "en", "it"]);
    const problems = await test.database.execute<{ reason: string; language: string }>(sql`
      select details ->> 'reason' as reason, details ->> 'language' as language from import_problems
      where import_id = ${view.id} and code = 'translationNotImported' order by 1`);
    expect(problems.rows).toEqual([
      { reason: "defaultLanguage", language: "de" },
      { reason: "duplicate", language: "en" },
      { reason: "unknown", language: "xx" },
    ]);
  });

  describe("re-imports into a knowledge base", () => {
    const article = (name: string, language: string, translation: boolean, text: string): ZipFileSpec => ({
      name,
      data: `---\npagehall:\n  kind: page\n  language: ${language}\n${translation ? "  translation: true\n" : ""}---\n${text}\n`,
    });
    const before: ZipFileSpec[] = [
      article("hilfe/Geräte/Drucker/Drucker.md", "de", false, "Drucker einrichten."),
      article("hilfe/Geräte/Telefon/Telefon.md", "de", false, "Telefon einrichten."),
      article("hilfe/Geräte/Telefon/Phone.md", "en", true, "Set up the phone."),
    ];

    async function reimported(
      added: ZipFileSpec[],
      key: string,
      removed: readonly string[] = [],
      earlier: ZipFileSpec[] = [],
    ) {
      const organization = await fixtures.organization();
      await test.settings.set(languageSetting, { organization: organization.id }, "organization", "de");
      const first = await harness.importedFiles({
        organizationId: organization.id,
        admin: organization.owner,
        source: "markdown",
        files: [{ name: "hilfe.zip", data: createZip([...before, ...earlier]) }],
        options: { knowledgeBase: true },
        key,
      });
      await test.services.imports.accept(harness.as(organization.owner), first.id, {
        visibility: "organization",
        grants: [],
      });
      const spaceId = first.quarantineSpace?.id ?? "";
      const again = await harness.importedFiles({
        organizationId: organization.id,
        admin: organization.owner,
        source: "markdown",
        files: [
          {
            name: "hilfe-2.zip",
            data: createZip([
              ...[...before, ...earlier].filter((file) => !removed.includes(file.name)),
              ...added,
            ]),
          },
        ],
        spaceId,
        key,
      });
      expect(again.state).toBe("review");
      const applied = await harness.applyChanges(organization.owner, again.id);
      expect(applied.errorCode).toBeNull();
      const items = await test.database.execute<{
        id: string;
        title: string;
        kind: string;
        parent_id: string | null;
        translation_of: string | null;
        content_language: string | null;
        numbered: boolean;
      }>(sql`
        select t.id, t.title, t.kind, t.parent_id, t.translation_of, t.content_language,
          exists (select 1 from article_numbers n where n.item_id = t.id) as numbered
        from tree_items t where t.space_id = ${spaceId} and t.trash_entry_id is null`);
      return {
        first,
        again,
        spaceId,
        item: (title: string) => items.rows.find((row) => row.title === title),
        byId: (id: string) => items.rows.find((row) => row.id === id),
      };
    }

    it("imports a new translation file as a translation of its article", async () => {
      const result = await reimported(
        [article("hilfe/Geräte/Drucker/Printer.md", "en", true, "Set up the printer.")],
        "MDKBTRANS",
      );
      const original = await harness.target(result.first.id, "page", "md:Geräte/Drucker/Drucker.md");
      expect(result.item("Printer")).toMatchObject({
        parent_id: original,
        translation_of: original,
        content_language: "en",
        numbered: false,
      });
    });

    it("keeps an article in its category when its file turns into a translation", async () => {
      const result = await reimported(
        [article("hilfe/Geräte/Drucker/Handbuch.md", "en", true, "Printer manual.")],
        "MDKBMOVE",
        ["hilfe/Geräte/Drucker/Handbuch.md"],
        [{ name: "hilfe/Geräte/Drucker/Handbuch.md", data: "# Handbook\n\nDruckerhandbuch.\n" }],
      );
      const handbook = await harness.target(result.first.id, "page", "md:Geräte/Drucker/Handbuch.md");
      expect(handbook).not.toBe("");
      expect(result.byId(handbook)).toMatchObject({
        parent_id: result.item("Geräte")?.id,
        translation_of: null,
      });
    });

    it("places new files by the rules of the knowledge base", async () => {
      const result = await reimported(
        [
          article("hilfe/Geräte/Scanner/Scanner.md", "de", false, "Scanner einrichten."),
          { name: "hilfe/Geräte/Drucker/Wartung.md", data: "# Wartung\n\nToner wechseln.\n" },
          article("hilfe/Geräte/Drucker/Imprimante.md", "fr", true, "Configurer l'imprimante."),
          article("hilfe/Geräte/Telefon/Phone again.md", "en", true, "Set up the phone again."),
        ],
        "MDKBRULES",
      );
      const category = result.item("Geräte");
      expect(category?.kind).toBe("folder");
      expect(result.item("Scanner")).toMatchObject({ kind: "page", parent_id: category?.id, numbered: true });
      expect(result.item("Wartung")).toMatchObject({
        kind: "page",
        parent_id: category?.id,
        translation_of: null,
        numbered: true,
      });
      expect(result.item("Imprimante")).toBeUndefined();
      expect(result.item("Phone again")).toMatchObject({ parent_id: category?.id, translation_of: null });
      const languages = await test.database.execute<{ languages: string[] }>(
        sql`select languages from knowledge_bases where space_id = ${result.spaceId}`,
      );
      expect([...(languages.rows[0]?.languages ?? [])].sort()).toEqual(["de", "en"]);
      const problems = await test.database.execute<{ reason: string; language: string; outcome: string }>(sql`
        select details ->> 'reason' as reason, details ->> 'language' as language, details ->> 'outcome' as outcome
        from import_problems where import_id = ${result.again.id} and code = 'translationNotImported' order by 1`);
      expect(problems.rows).toEqual([
        { reason: "duplicate", language: "en", outcome: "separate" },
        { reason: "notEnabled", language: "fr", outcome: "skipped" },
      ]);
    });
  });

  it("starts a re-import of a Markdown space as a Markdown import", async () => {
    const organization = await fixtures.organization();
    const first = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "handbook.zip", data: createZip(wiki) }],
      key: "MDKIND",
    });
    await test.services.imports.accept(harness.as(organization.owner), first.id, {
      visibility: "private",
      grants: [],
    });
    const draft = await test.services.imports.create(harness.as(organization.owner), organization.id, {
      source: "confluence-xml",
      spaceId: first.quarantineSpace?.id ?? "",
    });
    expect(draft.source).toBe("markdown");
    await expect(
      test.services.imports.update(harness.as(organization.owner), draft.id, { source: "confluence-xml" }),
    ).rejects.toMatchObject({ code: "reimportSpaceFixed" });
  });

  it.each([
    ["a path outside the archive", [{ name: "../outside.md", data: "x" }], "unsafeEntryName"],
    ["a symbolic link", [{ name: "link.md", data: "/etc/passwd", symbolicLink: true }], "unsafeEntryName"],
    [
      "a zip bomb",
      [{ name: "bomb.md", data: Buffer.alloc(20 * 1024 * 1024, 0x61), deflate: true }],
      "compressionRatio",
    ],
    ["no Markdown files", [{ name: "image.png", data: PNG }], "noMarkdown"],
  ] as const)("refuses %s", async (_case, files, code) => {
    const organization = await fixtures.organization();
    const id = await harness.analyzedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "crafted.zip", data: createZip(files as unknown as ZipFileSpec[]) }],
    });
    const view = await test.services.imports.get(harness.as(organization.owner), id);
    expect(view.state).toBe("draft");
    expect(view.errorCode).toBe(code);
  });

  it("accepts only ZIP files for Markdown folders", async () => {
    const organization = await fixtures.organization();
    const draft = await test.services.imports.create(harness.as(organization.owner), organization.id, {
      source: "markdown",
    });
    const uploadId = await harness.upload(
      organization.owner,
      organization.id,
      Buffer.from("# x"),
      "notes.md",
    );
    await expect(
      test.services.imports.update(harness.as(organization.owner), draft.id, {
        file: { kind: "upload", uploadId },
      }),
    ).rejects.toMatchObject({ code: "wrongFileType" });
  });
});
