import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { bytesOf, unzip } from "../exports/fixtures.testing.js";
import { defaultExportOptions } from "../exports/options.js";
import { importHarness } from "../imports/testing/harness.js";
import { createZip } from "../imports/testing/zip-writer.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

type TreeRow = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  article_type: string | null;
  translation_of: string | null;
  content_language: string | null;
};

describe.skipIf(!baseUrl)("knowledge base round trip between instances", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function tree(spaceId: string): Promise<TreeRow[]> {
    const result = await test.database.execute<TreeRow>(sql`
      select id, parent_id, kind, title, article_type, translation_of, content_language from tree_items
      where space_id = ${spaceId} and trash_entry_id is null order by title`);
    return result.rows;
  }

  async function published(itemId: string): Promise<NodeJson> {
    const result = await test.database.execute<{ document: NodeJson }>(sql`
      select v.document from tree_items t join page_versions v on v.id = t.published_version_id
      where t.id = ${itemId}`);
    return result.rows[0]?.document as NodeJson;
  }

  async function knowledgeBase(owner: Principal, organizationId: string) {
    const name = `Hilfe ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      owner,
      organizationId,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        audience: "signedIn",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await test.services.translations.update(owner, kb.id, { defaultLanguage: "de", languages: ["de", "en"] });
    const network = await test.services.tree.create(owner, kb.id, {
      kind: "folder",
      title: "Netzwerk",
      placement: { parentId: null },
    });
    const vpn = await test.services.tree.create(owner, kb.id, {
      kind: "folder",
      title: "VPN",
      placement: { parentId: network.id },
    });
    const article = await test.services.tree.create(owner, kb.id, {
      kind: "page",
      title: "VPN einrichten",
      placement: { parentId: vpn.id },
    });
    await test.services.knowledgeBases.setArticleType(article.id, "howTo");
    const image = await test.services.attachments.upload(owner, article.id, {
      name: "client.png",
      body: Readable.from([PNG]),
      contentLength: PNG.length,
    });
    await test.services.documents.replace(owner, article.id, {
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { key: "summary", title: "Worum es geht", icon: "eye" },
          content: [paragraph("Der Client verbindet dich mit dem Büro.")],
        },
        {
          type: "section",
          attrs: { key: "steps", title: "Schritte", icon: "list-ordered" },
          content: [
            paragraph("Öffne den Client."),
            { type: "image", attrs: { attachmentId: image.id, alt: "Der Client" } },
          ],
        },
      ],
    });
    await test.services.versions.publish(owner, article.id);
    const translation = await test.services.translations.create(owner, article.id, "en");
    await test.services.documents.replace(owner, translation.id, {
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { key: "summary", title: "What it is about", icon: "eye" },
          content: [paragraph("The client connects you to the office.")],
        },
      ],
    });
    await test.services.tree.update(owner, translation.id, { title: "Set up the VPN" });
    await test.services.versions.publish(owner, translation.id);
    const fault = await test.services.tree.create(owner, kb.id, {
      kind: "page",
      title: "Drucker druckt nicht",
      placement: { parentId: network.id },
    });
    await test.services.knowledgeBases.setArticleType(fault.id, "troubleshooting");
    await test.services.documents.replace(owner, fault.id, {
      type: "doc",
      content: [paragraph("Starte den Drucker neu.")],
    });
    await test.services.versions.publish(owner, fault.id);
    return kb;
  }

  async function exported(owner: Principal, spaceId: string, format: "markdown" | "html") {
    const started = await test.services.exports.start(
      owner,
      { spaceId },
      { format, options: defaultExportOptions },
    );
    await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
    const file = await test.services.exports.download(owner, started.id);
    return bytesOf(file);
  }

  it("carries categories, article types, sections, images and translations through Markdown", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const source = await knowledgeBase(owner, organization.id);

    const archive = await exported(owner, source.id, "markdown");
    const files = await unzip(archive);
    const markdown = [...files].find(([path]) => path.endsWith("VPN einrichten.md"));
    expect(markdown?.[1].toString("utf8")).toMatch(/^---\n[\s\S]*articleType: howTo[\s\S]*language: de/);
    expect(markdown?.[1].toString("utf8")).toContain(
      '<!-- lunedo:section key="steps" icon="list-ordered" -->',
    );

    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "hilfe.zip", data: archive }],
      options: { knowledgeBase: true },
      key: `RT${randomUUID()
        .slice(0, 6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X")}`,
    });
    expect(view.state).toBe("review");
    await test.services.imports.accept(owner, view.id, { visibility: "organization", grants: [] });
    const targetId = view.quarantineSpace?.id as string;
    const space = await test.database.execute<{
      type: string;
      audience: string;
      visibility: string;
      quarantined: boolean;
    }>(sql`select type, audience, visibility, quarantined from spaces where id = ${targetId}`);
    expect(space.rows[0]).toEqual({
      type: "knowledgeBase",
      audience: "groups",
      visibility: "private",
      quarantined: false,
    });

    const before = await tree(source.id);
    const after = await tree(targetId);
    const shape = (rows: TreeRow[]) => {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return rows.map((row) => ({
        kind: row.kind,
        title: row.title,
        parent: row.parent_id ? (byId.get(row.parent_id)?.title ?? null) : null,
        articleType: row.article_type,
        translationOf: row.translation_of ? (byId.get(row.translation_of)?.title ?? null) : null,
        language: row.translation_of ? row.content_language : null,
      }));
    };
    expect(shape(after)).toEqual(shape(before));

    const original = after.find((row) => row.title === "VPN einrichten") as TreeRow;
    const document = await published(original.id);
    const sections = nodes(document).filter((node) => node.type === "section");
    expect(sections.map((node) => node.attrs)).toEqual([
      { key: "summary", title: "Worum es geht", icon: "eye" },
      { key: "steps", title: "Schritte", icon: "list-ordered" },
    ]);
    const image = nodes(document).find((node) => node.type === "image");
    const attachment = await test.database.execute<{ name: string; item_id: string }>(
      sql`select name, item_id from attachments where id = ${String(image?.attrs?.attachmentId)}`,
    );
    expect(attachment.rows[0]).toEqual({ name: "client.png", item_id: original.id });
    const numbers = await test.database.execute<{ item_id: string }>(
      sql`select item_id from article_numbers where space_id = ${targetId}`,
    );
    expect(numbers.rows).toHaveLength(2);
  });

  it("keeps the article type and the sections in the HTML archive", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const source = await knowledgeBase(owner, organization.id);
    const files = await unzip(await exported(owner, source.id, "html"));
    const html = [...files].find(([path]) => path.endsWith("VPN einrichten.html"))?.[1].toString("utf8");
    expect(html).toContain('data-section="steps"');
    expect(html).toContain('data-icon="list-ordered"');
    expect(html).toContain('<meta name="lunedo:article-type" content="howTo">');
    expect(html).toContain('<html lang="de"');
  });

  it("offers the knowledge base option only for Markdown folders", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const created = await test.services.imports.create(owner, organization.id, { source: "word" });
    await expect(
      test.services.imports.update(owner, created.id, { options: { knowledgeBase: true } }),
    ).rejects.toMatchObject({ code: "invalidOptions" });
  });

  it("imports a plain Markdown folder as a knowledge base with folders as categories", async () => {
    const organization = await fixtures.organization();
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [
        {
          name: "docs.zip",
          data: createZip([
            { name: "docs/README.md", data: "# Docs\n\nStart here.\n" },
            { name: "docs/setup/index.md", data: "# Setup\n\nInstall it.\n" },
            { name: "docs/setup/backup.md", data: "# Backup\n\nSave it.\n" },
          ]),
        },
      ],
      options: { knowledgeBase: true },
      key: `MK${randomUUID()
        .slice(0, 6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X")}`,
    });
    expect(view.state).toBe("review");
    const rows = await tree(view.quarantineSpace?.id as string);
    const byTitle = new Map(rows.map((row) => [row.title, row]));
    expect(byTitle.get("setup")?.kind).toBe("folder");
    expect(byTitle.get("Setup")).toMatchObject({ kind: "page", parent_id: byTitle.get("setup")?.id });
    expect(byTitle.get("Backup")).toMatchObject({ kind: "page", parent_id: byTitle.get("setup")?.id });
    expect(byTitle.get("Docs")).toMatchObject({ kind: "page", parent_id: null });
    const portal = await test.services.portals.config(view.quarantineSpace?.id as string);
    expect(portal).toBeNull();
  });
});
