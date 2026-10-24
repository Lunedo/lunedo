import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type DocumentJson, extractSections, type NodeJson, plainText } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import MiniSearch from "minisearch";
import { ANONYMOUS } from "../../accounts/principal.js";
import type { Database } from "../../database/database.js";
import type { ArchiveEntry } from "../../exports/archive.js";
import type { AttachmentService } from "../../files/attachments.js";
import type { DisplayVersionService } from "../../files/display-versions.js";
import type { FileService } from "../../files/files.js";
import type { OrganizationService } from "../../organizations/organizations.js";
import { SpaceError } from "../../spaces/common.js";
import { migrated } from "../../spaces/documents.js";
import type { ArticleAddresses, ArticleRenderer } from "../articles.js";
import { brandValues, interfaceLanguage, type PortalConfig, type PortalService } from "../portals.js";
import type { PortalArticle, PortalArticleSummary, PortalCategory, PortalReader } from "../reader.js";
import { fontFile, fontFiles, portalCss, portalScript, staticSearchScript } from "./assets.js";
import { escapeHtml } from "./html.js";
import { languageName, messagesFor } from "./messages.js";
import {
  articlePage,
  categoryPage,
  contactPage,
  folderTrail,
  type LanguageLink,
  notFoundPage,
  type PortalLinks,
  type PortalView,
  startPage,
  staticSearchPage,
} from "./views.js";

const require = createRequire(import.meta.url);
const EXCERPT = 240;
const MAX_INDEXED_TEXT = 20_000;

export const STATIC_SEARCH_OPTIONS = {
  fields: ["title", "text", "category"],
  storeFields: ["title", "url", "excerpt", "category", "type", "number"],
};

interface SiteArticle {
  itemId: string;
  versionId: string;
  number: number;
  slug: string;
  language: string;
  title: string;
  type: PortalArticleSummary["type"];
  folderIds: string[];
  oldSlugs: string[];
  document: DocumentJson;
  found: PortalArticle;
}

interface SiteFile {
  attachmentId: string;
  extension: string;
  display: boolean;
}

interface FileInfo {
  name: string;
  displayExtension: string;
}

const TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
};

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match?.[1] ? `.${match[1].toLowerCase()}` : "";
}

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function excerptOf(article: SiteArticle): string {
  const lead = article.found.lead.trim();
  const text =
    lead ||
    extractSections(article.document)
      .map((section) => section.text)
      .join(" ");
  return text.replace(/\s+/g, " ").trim().slice(0, EXCERPT);
}

function up(depth: number): string {
  return depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
}

function redirectPage(target: string, title: string): string {
  const href = escapeHtml(target);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><meta http-equiv="refresh" content="0; url=${href}"><link rel="canonical" href="${href}"></head><body><p><a href="${href}">${escapeHtml(title)}</a></p></body></html>`;
}

export interface StaticSiteOptions {
  siteUrl: string | null;
  now: Date;
}

export class StaticSiteBuilder {
  readonly #database: Database;
  readonly #portals: PortalService;
  readonly #reader: PortalReader;
  readonly #renderer: ArticleRenderer;
  readonly #attachments: AttachmentService;
  readonly #displayVersions: DisplayVersionService;
  readonly #files: FileService;
  readonly #organizations: OrganizationService;

  constructor(options: {
    database: Database;
    portals: PortalService;
    reader: PortalReader;
    renderer: ArticleRenderer;
    attachments: AttachmentService;
    displayVersions: DisplayVersionService;
    files: FileService;
    organizations: OrganizationService;
  }) {
    this.#database = options.database;
    this.#portals = options.portals;
    this.#reader = options.reader;
    this.#renderer = options.renderer;
    this.#attachments = options.attachments;
    this.#displayVersions = options.displayVersions;
    this.#files = options.files;
    this.#organizations = options.organizations;
  }

  async config(spaceId: string): Promise<PortalConfig> {
    const config = await this.#portals.config(spaceId);
    if (!config) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    if (config.audience !== "public") {
      throw new SpaceError(
        "staticSiteNotPublic",
        "Only public knowledge bases can be downloaded as a static website, because a static website has no sign-in.",
      );
    }
    return config;
  }

  async #articles(config: PortalConfig): Promise<SiteArticle[]> {
    const result = await this.#database.execute<{
      id: string;
      version_id: string;
      number: number;
      slug: string;
      language: string;
      title: string;
      article_type: PortalArticleSummary["type"];
      path: string[];
      old_slugs: string[];
      document: unknown;
      schema_version: number;
    }>(sql`
      select t.id, v.id as version_id, n.number, coalesce(article_slug(v.title), '') as slug,
        case when t.translation_of is null then ${config.defaultLanguage} else t.content_language end as language,
        v.title, t.article_type, array_remove(t.path, t.translation_of) as path,
        array(select sl.slug from article_slugs sl where sl.item_id = t.id and sl.space_id = t.space_id
          and sl.slug <> coalesce(article_slug(v.title), '') and sl.slug <> '' order by sl.slug) as old_slugs,
        v.document, v.schema_version
      from tree_items t
      join page_versions v on v.id = t.published_version_id
      join article_numbers n on n.item_id = coalesce(t.translation_of, t.id) and n.space_id = t.space_id
      where t.space_id = ${config.spaceId} and t.kind = 'page' and t.reader_visible
        and (t.translation_of is null or t.content_language = any(${sql.param([...config.languages])}::text[]))
      order by n.number, t.id`);
    const articles: SiteArticle[] = [];
    for (const row of result.rows) {
      const found = await this.#reader.article(ANONYMOUS, config, Number(row.number), row.slug, row.language);
      if (found?.type !== "found" || found.article.itemId !== row.id || found.article.fallback) continue;
      articles.push({
        itemId: row.id,
        versionId: row.version_id,
        number: Number(row.number),
        slug: row.slug,
        language: row.language,
        title: row.title,
        type: row.article_type,
        folderIds: found.article.folderIds,
        oldSlugs: row.old_slugs,
        document: migrated(row.document, row.schema_version),
        found: found.article,
      });
    }
    return articles;
  }

  async #fileNames(config: PortalConfig, articles: SiteArticle[]): Promise<Map<string, FileInfo>> {
    const ids = new Set<string>();
    for (const article of articles) {
      walk(article.document as NodeJson, (node) => {
        const attachmentId = node.attrs?.attachmentId;
        if (typeof attachmentId === "string") ids.add(attachmentId);
        for (const mark of node.marks ?? []) {
          const markId = mark.attrs?.attachmentId;
          if (typeof markId === "string") ids.add(markId);
        }
      });
    }
    if (ids.size === 0) return new Map();
    const info = new Map<string, FileInfo>();
    for (const id of ids) {
      const found = await this.#attachments.get(ANONYMOUS, id.toLowerCase(), "published");
      if (!found || !(await this.#reader.readable(ANONYMOUS, config, found.itemId))) continue;
      const content = await this.#attachments.content(found.id, "published");
      const shown = content ? await this.#displayVersions.apply(content, "display") : null;
      info.set(id, {
        name: found.name,
        displayExtension: (shown && TYPE_EXTENSIONS[shown.contentType]) || extensionOf(found.name),
      });
    }
    return info;
  }

  async entries(spaceId: string, options: StaticSiteOptions): Promise<ArchiveEntry[]> {
    const config = await this.config(spaceId);
    const articles = await this.#articles(config);
    const names = await this.#fileNames(config, articles);
    const files = new Map<string, SiteFile>();
    const entries: ArchiveEntry[] = [];
    const mtime = options.now;
    const text = (path: string, content: string, compress = true) =>
      entries.push({ path, mtime, compress, content: async () => Buffer.from(content, "utf8") });
    const languages = [
      config.defaultLanguage,
      ...config.languages.filter((language) => language !== config.defaultLanguage).sort(),
    ];
    const folder = (language: string) => (language === config.defaultLanguage ? "" : `${language}/`);
    const summaryOf = (article: SiteArticle): PortalArticleSummary => ({
      itemId: article.itemId,
      number: article.number,
      slug: article.slug,
      language: article.language,
      title: article.title,
      type: article.type,
      folderIds: article.folderIds,
      updatedAt: article.found.updatedAt,
      reviewedAt: article.found.reviewedAt,
      views: 0,
    });
    const byNumber = new Map<number, Map<string, SiteArticle>>();
    for (const article of articles) {
      const versions = byNumber.get(article.number) ?? new Map<string, SiteArticle>();
      versions.set(article.language, article);
      byNumber.set(article.number, versions);
    }
    const articleFile = (article: { number: number; slug: string; language: string }) =>
      `${folder(article.language)}${article.number}${article.slug ? `-${article.slug}` : ""}.html`;
    const fileOf = (attachmentId: string, display: boolean) => {
      const info = names.get(attachmentId);
      if (!info) return null;
      const extension = display ? (info?.displayExtension ?? "") : extensionOf(info?.name ?? "");
      const key = `${attachmentId}${display ? "-display" : ""}`;
      files.set(key, { attachmentId, extension, display });
      return `files/${key}${extension}`;
    };
    const absolute = (path: string) =>
      options.siteUrl ? `${options.siteUrl.replace(/\/+$/, "")}/${path}` : null;
    const logo = config.logoRef
      ? await this.#portals.logo(config.spaceId)
      : config.organizationLogoRef
        ? await this.#organizations.logo(config.organizationId)
        : null;
    const logoPath = logo
      ? `_assets/logo${logo.contentType === "image/png" ? ".png" : logo.contentType === "image/webp" ? ".webp" : ".jpg"}`
      : null;
    if (logo && logoPath)
      entries.push({ path: logoPath, mtime, compress: false, content: async () => logo.data });

    const view = (
      language: string,
      depth: number,
      categories: PortalCategory[],
      pageLanguages: Pick<PortalView, "languageLinks" | "alternates">,
      options: { lang?: string; note?: PortalView["note"] } = {},
    ): PortalView => {
      const root = up(depth);
      const base = language === config.defaultLanguage ? root : `${root}/${language}`;
      const t = messagesFor(interfaceLanguage(options.lang ?? language));
      const brand = brandValues(config.brand);
      const links: PortalLinks = {
        home: `${base}/index.html`,
        article: (article) =>
          `${root}/${articleFile({ ...article, language: article.language ?? language })}`,
        category: (id) => `${base}/topics/${id}.html`,
        search: (query) => `${base}/search.html${query ? `?q=${encodeURIComponent(query)}` : ""}`,
        searchAction: `${base}/search.html`,
        contact: (query) => `${base}/contact.html${query ? `?q=${encodeURIComponent(query)}` : ""}`,
        share: (article) => absolute(articleFile({ ...article, language: article.language ?? language })),
      };
      return {
        config,
        t,
        lang: options.lang ?? language,
        root,
        base,
        links,
        static: true,
        ...pageLanguages,
        note: options.note ?? null,
        maintenance: null,
        frameSources: [],
        origin: "",
        nonce: "",
        assets: { style: `${root}/_assets/portal.css`, script: `${root}/_assets/portal.js` },
        brandStyle: `:root{--kb:${brand.light}}@media (prefers-color-scheme:dark){:root{--kb:${brand.dark}}}`,
        logoUrl: logoPath ? `${root}/${logoPath}` : null,
        account: null,
        appLink: null,
        accountLink: null,
        signInUrl: null,
        signOutUrl: "",
        categories,
      };
    };
    const languageLinks = (
      current: string,
      depth: number,
      path: (language: string) => string,
    ): LanguageLink[] =>
      languages.length < 2
        ? []
        : languages.map((language) => ({
            language,
            label: languageName(language, language),
            href: `${up(depth)}/${path(language)}`,
            current: language === current,
          }));
    const alternates = (entries: { language: string; path: string }[]) => {
      if (!options.siteUrl || languages.length < 2 || entries.length === 0) return [];
      const fallback = entries.find((entry) => entry.language === config.defaultLanguage) ?? entries[0];
      return [
        ...entries.map((entry) => ({ hreflang: entry.language, href: absolute(entry.path) ?? "" })),
        ...(fallback ? [{ hreflang: "x-default", href: absolute(fallback.path) ?? "" }] : []),
      ];
    };
    const sitemap: string[] = [];
    const pageFor = (language: string, path: string) => {
      const file = `${folder(language)}${path}`;
      sitemap.push(file);
      return file;
    };
    const pageLanguages = (current: string, depth: number, path: string) => ({
      languageLinks: languageLinks(current, depth, (language) => `${folder(language)}${path}`),
      alternates: alternates(languages.map((language) => ({ language, path: `${folder(language)}${path}` }))),
    });

    const categoriesOf = new Map<string, PortalCategory[]>();
    for (const language of languages) {
      const depth = language === config.defaultLanguage ? 0 : 1;
      const shown = [...byNumber.values()]
        .flatMap((versions) => {
          const article = versions.get(language) ?? versions.get(config.defaultLanguage);
          return article ? [summaryOf(article)] : [];
        })
        .sort((left, right) => left.title.localeCompare(right.title, language));
      const counted = new Map<string, number>();
      for (const summary of shown) {
        for (const id of summary.folderIds) counted.set(id, (counted.get(id) ?? 0) + 1);
      }
      const categories = await this.#reader.countedCategories(ANONYMOUS, config, counted);
      categoriesOf.set(language, categories);
      const listed = (categoryId: string | null) => {
        const list = shown.filter((summary) => categoryId === null || summary.folderIds.includes(categoryId));
        const howTo = list.filter((summary) => summary.type === "howTo").length;
        const troubleshooting = list.filter((summary) => summary.type === "troubleshooting").length;
        return {
          articles: list,
          total: list.length,
          typeCounts: { all: list.length, howTo, troubleshooting },
        };
      };
      const everything = listed(null);
      const recent = [...everything.articles]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 5);
      text(
        pageFor(language, "index.html"),
        startPage(view(language, depth, categories, pageLanguages(language, depth, "index.html")), {
          mostRead: [],
          recent,
          frequent: [],
        }),
      );
      for (const category of categories) {
        const list = listed(category.id);
        const path = `topics/${category.id}.html`;
        text(
          pageFor(language, path),
          categoryPage(
            view(language, depth + 1, categories, pageLanguages(language, depth + 1, path)),
            category,
            list,
            {
              type: null,
              sort: "title",
              page: 1,
            },
            Math.max(list.total, 1),
          ),
        );
      }
      text(
        `${folder(language)}contact.html`,
        contactPage(view(language, depth, categories, pageLanguages(language, depth, "contact.html")), ""),
      );
      const fallback = language !== config.defaultLanguage;
      text(
        `${folder(language)}search.html`,
        staticSearchPage(view(language, depth, categories, pageLanguages(language, depth, "search.html")), {
          index: "search-index.json",
          base: fallback ? "../" : "",
          fallbackIndex: fallback ? `${up(depth)}/search-index.json` : null,
          fallbackBase: fallback ? "../" : null,
          fallbackLanguage: config.defaultLanguage,
        }),
      );
      const index = new MiniSearch(STATIC_SEARCH_OPTIONS);
      index.addAll(
        everything.articles.flatMap((summary) => {
          const article = byNumber.get(summary.number)?.get(summary.language);
          if (!article || article.language !== language) return [];
          const body = plainText(article.document).slice(0, MAX_INDEXED_TEXT);
          const trail = folderTrail(categories, summary.folderIds);
          return [
            {
              id: `${summary.language}:${summary.number}`,
              number: summary.number,
              title: summary.title,
              text: body,
              category: trail.map((entry) => entry.title).join(" › "),
              type: summary.type ?? "",
              url: articleFile(article),
              excerpt: excerptOf(article),
            },
          ];
        }),
      );
      text(`${folder(language)}search-index.json`, JSON.stringify(index));
    }

    for (const article of articles) {
      const depth = article.language === config.defaultLanguage ? 0 : 1;
      const root = up(depth);
      const addresses: ArticleAddresses = {
        page: (number) => {
          const versions = byNumber.get(number);
          const target = versions?.get(article.language) ?? versions?.get(config.defaultLanguage);
          return target ? `${root}/${articleFile(target)}` : "";
        },
        file: (attachmentId, display) => {
          const path = fileOf(attachmentId, display);
          return path ? `${root}/${path}` : "";
        },
      };
      const content = await this.#renderer.renderDocument(
        {
          spaceId: config.spaceId,
          itemId: article.itemId,
          language: article.language,
          document: article.document,
        },
        interfaceLanguage(article.language),
        addresses,
        ANONYMOUS,
      );
      const categories = categoriesOf.get(article.language) ?? [];
      const versions = [...(byNumber.get(article.number)?.values() ?? [])];
      const page: PortalArticle = { ...article.found, html: content.html, headings: content.headings };
      const path = articleFile(article);
      sitemap.push(path);
      const pageView = view(article.language, depth, categories, {
        languageLinks: languageLinks(article.language, depth, (language) => {
          const target = versions.find((entry) => entry.language === language);
          return target ? articleFile(target) : `${folder(language)}index.html`;
        }),
        alternates: alternates(
          versions.map((entry) => ({ language: entry.language, path: articleFile(entry) })),
        ),
      });
      text(path, articlePage(pageView, page, { related: [], similar: [], editUrl: null }));
      for (const old of [...article.oldSlugs, ""]) {
        const redirect = `${folder(article.language)}${article.number}${old ? `-${old}` : ""}.html`;
        if (redirect === path) continue;
        text(redirect, redirectPage(`${root}/${path}`, article.title));
      }
    }

    const notFoundView = view(config.defaultLanguage, 0, categoriesOf.get(config.defaultLanguage) ?? [], {
      languageLinks: [],
      alternates: [],
    });
    text("404.html", notFoundPage(notFoundView));

    const redirects: string[] = [];
    for (const article of articles) {
      const target = `/${articleFile(article).replace(/\.html$/, "")}`;
      for (const old of [...article.oldSlugs, ""]) {
        const source = `/${folder(article.language)}${article.number}${old ? `-${old}` : ""}`;
        if (source === target) continue;
        redirects.push(`${source} ${target} 301`, `${source}.html ${target} 301`);
      }
    }
    text("_redirects", `${redirects.join("\n")}\n`);
    if (options.siteUrl) {
      const urls = sitemap
        .map((path) => `<url><loc>${escapeHtml(absolute(path) ?? "")}</loc></url>`)
        .join("");
      text(
        "sitemap.xml",
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
      );
      text("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${absolute("sitemap.xml")}\n`);
    }
    text("_assets/portal.css", portalCss);
    text("_assets/portal.js", portalScript);
    text("_assets/static-search.js", staticSearchScript);
    text(
      "_assets/minisearch.js",
      readFileSync(join(dirname(require.resolve("minisearch")), "../umd/index.js"), "utf8").replace(
        /\n\/\/# sourceMappingURL=\S+\s*$/,
        "\n",
      ),
    );
    for (const name of fontFiles()) {
      const font = fontFile(name);
      if (font)
        entries.push({ path: `_assets/fonts/${name}`, mtime, compress: false, content: async () => font });
    }
    for (const [key, file] of files) {
      entries.push({
        path: `files/${key}${file.extension}`,
        mtime,
        compress: false,
        content: async () => {
          const content = await this.#attachments.content(file.attachmentId, "published");
          if (!content) return Buffer.alloc(0);
          const shown = file.display
            ? ((await this.#displayVersions.apply(content, "display")) ?? content)
            : content;
          return this.#files.read(shown.fileId);
        },
      });
    }
    return entries;
  }
}
