import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import MiniSearch from "minisearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, accountPrincipal, type Principal } from "../../accounts/principal.js";
import { bytesOf, unzip } from "../../exports/fixtures.testing.js";
import { defaultExportOptions } from "../../exports/options.js";
import { importHarness } from "../../imports/testing/harness.js";
import { createZip, type ZipFileSpec } from "../../imports/testing/zip-writer.js";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { testJobContext } from "../../testing/jobs.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { STATIC_SEARCH_OPTIONS } from "./static-site.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");
const CATEGORIES: Record<string, string> = {
  setup: "Operations",
  configuration: "Operations",
  backup: "Operations",
  database: "Operations",
  storage: "Operations",
  email: "Operations",
  encryption: "Operations",
  rendering: "Operations",
  authentication: "Identity and access",
  "identity-providers": "Identity and access",
  organizations: "Identity and access",
  audit: "Identity and access",
  spaces: "Content",
  "editor-schema": "Content",
  "embeds-and-blocks": "Content",
  diagrams: "Content",
  whiteboards: "Content",
  templates: "Content",
  "reports-and-reuse": "Content",
  imports: "Content",
  "knowledge-bases": "Content",
  collaboration: "Content",
  notifications: "Content",
};
const TYPES: Record<string, string> = {
  "text/html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
};

function serve(root: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://site").pathname);
    const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path));
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (content) => {
        response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        response.end(content);
      },
      () => response.writeHead(404).end(),
    );
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

function links(html: string): string[] {
  return [...html.matchAll(/(?:href|src|action|data-index|data-fallback-index)="([^"]*)"/g)].map((match) =>
    (match[1] ?? "").replaceAll("&amp;", "&"),
  );
}

describe.skipIf(!baseUrl)("static website of a knowledge base", () => {
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

  async function docsKnowledgeBase() {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const files: ZipFileSpec[] = [];
    for (const name of (await readdir(DOCS)).filter((entry) => entry.endsWith(".md")).sort()) {
      const stem = name.replace(/\.md$/, "");
      files.push({
        name: `docs/${CATEGORIES[stem] ?? "Development"}/${name}`,
        data: await readFile(join(DOCS, name), "utf8"),
      });
    }
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "markdown",
      files: [{ name: "docs.zip", data: createZip(files) }],
      options: { knowledgeBase: true },
      key: `DOC${randomUUID()
        .slice(0, 5)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X")}`,
    });
    expect(view.state).toBe("review");
    await test.services.imports.accept(owner, view.id, { visibility: "private", grants: [] });
    const spaceId = view.quarantineSpace?.id as string;
    return { organization, owner, spaceId, articles: files.length };
  }

  async function site(owner: Principal, spaceId: string, siteUrl: string | null) {
    const started = await test.services.exports.start(
      owner,
      { spaceId },
      { format: "site", options: { ...defaultExportOptions, siteUrl } },
    );
    await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
    expect(await test.services.exports.get(owner, started.id)).toMatchObject({
      state: "ready",
      format: "site",
    });
    return unzip(await bytesOf(await test.services.exports.download(owner, started.id)));
  }

  it("builds the documentation as a website that works when served as plain files", async () => {
    const { owner, spaceId, articles } = await docsKnowledgeBase();
    await expect(site(owner, spaceId, null)).rejects.toMatchObject({ code: "staticSiteNotPublic" });
    await test.services.knowledgeBases.changeAudience(owner, spaceId, {
      audience: "public",
      groupIds: [],
      confirmWidening: true,
    });
    const spaces = await test.database.execute<{ id: string; title: string }>(sql`
      select id, title from tree_items where space_id = ${spaceId} and kind = 'page' and title = 'Knowledge bases'`);
    const renamed = spaces.rows[0]?.id as string;
    await test.services.tree.update(owner, renamed, { title: "Help portals" });
    await test.services.versions.publish(owner, renamed);
    await test.services.translations.update(owner, spaceId, { languages: ["en", "de"] });
    const backup = (
      await test.database.execute<{ id: string }>(sql`
        select id from tree_items where space_id = ${spaceId} and kind = 'page' and title = 'Backups'`)
    ).rows[0]?.id as string;
    const german = await test.services.translations.create(owner, backup, "de");
    await test.services.documents.replace(owner, german.id, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Sicherung der Datenbank und der Dateien." }] },
      ],
    });
    await test.services.tree.update(owner, german.id, { title: "Sicherung" });
    await test.services.versions.publish(owner, german.id);

    const files = await site(owner, spaceId, "https://help.example.org/docs/");
    const pages = [...files.keys()].filter((path) => /^\d+-.+\.html$/.test(path));
    expect(pages.length).toBeGreaterThanOrEqual(articles - 1);
    const numbers = await test.database.execute<{ number: number; item_id: string }>(
      sql`select number, item_id from article_numbers where space_id = ${spaceId}`,
    );
    const renamedNumber = numbers.rows.find((row) => row.item_id === renamed)?.number;
    const backupNumber = numbers.rows.find((row) => row.item_id === backup)?.number;

    const root = await mkdtemp(join(tmpdir(), "pagehall-site-"));
    try {
      for (const [path, content] of files) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }
      const { server, origin } = await serve(root);
      try {
        const html = [...files.keys()].filter((path) => path.endsWith(".html"));
        const checked = new Set<string>();
        for (const path of html) {
          const page = files.get(path)?.toString("utf8") ?? "";
          expect(page, path).not.toMatch(/data-feedback=|data-endpoint=|method="post"|aria-label="Sign in"/);
          for (const link of links(page)) {
            if (!link || link.startsWith("#") || /^(mailto:|https?:|data:)/.test(link)) continue;
            expect(link.startsWith("/"), `${path} links to ${link}`).toBe(false);
            const target = new URL(link, `${origin}/${path}`);
            target.hash = "";
            target.search = "";
            if (checked.has(target.href)) continue;
            checked.add(target.href);
            const response = await fetch(target);
            expect(response.status, `${path} links to ${link}`).toBe(200);
          }
        }

        const start = await (await fetch(`${origin}/index.html`)).text();
        expect(start).toContain("Operations");
        const category = (
          await test.database.execute<{ id: string }>(sql`
            select id from tree_items where space_id = ${spaceId} and kind = 'folder' and title = 'Operations'`)
        ).rows[0]?.id;
        const topic = await (await fetch(`${origin}/topics/${category}.html`)).text();
        expect(topic).toContain(">Backups<");
        expect(topic).not.toContain("data-autosubmit");

        const index = MiniSearch.loadJSON(
          await (await fetch(`${origin}/search-index.json`)).text(),
          STATIC_SEARCH_OPTIONS,
        );
        const found = index.search("passkey", { prefix: true });
        expect(found.length).toBeGreaterThan(0);
        expect((await fetch(`${origin}/${String(found[0]?.url)}`)).status).toBe(200);
        const search = await (await fetch(`${origin}/search.html`)).text();
        expect(search).toContain('data-index="search-index.json"');
        expect(search).toContain('src="./_assets/minisearch.js"');
        expect((await fetch(`${origin}/_assets/static-search.js`)).status).toBe(200);

        const redirects = files.get("_redirects")?.toString("utf8") ?? "";
        expect(redirects).toContain(`/${renamedNumber}-knowledge-bases /${renamedNumber}-help-portals 301`);
        const old = await (await fetch(`${origin}/${renamedNumber}-knowledge-bases.html`)).text();
        expect(old).toContain(`url=./${renamedNumber}-help-portals.html`);

        const translated = await (await fetch(`${origin}/de/${backupNumber}-sicherung.html`)).text();
        expect(translated).toContain('<html lang="de"');
        expect(translated).toContain("Sicherung der Datenbank");
        expect(translated).toContain(`href="../${backupNumber}-backups.html"`);
        expect((await fetch(`${origin}/de/search-index.json`)).status).toBe(200);

        const sitemap = files.get("sitemap.xml")?.toString("utf8") ?? "";
        expect(sitemap).toContain(`<loc>https://help.example.org/docs/${backupNumber}-backups.html</loc>`);
        expect(files.get("robots.txt")?.toString("utf8")).toContain(
          "Sitemap: https://help.example.org/docs/sitemap.xml",
        );
        expect(files.get(`${backupNumber}-backups.html`)?.toString("utf8")).toContain(
          `hreflang="de" href="https://help.example.org/docs/de/${backupNumber}-sicherung.html"`,
        );
      } finally {
        await new Promise((done) => server.close(done));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves out the sitemap without an address and refuses page exports as a website", async () => {
    const { owner, spaceId } = await docsKnowledgeBase();
    await test.services.knowledgeBases.changeAudience(owner, spaceId, {
      audience: "public",
      groupIds: [],
      confirmWidening: true,
    });
    const files = await site(owner, spaceId, null);
    expect(files.has("sitemap.xml")).toBe(false);
    expect(files.has("robots.txt")).toBe(false);
    expect(files.has("index.html")).toBe(true);
    const page = (
      await test.database.execute<{ id: string }>(sql`
        select id from tree_items where space_id = ${spaceId} and kind = 'page' limit 1`)
    ).rows[0]?.id as string;
    await expect(
      test.services.exports.start(owner, { pageId: page }, { format: "site", options: defaultExportOptions }),
    ).rejects.toMatchObject({ code: "nothingToExport" });
  }, 120_000);

  it("fails a waiting website when the knowledge base stops being public", async () => {
    const { owner, spaceId } = await docsKnowledgeBase();
    await test.services.knowledgeBases.changeAudience(owner, spaceId, {
      audience: "public",
      groupIds: [],
      confirmWidening: true,
    });
    const started = await test.services.exports.start(
      owner,
      { spaceId },
      { format: "site", options: defaultExportOptions },
    );
    await test.services.knowledgeBases.changeAudience(owner, spaceId, { audience: "signedIn", groupIds: [] });
    await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
    expect(await test.services.exports.get(owner, started.id)).toMatchObject({
      state: "failed",
      errorCode: "notPublic",
    });
  }, 120_000);

  async function knowledgeBase(owner: Principal, organizationId: string, audience: "public" | "signedIn") {
    const name = `Help ${randomUUID().slice(0, 8)}`;
    return test.services.spaces.create(
      owner,
      organizationId,
      { name, key: await test.services.spaces.suggestKey(name), type: "knowledgeBase", audience, grants: [] },
      test.services.spacePermissions.holders,
    );
  }

  async function article(owner: Principal, spaceId: string, title: string, text: string) {
    const created = await test.services.tree.create(owner, spaceId, {
      kind: "page",
      title,
      placement: { parentId: null },
    });
    await test.services.documents.replace(owner, created.id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    return created.id;
  }

  async function numberOf(itemId: string, spaceId: string) {
    const found = await test.database.execute<{ number: number }>(
      sql`select number from article_numbers where item_id = ${itemId} and space_id = ${spaceId}`,
    );
    return Number(found.rows[0]?.number);
  }

  it("keeps only titles published in this knowledge base as old addresses", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const open = await knowledgeBase(owner, organization.id, "public");
    const internal = await knowledgeBase(owner, organization.id, "signedIn");
    const drafted = await article(owner, open.id, "Entlassungen Standort Nord intern", "Text");
    await test.services.tree.update(owner, drafted, { title: "Zwischenstand Umzug" });
    await test.services.tree.update(owner, drafted, { title: "Standortwechsel FAQ" });
    await test.services.versions.publish(owner, drafted);
    await test.database.execute(
      sql`update tree_items set title = ${"Zwischenstand Kündigungen"} where id = ${drafted}`,
    );
    const moved = await article(owner, internal.id, "Abmahnung Fall Huber Vorlage", "Text");
    await test.services.versions.publish(owner, moved);
    await test.services.tree.update(owner, moved, { title: "Abmahnung Vorlage" });
    await test.services.versions.publish(owner, moved);
    const internalNumber = await numberOf(moved, internal.id);
    await test.services.tree.move(owner, moved, { spaceId: open.id, parentId: null });
    const draftedNumber = await numberOf(drafted, open.id);
    const movedNumber = await numberOf(moved, open.id);

    const files = await site(owner, open.id, null);
    const names = [...files.keys()].join("\n");
    const redirects = files.get("_redirects")?.toString("utf8") ?? "";
    for (const hidden of ["entlassungen", "zwischenstand", "kuendigungen", "huber"]) {
      expect(names).not.toContain(hidden);
      expect(redirects).not.toContain(hidden);
    }
    expect(files.has(`${draftedNumber}-standortwechsel-faq.html`)).toBe(true);
    expect(files.has(`${movedNumber}-abmahnung-vorlage.html`)).toBe(true);

    const portal = await test.services.portals.config(open.id);
    const internalPortal = await test.services.portals.config(internal.id);
    if (!portal || !internalPortal) throw new Error("missing portal");
    const reader = test.services.portalReader;
    expect(
      await reader.article(ANONYMOUS, portal, draftedNumber, "entlassungen-standort-nord-intern", "en"),
    ).toBeNull();
    expect(await reader.article(ANONYMOUS, portal, draftedNumber, "zwischenstand-umzug", "en")).toBeNull();
    expect(
      await reader.article(ANONYMOUS, portal, movedNumber, "abmahnung-fall-huber-vorlage", "en"),
    ).toBeNull();
    expect(
      await reader.article(ANONYMOUS, portal, draftedNumber, "standortwechsel-faq", "en"),
    ).not.toBeNull();
    expect(
      await reader.article(owner, internalPortal, internalNumber, "abmahnung-fall-huber-vorlage", "en"),
    ).toMatchObject({ type: "redirect", number: movedNumber });
  }, 120_000);

  it("keeps titles of linked pages out of both search indexes", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const open = await knowledgeBase(owner, organization.id, "public");
    const secret = await fixtures.space(organization.id, organization.owner);
    const hidden = await test.services.tree.create(owner, secret.id, {
      kind: "page",
      title: "Aufhebungsvertrag Huber",
      placement: { parentId: null },
    });
    const entry = await test.services.tree.create(owner, open.id, {
      kind: "page",
      title: "Laptop zurückgeben",
      placement: { parentId: null },
    });
    await test.services.documents.replace(owner, entry.id, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Gib den Laptop ab. " },
            {
              type: "pageLink",
              attrs: { pageId: hidden.id, spaceId: secret.id, title: "Aufhebungsvertrag Huber" },
            },
          ],
        },
      ],
    });
    await test.services.versions.publish(owner, entry.id);
    await test.services.search.indexer.drain();

    const files = await site(owner, open.id, null);
    const index = files.get("search-index.json")?.toString("utf8") ?? "";
    expect(index).toContain("Gib den Laptop ab");
    expect(index).not.toContain("Aufhebungsvertrag");
    expect(index).not.toContain("Huber");
    const config = await test.services.portals.config(open.id);
    if (!config) throw new Error("missing portal");
    const search = (query: string) =>
      test.services.portalReader.search(ANONYMOUS, config, {
        query,
        categoryId: null,
        type: null,
        cursor: null,
      });
    expect((await search("Huber")).results).toEqual([]);
    const found = await search("Laptop");
    expect(found.results).toHaveLength(1);
    expect(JSON.stringify(found.results[0]?.excerpt)).not.toContain("Huber");
  }, 120_000);

  it("shows the text of an article as the excerpt of a search result, not its section headings", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const open = await knowledgeBase(owner, organization.id, "public");
    const entry = await test.services.tree.create(owner, open.id, {
      kind: "page",
      title: "VPN disconnects",
      placement: { parentId: null },
    });
    const heading = (text: string) => ({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text }],
    });
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    await test.services.documents.replace(owner, entry.id, {
      type: "doc",
      content: [
        heading("What you see"),
        paragraph("The VPN drops after a few minutes."),
        heading("Cause"),
        paragraph("The router closes idle connections."),
      ],
    });
    await test.services.versions.publish(owner, entry.id);

    const files = await site(owner, open.id, null);
    const index = MiniSearch.loadJSON(
      files.get("search-index.json")?.toString("utf8") ?? "",
      STATIC_SEARCH_OPTIONS,
    );
    const [found] = index.search("vpn", { prefix: true });
    expect(found?.excerpt).toBe("The VPN drops after a few minutes. The router closes idle connections.");
  }, 120_000);

  it("leaves restricted, unpublished, trashed and turned-off articles out of every file", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const open = await knowledgeBase(owner, organization.id, "public");
    const category = await test.services.tree.create(owner, open.id, {
      kind: "folder",
      title: "Hardware",
      placement: { parentId: null },
    });
    const place = async (title: string, text: string) => {
      const created = await test.services.tree.create(owner, open.id, {
        kind: "page",
        title,
        placement: { parentId: category.id },
      });
      await test.services.documents.replace(owner, created.id, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      return created.id;
    };
    const visible = await place("Drucker einrichten", "Sichtbarer Text");
    await test.services.versions.publish(owner, visible);
    const restricted = await place("Geheimprojekt Nord", "Geheimer Text");
    await test.services.versions.publish(owner, restricted);
    await test.services.tree.update(owner, restricted, { title: "Geheimprojekt Nord neu" });
    await test.services.versions.publish(owner, restricted);
    await test.services.pageAccess.change(owner, restricted, [{ action: "restrict", kind: "view" }]);
    await place("Entwurf Umzug", "Entwurfstext");
    const trashed = await place("Altes Telefon", "Papierkorbtext");
    await test.services.versions.publish(owner, trashed);
    await test.services.trash.deleteItem(owner, trashed);
    await test.services.translations.update(owner, open.id, { languages: ["en", "de"] });
    const german = await test.services.translations.create(owner, visible, "de");
    await test.services.documents.replace(owner, german.id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Ausgeschaltete Sprache" }] }],
    });
    await test.services.tree.update(owner, german.id, { title: "Drucker auf Deutsch" });
    await test.services.versions.publish(owner, german.id);
    await test.services.translations.update(owner, open.id, { languages: ["en"] });

    const files = await site(owner, open.id, "https://help.example.org/");
    const everything = [...files.entries()]
      .filter(([path]) => /\.(html|json|xml|txt)$|_redirects$/.test(path))
      .map(([path, content]) => `${path}\n${content.toString("utf8")}`)
      .join("\n");
    expect(everything).toContain("Sichtbarer Text");
    for (const hidden of [
      "Geheimprojekt",
      "geheimprojekt",
      "Geheimer Text",
      "Entwurf",
      "entwurf",
      "Altes Telefon",
      "altes-telefon",
      "Papierkorbtext",
      "Ausgeschaltete Sprache",
      "Drucker auf Deutsch",
    ]) {
      expect(everything, hidden).not.toContain(hidden);
    }
    expect([...files.keys()].some((path) => path.startsWith("de/"))).toBe(false);
    const topic = files.get(`topics/${category.id}.html`)?.toString("utf8") ?? "";
    expect(topic).toContain(">Drucker einrichten<");
    const start = files.get("index.html")?.toString("utf8") ?? "";
    expect(start).toContain("1 article");
    expect(start).not.toMatch(/[2-9] articles/);
  }, 120_000);

  it("leaves out files of other spaces that an article points to", async () => {
    const organization = await fixtures.organization();
    const owner = accountPrincipal(organization.owner);
    const name = `Help ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      owner,
      organization.id,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        audience: "public",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    const secret = await fixtures.space(organization.id, organization.owner);
    const hidden = await test.services.tree.create(owner, secret.id, {
      kind: "page",
      title: "Salaries",
      placement: { parentId: null },
    });
    const leaked = await test.services.attachments.upload(owner, hidden.id, {
      name: "salaries.png",
      body: Readable.from([PNG]),
      contentLength: PNG.length,
    });
    const article = await test.services.tree.create(owner, kb.id, {
      kind: "page",
      title: "Printer",
      placement: { parentId: null },
    });
    const own = await test.services.attachments.upload(owner, article.id, {
      name: "printer.png",
      body: Readable.from([PNG]),
      contentLength: PNG.length,
    });
    await test.services.documents.replace(owner, article.id, {
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: own.id, alt: "Printer" } },
        { type: "image", attrs: { attachmentId: leaked.id, alt: "Chart" } },
      ],
    });
    await test.services.versions.publish(owner, article.id);
    await test.services.versions.publish(owner, hidden.id);

    const files = await site(owner, kb.id, null);
    const paths = [...files.keys()];
    expect(paths.some((path) => path.includes(own.id))).toBe(true);
    expect(paths.some((path) => path.includes(leaked.id))).toBe(false);
    const everything = [...files.values()].map((content) => content.toString("latin1")).join("\n");
    expect(everything).not.toMatch(new RegExp(`(src|href)="[^"]*${leaked.id}`));
  }, 120_000);
});
