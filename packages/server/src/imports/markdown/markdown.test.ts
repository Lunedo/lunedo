import type { NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
